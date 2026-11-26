import { chunkWorkspaceFiles } from './codeChunker.js';
import { workspaceStorage } from './workspaceStorage.js';

export const EMBEDDING_MODEL_ID = 'onnx-community/all-MiniLM-L6-v2-ONNX';
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Computes a fast, deterministic FNV-1a 32-bit hex hash for chunk content validation.
 *
 * @param {string} text
 * @returns {string}
 */
export function computeContentHash(text = '') {
  const str = typeof text === 'string' ? text : '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Validates that a cached or worker-returned embedding record matches the expected
 * chunk identity, content hash, model ID, and vector dimensions.
 *
 * @param {object} record
 * @param {object|null} [expectedChunk]
 * @param {object} [options]
 * @returns {boolean}
 */
export function isValidEmbeddingRecord(
  record,
  expectedChunk = null,
  { modelId = EMBEDDING_MODEL_ID, dimensions = EMBEDDING_DIMENSIONS } = {}
) {
  if (!record || !record.chunkId || !record.fileId) return false;
  if (!record.modelId || record.modelId !== modelId) return false;
  if (typeof record.dimensions === 'number' && record.dimensions !== dimensions) return false;

  const vec = record.vector;
  if (!vec || typeof vec.length !== 'number' || vec.length !== dimensions) {
    return false;
  }

  for (let i = 0; i < vec.length; i++) {
    if (typeof vec[i] !== 'number' || !Number.isFinite(vec[i])) {
      return false;
    }
  }

  if (expectedChunk) {
    if (record.chunkId !== expectedChunk.chunkId || record.fileId !== expectedChunk.fileId) {
      return false;
    }
    const expectedHash = computeContentHash(expectedChunk.searchText || expectedChunk.content || '');
    if (record.contentHash !== expectedHash) {
      return false;
    }
  }

  return true;
}

function defaultWorkerFactory() {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('../workers/embeddingWorker.js', import.meta.url), {
    type: 'module',
  });
}

/**
 * Creates a client-side vector index backed by a Web Worker and persistent cache.
 * Handles cancellation, stale request rejection, and graceful degradation when unavailable.
 */
export function createVectorIndex({
  storage = workspaceStorage,
  workerFactory = defaultWorkerFactory,
  modelId = EMBEDDING_MODEL_ID,
  dimensions = EMBEDDING_DIMENSIONS,
} = {}) {
  const vectorMap = new Map(); // chunkId -> Float32Array
  const recordMetaMap = new Map(); // chunkId -> { chunkId, fileId, contentHash, modelId, dimensions }

  let worker = null;
  let status = 'idle'; // 'idle' | 'loading_model' | 'indexing' | 'ready' | 'unavailable' | 'error'
  let lastError = null;
  let cacheLoaded = false;
  let cacheEpoch = 0;
  let latestRestoreId = 0;
  let nextRequestId = 0;
  let latestIndexSessionId = 0;
  let activeIndexRequestId = null;
  let activeQueryRequestId = null;
  const fileRemoveSeq = new Map(); // fileId -> monotonic removal counter
  const pendingRequests = new Map();

  function settlePending(requestId, outcome) {
    const entry = pendingRequests.get(requestId);
    if (!entry) return;
    pendingRequests.delete(requestId);
    entry.resolve(outcome);
  }

  function failAllPending(reason) {
    for (const [reqId, entry] of pendingRequests.entries()) {
      pendingRequests.delete(reqId);
      entry.resolve({ ok: false, cancelled: false, error: reason });
    }
  }

  function ensureWorker() {
    if (worker) return worker;
    let created = null;
    try {
      created = workerFactory();
    } catch (err) {
      status = 'unavailable';
      lastError = err?.message || 'Web Worker could not be started.';
      return null;
    }

    if (!created) {
      status = 'unavailable';
      lastError = 'Web Workers are unavailable in this environment.';
      return null;
    }

    worker = created;
    worker.addEventListener('message', (event) => {
      const msg = event.data || {};
      const { type, requestId } = msg;

      if (type === 'MODEL_PROGRESS') {
        const pending = pendingRequests.get(requestId);
        pending?.onProgress?.({
          phase: 'loading_model',
          completed: 0,
          total: 0,
          info: msg.info,
        });
        return;
      }

      if (type === 'INDEX_PROGRESS') {
        if (requestId !== activeIndexRequestId) return;
        const pending = pendingRequests.get(requestId);
        pending?.onProgress?.({
          phase: 'indexing',
          completed: msg.completed,
          total: msg.total,
        });
        return;
      }

      if (type === 'CANCELLED') {
        settlePending(requestId, { ok: false, cancelled: true });
        return;
      }

      if (type === 'ERROR') {
        settlePending(requestId, { ok: false, cancelled: false, error: msg.error || 'Worker error' });
        return;
      }

      if (type === 'INIT_COMPLETE') {
        settlePending(requestId, { ok: true });
        return;
      }

      if (type === 'INDEX_COMPLETE') {
        settlePending(requestId, { ok: true, embeddings: msg.embeddings || [] });
        return;
      }

      if (type === 'QUERY_EMBEDDING') {
        settlePending(requestId, { ok: true, vector: msg.vector || null });
      }
    });

    worker.addEventListener('error', (event) => {
      const errMsg = event?.message || 'Embedding worker failed to load or crashed.';
      status = 'error';
      lastError = errMsg;
      activeIndexRequestId = null;
      activeQueryRequestId = null;
      failAllPending(errMsg);
      try {
        worker?.terminate?.();
      } catch {
        // Ignore termination failures
      }
      worker = null;
    });

    return worker;
  }

  function postWorkerRequest(type, payload, { onProgress, onStart } = {}) {
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return {
        requestId: null,
        promise: Promise.resolve({ ok: false, cancelled: false, unavailable: true, error: lastError }),
      };
    }

    const requestId = ++nextRequestId;
    const promise = new Promise((resolve) => {
      pendingRequests.set(requestId, { resolve, onProgress });
    });
    onStart?.(requestId);

    try {
      activeWorker.postMessage({ type, requestId, modelId, ...payload });
    } catch (err) {
      const errorMsg = err?.message || 'Failed to post message to embedding worker.';
      lastError = errorMsg;
      settlePending(requestId, { ok: false, cancelled: false, error: errorMsg });
    }
    return { requestId, promise };
  }

  function cancelRequest(requestId) {
    if (requestId === null || requestId === undefined) return;
    if (worker) {
      try {
        worker.postMessage({ type: 'CANCEL', requestId });
      } catch {
        // Ignore if worker already terminated
      }
    }
    settlePending(requestId, { ok: false, cancelled: true });
  }

  return {
    getStatus() {
      return {
        status,
        error: lastError,
        indexedChunkCount: vectorMap.size,
        modelId,
        dimensions,
      };
    },

    getVectorMap() {
      return vectorMap;
    },

    cancelIndexing() {
      latestIndexSessionId++;
      if (activeIndexRequestId !== null) {
        const reqId = activeIndexRequestId;
        activeIndexRequestId = null;
        cancelRequest(reqId);
      }
      if (status === 'loading_model' || status === 'indexing') {
        status = vectorMap.size > 0 ? 'ready' : 'idle';
      }
    },

    async restoreFromCache(filesList = []) {
      const restoreId = ++latestRestoreId;
      const epoch = cacheEpoch;
      const hasFilesList = Array.isArray(filesList) && filesList.length > 0;
      const startRemoveSeqByFile = new Map();
      if (hasFilesList) {
        for (const f of filesList) {
          const fId = f?.id;
          if (fId && !startRemoveSeqByFile.has(fId)) {
            startRemoveSeqByFile.set(fId, fileRemoveSeq.get(fId) || 0);
          }
        }
      }

      const res = await storage.loadEmbeddings();
      if (epoch !== cacheEpoch || restoreId !== latestRestoreId) {
        return { ok: false, cancelled: true, restoredCount: 0 };
      }

      cacheLoaded = true;
      if (!res?.ok || !Array.isArray(res.data)) {
        return { ok: false, restoredCount: 0, error: res?.error || null };
      }

      const expectedChunksById = new Map();
      if (hasFilesList) {
        for (const chunk of chunkWorkspaceFiles(filesList)) {
          if ((fileRemoveSeq.get(chunk.fileId) || 0) !== (startRemoveSeqByFile.get(chunk.fileId) || 0)) {
            continue;
          }
          expectedChunksById.set(chunk.chunkId, chunk);
        }
      }

      let restoredCount = 0;
      for (const rec of res.data) {
        if (hasFilesList) {
          const expected = expectedChunksById.get(rec?.chunkId);
          if (!expected) continue;
          if (!isValidEmbeddingRecord(rec, expected, { modelId, dimensions })) continue;
        } else if (!isValidEmbeddingRecord(rec, null, { modelId, dimensions })) {
          continue;
        }

        vectorMap.set(rec.chunkId, new Float32Array(rec.vector));
        recordMetaMap.set(rec.chunkId, {
          chunkId: rec.chunkId,
          fileId: rec.fileId,
          contentHash: rec.contentHash,
          modelId: rec.modelId,
          dimensions,
        });
        restoredCount++;
      }

      if (restoredCount > 0 && status === 'idle') {
        status = 'ready';
      }
      return { ok: true, restoredCount };
    },

    async indexFiles(filesList = [], { chunks: providedChunks = null, onProgress = null } = {}) {
      this.cancelIndexing();
      const sessionId = latestIndexSessionId;

      const chunks = providedChunks || chunkWorkspaceFiles(filesList);
      if (chunks.length === 0) {
        vectorMap.clear();
        recordMetaMap.clear();
        status = 'idle';
        return { ok: true, indexedCount: 0, cachedCount: 0 };
      }

      const startRemoveSeqByFile = new Map();
      for (const chunk of chunks) {
        if (!startRemoveSeqByFile.has(chunk.fileId)) {
          startRemoveSeqByFile.set(chunk.fileId, fileRemoveSeq.get(chunk.fileId) || 0);
        }
      }
      const isFileRemovedSinceStart = (fileId) =>
        (fileRemoveSeq.get(fileId) || 0) !== (startRemoveSeqByFile.get(fileId) || 0);

      if (!cacheLoaded) {
        const restoreRes = await this.restoreFromCache(filesList);
        if (sessionId !== latestIndexSessionId || restoreRes?.cancelled) {
          return { ok: false, cancelled: true, indexedCount: 0, cachedCount: 0 };
        }
      }

      const activeChunks = chunks.filter((c) => !isFileRemovedSinceStart(c.fileId));

      // Prune orphaned chunk vectors not present in active chunks
      const currentChunkIds = new Set(activeChunks.map((c) => c.chunkId));
      for (const existingId of Array.from(vectorMap.keys())) {
        if (!currentChunkIds.has(existingId)) {
          vectorMap.delete(existingId);
          recordMetaMap.delete(existingId);
        }
      }

      if (activeChunks.length === 0) {
        status = vectorMap.size > 0 ? 'ready' : 'idle';
        return { ok: true, indexedCount: 0, cachedCount: 0 };
      }

      const toEmbed = [];
      const changedFileIds = new Set();
      let cachedCount = 0;

      for (const chunk of activeChunks) {
        const text = chunk.searchText || chunk.content || '';
        const contentHash = computeContentHash(text);
        const existingMeta = recordMetaMap.get(chunk.chunkId);
        const existingVec = vectorMap.get(chunk.chunkId);

        if (
          existingMeta &&
          existingVec &&
          isValidEmbeddingRecord(
            { ...existingMeta, vector: existingVec },
            chunk,
            { modelId, dimensions }
          )
        ) {
          cachedCount++;
        } else {
          changedFileIds.add(chunk.fileId);
          toEmbed.push({
            chunkId: chunk.chunkId,
            fileId: chunk.fileId,
            contentHash,
            text,
          });
        }
      }

      if (toEmbed.length === 0) {
        status = vectorMap.size > 0 ? 'ready' : 'idle';
        lastError = null;
        return { ok: true, indexedCount: 0, cachedCount };
      }

      status = 'loading_model';
      lastError = null;
      let pendingReqId = null;
      const { requestId, promise } = postWorkerRequest(
        'INDEX_CHUNKS',
        { chunks: toEmbed },
        {
          onStart: (id) => {
            pendingReqId = id;
            activeIndexRequestId = id;
          },
          onProgress: (prog) => {
            if (pendingReqId !== activeIndexRequestId) return;
            status = prog.phase === 'indexing' ? 'indexing' : 'loading_model';
            onProgress?.(prog);
          },
        }
      );

      if (requestId === null) {
        return { ok: false, unavailable: true, error: lastError, indexedCount: 0, cachedCount };
      }

      const workerResult = await promise;

      if (workerResult.cancelled || sessionId !== latestIndexSessionId) {
        if (activeIndexRequestId === requestId) {
          activeIndexRequestId = null;
        }
        return { ok: false, cancelled: true, indexedCount: 0, cachedCount };
      }

      if (activeIndexRequestId === requestId) {
        activeIndexRequestId = null;
      }

      if (!workerResult.ok) {
        status = workerResult.unavailable ? 'unavailable' : 'error';
        lastError = workerResult.error || 'Failed to generate embeddings.';
        return { ok: false, unavailable: Boolean(workerResult.unavailable), error: lastError, indexedCount: 0, cachedCount };
      }

      const validNewRecords = [];
      for (const item of workerResult.embeddings || []) {
        if (!item || isFileRemovedSinceStart(item.fileId)) continue;
        const record = {
          chunkId: item.chunkId,
          fileId: item.fileId,
          contentHash: item.contentHash,
          modelId,
          dimensions,
          vector: Array.isArray(item.vector) ? item.vector : Array.from(item.vector || []),
        };
        if (!isValidEmbeddingRecord(record, null, { modelId, dimensions })) continue;

        vectorMap.set(record.chunkId, new Float32Array(record.vector));
        recordMetaMap.set(record.chunkId, {
          chunkId: record.chunkId,
          fileId: record.fileId,
          contentHash: record.contentHash,
          modelId,
          dimensions,
        });
        validNewRecords.push(record);
      }

      const activeChangedFileIds = Array.from(changedFileIds).filter(
        (fId) => !isFileRemovedSinceStart(fId)
      );

      if (validNewRecords.length > 0 && activeChangedFileIds.length > 0) {
        const activeChangedSet = new Set(activeChangedFileIds);
        const newChunkIds = new Set(validNewRecords.map((r) => r.chunkId));
        const recordsToSave = [...validNewRecords];

        // Preserve still-valid cached sibling chunks of modified files before replaceFileIds wipes by_file
        for (const chunk of activeChunks) {
          if (
            isFileRemovedSinceStart(chunk.fileId) ||
            !activeChangedSet.has(chunk.fileId) ||
            newChunkIds.has(chunk.chunkId)
          ) {
            continue;
          }
          const cachedMeta = recordMetaMap.get(chunk.chunkId);
          const cachedVec = vectorMap.get(chunk.chunkId);
          if (
            cachedMeta &&
            cachedVec &&
            isValidEmbeddingRecord({ ...cachedMeta, vector: cachedVec }, chunk, { modelId, dimensions })
          ) {
            recordsToSave.push({
              ...cachedMeta,
              vector: Array.from(cachedVec),
            });
          }
        }

        await storage.saveEmbeddings(recordsToSave, {
          replaceFileIds: activeChangedFileIds,
        });
      }

      if (sessionId !== latestIndexSessionId) {
        return { ok: false, cancelled: true, indexedCount: 0, cachedCount };
      }

      status = vectorMap.size > 0 ? 'ready' : 'idle';
      lastError = null;
      return { ok: true, indexedCount: validNewRecords.length, cachedCount };
    },

    async embedQuery(query = '') {
      const trimmed = typeof query === 'string' ? query.trim() : '';
      if (!trimmed) return null;

      if (activeQueryRequestId !== null) {
        const prevId = activeQueryRequestId;
        activeQueryRequestId = null;
        cancelRequest(prevId);
      }

      const { requestId, promise } = postWorkerRequest('EMBED_QUERY', { query: trimmed });
      if (requestId === null) {
        return null;
      }

      activeQueryRequestId = requestId;
      const result = await promise;

      if (result.cancelled || activeQueryRequestId !== requestId) {
        return null;
      }

      activeQueryRequestId = null;
      if (!result.ok || !result.vector) {
        return null;
      }

      const vec = result.vector;
      if (typeof vec.length !== 'number' || vec.length !== dimensions) {
        return null;
      }

      for (let i = 0; i < vec.length; i++) {
        if (typeof vec[i] !== 'number' || !Number.isFinite(vec[i])) {
          return null;
        }
      }

      return new Float32Array(vec);
    },

    removeFile(fileId) {
      if (!fileId) return;
      fileRemoveSeq.set(fileId, (fileRemoveSeq.get(fileId) || 0) + 1);
      for (const [chunkId, meta] of Array.from(recordMetaMap.entries())) {
        if (meta.fileId === fileId) {
          recordMetaMap.delete(chunkId);
          vectorMap.delete(chunkId);
        }
      }
      if (vectorMap.size === 0 && status === 'ready') {
        status = 'idle';
      }
    },

    clear() {
      this.cancelIndexing();
      if (activeQueryRequestId !== null) {
        const qId = activeQueryRequestId;
        activeQueryRequestId = null;
        cancelRequest(qId);
      }
      cacheEpoch++;
      latestRestoreId++;
      fileRemoveSeq.clear();
      vectorMap.clear();
      recordMetaMap.clear();
      cacheLoaded = true;
      if (status !== 'unavailable') {
        status = 'idle';
        lastError = null;
      }
    },

    dispose() {
      this.clear();
      if (worker) {
        try {
          worker.terminate?.();
        } catch {
          // Ignore termination failures
        }
        worker = null;
      }
    },
  };
}
