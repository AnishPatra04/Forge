import { getFileExtension, getFileNameFromPath, getFilePath } from '../constants/fileTypes.js';

export const DEFAULT_MAX_CHUNK_LINES = 50;
export const DEFAULT_OVERLAP_LINES = 8;
export const DEFAULT_WINDOW_LINES = 35;

/**
 * Splits camelCase, PascalCase, snake_case, and kebab-case identifiers
 * into space-separated lowercase words to improve both lexical and semantic matching.
 *
 * @param {string} text
 * @returns {string}
 */
export function splitIdentifierWords(text = '') {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildSearchText({ filePath, symbolName, symbolType, content }) {
  const headerParts = [filePath];
  if (symbolName) {
    headerParts.push(`${symbolType} ${symbolName}`);
    const expanded = splitIdentifierWords(symbolName);
    if (expanded && expanded !== symbolName.toLowerCase()) {
      headerParts.push(expanded);
    }
  }
  return `${headerParts.join(' | ')}\n${content}`;
}

function sliceLines(lines, startLine, endLine) {
  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.min(lines.length, Math.max(safeStart, endLine));
  return lines.slice(safeStart - 1, safeEnd).join('\n');
}

function emitBoundedChunk({
  chunks,
  seenRanges,
  lines,
  fileId,
  fileName,
  filePath,
  extension,
  symbolName,
  symbolType,
  startLine,
  endLine,
  maxChunkLines,
  overlapLines,
}) {
  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.min(lines.length, Math.max(safeStart, endLine));
  const totalSpan = safeEnd - safeStart + 1;

  if (totalSpan <= maxChunkLines) {
    const content = sliceLines(lines, safeStart, safeEnd);
    if (!content.trim()) return;
    const rangeKey = `${safeStart}:${safeEnd}`;
    if (seenRanges.has(rangeKey)) return;
    seenRanges.add(rangeKey);

    chunks.push({
      chunkId: `${fileId}:${safeStart}-${safeEnd}:${symbolName || symbolType}`,
      fileId,
      fileName,
      filePath,
      extension,
      symbolName: symbolName || null,
      symbolType,
      startLine: safeStart,
      endLine: safeEnd,
      content,
      searchText: buildSearchText({ filePath, symbolName, symbolType, content }),
    });
    return;
  }

  const step = Math.max(1, maxChunkLines - overlapLines);
  for (let cursor = safeStart; cursor <= safeEnd; cursor += step) {
    const windowEnd = Math.min(safeEnd, cursor + maxChunkLines - 1);
    const content = sliceLines(lines, cursor, windowEnd);
    if (content.trim()) {
      const rangeKey = `${cursor}:${windowEnd}`;
      if (!seenRanges.has(rangeKey)) {
        seenRanges.add(rangeKey);
        chunks.push({
          chunkId: `${fileId}:${cursor}-${windowEnd}:${symbolName || symbolType}`,
          fileId,
          fileName,
          filePath,
          extension,
          symbolName: symbolName || null,
          symbolType,
          startLine: cursor,
          endLine: windowEnd,
          content,
          searchText: buildSearchText({ filePath, symbolName, symbolType, content }),
        });
      }
    }
    if (windowEnd >= safeEnd) break;
  }
}

function chunkWithWindow(lines, ctx, windowSize, overlapLines) {
  const step = Math.max(1, windowSize - overlapLines);
  for (let start = 1; start <= lines.length; start += step) {
    const end = Math.min(lines.length, start + windowSize - 1);
    emitBoundedChunk({
      ...ctx,
      lines,
      symbolName: null,
      symbolType: 'block',
      startLine: start,
      endLine: end,
    });
    if (end >= lines.length) break;
  }
}

function chunkAstFile(lines, astMetadata, ctx) {
  const { functions = [], classes = [], imports = [], exports = [] } = astMetadata;
  const coveredLines = new Set();

  const markCovered = (start, end) => {
    for (let ln = start; ln <= end; ln++) coveredLines.add(ln);
  };

  // Emit class header/field context or full class if it contains no nested functions
  for (const cls of classes) {
    const start = cls.line || 1;
    const end = cls.endLine || start;
    const innerFunctions = functions.filter(
      (fn) => fn.line > start && (fn.endLine || fn.line) <= end
    );

    if (innerFunctions.length === 0) {
      emitBoundedChunk({
        ...ctx,
        lines,
        symbolName: cls.name,
        symbolType: 'class',
        startLine: start,
        endLine: end,
      });
      markCovered(start, end);
    } else {
      const firstMethodLine = Math.min(...innerFunctions.map((fn) => fn.line));
      const headerEnd = Math.max(start, Math.min(end, firstMethodLine - 1));
      emitBoundedChunk({
        ...ctx,
        lines,
        symbolName: cls.name,
        symbolType: 'class',
        startLine: start,
        endLine: headerEnd,
      });
      markCovered(start, headerEnd);
    }
  }

  // Emit function/method chunks
  for (const fn of functions) {
    const start = fn.line || 1;
    const end = fn.endLine || start;
    emitBoundedChunk({
      ...ctx,
      lines,
      symbolName: fn.name,
      symbolType: 'function',
      startLine: start,
      endLine: end,
    });
    markCovered(start, end);
  }

  // Emit module-level summary/top-level declarations not inside functions/classes
  const uncoveredLines = [];
  for (let ln = 1; ln <= lines.length; ln++) {
    if (!coveredLines.has(ln) && lines[ln - 1].trim().length > 0) {
      uncoveredLines.push(ln);
    }
  }

  if (uncoveredLines.length > 0 || imports.length > 0 || exports.length > 0) {
    const firstUncovered = uncoveredLines[0] || 1;
    const lastUncovered = uncoveredLines[uncoveredLines.length - 1] || Math.min(lines.length, 25);

    if (uncoveredLines.length === lines.length || ctx.chunks.length === 0) {
      chunkWithWindow(lines, ctx, ctx.windowLines, ctx.overlapLines);
    } else {
      const topLines = uncoveredLines
        .slice(0, ctx.maxChunkLines)
        .map((ln) => lines[ln - 1])
        .join('\n');
      if (topLines.trim()) {
        const rangeKey = `mod:${firstUncovered}:${lastUncovered}`;
        if (!ctx.seenRanges.has(rangeKey)) {
          ctx.seenRanges.add(rangeKey);
          ctx.chunks.push({
            chunkId: `${ctx.fileId}:module:${firstUncovered}-${lastUncovered}`,
            fileId: ctx.fileId,
            fileName: ctx.fileName,
            filePath: ctx.filePath,
            extension: ctx.extension,
            symbolName: 'module',
            symbolType: 'module',
            startLine: firstUncovered,
            endLine: Math.min(lastUncovered, firstUncovered + ctx.maxChunkLines - 1),
            content: topLines,
            searchText: buildSearchText({
              filePath: ctx.filePath,
              symbolName: 'module',
              symbolType: 'module',
              content: topLines,
            }),
          });
        }
      }
    }
  }
}

function chunkPythonOrJava(lines, extension, ctx) {
  const isPython = extension === '.py';
  const declPattern = isPython
    ? /^(?:async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/
    : /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|enum|[A-Za-z0-9_<>[\]]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|{|extends|implements)/;

  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(declPattern);
    if (match) {
      headers.push({
        line: i + 1,
        name: match[1],
        type: /\bclass\b/.test(lines[i]) ? 'class' : 'function',
      });
    }
  }

  if (headers.length === 0) {
    chunkWithWindow(lines, ctx, ctx.windowLines, ctx.overlapLines);
    return;
  }

  // Leading imports/module header before first declaration
  if (headers[0].line > 1) {
    emitBoundedChunk({
      ...ctx,
      lines,
      symbolName: 'module',
      symbolType: 'module',
      startLine: 1,
      endLine: headers[0].line - 1,
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].line;
    const end = i + 1 < headers.length ? headers[i + 1].line - 1 : lines.length;
    emitBoundedChunk({
      ...ctx,
      lines,
      symbolName: headers[i].name,
      symbolType: headers[i].type,
      startLine: start,
      endLine: end,
    });
  }
}

function chunkMarkdown(lines, ctx) {
  const sections = [];
  let currentStart = 1;
  let currentHeading = 'overview';

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      if (i + 1 > currentStart) {
        sections.push({ startLine: currentStart, endLine: i, heading: currentHeading });
      }
      currentStart = i + 1;
      currentHeading = headingMatch[1].trim();
    }
  }
  if (currentStart <= lines.length) {
    sections.push({ startLine: currentStart, endLine: lines.length, heading: currentHeading });
  }

  for (const sec of sections) {
    emitBoundedChunk({
      ...ctx,
      lines,
      symbolName: sec.heading,
      symbolType: 'section',
      startLine: sec.startLine,
      endLine: sec.endLine,
    });
  }
}

/**
 * Splits a single workspace file into meaningful, line-bounded chunks.
 *
 * @param {object} file
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function chunkFile(file, options = {}) {
  if (!file || typeof file.content !== 'string' || !file.content.trim()) {
    return [];
  }

  const maxChunkLines = options.maxChunkLines || DEFAULT_MAX_CHUNK_LINES;
  const overlapLines = options.overlapLines || DEFAULT_OVERLAP_LINES;
  const windowLines = options.windowLines || DEFAULT_WINDOW_LINES;

  const filePath = getFilePath(file) || file.name || '';
  const fileName = file.name || getFileNameFromPath(filePath);
  const fileId = file.id || filePath || fileName;
  const extension = (file.extension || getFileExtension(filePath)).toLowerCase();
  const lines = file.content.split('\n');

  const chunks = [];
  const seenRanges = new Set();
  const ctx = {
    chunks,
    seenRanges,
    fileId,
    fileName,
    filePath,
    extension,
    maxChunkLines,
    overlapLines,
    windowLines,
  };

  if (file.astMetadata && !file.astMetadata.error) {
    chunkAstFile(lines, file.astMetadata, ctx);
  } else if (extension === '.py' || extension === '.java') {
    chunkPythonOrJava(lines, extension, ctx);
  } else if (extension === '.md') {
    chunkMarkdown(lines, ctx);
  } else {
    chunkWithWindow(lines, ctx, windowLines, overlapLines);
  }

  return chunks;
}

/**
 * Splits an array of workspace files into chunks.
 *
 * @param {Array<object>} filesList
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function chunkWorkspaceFiles(filesList = [], options = {}) {
  if (!Array.isArray(filesList) || filesList.length === 0) return [];
  const allChunks = [];
  for (const file of filesList) {
    const fileChunks = chunkFile(file, options);
    for (const chunk of fileChunks) {
      allChunks.push(chunk);
    }
  }
  return allChunks;
}
