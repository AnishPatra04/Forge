import { chunkFile } from './codeChunker.js';
import { retrieveRagContext } from './ragPipeline.js';
import { getFileExtension, getFilePath, isSupportedFile } from '../constants/fileTypes.js';

export const REVIEW_CATEGORIES = [
  'Bug Detection',
  'Security Analysis',
  'Performance Analysis',
  'Code Quality',
  'Maintainability',
];

export const REVIEW_SEVERITIES = [
  'Critical',
  'High',
  'Medium',
  'Low',
  'Informational',
];

const NON_CODE_DOC_EXTENSIONS = new Set(['.md']);
const HIGH_PRIORITY_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java']);
const MAX_PROJECT_BATCH_FILES = 3;
const MAX_PROJECT_BATCH_CHARS = 18000;
const MAX_PROJECT_FILES_DEFAULT = 24;

/**
 * Extracts selectable functions/classes from a file using existing AST metadata
 * and codeChunker (supports JS, JSX, TS, TSX, Python, Java).
 *
 * @param {object} file
 * @returns {Array<{ id: string, symbolName: string, symbolType: string, startLine: number, endLine: number, label: string }>}
 */
export function getReviewableSymbols(file) {
  if (!file || typeof file.content !== 'string' || !file.content.trim()) {
    return [];
  }

  const symbols = [];
  const seen = new Set();

  if (file.astMetadata && !file.astMetadata.error) {
    for (const cls of file.astMetadata.classes || []) {
      if (!cls?.name) continue;
      const startLine = cls.line || 1;
      const endLine = cls.endLine || startLine;
      const key = `class:${cls.name}:${startLine}`;
      if (!seen.has(key)) {
        seen.add(key);
        symbols.push({
          id: key,
          symbolName: cls.name,
          symbolType: 'class',
          startLine,
          endLine,
          label: `class ${cls.name} (L${startLine}-L${endLine})`,
        });
      }
    }

    for (const fn of file.astMetadata.functions || []) {
      if (!fn?.name) continue;
      const startLine = fn.line || 1;
      const endLine = fn.endLine || startLine;
      const key = `function:${fn.name}:${startLine}`;
      if (!seen.has(key)) {
        seen.add(key);
        symbols.push({
          id: key,
          symbolName: fn.name,
          symbolType: 'function',
          startLine,
          endLine,
          label: `function ${fn.name} (L${startLine}-L${endLine})`,
        });
      }
    }
  } else {
    // Reuse existing codeChunker for Python/Java functions & classes
    const fileChunks = chunkFile(file);
    for (const chunk of fileChunks) {
      if (!chunk.symbolName || chunk.symbolType === 'module' || chunk.symbolType === 'block') {
        continue;
      }
      const key = `${chunk.symbolType}:${chunk.symbolName}:${chunk.startLine}`;
      if (!seen.has(key)) {
        seen.add(key);
        symbols.push({
          id: key,
          symbolName: chunk.symbolName,
          symbolType: chunk.symbolType,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          label: `${chunk.symbolType} ${chunk.symbolName} (L${chunk.startLine}-L${chunk.endLine})`,
        });
      }
    }
  }

  symbols.sort((a, b) => a.startLine - b.startLine);
  return symbols;
}

/**
 * Checks whether a file is eligible for AI code review.
 *
 * @param {object} file
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function validateReviewableFile(file) {
  if (!file) {
    return { eligible: false, reason: 'No file selected.' };
  }
  const filePath = getFilePath(file) || file.name || '';
  if (!isSupportedFile(filePath)) {
    return { eligible: false, reason: `Unsupported file type for "${filePath}".` };
  }
  if (typeof file.content !== 'string' || !file.content.trim()) {
    return { eligible: false, reason: `File "${filePath}" is empty and cannot be reviewed.` };
  }
  return { eligible: true, reason: null };
}

/**
 * Gathers up to 4 compact supporting code chunks for a target file by combining:
 * 1. Direct workspace dependencies (from Phase 3A metadata)
 * 2. Relevant chunks from existing Hybrid Search / RAG retrieval
 * Excludes the target file itself to prevent redundant tokens.
 */
export async function gatherSupportingContext({
  targetFile,
  files = [],
  chunks = [],
  bm25Index = null,
  vectorIndex = null,
  maxChunks = 4,
}) {
  if (!targetFile || files.length <= 1) return [];

  const targetId = targetFile.id;
  const targetPath = getFilePath(targetFile) || targetFile.name;
  const supporting = [];
  const seenKeys = new Set();

  // 1. Direct local dependencies (Phase 3A metadata)
  const resolvedDeps = targetFile.dependencies?.resolved || [];
  const filesById = new Map(files.map((f) => [f.id, f]));

  for (const dep of resolvedDeps) {
    if (supporting.length >= maxChunks) break;
    const depFile = filesById.get(dep.resolvedFileId);
    if (!depFile || depFile.id === targetId || !depFile.content?.trim()) continue;

    const depPath = getFilePath(depFile) || depFile.name;
    const key = `${depFile.id}:1`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const previewLines = depFile.content.split('\n').slice(0, 40);
    supporting.push({
      filePath: depPath,
      fileName: depFile.name,
      startLine: 1,
      endLine: previewLines.length,
      content: previewLines.join('\n'),
    });
  }

  // 2. Supplement via existing hybrid RAG retrieval if budget remains
  if (supporting.length < maxChunks && chunks.length > 0) {
    const querySeed = [
      targetPath,
      ...(targetFile.astMetadata?.imports || []).slice(0, 5).map((i) => i.name || i.source),
      ...(targetFile.astMetadata?.functions || []).slice(0, 4).map((f) => f.name),
    ]
      .filter(Boolean)
      .join(' ');

    if (querySeed.trim()) {
      const rag = await retrieveRagContext({
        question: querySeed,
        files,
        chunks,
        bm25Index,
        vectorIndex,
        maxChunks: maxChunks + 3,
      });

      for (const chunk of rag.contextChunks) {
        if (supporting.length >= maxChunks) break;
        if (chunk.fileId === targetId || chunk.filePath === targetPath) continue;
        const key = `${chunk.fileId}:${chunk.startLine}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        supporting.push({
          filePath: chunk.filePath,
          fileName: chunk.fileName,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
        });
      }
    }
  }

  return supporting.slice(0, maxChunks);
}

/**
 * Prioritizes workspace files for full-project review (source code first, higher
 * dependency connectivity and symbol richness prioritized) and splits into batches.
 *
 * @param {Array<object>} files
 * @param {object} [options]
 * @returns {{ prioritizedFiles: Array<object>, batches: Array<Array<object>>, skippedCount: number }}
 */
export function buildProjectReviewBatches(
  files = [],
  {
    maxFiles = MAX_PROJECT_FILES_DEFAULT,
    maxBatchFiles = MAX_PROJECT_BATCH_FILES,
    maxBatchChars = MAX_PROJECT_BATCH_CHARS,
  } = {}
) {
  const eligible = [];
  let skippedCount = 0;

  for (const file of files) {
    const validation = validateReviewableFile(file);
    const ext = (file?.extension || getFileExtension(getFilePath(file) || '')).toLowerCase();
    if (!validation.eligible || NON_CODE_DOC_EXTENSIONS.has(ext)) {
      skippedCount++;
      continue;
    }

    const depCount = (file.dependencies?.resolved?.length || 0) + (file.importedBy?.length || 0);
    const astCount =
      (file.astMetadata?.functions?.length || 0) + (file.astMetadata?.classes?.length || 0);
    const isHighPriority = HIGH_PRIORITY_EXTENSIONS.has(ext) ? 10 : 1;
    const priorityScore = isHighPriority + depCount * 3 + Math.min(10, astCount);

    eligible.push({ file, priorityScore });
  }

  eligible.sort((a, b) => b.priorityScore - a.priorityScore);
  const prioritizedFiles = eligible.slice(0, maxFiles).map((e) => e.file);
  if (eligible.length > maxFiles) {
    skippedCount += eligible.length - maxFiles;
  }

  const batches = [];
  let currentBatch = [];
  let currentChars = 0;

  for (const file of prioritizedFiles) {
    const fileChars = Math.min(10000, file.content.length);
    if (
      currentBatch.length > 0 &&
      (currentBatch.length >= maxBatchFiles || currentChars + fileChars > maxBatchChars)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(file);
    currentChars += fileChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return { prioritizedFiles, batches, skippedCount };
}

/**
 * Aggregates and deduplicates findings across multiple batch review responses.
 */
export function aggregateProjectReviewResults(batchResults = [], { reviewedFileCount = 0, skippedCount = 0 } = {}) {
  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3, Informational: 4 };
  const breakdown = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
  };

  const mergedFindings = [];
  const seenKeys = new Set();
  const summaries = [];
  const reviewedFiles = [];
  let model = null;

  for (const batch of batchResults) {
    if (!batch) continue;
    if (batch.model) model = batch.model;
    if (batch.summary) summaries.push(batch.summary);
    if (Array.isArray(batch.reviewedFiles)) {
      for (const rf of batch.reviewedFiles) {
        if (!reviewedFiles.includes(rf)) reviewedFiles.push(rf);
      }
    }

    for (const finding of batch.findings || []) {
      const key = `${finding.filePath}:${finding.startLine}-${finding.endLine}:${finding.category}:${finding.title.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const normalized = {
        ...finding,
        id: `proj-rev-${mergedFindings.length + 1}-${finding.fileId || 'file'}-${finding.startLine}`,
      };
      mergedFindings.push(normalized);
      if (breakdown[normalized.severity] !== undefined) {
        breakdown[normalized.severity]++;
      }
    }
  }

  mergedFindings.sort((a, b) => {
    const sevDiff = (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.startLine - b.startLine;
  });

  const combinedSummary =
    summaries.length > 0
      ? `Reviewed ${reviewedFileCount || reviewedFiles.length} prioritized code file${(reviewedFileCount || reviewedFiles.length) === 1 ? '' : 's'} across ${batchResults.length} batch${batchResults.length === 1 ? '' : 'es'}${skippedCount > 0 ? ` (${skippedCount} non-code/excess skipped)` : ''}. ${summaries[0]}`
      : 'Full-project review completed.';

  return {
    mode: 'project',
    reviewedFiles,
    skippedCount,
    summary: combinedSummary,
    findings: mergedFindings,
    totalFindings: mergedFindings.length,
    severityBreakdown: breakdown,
    model,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

async function postReviewRequest(endpoint, body, signal) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const netErr = new Error(
      'Unable to reach the FORGE AI backend server. Start it with `npm run server`.'
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
    const apiErr = new Error(data?.error || `Code review request failed (HTTP ${response.status}).`);
    apiErr.code = data?.code || 'REVIEW_FAILED';
    apiErr.status = response.status;
    throw apiErr;
  }

  return data;
}

export function requestFileReview({ file, scope = null, supportingChunks = [], projectName, signal }) {
  return postReviewRequest(
    '/api/review/file',
    {
      file: {
        id: file.id,
        name: file.name,
        path: getFilePath(file) || file.name,
        extension: file.extension,
        content: file.content,
      },
      scope,
      supportingChunks,
      projectName,
    },
    signal
  );
}

export function requestProjectBatchReview({ files = [], projectName, signal }) {
  return postReviewRequest(
    '/api/review/project-batch',
    {
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        path: getFilePath(file) || file.name,
        extension: file.extension,
        content: file.content,
      })),
      projectName,
    },
    signal
  );
}
