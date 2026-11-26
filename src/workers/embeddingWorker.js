import { env, pipeline } from '@huggingface/transformers';

// Run purely client-side from Hugging Face Hub + browser Cache API without probing local /models
env.allowLocalModels = false;
env.useBrowserCache = true;

const DEFAULT_MODEL_ID = 'onnx-community/all-MiniLM-L6-v2-ONNX';
const DEFAULT_BATCH_SIZE = 8;

let activeModelId = null;
let extractorPromise = null;
const activeRequestIds = new Set();
const activeProgressRequestIds = new Set();
const cancelledRequestIds = new Set();

function isCancelled(requestId) {
  return requestId !== undefined && requestId !== null && cancelledRequestIds.has(requestId);
}

async function getExtractor(modelId = DEFAULT_MODEL_ID) {
  if (extractorPromise && activeModelId === modelId) {
    return extractorPromise;
  }

  activeModelId = modelId;
  extractorPromise = pipeline('feature-extraction', modelId, {
    dtype: 'q4',
    progress_callback: (info) => {
      for (const reqId of activeProgressRequestIds) {
        if (!cancelledRequestIds.has(reqId)) {
          self.postMessage({
            type: 'MODEL_PROGRESS',
            requestId: reqId,
            info,
          });
        }
      }
    },
  }).catch((err) => {
    // Allow future retries if model download/init failed
    extractorPromise = null;
    activeModelId = null;
    throw err;
  });

  return extractorPromise;
}

async function acquireExtractor(modelId, requestId) {
  if (requestId !== undefined && requestId !== null) {
    activeProgressRequestIds.add(requestId);
  }
  try {
    return await getExtractor(modelId);
  } finally {
    if (requestId !== undefined && requestId !== null) {
      activeProgressRequestIds.delete(requestId);
    }
  }
}

self.addEventListener('message', async (event) => {
  const payload = event.data || {};
  const { type, requestId, modelId = DEFAULT_MODEL_ID } = payload;

  if (type === 'CANCEL') {
    if (requestId !== undefined && requestId !== null && activeRequestIds.has(requestId)) {
      cancelledRequestIds.add(requestId);
      activeProgressRequestIds.delete(requestId);
    }
    return;
  }

  if (type === 'INIT') {
    if (requestId !== undefined && requestId !== null) {
      activeRequestIds.add(requestId);
    }
    try {
      await acquireExtractor(modelId, requestId);
      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
        return;
      }
      self.postMessage({ type: 'INIT_COMPLETE', requestId, modelId });
    } catch (err) {
      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
      } else {
        self.postMessage({
          type: 'ERROR',
          requestId,
          error: err?.message || 'Failed to initialize embedding model.',
        });
      }
    } finally {
      if (requestId !== undefined && requestId !== null) {
        activeRequestIds.delete(requestId);
        cancelledRequestIds.delete(requestId);
      }
    }
    return;
  }

  if (type === 'INDEX_CHUNKS') {
    const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
    const batchSize = Math.max(1, payload.batchSize || DEFAULT_BATCH_SIZE);
    if (requestId !== undefined && requestId !== null) {
      activeRequestIds.add(requestId);
    }

    try {
      const extractor = await acquireExtractor(modelId, requestId);
      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
        return;
      }

      const embeddings = [];
      for (let i = 0; i < chunks.length; i += batchSize) {
        if (isCancelled(requestId)) {
          self.postMessage({ type: 'CANCELLED', requestId });
          return;
        }

        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map((c) => c.text || '');
        const output = await extractor(texts, { pooling: 'mean', normalize: true });
        let vectors;
        try {
          vectors = output.tolist();
        } finally {
          output?.dispose?.();
        }

        for (let j = 0; j < batch.length; j++) {
          embeddings.push({
            chunkId: batch[j].chunkId,
            fileId: batch[j].fileId,
            contentHash: batch[j].contentHash,
            vector: vectors[j],
          });
        }

        if (!isCancelled(requestId)) {
          self.postMessage({
            type: 'INDEX_PROGRESS',
            requestId,
            completed: Math.min(chunks.length, i + batch.length),
            total: chunks.length,
          });
        }
      }

      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
        return;
      }

      self.postMessage({
        type: 'INDEX_COMPLETE',
        requestId,
        modelId,
        embeddings,
      });
    } catch (err) {
      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
      } else {
        self.postMessage({
          type: 'ERROR',
          requestId,
          error: err?.message || 'Failed to generate chunk embeddings.',
        });
      }
    } finally {
      if (requestId !== undefined && requestId !== null) {
        activeRequestIds.delete(requestId);
        cancelledRequestIds.delete(requestId);
      }
    }
    return;
  }

  if (type === 'EMBED_QUERY') {
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) {
      self.postMessage({ type: 'QUERY_EMBEDDING', requestId, vector: null });
      return;
    }

    if (requestId !== undefined && requestId !== null) {
      activeRequestIds.add(requestId);
    }

    try {
      const extractor = await acquireExtractor(modelId, requestId);
      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
        return;
      }

      const output = await extractor([query], { pooling: 'mean', normalize: true });
      let vectors;
      try {
        vectors = output.tolist();
      } finally {
        output?.dispose?.();
      }

      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
        return;
      }

      self.postMessage({
        type: 'QUERY_EMBEDDING',
        requestId,
        modelId,
        vector: vectors[0] || null,
      });
    } catch (err) {
      if (isCancelled(requestId)) {
        self.postMessage({ type: 'CANCELLED', requestId });
      } else {
        self.postMessage({
          type: 'ERROR',
          requestId,
          error: err?.message || 'Failed to embed search query.',
        });
      }
    } finally {
      if (requestId !== undefined && requestId !== null) {
        activeRequestIds.delete(requestId);
        cancelledRequestIds.delete(requestId);
      }
    }
  }
});
