import { indexedDbStorage } from './indexedDbStorage.js';

/**
 * Creates a provider-agnostic workspace storage service.
 * Serializes write operations so overlapping async updates never finish out of order,
 * prevents failed writes from blocking subsequent writes, and returns `{ ok, unavailable, data, error }`.
 */
export function createWorkspaceStorage(adapter = indexedDbStorage) {
  let writeQueue = Promise.resolve();

  function enqueueWrite(operation) {
    const run = writeQueue.then(operation, operation);
    writeQueue = run.catch(() => {});
    return run;
  }

  async function safeExecute(fn, fallbackData = undefined) {
    try {
      if (!adapter?.isAvailable?.()) {
        return {
          ok: false,
          unavailable: true,
          data: fallbackData,
          error: 'Persistent browser storage (IndexedDB) is unavailable.',
        };
      }
      const data = await fn();
      return { ok: true, unavailable: false, data, error: null };
    } catch (err) {
      return {
        ok: false,
        unavailable: false,
        data: fallbackData,
        error: err?.message || 'Workspace storage operation failed.',
      };
    }
  }

  return {
    isAvailable() {
      try {
        return Boolean(adapter?.isAvailable?.());
      } catch {
        return false;
      }
    },

    async loadWorkspace() {
      await writeQueue;
      return safeExecute(() => adapter.loadWorkspace(), null);
    },

    replaceWorkspace(snapshot) {
      return enqueueWrite(() => safeExecute(() => adapter.replaceWorkspace(snapshot)));
    },

    appendFiles(newFiles = [], metadataPatch = null) {
      if (newFiles.length === 0 && !metadataPatch) {
        return Promise.resolve({ ok: true, unavailable: false, error: null });
      }
      return enqueueWrite(() => safeExecute(() => adapter.appendFiles(newFiles, metadataPatch)));
    },

    removeFile(fileId, metadataPatch = null) {
      if (!fileId) {
        return Promise.resolve({ ok: true, unavailable: false, error: null });
      }
      return enqueueWrite(() => safeExecute(() => adapter.removeFile(fileId, metadataPatch)));
    },

    updateMetadata(metadataPatch) {
      if (!metadataPatch || Object.keys(metadataPatch).length === 0) {
        return Promise.resolve({ ok: true, unavailable: false, error: null });
      }
      return enqueueWrite(() => safeExecute(() => adapter.updateMetadata(metadataPatch)));
    },

    clearWorkspace(snapshot) {
      return enqueueWrite(() => safeExecute(() => adapter.clearWorkspace(snapshot)));
    },
  };
}

export const workspaceStorage = createWorkspaceStorage(indexedDbStorage);
