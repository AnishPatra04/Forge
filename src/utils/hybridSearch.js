import { performAstAwareSearch } from './astParser.js';
import { chunkWorkspaceFiles, splitIdentifierWords } from './codeChunker.js';
import { getFilePath } from '../constants/fileTypes.js';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'into',
  'how',
  'what',
  'where',
  'when',
  'why',
  'does',
  'can',
]);

/**
 * Tokenizes source code or natural-language queries for BM25 lexical matching.
 * Expands camelCase/snake_case identifiers into sub-tokens while preserving original tokens.
 *
 * @param {string} text
 * @param {object} [options]
 * @returns {string[]}
 */
export function tokenizeForLexicalSearch(text = '', { filterStopWords = false } = {}) {
  if (!text || typeof text !== 'string') return [];

  const rawTokens = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
  const expanded = splitIdentifierWords(text).match(/[a-z0-9]+/g) || [];
  const combined = [...rawTokens, ...expanded];

  if (!filterStopWords) {
    return combined;
  }

  const filtered = combined.filter((tok) => tok.length > 1 && !STOP_WORDS.has(tok));
  return filtered.length > 0 ? filtered : combined.filter((tok) => tok.length > 0);
}

/**
 * Builds an inverted BM25 index over an array of code chunks.
 *
 * @param {Array<object>} chunks
 * @returns {object}
 */
export function createBm25Index(chunks = []) {
  const docCount = chunks.length;
  const docFreq = new Map();
  const docs = [];
  let totalLength = 0;

  for (let i = 0; i < docCount; i++) {
    const chunk = chunks[i];
    const tokens = tokenizeForLexicalSearch(chunk.searchText || chunk.content || '');
    const termFreq = new Map();

    for (const tok of tokens) {
      termFreq.set(tok, (termFreq.get(tok) || 0) + 1);
    }

    for (const uniqueTok of termFreq.keys()) {
      docFreq.set(uniqueTok, (docFreq.get(uniqueTok) || 0) + 1);
    }

    totalLength += tokens.length;
    docs.push({
      chunk,
      length: tokens.length,
      termFreq,
    });
  }

  return {
    docCount,
    avgDocLength: docCount > 0 ? totalLength / docCount : 0,
    docFreq,
    docs,
  };
}

/**
 * Scores and ranks chunks against a query using Okapi BM25.
 *
 * @param {object|Array<object>} indexOrChunks
 * @param {string} query
 * @param {object} [options]
 * @returns {Array<{ chunk: object, score: number, rank: number, matchedTerms: string[] }>}
 */
export function searchBm25(indexOrChunks, query = '', { limit = 50, k1 = 1.5, b = 0.75 } = {}) {
  const rawQuery = typeof query === 'string' ? query.trim() : '';
  if (!rawQuery) return [];

  const index = Array.isArray(indexOrChunks) ? createBm25Index(indexOrChunks) : indexOrChunks;
  if (!index || index.docCount === 0) return [];

  const queryTokens = Array.from(
    new Set(tokenizeForLexicalSearch(rawQuery, { filterStopWords: true }))
  );
  if (queryTokens.length === 0) return [];

  const avgdl = index.avgDocLength || 1;
  const N = index.docCount;
  const scored = [];

  for (const doc of index.docs) {
    let score = 0;
    const matchedTerms = [];

    for (const term of queryTokens) {
      const tf = doc.termFreq.get(term) || 0;
      if (tf === 0) continue;

      matchedTerms.push(term);
      const df = index.docFreq.get(term) || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (doc.length / avgdl));
      score += idf * (numerator / denominator);
    }

    if (score > 0) {
      // Modest boost if symbol name or file path directly matches query terms
      const symbolLower = (doc.chunk.symbolName || '').toLowerCase();
      const pathLower = (doc.chunk.filePath || doc.chunk.fileName || '').toLowerCase();
      let boost = 0;
      for (const term of matchedTerms) {
        if (symbolLower.includes(term)) boost += 0.35;
        if (pathLower.includes(term)) boost += 0.2;
      }

      scored.push({
        chunk: doc.chunk,
        score: score + boost,
        matchedTerms,
      });
    }
  }

  scored.sort((a, bItem) => bItem.score - a.score);
  return scored.slice(0, limit).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/**
 * Computes cosine similarity between two numeric vectors / Float32Arrays.
 *
 * @param {ArrayLike<number>} vecA
 * @param {ArrayLike<number>} vecB
 * @returns {number}
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Ranks chunks by cosine similarity against a query embedding vector.
 *
 * @param {Array<object>} chunks
 * @param {ArrayLike<number>|null} queryVector
 * @param {Map<string, ArrayLike<number>>|null} vectorMap
 * @param {object} [options]
 * @returns {Array<{ chunk: object, score: number, rank: number }>}
 */
export function searchVectors(
  chunks = [],
  queryVector = null,
  vectorMap = null,
  { limit = 50, minScore = 0.15 } = {}
) {
  if (!queryVector || !vectorMap || chunks.length === 0) {
    return [];
  }

  const scored = [];
  for (const chunk of chunks) {
    const chunkVec = vectorMap.get(chunk.chunkId);
    if (!chunkVec) continue;
    const score = cosineSimilarity(queryVector, chunkVec);
    if (score >= minScore) {
      scored.push({ chunk, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/**
 * Combines multiple ranked item lists using Reciprocal Rank Fusion (RRF).
 *
 * @param {Array<{ source: string, weight?: number, items: Array<{ id: string, payload?: any, rank?: number }> }>} rankedLists
 * @param {object} [options]
 * @returns {Array<{ id: string, payload: any, rrfScore: number, sources: string[], ranks: object }>}
 */
export function reciprocalRankFusion(rankedLists = [], { k = 60 } = {}) {
  const fused = new Map();

  for (const list of rankedLists) {
    if (!list || !Array.isArray(list.items) || list.items.length === 0) continue;
    const source = list.source || 'unknown';
    const weight = typeof list.weight === 'number' ? list.weight : 1;

    list.items.forEach((item, idx) => {
      if (!item || !item.id) return;
      const rank = typeof item.rank === 'number' ? item.rank : idx + 1;
      const contribution = weight * (1 / (k + rank));

      if (!fused.has(item.id)) {
        fused.set(item.id, {
          id: item.id,
          payload: item.payload ?? item,
          rrfScore: 0,
          sources: [],
          ranks: {},
        });
      }

      const entry = fused.get(item.id);
      entry.rrfScore += contribution;
      if (!entry.sources.includes(source)) {
        entry.sources.push(source);
      }
      if (entry.ranks[source] === undefined || rank < entry.ranks[source]) {
        entry.ranks[source] = rank;
      }
    });
  }

  return Array.from(fused.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Retrieves the top-K relevant code chunks using BM25 + optional dense vectors fused with RRF.
 * Designed for both Hybrid Search and downstream Phase 4 RAG pipelines.
 *
 * @param {Array<object>} filesList
 * @param {string} query
 * @param {object} [options]
 * @returns {Array<{ chunk: object, score: number, sources: string[], matchedTerms: string[] }>}
 */
export function retrieveRelevantChunks(filesList = [], query = '', options = {}) {
  const raw = typeof query === 'string' ? query.trim() : '';
  if (!raw || !Array.isArray(filesList) || filesList.length === 0) {
    return [];
  }

  const {
    mode = 'hybrid',
    limit = 20,
    chunks: providedChunks = null,
    bm25Index: providedIndex = null,
    queryVector = null,
    vectorMap = null,
    rrfK = 60,
  } = options;

  const chunks = providedChunks || chunkWorkspaceFiles(filesList);
  if (chunks.length === 0) return [];

  const lexicalHits =
    mode !== 'semantic' ? searchBm25(providedIndex || chunks, raw, { limit: Math.max(30, limit * 2) }) : [];
  const semanticHits =
    mode !== 'keyword'
      ? searchVectors(chunks, queryVector, vectorMap, { limit: Math.max(30, limit * 2) })
      : [];

  const matchedTermsByChunk = new Map();
  for (const hit of lexicalHits) {
    matchedTermsByChunk.set(hit.chunk.chunkId, hit.matchedTerms || []);
  }

  const rankedLists = [];
  if (lexicalHits.length > 0) {
    rankedLists.push({
      source: 'bm25',
      weight: 1,
      items: lexicalHits.map((h) => ({ id: h.chunk.chunkId, payload: h.chunk, rank: h.rank })),
    });
  }
  if (semanticHits.length > 0) {
    rankedLists.push({
      source: 'semantic',
      weight: 1.1,
      items: semanticHits.map((h) => ({ id: h.chunk.chunkId, payload: h.chunk, rank: h.rank })),
    });
  }

  const fused = reciprocalRankFusion(rankedLists, { k: rrfK });
  return fused.slice(0, limit).map((item) => ({
    chunk: item.payload,
    score: item.rrfScore,
    sources: item.sources,
    matchedTerms: matchedTermsByChunk.get(item.id) || [],
  }));
}

function resolveMatchType(sources = [], mode = 'hybrid') {
  const hasLexical = sources.includes('ast') || sources.includes('bm25');
  const hasSemantic = sources.includes('semantic');
  if (hasLexical && hasSemantic) return 'hybrid';
  if (hasSemantic) return 'semantic';
  if (hasLexical) return 'keyword';
  return mode;
}

/**
 * Executes hybrid search across workspace files, combining:
 * - AST-aware exact line matching (`performAstAwareSearch`)
 * - Identifier-aware BM25 chunk ranking
 * - Dense vector similarity (when embeddings are provided)
 * fused via Reciprocal Rank Fusion (RRF).
 *
 * @param {Array<object>} filesList
 * @param {string} query
 * @param {object} [options]
 * @returns {{ results: Array|null, grandTotalMatches: number, totalMatchedChunks: number, modeUsed: string }}
 */
export function performHybridSearch(filesList = [], query = '', options = {}) {
  const raw = typeof query === 'string' ? query.trim() : '';
  if (!raw) {
    return { results: null, grandTotalMatches: 0, totalMatchedChunks: 0, modeUsed: options.mode || 'hybrid' };
  }

  const mode = options.mode || 'hybrid';
  const chunks = options.chunks || chunkWorkspaceFiles(filesList);

  const astResult =
    mode !== 'semantic'
      ? performAstAwareSearch(filesList, raw)
      : { results: [], grandTotalMatches: 0 };
  const astFiles = astResult.results || [];

  const chunkHits = retrieveRelevantChunks(filesList, raw, {
    ...options,
    mode,
    chunks,
    limit: options.chunkLimit || 60,
  });

  // Group top chunks per file
  const chunksByFileId = new Map();
  const fileIndexById = new Map();
  for (const f of filesList) {
    if (f) fileIndexById.set(f.id || getFilePath(f), f);
  }

  for (const hit of chunkHits) {
    const fId = hit.chunk.fileId;
    if (!chunksByFileId.has(fId)) chunksByFileId.set(fId, []);
    chunksByFileId.get(fId).push(hit);
  }

  const astByFileId = new Map();
  astFiles.forEach((res, idx) => {
    astByFileId.set(res.fileId, { res, rank: idx + 1 });
  });

  // Fuse file-level rankings from AST exact matches, BM25 top chunk per file, and semantic top chunk per file
  const bm25FileRanks = [];
  const semanticFileRanks = [];

  for (const [fId, hits] of chunksByFileId.entries()) {
    const bm25Best = hits.find((h) => h.sources.includes('bm25'));
    const semBest = hits.find((h) => h.sources.includes('semantic'));
    if (bm25Best) bm25FileRanks.push({ id: fId, score: bm25Best.score });
    if (semBest) semanticFileRanks.push({ id: fId, score: semBest.score });
  }

  bm25FileRanks.sort((a, b) => b.score - a.score);
  semanticFileRanks.sort((a, b) => b.score - a.score);

  const fileRankedLists = [];
  if (astFiles.length > 0) {
    fileRankedLists.push({
      source: 'ast',
      weight: 1.2,
      items: astFiles.map((res, idx) => ({ id: res.fileId, payload: res.fileId, rank: idx + 1 })),
    });
  }
  if (bm25FileRanks.length > 0) {
    fileRankedLists.push({
      source: 'bm25',
      weight: 1.0,
      items: bm25FileRanks.map((item, idx) => ({ id: item.id, payload: item.id, rank: idx + 1 })),
    });
  }
  if (semanticFileRanks.length > 0) {
    fileRankedLists.push({
      source: 'semantic',
      weight: 1.1,
      items: semanticFileRanks.map((item, idx) => ({ id: item.id, payload: item.id, rank: idx + 1 })),
    });
  }

  const fusedFiles = reciprocalRankFusion(fileRankedLists, { k: options.rrfK || 60 });
  const results = [];
  let grandTotalMatches = 0;

  for (const fused of fusedFiles) {
    const fileId = fused.id;
    const fileObj = fileIndexById.get(fileId);
    const astEntry = astByFileId.get(fileId)?.res || null;
    const fileChunks = chunksByFileId.get(fileId) || [];

    const existingLines = new Set((astEntry?.matches || []).map((m) => m.lineNumber));
    const mergedMatches = [...(astEntry?.matches || [])];

    // Append chunk-level snippet matches for lines not already shown by exact AST matches
    for (const hit of fileChunks.slice(0, 3)) {
      const c = hit.chunk;
      if (existingLines.has(c.startLine)) continue;
      const previewLine = c.content
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) || '';
      const label = c.symbolName && c.symbolName !== 'module' ? `[${c.symbolType}:${c.symbolName}]` : `[${c.symbolType}]`;

      mergedMatches.push({
        lineNumber: c.startLine,
        endLine: c.endLine,
        fileName: c.fileName,
        filePath: c.filePath,
        declarationType: c.symbolType,
        declarationName: c.symbolName,
        lineContent: `${label} L${c.startLine}-L${c.endLine}: ${previewLine}`,
        rawContent: c.content,
        matchedWords: hit.matchedTerms,
        fromChunk: true,
      });
    }

    const totalMatches = mergedMatches.length;
    grandTotalMatches += totalMatches;

    results.push({
      fileId,
      fileName: astEntry?.fileName || fileObj?.name || fileChunks[0]?.chunk.fileName || '',
      filePath:
        astEntry?.filePath ||
        getFilePath(fileObj) ||
        fileChunks[0]?.chunk.filePath ||
        '',
      fileExtension: astEntry?.fileExtension || fileObj?.extension || fileChunks[0]?.chunk.extension || '',
      fileSize: astEntry?.fileSize || fileObj?.size || 0,
      lineCount: astEntry?.lineCount || fileObj?.lineCount || 0,
      matches: mergedMatches,
      totalMatches,
      score: fused.rrfScore,
      matchType: resolveMatchType(fused.sources, mode),
      sources: fused.sources,
      chunks: fileChunks.slice(0, 5),
    });
  }

  return {
    results,
    grandTotalMatches,
    totalMatchedChunks: chunkHits.length,
    modeUsed: mode,
  };
}
