import { getFilePath } from '../constants/fileTypes.js';

const DB_NAME = 'forge_workspace_db';
const DB_VERSION = 1;
const META_STORE = 'workspace_meta';
const FILES_STORE = 'workspace_files';
const META_KEY = 'current';

let cachedDbPromise = null;

function getIndexedDbFactory() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.indexedDB || null;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function resetCachedDb() {
  cachedDbPromise = null;
}

function openDatabase() {
  const idb = getIndexedDbFactory();
  if (!idb) {
    return Promise.reject(new Error('IndexedDB is not available in this browser environment.'));
  }

  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise((resolve, reject) => {
    let settled = false;
    let request;

    try {
      request = idb.open(DB_NAME, DB_VERSION);
    } catch (err) {
      resetCachedDb();
      reject(err);
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const upgradeTx = event.target.transaction || request.transaction;
      try {
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          const filesStore = db.createObjectStore(FILES_STORE, { keyPath: 'id' });
          filesStore.createIndex('by_path', 'path', { unique: false });
        }
      } catch (err) {
        try {
          upgradeTx?.abort();
        } catch {
          // Ignore if upgrade transaction already aborted or finished
        }
        if (!settled) {
          settled = true;
          resetCachedDb();
          reject(err);
        }
      }
    };

    request.onblocked = () => {
      if (!settled) {
        settled = true;
        resetCachedDb();
        reject(new Error('IndexedDB upgrade was blocked by another open tab.'));
      }
    };

    request.onerror = () => {
      if (!settled) {
        settled = true;
        resetCachedDb();
        reject(request.error || new Error('Failed to open IndexedDB workspace database.'));
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        // Close connection if open succeeded after onblocked/onerror already rejected
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        resetCachedDb();
      };
      db.onclose = () => {
        resetCachedDb();
      };
      resolve(db);
    };
  });

  return cachedDbPromise;
}

async function runTransaction(storeNames, mode, executor) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      resetCachedDb();
      reject(err);
      return;
    }

    let resultValue;
    let settled = false;
    let txCompleted = false;
    let execDone = false;

    const tryResolve = () => {
      if (!settled && txCompleted && execDone) {
        settled = true;
        resolve(resultValue);
      }
    };

    tx.oncomplete = () => {
      txCompleted = true;
      tryResolve();
    };

    tx.onerror = () => {
      if (!settled) {
        settled = true;
        resetCachedDb();
        reject(tx.error || new Error('IndexedDB transaction failed.'));
      }
    };

    tx.onabort = () => {
      if (!settled) {
        settled = true;
        resetCachedDb();
        reject(tx.error || new Error('IndexedDB transaction was aborted.'));
      }
    };

    const stores = {};
    for (const name of storeNames) {
      stores[name] = tx.objectStore(name);
    }

    try {
      Promise.resolve(executor(stores))
        .then((val) => {
          resultValue = val;
          execDone = true;
          tryResolve();
        })
        .catch((err) => {
          try {
            tx.abort();
          } catch {
            // Ignore if transaction already finished
          }
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // Ignore if transaction already finished
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
    }
  });
}

export const indexedDbStorage = {
  isAvailable() {
    return Boolean(getIndexedDbFactory());
  },

  async loadWorkspace() {
    return runTransaction([META_STORE, FILES_STORE], 'readonly', async (stores) => {
      const [meta, files] = await Promise.all([
        requestToPromise(stores[META_STORE].get(META_KEY)),
        requestToPromise(stores[FILES_STORE].getAll()),
      ]);

      if (!meta && (!files || files.length === 0)) {
        return null;
      }

      return {
        files: Array.isArray(files) ? files : [],
        projectName: meta?.projectName || 'Forge Core',
        projectSource: meta?.projectSource || { type: 'local' },
      };
    });
  },

  async replaceWorkspace({ files = [], projectName = 'Forge Core', projectSource = { type: 'local' } }) {
    return runTransaction([META_STORE, FILES_STORE], 'readwrite', async (stores) => {
      const seenPaths = new Set();
      stores[FILES_STORE].clear();
      for (const file of files) {
        const normalizedPath = getFilePath(file);
        if (!normalizedPath || seenPaths.has(normalizedPath)) continue;
        seenPaths.add(normalizedPath);
        const record = file.path === normalizedPath ? file : { ...file, path: normalizedPath };
        stores[FILES_STORE].put(record);
      }
      stores[META_STORE].put({
        key: META_KEY,
        projectName,
        projectSource,
        updatedAt: Date.now(),
      });
    });
  },

  async appendFiles(newFiles = [], metadataPatch = null) {
    if (newFiles.length === 0 && !metadataPatch) {
      return;
    }

    return runTransaction([META_STORE, FILES_STORE], 'readwrite', async (stores) => {
      const filesStore = stores[FILES_STORE];
      const pathIndex = filesStore.index('by_path');
      const seenInTx = new Set();

      for (const file of newFiles) {
        const filePath = getFilePath(file);
        if (!filePath || seenInTx.has(filePath)) continue;
        seenInTx.add(filePath);

        const existingKey = await requestToPromise(pathIndex.getKey(filePath));
        if (existingKey === undefined) {
          const record = file.path === filePath ? file : { ...file, path: filePath };
          filesStore.put(record);
        }
      }

      if (metadataPatch) {
        const existingMeta = await requestToPromise(stores[META_STORE].get(META_KEY));
        stores[META_STORE].put({
          key: META_KEY,
          projectName: metadataPatch.projectName ?? existingMeta?.projectName ?? 'Forge Core',
          projectSource: metadataPatch.projectSource ?? existingMeta?.projectSource ?? { type: 'local' },
          updatedAt: Date.now(),
        });
      }
    });
  },

  async removeFile(fileId, metadataPatch = null) {
    if (!fileId) return;

    return runTransaction([META_STORE, FILES_STORE], 'readwrite', async (stores) => {
      stores[FILES_STORE].delete(fileId);
      const existingMeta = await requestToPromise(stores[META_STORE].get(META_KEY));
      if (existingMeta || metadataPatch) {
        stores[META_STORE].put({
          key: META_KEY,
          projectName: metadataPatch?.projectName ?? existingMeta?.projectName ?? 'Forge Core',
          projectSource: metadataPatch?.projectSource ?? existingMeta?.projectSource ?? { type: 'local' },
          updatedAt: Date.now(),
        });
      }
    });
  },

  async updateMetadata(metadataPatch = {}) {
    return runTransaction([META_STORE], 'readwrite', async (stores) => {
      const existingMeta = await requestToPromise(stores[META_STORE].get(META_KEY));
      stores[META_STORE].put({
        key: META_KEY,
        projectName: metadataPatch.projectName ?? existingMeta?.projectName ?? 'Forge Core',
        projectSource: metadataPatch.projectSource ?? existingMeta?.projectSource ?? { type: 'local' },
        updatedAt: Date.now(),
      });
    });
  },

  async clearWorkspace({ projectName = 'Forge Core', projectSource = { type: 'local' } } = {}) {
    return runTransaction([META_STORE, FILES_STORE], 'readwrite', async (stores) => {
      stores[FILES_STORE].clear();
      stores[META_STORE].put({
        key: META_KEY,
        projectName,
        projectSource,
        updatedAt: Date.now(),
      });
    });
  },
};
