import { getFilePath } from '../constants/fileTypes.js';
import { performHybridSearch } from './hybridSearch.js';
import { retrieveRagContext } from './ragPipeline.js';
import { getReviewableSymbols } from './codeReviewPipeline.js';

export const DEFAULT_MAX_TRAVERSAL_DEPTH = 5;
export const DEFAULT_MAX_TRAVERSAL_NODES = 40;
export const DEFAULT_MAX_IMPACT_SNIPPETS = 12;
export const DEFAULT_MAX_IMPACT_CHARS = 18000;

const STOP_WORDS = new Set([
  'what', 'would', 'happen', 'if', 'we', 'i', 'the', 'a', 'an', 'to', 'of', 'in',
  'on', 'for', 'with', 'from', 'by', 'at', 'is', 'are', 'be', 'this', 'that',
  'these', 'those', 'into', 'our', 'my', 'your', 'it', 'its', 'how', 'could',
  'might', 'will', 'should', 'can', 'does', 'do', 'about', 'code', 'codebase',
  'project', 'application', 'app', 'system', 'function', 'class', 'file', 'method',
  'module', 'component', 'service', 'instead', 'using', 'use', 'make', 'change',
]);

const OPERATION_PATTERNS = [
  { op: 'remove', regex: /\b(remove|delete|drop|eliminate|strip|deprecate)\b/i },
  { op: 'replace', regex: /\b(replace|swap|switch|migrate|move\s+from|convert)\b/i },
  { op: 'rename', regex: /\b(rename)\b/i },
  { op: 'refactor', regex: /\b(refactor|restructure|split|extract|decouple)\b/i },
  { op: 'modify', regex: /\b(change|modify|update|alter|edit|extend|add|adjust)\b/i },
];

const TECH_SYNONYMS = {
  postgresql: ['postgres', 'postgresql', 'psycopg', 'pg', 'pool', 'database', 'sql'],
  postgres: ['postgres', 'postgresql', 'psycopg', 'pg', 'pool', 'database', 'sql'],
  mongodb: ['mongo', 'mongodb', 'mongoose', 'database', 'nosql'],
  jwt: ['jwt', 'jose', 'signjwt', 'jwtverify', 'token', 'session', 'auth'],
  oauth: ['oauth', 'auth', 'token', 'session', 'login'],
  auth: ['auth', 'authentication', 'login', 'session', 'token', 'jwt'],
  authentication: ['auth', 'authentication', 'login', 'session', 'token', 'jwt'],
  database: ['database', 'db', 'postgres', 'sql', 'pool', 'query', 'connection'],
  pooling: ['pool', 'pooling', 'connection', 'database', 'db'],
  api: ['api', 'fetch', 'http', 'client', 'endpoint', 'request', 'response'],
  retry: ['retry', 'retries', 'backoff', 'fetch', 'api'],
};

const TEST_FILE_REGEX =
  /(^|\/)(__tests__|tests?|spec)\/|(\.(test|spec)\.[a-z0-9]+$)|(^|\/)test_[^/]+\.py$|_test\.(py|go|js|ts|jsx|tsx)$/i;

/**
 * Stage 1: Parse a natural-language change description into structured intent & hints.
 *
 * @param {string} description
 * @returns {object}
 */
export function parseChangeDescription(description = '') {
  const raw = typeof description === 'string' ? description.trim() : '';
  if (!raw) {
    return {
      raw: '',
      operation: 'modify',
      currentBehavior: null,
      proposedBehavior: null,
      candidateSymbols: [],
      candidateFiles: [],
      technologyTerms: [],
      keywords: [],
      expectedScope: 'unknown',
      isVague: true,
      vaguenessReason: 'No change description was provided.',
    };
  }

  let operation = 'modify';
  for (const entry of OPERATION_PATTERNS) {
    if (entry.regex.test(raw)) {
      operation = entry.op;
      break;
    }
  }

  // Extract "replace X with Y" / "migrate X to Y" / "rename X to Y"
  let currentBehavior = null;
  let proposedBehavior = null;
  const replaceMatch = raw.match(
    /\b(?:replace|swap|switch|migrate|convert)\s+([^?.!,]+?)\s+(?:with|to|for)\s+([^?.!,]+)/i
  );
  const renameMatch = raw.match(/\brename\s+([^\s?.!,]+)\s+(?:to|as)\s+([^\s?.!,]+)/i);
  if (replaceMatch) {
    currentBehavior = replaceMatch[1].trim();
    proposedBehavior = replaceMatch[2].trim();
  } else if (renameMatch) {
    currentBehavior = renameMatch[1].trim();
    proposedBehavior = renameMatch[2].trim();
  }

  // Extract explicit file references (e.g. authService.ts, src/api/client.js)
  const fileMatches = raw.match(/[A-Za-z0-9_./-]+\.(?:tsx?|jsx?|py|java|json|css|html|md)\b/gi) || [];
  const candidateFiles = Array.from(new Set(fileMatches.map((m) => m.replace(/\\/g, '/'))));

  // Extract explicit identifier-like symbols: backticked, quoted, camelCase, PascalCase, snake_case
  const symbolSet = new Set();
  for (const m of raw.matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'/g)) {
    const val = (m[1] || m[2] || m[3] || '').trim();
    if (val && val.length <= 80 && !val.includes(' ')) {
      symbolSet.add(val);
    }
  }
  for (const m of raw.matchAll(/\b([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[a-z]+_[a-z0-9_]+)\b/g)) {
    symbolSet.add(m[1]);
  }
  // Also capture identifier directly following "function/class/method/remove/rename <name>"
  for (const m of raw.matchAll(/\b(?:function|class|method|symbol|variable|remove|delete|rename)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)) {
    const word = m[1];
    if (!STOP_WORDS.has(word.toLowerCase())) {
      symbolSet.add(word);
    }
  }
  // Remove file names from candidateSymbols
  const fileSetLower = new Set(candidateFiles.map((f) => f.toLowerCase()));
  const candidateSymbols = Array.from(symbolSet).filter(
    (s) => !fileSetLower.has(s.toLowerCase()) && !STOP_WORDS.has(s.toLowerCase())
  );

  const tokens = raw
    .toLowerCase()
    .match(/[a-z0-9_]+/g) || [];
  const keywords = Array.from(
    new Set(tokens.filter((t) => t.length > 2 && !STOP_WORDS.has(t)))
  );

  const technologyTerms = keywords.filter((kw) => Boolean(TECH_SYNONYMS[kw]));

  let expectedScope = 'component';
  if (technologyTerms.length > 0 && candidateSymbols.length === 0 && candidateFiles.length === 0) {
    expectedScope = 'architectural';
  } else if (candidateSymbols.length > 0) {
    expectedScope = 'symbol';
  } else if (candidateFiles.length > 0) {
    expectedScope = 'file';
  }

  const isVague =
    keywords.length === 0 &&
    candidateSymbols.length === 0 &&
    candidateFiles.length === 0;

  return {
    raw,
    operation,
    currentBehavior,
    proposedBehavior,
    candidateSymbols,
    candidateFiles,
    technologyTerms,
    keywords,
    expectedScope,
    isVague,
    vaguenessReason: isVague
      ? 'The description is too vague to identify a concrete file, symbol, or architectural target.'
      : null,
  };
}

/**
 * Stage 2: Resolve the proposed change to concrete workspace targets (file, symbol, or multi-file tech).
 * Explicitly detects ambiguity and nonexistent targets instead of silently guessing.
 */
export async function resolveChangeTargets({
  changeDescription,
  parsedChange,
  targetSelection = null,
  files = [],
  chunks = [],
  bm25Index = null,
  vectorIndex = null,
}) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      status: 'empty_workspace',
      targets: [],
      ambiguity: null,
      retrievalMode: 'empty',
      semanticUsed: false,
      notes: ['Workspace contains no loaded files.'],
    };
  }

  // 1. Explicit target selected in UI (file or specific function/class)
  if (targetSelection && targetSelection.scope !== 'workspace' && targetSelection.fileId) {
    const file = files.find((f) => f.id === targetSelection.fileId);
    if (!file) {
      return {
        status: 'not_found',
        targets: [],
        ambiguity: null,
        retrievalMode: 'explicit',
        semanticUsed: false,
        notes: ['The explicitly selected file is no longer present in the workspace.'],
      };
    }

    const filePath = getFilePath(file) || file.name;
    const isSymbol = targetSelection.scope === 'symbol' && targetSelection.symbolName;
    return {
      status: 'resolved',
      targets: [
        {
          fileId: file.id,
          fileName: file.name,
          filePath,
          targetType: isSymbol ? targetSelection.symbolType || 'symbol' : 'file',
          symbolName: isSymbol ? targetSelection.symbolName : null,
          startLine: isSymbol ? targetSelection.startLine || 1 : 1,
          endLine: isSymbol ? targetSelection.endLine || file.lineCount : file.lineCount,
          matchReason: isSymbol
            ? `Explicitly selected ${targetSelection.symbolType || 'symbol'} "${targetSelection.symbolName}"`
            : `Explicitly selected file "${filePath}"`,
          confidence: 'High',
        },
      ],
      ambiguity: null,
      retrievalMode: 'explicit',
      semanticUsed: false,
      notes: [],
    };
  }

  if (parsedChange.isVague) {
    return {
      status: 'ambiguous',
      targets: [],
      ambiguity: {
        isAmbiguous: true,
        reason: parsedChange.vaguenessReason,
        candidates: files.slice(0, 6).map((f) => ({
          fileId: f.id,
          filePath: getFilePath(f) || f.name,
          symbolName: null,
        })),
      },
      retrievalMode: 'none',
      semanticUsed: false,
      notes: [parsedChange.vaguenessReason],
    };
  }

  const targets = [];
  const seenTargetKeys = new Set();
  const notes = [];

  const addTarget = (entry) => {
    const key = `${entry.fileId}:${entry.symbolName || '__file__'}`;
    if (seenTargetKeys.has(key)) return;
    seenTargetKeys.add(key);
    targets.push(entry);
  };

  // 2. Match explicit file names mentioned in the description
  for (const ref of parsedChange.candidateFiles) {
    const refLower = ref.toLowerCase();
    const matched = files.filter((f) => {
      const fp = (getFilePath(f) || f.name || '').toLowerCase();
      return fp === refLower || fp.endsWith(`/${refLower}`) || (f.name || '').toLowerCase() === refLower;
    });

    if (matched.length > 1) {
      return {
        status: 'ambiguous',
        targets: matched.map((f) => ({
          fileId: f.id,
          fileName: f.name,
          filePath: getFilePath(f) || f.name,
          targetType: 'file',
          symbolName: null,
          startLine: 1,
          endLine: f.lineCount,
          matchReason: `Ambiguous filename match for "${ref}"`,
          confidence: 'Low',
        })),
        ambiguity: {
          isAmbiguous: true,
          reason: `Multiple files match "${ref}": ${matched.map((f) => getFilePath(f) || f.name).join(', ')}. Select a specific target file to disambiguate.`,
          candidates: matched.map((f) => ({
            fileId: f.id,
            filePath: getFilePath(f) || f.name,
            symbolName: null,
          })),
        },
        retrievalMode: 'deterministic',
        semanticUsed: false,
        notes: [`Multiple files match "${ref}".`],
      };
    }

    if (matched.length === 1) {
      const f = matched[0];
      addTarget({
        fileId: f.id,
        fileName: f.name,
        filePath: getFilePath(f) || f.name,
        targetType: 'file',
        symbolName: null,
        startLine: 1,
        endLine: f.lineCount,
        matchReason: `Exact file reference "${ref}"`,
        confidence: 'High',
      });
    }
  }

  // 3. Match symbols across AST metadata & codeChunker symbols (JS/TS/Python/Java)
  const symbolMatchesByName = new Map();
  if (parsedChange.candidateSymbols.length > 0) {
    const allFileSymbols = files.map((f) => ({
      file: f,
      symbols: getReviewableSymbols(f),
      variables: f.astMetadata?.variables || [],
    }));

    for (const symQuery of parsedChange.candidateSymbols) {
      const qLower = symQuery.toLowerCase();
      const hits = [];

      for (const { file, symbols, variables } of allFileSymbols) {
        const filePath = getFilePath(file) || file.name;
        for (const sym of symbols) {
          if (sym.symbolName.toLowerCase() === qLower) {
            hits.push({
              fileId: file.id,
              fileName: file.name,
              filePath,
              targetType: sym.symbolType,
              symbolName: sym.symbolName,
              startLine: sym.startLine,
              endLine: sym.endLine,
              matchReason: `Exact ${sym.symbolType} declaration "${sym.symbolName}" in ${filePath}`,
              confidence: 'High',
            });
          }
        }
        if (hits.length === 0) {
          for (const v of variables) {
            if (v?.name && v.name.toLowerCase() === qLower) {
              hits.push({
                fileId: file.id,
                fileName: file.name,
                filePath,
                targetType: 'variable',
                symbolName: v.name,
                startLine: v.line || 1,
                endLine: v.line || 1,
                matchReason: `Exact variable declaration "${v.name}" in ${filePath}`,
                confidence: 'High',
              });
            }
          }
        }
      }

      if (hits.length > 0) {
        symbolMatchesByName.set(symQuery, hits);
      }
    }
  }

  // Check if a named symbol is ambiguous across multiple distinct files
  for (const [symQuery, hits] of symbolMatchesByName.entries()) {
    const distinctFiles = new Set(hits.map((h) => h.fileId));
    if (distinctFiles.size > 1 && targets.length === 0) {
      return {
        status: 'ambiguous',
        targets: hits,
        ambiguity: {
          isAmbiguous: true,
          reason: `Symbol "${symQuery}" is declared in ${distinctFiles.size} different files (${hits.map((h) => h.filePath).join(', ')}). Select the specific file/symbol in the Target Selector to narrow analysis.`,
          candidates: hits.map((h) => ({
            fileId: h.fileId,
            filePath: h.filePath,
            symbolName: h.symbolName,
          })),
        },
        retrievalMode: 'ast_symbol',
        semanticUsed: false,
        notes: [`Symbol "${symQuery}" appears in multiple files.`],
      };
    }

    for (const hit of hits) {
      addTarget(hit);
    }
  }

  // 4. Architectural / Technology or Natural-Language Target Resolution via Hybrid Search
  let retrievalMode = targets.length > 0 ? 'ast_symbol' : 'lexical_fallback';
  let semanticUsed = false;

  if (targets.length === 0) {
    // Expand technology keywords ONLY for the "current" side if replacing X with Y
    const searchSeedTerms = parsedChange.currentBehavior
      ? [parsedChange.currentBehavior]
      : [changeDescription];

    for (const tech of parsedChange.technologyTerms) {
      if (
        parsedChange.proposedBehavior &&
        parsedChange.proposedBehavior.toLowerCase().includes(tech) &&
        !(parsedChange.currentBehavior || '').toLowerCase().includes(tech)
      ) {
        continue;
      }
      searchSeedTerms.push(...(TECH_SYNONYMS[tech] || []).slice(0, 4));
    }

    const searchQuery = searchSeedTerms.join(' ').trim();
    const rag = await retrieveRagContext({
      question: searchQuery,
      files,
      chunks,
      bm25Index,
      vectorIndex,
      maxChunks: 8,
    });
    retrievalMode = rag.retrievalMode;
    semanticUsed = rag.semanticUsed;

    const hybridRes = performHybridSearch(files, searchQuery, {
      mode: 'hybrid',
      chunks,
      bm25Index,
      queryVector: null,
      vectorMap: null,
    });

    // Check if the user explicitly named a nonexistent file or symbol
    const explicitFileMissing =
      parsedChange.candidateFiles.length > 0 &&
      !parsedChange.candidateFiles.some((cf) =>
        files.some((f) => (getFilePath(f) || f.name).toLowerCase().endsWith(cf.toLowerCase()))
      );

    const explicitSymbolMissing =
      parsedChange.candidateSymbols.length > 0 &&
      symbolMatchesByName.size === 0 &&
      !files.some((f) =>
        parsedChange.candidateSymbols.some((sym) =>
          (f.content || '').toLowerCase().includes(sym.toLowerCase())
        )
      );

    if (explicitFileMissing || explicitSymbolMissing) {
      const missingName = explicitFileMissing
        ? parsedChange.candidateFiles.join(', ')
        : parsedChange.candidateSymbols.join(', ');
      return {
        status: 'not_found',
        targets: [],
        ambiguity: null,
        retrievalMode,
        semanticUsed,
        notes: [
          `Target "${missingName}" could not be found in any of the ${files.length} loaded workspace files.`,
        ],
      };
    }

    // Collect candidate target files from Hybrid Search + RAG
    const candidateFileIds = new Map();
    for (const res of (hybridRes.results || []).slice(0, 4)) {
      if (!candidateFileIds.has(res.fileId)) {
        candidateFileIds.set(res.fileId, {
          score: res.score || 0.1,
          reason: `Matched via Hybrid Search (${res.totalMatches} match${res.totalMatches === 1 ? '' : 'es'})`,
          firstLine: res.matches?.[0]?.lineNumber || 1,
        });
      }
    }
    for (const src of rag.sources.slice(0, 4)) {
      if (!candidateFileIds.has(src.fileId)) {
        candidateFileIds.set(src.fileId, {
          score: src.score || 0.05,
          reason: `Matched via ${src.matchSources?.includes('semantic') ? 'Semantic Vector' : 'BM25'} retrieval`,
          firstLine: src.startLine || 1,
        });
      }
    }

    // Verify term overlap when running without vectors
    const currentTerms = (
      (parsedChange.currentBehavior || changeDescription).toLowerCase().match(/[a-z0-9_]{3,}/g) || []
    ).filter((t) => !STOP_WORDS.has(t));
    const expandedCurrent = new Set(currentTerms);
    for (const t of currentTerms) {
      if (TECH_SYNONYMS[t]) {
        TECH_SYNONYMS[t].forEach((syn) => expandedCurrent.add(syn));
      }
    }

    for (const [fId, info] of candidateFileIds.entries()) {
      const file = files.find((f) => f.id === fId);
      if (!file) continue;
      const filePath = getFilePath(file) || file.name;
      const haystack = `${filePath}\n${file.content || ''}`.toLowerCase();
      const hasTermOverlap =
        semanticUsed ||
        Array.from(expandedCurrent).some((term) => haystack.includes(term));

      if (!hasTermOverlap) continue;

      addTarget({
        fileId: file.id,
        fileName: file.name,
        filePath,
        targetType: parsedChange.expectedScope === 'architectural' ? 'architectural_component' : 'file',
        symbolName: null,
        startLine: info.firstLine,
        endLine: Math.min(file.lineCount, info.firstLine + 25),
        matchReason: info.reason,
        confidence: info.score >= 0.025 ? 'High' : 'Medium',
      });
    }
  }

  if (targets.length === 0) {
    return {
      status: 'not_found',
      targets: [],
      ambiguity: null,
      retrievalMode,
      semanticUsed,
      notes: [
        'No workspace files or symbols matched the proposed change description with sufficient evidence.',
      ],
    };
  }

  return {
    status: 'resolved',
    targets: targets.slice(0, 5),
    ambiguity: null,
    retrievalMode,
    semanticUsed,
    notes,
  };
}

/**
 * Stage 3 & 4: Deterministic reverse-dependency BFS traversal using Phase 3A metadata.
 * Preserves exact edge direction (if B imports A, a change to A affects B: A -> B),
 * handles cycles safely, bounds depth/node counts, and records exact paths.
 */
export function traverseDependencyImpact(
  resolvedTargets = [],
  files = [],
  { maxDepth = DEFAULT_MAX_TRAVERSAL_DEPTH, maxNodes = DEFAULT_MAX_TRAVERSAL_NODES } = {}
) {
  const filesById = new Map();
  const filesByPath = new Map();
  for (const f of files) {
    if (!f) continue;
    filesById.set(f.id, f);
    const fp = getFilePath(f) || f.name;
    if (fp) filesByPath.set(fp, f);
    if (f.name && !filesByPath.has(f.name)) filesByPath.set(f.name, f);
  }

  const targetFileIds = new Set(resolvedTargets.map((t) => t.fileId));
  const targetSymbols = resolvedTargets
    .map((t) => t.symbolName)
    .filter(Boolean);

  const visitedDepth = new Map(); // fileId -> shortest depth from any target
  const componentMap = new Map(); // fileId -> impactedComponent record
  const dependencyPaths = []; // [{ from, to, path, depth, relationship }]
  const highlightedEdges = new Set(); // "importerName->importedName" (matching ProjectGraphView edge IDs)
  const cyclesDetected = [];
  let traversalTruncated = false;

  const queue = [];

  for (const target of resolvedTargets) {
    const file = filesById.get(target.fileId);
    if (!file) continue;
    const fp = getFilePath(file) || file.name;
    visitedDepth.set(file.id, 0);

    if (!componentMap.has(file.id)) {
      componentMap.set(file.id, {
        fileId: file.id,
        fileName: file.name,
        filePath: fp,
        dependencyType: 'target',
        depth: 0,
        dependencyPath: [fp],
        importEvidence: [],
        symbolReferences: [],
        isTestFile: TEST_FILE_REGEX.test(fp),
      });
    }
    queue.push({ fileId: file.id, depth: 0, path: [fp], pathIds: new Set([file.id]) });
  }

  // Reverse BFS: follow `importedBy` (if B imports A, change to A impacts B)
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      const curFile = filesById.get(current.fileId);
      if ((curFile?.importedBy || []).length > 0) {
        traversalTruncated = true;
      }
      continue;
    }

    const curFile = filesById.get(current.fileId);
    if (!curFile) continue;

    const importers = curFile.importedBy || [];
    for (const imp of importers) {
      const dependentFile =
        filesById.get(imp.fileId) ||
        filesByPath.get(imp.filePath) ||
        filesByPath.get(imp.fileName);
      if (!dependentFile) continue;

      const depPath = getFilePath(dependentFile) || dependentFile.name;

      // Cycle detection
      if (current.pathIds.has(dependentFile.id)) {
        const cycleLabel = [...current.path, depPath].join(' -> ');
        if (!cyclesDetected.includes(cycleLabel)) {
          cyclesDetected.push(cycleLabel);
        }
        continue;
      }

      const nextDepth = current.depth + 1;
      const nextPath = [...current.path, depPath];

      // Graph edge in ProjectGraphView is stored as importer.name -> imported.name
      highlightedEdges.add(`${dependentFile.name}->${curFile.name}`);

      const relationship = nextDepth === 1 ? 'direct_dependent' : 'indirect_dependent';
      const importNote = {
        importedFile: getFilePath(curFile) || curFile.name,
        line: imp.line || 1,
        specifiers: Array.isArray(imp.specifiers) ? imp.specifiers : [],
      };

      const prevDepth = visitedDepth.get(dependentFile.id);
      if (prevDepth === undefined) {
        if (componentMap.size >= maxNodes) {
          traversalTruncated = true;
          continue;
        }
        visitedDepth.set(dependentFile.id, nextDepth);
        componentMap.set(dependentFile.id, {
          fileId: dependentFile.id,
          fileName: dependentFile.name,
          filePath: depPath,
          dependencyType: relationship,
          depth: nextDepth,
          dependencyPath: nextPath,
          importEvidence: [importNote],
          symbolReferences: findSymbolLinesInFile(dependentFile, targetSymbols),
          isTestFile: TEST_FILE_REGEX.test(depPath),
        });

        dependencyPaths.push({
          from: nextPath[0],
          to: depPath,
          path: nextPath,
          depth: nextDepth,
          relationship,
        });

        const nextPathIds = new Set(current.pathIds);
        nextPathIds.add(dependentFile.id);
        queue.push({
          fileId: dependentFile.id,
          depth: nextDepth,
          path: nextPath,
          pathIds: nextPathIds,
        });
      } else {
        const existing = componentMap.get(dependentFile.id);
        if (
          existing &&
          !existing.importEvidence.some(
            (e) => e.importedFile === importNote.importedFile && e.line === importNote.line
          )
        ) {
          existing.importEvidence.push(importNote);
        }
      }
    }
  }

  // Identify shared dependencies (files imported by a target that are ALSO imported by other files)
  for (const target of resolvedTargets) {
    const targetFile = filesById.get(target.fileId);
    if (!targetFile) continue;
    const resolvedDeps = targetFile.dependencies?.resolved || [];
    for (const dep of resolvedDeps) {
      const depFile =
        filesById.get(dep.resolvedFileId) ||
        filesByPath.get(dep.resolvedFilePath) ||
        filesByPath.get(dep.resolvedFileName);
      if (!depFile || componentMap.has(depFile.id)) continue;

      const otherImporters = (depFile.importedBy || []).filter((i) => !targetFileIds.has(i.fileId));
      if (otherImporters.length > 0 && componentMap.size < maxNodes) {
        const depPath = getFilePath(depFile) || depFile.name;
        const targetPath = getFilePath(targetFile) || targetFile.name;
        componentMap.set(depFile.id, {
          fileId: depFile.id,
          fileName: depFile.name,
          filePath: depPath,
          dependencyType: 'shared_dependency',
          depth: 1,
          dependencyPath: [targetPath, depPath],
          importEvidence: [
            {
              importedFile: depPath,
              line: dep.line || 1,
              specifiers: dep.specifiers || [],
            },
          ],
          symbolReferences: [],
          isTestFile: TEST_FILE_REGEX.test(depPath),
        });
      }
    }
  }

  // Secondary cross-reference check for symbol references in files not reached by static ES imports
  if (targetSymbols.length > 0) {
    for (const file of files) {
      if (componentMap.has(file.id) || componentMap.size >= maxNodes) continue;
      const refs = findSymbolLinesInFile(file, targetSymbols);
      if (refs.length > 0) {
        const fp = getFilePath(file) || file.name;
        componentMap.set(file.id, {
          fileId: file.id,
          fileName: file.name,
          filePath: fp,
          dependencyType: 'related_context',
          depth: 1,
          dependencyPath: [resolvedTargets[0]?.filePath || 'target', fp],
          importEvidence: [],
          symbolReferences: refs,
          isTestFile: TEST_FILE_REGEX.test(fp),
        });
      }
    }
  }

  const impactedComponents = Array.from(componentMap.values());
  const directDependents = impactedComponents.filter((c) => c.dependencyType === 'direct_dependent');
  const indirectDependents = impactedComponents.filter((c) => c.dependencyType === 'indirect_dependent');
  const sharedDependencies = impactedComponents.filter((c) => c.dependencyType === 'shared_dependency');
  const relatedContext = impactedComponents.filter((c) => c.dependencyType === 'related_context');

  return {
    impactedComponents,
    directDependents,
    indirectDependents,
    sharedDependencies,
    relatedContext,
    dependencyPaths,
    highlightedEdges: Array.from(highlightedEdges),
    cyclesDetected,
    traversalTruncated,
  };
}

function findSymbolLinesInFile(file, symbolNames = []) {
  if (!file || typeof file.content !== 'string' || symbolNames.length === 0) return [];
  const lines = file.content.split('\n');
  const refs = [];
  for (const sym of symbolNames) {
    if (!sym || sym.length < 2) continue;
    const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`);
    for (let i = 0; i < lines.length && refs.length < 8; i++) {
      if (regex.test(lines[i])) {
        refs.push({ symbol: sym, line: i + 1, preview: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return refs;
}

/**
 * Part 8: Discover actual test files in the workspace and distinguish existing tests
 * from recommended new tests. Never fabricates existing tests.
 */
export function discoverTestIntelligence({
  resolvedTargets = [],
  traversal,
  files = [],
  parsedChange,
}) {
  const testFiles = files.filter((f) => TEST_FILE_REGEX.test(getFilePath(f) || f.name || ''));
  const targetIds = new Set(resolvedTargets.map((t) => t.fileId));
  const affectedIds = new Set(
    [...(traversal?.directDependents || []), ...(traversal?.indirectDependents || [])].map(
      (c) => c.fileId
    )
  );
  const targetNames = resolvedTargets.map((t) =>
    (t.fileName || '').replace(/\.[^.]+$/, '').toLowerCase()
  );
  const targetSymbols = resolvedTargets.map((t) => (t.symbolName || '').toLowerCase()).filter(Boolean);

  const existingTests = [];

  for (const tf of testFiles) {
    const fp = getFilePath(tf) || tf.name;
    const resolvedImports = (tf.dependencies?.resolved || []).map((d) => d.resolvedFileId);
    const importsTarget = resolvedImports.some((id) => targetIds.has(id));
    const importsAffected = resolvedImports.some((id) => affectedIds.has(id));
    const lowerContent = (tf.content || '').toLowerCase();
    const mentionsTarget =
      targetNames.some((n) => n.length >= 3 && (fp.toLowerCase().includes(n) || lowerContent.includes(n))) ||
      targetSymbols.some((s) => s.length >= 3 && lowerContent.includes(s));

    if (importsTarget) {
      existingTests.push({
        fileId: tf.id,
        fileName: tf.name,
        filePath: fp,
        relation: 'direct',
        reason: 'Directly imports a resolved target file.',
        existsInWorkspace: true,
      });
    } else if (importsAffected) {
      existingTests.push({
        fileId: tf.id,
        fileName: tf.name,
        filePath: fp,
        relation: 'affected',
        reason: 'Imports a component affected by this change.',
        existsInWorkspace: true,
      });
    } else if (mentionsTarget) {
      existingTests.push({
        fileId: tf.id,
        fileName: tf.name,
        filePath: fp,
        relation: 'uncertain',
        reason: 'References related symbol/file names without a verified static import.',
        existsInWorkspace: true,
      });
    }
  }

  const recommendedNewTests = [];
  if (existingTests.filter((t) => t.relation === 'direct').length === 0) {
    for (const target of resolvedTargets.slice(0, 3)) {
      recommendedNewTests.push({
        title: `Verify ${target.symbolName || target.fileName} behavior after ${parsedChange?.operation || 'change'}`,
        targetFile: target.filePath,
        targetSymbol: target.symbolName || null,
        scenario: `Add unit/integration tests covering ${target.symbolName ? `${target.symbolName} in ` : ''}${target.filePath} before and after applying the proposed change.`,
        priority: 'High',
        existsInWorkspace: false,
      });
    }
  }

  return {
    totalWorkspaceTestFiles: testFiles.length,
    existingTests,
    recommendedNewTests,
  };
}

/**
 * Stage 5: Collect bounded, deduplicated source snippets from targets, direct dependents,
 * indirect dependents, and hybrid search context — reusing existing searchArtifacts & vectorIndex.
 */
export async function collectBoundedImpactContext({
  changeDescription,
  resolvedTargets = [],
  traversal,
  testIntelligence,
  files = [],
  chunks = [],
  bm25Index = null,
  vectorIndex = null,
  maxSnippets = DEFAULT_MAX_IMPACT_SNIPPETS,
  maxTotalChars = DEFAULT_MAX_IMPACT_CHARS,
}) {
  const filesById = new Map(files.map((f) => [f.id, f]));
  const snippets = [];
  const seenKeys = new Set();
  let totalChars = 0;

  const pushSnippet = ({ file, startLine = 1, endLine = null, role = 'context', reason = '' }) => {
    if (!file || typeof file.content !== 'string' || !file.content.trim()) return;
    if (snippets.length >= maxSnippets) return;
    const remaining = maxTotalChars - totalChars;
    if (remaining < 200) return;

    const lines = file.content.split('\n');
    const safeStart = Math.max(1, Math.min(lines.length, startLine));
    const safeEnd = Math.min(lines.length, Math.max(safeStart, endLine || Math.min(lines.length, safeStart + 55)));
    const key = `${file.id}:${safeStart}-${safeEnd}`;
    if (seenKeys.has(key)) return;

    const maxCharsForThis = Math.min(2600, remaining);
    let content = lines.slice(safeStart - 1, safeEnd).join('\n');
    if (content.length > maxCharsForThis) {
      content = `${content.slice(0, maxCharsForThis)}\n// ... [truncated]`;
    }

    seenKeys.add(key);
    totalChars += content.length;
    snippets.push({
      fileId: file.id,
      fileName: file.name,
      filePath: getFilePath(file) || file.name,
      startLine: safeStart,
      endLine: safeEnd,
      totalLines: lines.length,
      role,
      reason,
      content,
    });
  };

  // 1. Target files / symbols first
  for (const target of resolvedTargets) {
    const file = filesById.get(target.fileId);
    if (!file) continue;
    pushSnippet({
      file,
      startLine: target.startLine || 1,
      endLine: target.endLine || Math.min(file.lineCount || 80, 80),
      role: 'target',
      reason: target.matchReason,
    });
  }

  // 2. Direct dependents (prioritize lines around import / symbol usage)
  for (const dep of (traversal?.directDependents || []).slice(0, 4)) {
    const file = filesById.get(dep.fileId);
    if (!file) continue;
    const focusLine = dep.symbolReferences?.[0]?.line || dep.importEvidence?.[0]?.line || 1;
    pushSnippet({
      file,
      startLine: Math.max(1, focusLine - 5),
      endLine: focusLine + 45,
      role: 'direct_dependent',
      reason: `Direct dependent via ${dep.dependencyPath.join(' -> ')}`,
    });
  }

  // 3. Indirect dependents
  for (const ind of (traversal?.indirectDependents || []).slice(0, 3)) {
    const file = filesById.get(ind.fileId);
    if (!file) continue;
    const focusLine = ind.importEvidence?.[0]?.line || 1;
    pushSnippet({
      file,
      startLine: Math.max(1, focusLine - 3),
      endLine: focusLine + 35,
      role: 'indirect_dependent',
      reason: `Indirect dependent via ${ind.dependencyPath.join(' -> ')}`,
    });
  }

  // 4. Existing related tests
  for (const tf of (testIntelligence?.existingTests || []).slice(0, 2)) {
    const file = filesById.get(tf.fileId);
    if (!file) continue;
    pushSnippet({
      file,
      startLine: 1,
      endLine: 45,
      role: 'existing_test',
      reason: tf.reason,
    });
  }

  // 5. Supporting contextual snippets via existing Hybrid RAG pipeline (reuses existing vectorIndex)
  let retrievalMode = 'lexical_fallback';
  let semanticUsed = false;
  if (snippets.length < maxSnippets && totalChars < maxTotalChars - 1000 && chunks.length > 0) {
    const rag = await retrieveRagContext({
      question: changeDescription,
      files,
      chunks,
      bm25Index,
      vectorIndex,
      maxChunks: 4,
    });
    retrievalMode = rag.retrievalMode;
    semanticUsed = rag.semanticUsed;

    for (const c of rag.contextChunks) {
      const file = filesById.get(c.fileId);
      if (!file) continue;
      pushSnippet({
        file,
        startLine: c.startLine,
        endLine: c.endLine,
        role: 'supporting_context',
        reason: 'Retrieved via Hybrid Search',
      });
    }
  }

  return { snippets, retrievalMode, semanticUsed, totalChars };
}

/**
 * Collects deterministic uncertainties and analysis limitations transparently.
 */
export function collectDeterministicUncertainties({
  resolvedTargets = [],
  traversal,
  testIntelligence,
  files = [],
}) {
  const uncertainties = [];

  const nonAstTargets = resolvedTargets.filter((t) => {
    const f = files.find((item) => item.id === t.fileId);
    return f && !f.astMetadata;
  });
  if (nonAstTargets.length > 0) {
    uncertainties.push(
      `Static ES/TS import graph does not parse non-JS/TS files (${nonAstTargets.map((t) => t.filePath).join(', ')}); cross-file links for these files rely on lexical/semantic evidence.`
    );
  }

  const missingRelatives = [];
  let externalDepCount = 0;
  for (const comp of traversal?.impactedComponents || []) {
    const f = files.find((item) => item.id === comp.fileId);
    const unresolved = f?.dependencies?.unresolved || [];
    for (const u of unresolved) {
      if (u.type === 'missing_relative') {
        missingRelatives.push(`${comp.filePath} -> ${u.source}`);
      } else if (u.type === 'external') {
        externalDepCount++;
      }
    }
  }

  if (missingRelatives.length > 0) {
    uncertainties.push(
      `Unresolved relative imports detected (${missingRelatives.slice(0, 4).join(', ')}${missingRelatives.length > 4 ? '...' : ''}); missing files were excluded from traversal.`
    );
  }

  if (externalDepCount > 0) {
    uncertainties.push(
      `${externalDepCount} external package import${externalDepCount === 1 ? '' : 's'} exist in affected files; runtime behavior inside third-party packages is outside workspace visibility.`
    );
  }

  if (traversal?.cyclesDetected?.length > 0) {
    uncertainties.push(
      `Circular dependency cycle(s) encountered and safely bounded during traversal: ${traversal.cyclesDetected.slice(0, 2).join('; ')}.`
    );
  }

  if (traversal?.traversalTruncated) {
    uncertainties.push(
      `Dependency traversal reached safety limits (max depth ${DEFAULT_MAX_TRAVERSAL_DEPTH}, max ${DEFAULT_MAX_TRAVERSAL_NODES} components); deeper indirect links may exist.`
    );
  }

  if (testIntelligence?.totalWorkspaceTestFiles === 0) {
    uncertainties.push(
      'No automated test files were detected in the loaded workspace; regression risk cannot be verified by existing tests.'
    );
  }

  return uncertainties;
}

/**
 * Builds the graph overlay payload consumed directly by ProjectGraphView (zero graph duplication).
 */
export function buildImpactGraphOverlay({ resolvedTargets = [], traversal, findings = [] }) {
  const severityRank = { Critical: 5, High: 4, Medium: 3, Low: 2, Informational: 1 };
  const nodeStates = {};
  const targetIds = new Set(resolvedTargets.map((t) => t.fileId));

  const topSeverityByFile = new Map();
  const findingsByFile = new Map();
  for (const f of findings) {
    const key = f.fileId || f.filePath;
    if (!findingsByFile.has(key)) findingsByFile.set(key, []);
    findingsByFile.get(key).push(f);

    const cur = topSeverityByFile.get(key);
    if (!cur || (severityRank[f.severity] || 0) > (severityRank[cur] || 0)) {
      topSeverityByFile.set(key, f.severity);
    }
  }

  for (const comp of traversal?.impactedComponents || []) {
    const isTarget = targetIds.has(comp.fileId);
    const sev = topSeverityByFile.get(comp.fileId) || topSeverityByFile.get(comp.filePath) || null;
    let state = 'related';
    if (isTarget) {
      state = 'target';
    } else if (sev === 'Critical' || sev === 'High') {
      state = 'high_risk';
    } else if (sev === 'Medium') {
      state = 'medium_risk';
    } else if (sev === 'Low' || sev === 'Informational') {
      state = 'low_risk';
    } else if (comp.dependencyType === 'direct_dependent') {
      state = 'medium_risk';
    } else if (comp.dependencyType === 'indirect_dependent') {
      state = 'low_risk';
    }

    const entry = {
      fileId: comp.fileId,
      fileName: comp.fileName,
      filePath: comp.filePath,
      state,
      severity: sev,
      dependencyType: comp.dependencyType,
      depth: comp.depth,
      dependencyPath: comp.dependencyPath,
      findingsCount: (findingsByFile.get(comp.fileId) || findingsByFile.get(comp.filePath) || []).length,
    };

    nodeStates[comp.fileId] = entry;
    nodeStates[comp.filePath] = entry;
    if (comp.fileName && !nodeStates[comp.fileName]) {
      nodeStates[comp.fileName] = entry;
    }
  }

  return {
    active: true,
    nodeStates,
    highlightedEdges: traversal?.highlightedEdges || [],
    targetFileNames: resolvedTargets.map((t) => t.fileName),
  };
}

/**
 * Generates contextual example change scenarios tailored to the loaded workspace.
 */
export function generateExampleChanges(files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const paths = files.map((f) => (getFilePath(f) || f.name || '').toLowerCase());
  const examples = [];

  if (paths.some((p) => p.includes('auth'))) {
    examples.push('What if I remove the verifySessionToken function or replace JWT with OAuth?');
  }
  if (paths.some((p) => p.includes('database') || p.includes('db'))) {
    examples.push('What would happen if I replaced PostgreSQL with MongoDB?');
  }
  if (paths.some((p) => p.includes('api') || p.includes('client'))) {
    examples.push('What if I change the retry logic and response error handling in fetchWithRetry?');
  }
  if (paths.some((p) => p.includes('config'))) {
    examples.push('What if I rename configuration keys in forge.config.json?');
  }

  const fallbacks = [
    'What if I change the return structure of the primary exported service?',
    'What would break if I refactored the shared utility module interface?',
  ];
  for (const ex of fallbacks) {
    if (examples.length >= 4) break;
    examples.push(ex);
  }
  return examples.slice(0, 4);
}

/**
 * Calls the Express backend `/api/impact/analyze` endpoint with deterministic evidence.
 */
export async function requestImpactReasoning({
  proposedChange,
  projectName,
  parsedChange,
  resolvedTargets,
  impactedComponents,
  dependencyPaths,
  snippets,
  existingTests,
  signal,
}) {
  let response;
  try {
    response = await fetch('/api/impact/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposedChange,
        projectName,
        parsedChange,
        resolvedTargets,
        impactedComponents,
        dependencyPaths,
        snippets,
        existingTests,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const netErr = new Error(
      'Unable to connect to the FORGE backend server. Start it with `npm run server`. Deterministic dependency analysis is still shown below.'
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
    if (response.status === 404 && !data?.code) {
      const staleErr = new Error(
        'Backend endpoint POST /api/impact/analyze returned HTTP 404. The running FORGE backend server appears outdated — restart it with `npm run server`.'
      );
      staleErr.code = 'ENDPOINT_NOT_FOUND';
      staleErr.status = 404;
      throw staleErr;
    }

    const apiErr = new Error(
      data?.error || `Change Impact reasoning failed (HTTP ${response.status}).`
    );
    apiErr.code = data?.code || 'IMPACT_REASONING_FAILED';
    apiErr.status = response.status;
    throw apiErr;
  }

  return data;
}
