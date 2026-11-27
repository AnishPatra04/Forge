import { retrieveRelevantChunks, performHybridSearch } from './hybridSearch.js';
import { getFilePath } from '../constants/fileTypes.js';

export const DEFAULT_MAX_RAG_CHUNKS = 8;
export const DEFAULT_MAX_CHUNK_CHARS = 2400;
export const DEFAULT_MAX_TOTAL_CHARS = 14000;

const FOLLOW_UP_HINT_REGEX =
  /\b(it|its|this|that|these|those|them|they|there|above|previous|same|more|else|also|what about|how about|why does|explain further|elaborate)\b/i;

/**
 * Builds an effective retrieval query for conversational follow-ups without sending
 * the whole codebase. Appends the previous user turn when the current question looks
 * like a short or pronoun-heavy follow-up.
 *
 * @param {string} question
 * @param {Array<{ role: string, content: string }>} [conversationHistory]
 * @returns {string}
 */
export function buildRetrievalQuery(question = '', conversationHistory = []) {
  const trimmed = typeof question === 'string' ? question.trim() : '';
  if (!trimmed || !Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return trimmed;
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const looksLikeFollowUp = wordCount <= 8 || FOLLOW_UP_HINT_REGEX.test(trimmed);
  if (!looksLikeFollowUp) {
    return trimmed;
  }

  const lastUserTurn = [...conversationHistory]
    .reverse()
    .find((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim());

  if (!lastUserTurn) {
    return trimmed;
  }

  const priorTopic = lastUserTurn.content.trim().slice(0, 180);
  return `${trimmed} ${priorTopic}`;
}

/**
 * Selects, deduplicates, and bounds retrieved chunks into grounded source references
 * and prompt-ready context chunks.
 *
 * @param {Array<{ chunk: object, score: number, sources: string[], matchedTerms: string[] }>} hits
 * @param {object} [options]
 * @returns {{ sources: Array<object>, contextChunks: Array<object> }}
 */
export function selectContextChunks(
  hits = [],
  {
    maxChunks = DEFAULT_MAX_RAG_CHUNKS,
    maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
    maxTotalChars = DEFAULT_MAX_TOTAL_CHARS,
  } = {}
) {
  const sources = [];
  const contextChunks = [];
  const seenKeys = new Set();
  let totalChars = 0;

  for (const hit of hits) {
    if (sources.length >= maxChunks) break;
    const chunk = hit?.chunk;
    if (!chunk || typeof chunk.content !== 'string' || !chunk.content.trim()) continue;

    const dedupeKey = `${chunk.fileId}:${chunk.startLine}-${chunk.endLine}`;
    if (seenKeys.has(dedupeKey)) continue;

    const remaining = maxTotalChars - totalChars;
    if (remaining < 120) break;

    seenKeys.add(dedupeKey);
    const maxAllowed = Math.min(maxChunkChars, remaining);
    const boundedContent =
      chunk.content.length > maxAllowed
        ? `${chunk.content.slice(0, maxAllowed)}\n// ... [truncated]`
        : chunk.content;

    const sourceId = `S${sources.length + 1}`;
    const snippetLines = chunk.content.split('\n').slice(0, 8).join('\n');
    const filePath = chunk.filePath || chunk.fileName || 'unknown';
    const fileName = chunk.fileName || filePath.split('/').pop() || filePath;

    const sourceEntry = {
      id: sourceId,
      chunkId: chunk.chunkId,
      fileId: chunk.fileId,
      fileName,
      filePath,
      extension: chunk.extension || '',
      startLine: chunk.startLine || 1,
      endLine: chunk.endLine || chunk.startLine || 1,
      symbolName: chunk.symbolName || null,
      symbolType: chunk.symbolType || 'block',
      snippet: snippetLines,
      score: hit.score || 0,
      matchSources: Array.isArray(hit.sources) ? hit.sources : [],
      matchedTerms: Array.isArray(hit.matchedTerms) ? hit.matchedTerms : [],
    };

    sources.push(sourceEntry);
    contextChunks.push({
      id: sourceId,
      fileId: chunk.fileId,
      fileName,
      filePath,
      startLine: sourceEntry.startLine,
      endLine: sourceEntry.endLine,
      symbolName: sourceEntry.symbolName,
      symbolType: sourceEntry.symbolType,
      content: boundedContent,
    });

    totalChars += boundedContent.length;
  }

  return { sources, contextChunks };
}

/**
 * Runs the client-side RAG retrieval stage reusing FORGE's existing hybrid search,
 * prebuilt BM25 index, code chunks, and local Transformers.js vector index.
 *
 * @param {object} params
 * @param {string} params.question
 * @param {Array<object>} params.files
 * @param {Array<object>} params.chunks
 * @param {object} params.bm25Index
 * @param {object|null} params.vectorIndex
 * @param {Array<{ role: string, content: string }>} [params.conversationHistory]
 * @returns {Promise<{ sources: Array<object>, contextChunks: Array<object>, retrievalMode: string, semanticUsed: boolean, retrievalQuery: string }>}
 */
export async function retrieveRagContext({
  question,
  files = [],
  chunks = [],
  bm25Index = null,
  vectorIndex = null,
  conversationHistory = [],
  maxChunks = DEFAULT_MAX_RAG_CHUNKS,
  maxTotalChars = DEFAULT_MAX_TOTAL_CHARS,
}) {
  const retrievalQuery = buildRetrievalQuery(question, conversationHistory);
  if (!retrievalQuery || !Array.isArray(files) || files.length === 0) {
    return {
      sources: [],
      contextChunks: [],
      retrievalMode: 'empty',
      semanticUsed: false,
      retrievalQuery,
    };
  }

  let queryVector = null;
  let vectorMap = null;

  if (vectorIndex) {
    const viStatus = vectorIndex.getStatus?.();
    const map = vectorIndex.getVectorMap?.();
    if (map && map.size > 0 && viStatus?.status !== 'unavailable') {
      try {
        queryVector = await vectorIndex.embedQuery(retrievalQuery);
        if (queryVector) {
          vectorMap = map;
        }
      } catch {
        queryVector = null;
        vectorMap = null;
      }
    }
  }

  const semanticUsed = Boolean(queryVector && vectorMap && vectorMap.size > 0);
  const hits = retrieveRelevantChunks(files, retrievalQuery, {
    mode: 'hybrid',
    chunks,
    bm25Index,
    queryVector,
    vectorMap,
    limit: maxChunks * 3,
  });

  // Also consult performHybridSearch (AST + BM25 + Vector) so AST declaration matches
  // contribute to RAG grounding alongside chunk-level hits.
  const hybridFileRes = performHybridSearch(files, retrievalQuery, {
    mode: 'hybrid',
    chunks,
    bm25Index,
    queryVector,
    vectorMap,
    chunkLimit: maxChunks * 3,
  });

  const combinedHits = [...hits];
  const seenChunkIds = new Set(hits.map((h) => h.chunk?.chunkId).filter(Boolean));

  for (const fileRes of hybridFileRes.results || []) {
    for (const chunkHit of fileRes.chunks || []) {
      if (chunkHit?.chunk?.chunkId && !seenChunkIds.has(chunkHit.chunk.chunkId)) {
        seenChunkIds.add(chunkHit.chunk.chunkId);
        combinedHits.push(chunkHit);
      }
    }
  }

  // In lexical fallback (when semantic vectors aren't ready), if a query term shares a
  // strong prefix (>= 4 chars, e.g. "authentication" -> "auth") with a file path or symbol
  // not yet retrieved, include its top chunks so natural-language questions stay grounded.
  if (!semanticUsed && combinedHits.length < maxChunks) {
    const queryWords = retrievalQuery
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g) || [];
    const prefixes = Array.from(new Set(queryWords.map((w) => w.slice(0, 4))));

    if (prefixes.length > 0) {
      for (const chunk of chunks) {
        if (seenChunkIds.has(chunk.chunkId)) continue;
        const haystack = `${chunk.filePath || ''} ${chunk.symbolName || ''}`.toLowerCase();
        if (prefixes.some((p) => haystack.includes(p))) {
          seenChunkIds.add(chunk.chunkId);
          combinedHits.push({
            chunk,
            score: 0.01,
            sources: ['ast'],
            matchedTerms: prefixes.filter((p) => haystack.includes(p)),
          });
        }
      }
    }
  }

  const { sources, contextChunks } = selectContextChunks(combinedHits, {
    maxChunks,
    maxTotalChars,
  });

  return {
    sources,
    contextChunks,
    retrievalMode: semanticUsed ? 'hybrid' : 'lexical_fallback',
    semanticUsed,
    retrievalQuery,
  };
}

/**
 * Checks whether the Express AI Assistant backend is reachable and configured.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ reachable: boolean, geminiConfigured: boolean, model: string|null, error: string|null }>}
 */
export async function checkAssistantHealth({ signal } = {}) {
  try {
    const res = await fetch('/api/health', { method: 'GET', signal });
    if (!res.ok) {
      return {
        reachable: false,
        geminiConfigured: false,
        model: null,
        error: `Backend health check returned HTTP ${res.status}.`,
      };
    }
    const data = await res.json();
    return {
      reachable: Boolean(data?.ok),
      geminiConfigured: Boolean(data?.geminiConfigured),
      model: data?.model || null,
      error: null,
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { reachable: false, geminiConfigured: false, model: null, error: null };
    }
    return {
      reachable: false,
      geminiConfigured: false,
      model: null,
      error: 'AI backend server is not running. Start it with `npm run server`.',
    };
  }
}

/**
 * Sends the user question and retrieved code context to the Express RAG endpoint.
 *
 * @param {object} params
 * @returns {Promise<{ answer: string, model: string, usage: object|null, citationsUsed: string[] }>}
 */
export async function requestAssistantAnswer({
  question,
  projectName,
  contextChunks,
  conversationHistory,
  signal,
}) {
  let response;
  try {
    response = await fetch('/api/assistant/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        projectName,
        contextChunks,
        conversationHistory,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    const netErr = new Error(
      'Unable to connect to the FORGE AI backend server. Make sure it is running with `npm run server`.'
    );
    netErr.code = 'BACKEND_UNREACHABLE';
    throw netErr;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || !data?.ok) {
    const apiErr = new Error(
      data?.error || `AI Assistant request failed (HTTP ${response.status}).`
    );
    apiErr.code = data?.code || 'REQUEST_FAILED';
    apiErr.status = response.status;
    throw apiErr;
  }

  return {
    answer: data.answer,
    model: data.model,
    usage: data.usage || null,
    citationsUsed: Array.isArray(data.citationsUsed) ? data.citationsUsed : [],
  };
}

/**
 * Generates contextual suggested questions based on the currently loaded workspace files.
 *
 * @param {Array<object>} files
 * @returns {string[]}
 */
export function generateSuggestedQuestions(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const paths = files.map((f) => (getFilePath(f) || f.name || '').toLowerCase());
  const suggestions = [];

  if (paths.some((p) => p.includes('auth') || p.includes('login') || p.includes('token'))) {
    suggestions.push('How does user authentication and session validation work in this project?');
  }
  if (paths.some((p) => p.includes('api') || p.includes('client') || p.includes('fetch'))) {
    suggestions.push('How are HTTP requests, retries, and errors handled in the API client?');
  }
  if (paths.some((p) => p.includes('db') || p.includes('database') || p.includes('storage'))) {
    suggestions.push('How does this codebase manage database or storage connections?');
  }
  if (paths.some((p) => p.includes('config') || p.includes('readme'))) {
    suggestions.push('What are the main configuration options and architecture of this project?');
  }

  const defaults = [
    'Give me a high-level architectural overview of the loaded files.',
    'What are the key exported functions and classes in this workspace?',
    'Where is error handling implemented across these files?',
    'How do the main modules in this codebase interact with each other?',
  ];

  for (const q of defaults) {
    if (suggestions.length >= 4) break;
    if (!suggestions.includes(q)) suggestions.push(q);
  }

  return suggestions.slice(0, 4);
}
