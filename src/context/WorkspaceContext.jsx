import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  isSupportedFile,
  getFileExtension,
  getFilePath,
  getFileNameFromPath,
} from '../constants/fileTypes.js';
import { SAMPLE_PROJECT_FILES } from '../constants/sampleProject.js';
import {
  extractAstMetadata,
  calculateStructuralMetrics,
  resolveFileDependencies,
} from '../utils/astParser';
import { chunkWorkspaceFiles } from '../utils/codeChunker.js';
import { createBm25Index, performHybridSearch } from '../utils/hybridSearch.js';
import { createVectorIndex, EMBEDDING_MODEL_ID } from '../utils/vectorIndex.js';
import { analyzeCodebaseArchitecture } from '../utils/architectureAnalyzer.js';
import { generateInterviewQuestions } from '../utils/interviewGenerator.js';
import { fetchGitHubRepository } from '../utils/githubClient.js';
import { workspaceStorage } from '../utils/workspaceStorage.js';
import {
  retrieveRagContext,
  requestAssistantAnswer,
  checkAssistantHealth,
} from '../utils/ragPipeline.js';

const WorkspaceContext = createContext(null);

const INITIAL_GITHUB_IMPORT_STATE = {
  status: 'idle', // 'idle' | 'fetching' | 'parsing' | 'error'
  progress: { phase: '', completed: 0, total: 0, currentPath: '' },
  error: null,
};

const STORAGE_UNAVAILABLE_MESSAGE =
  'Persistent browser storage (IndexedDB) is unavailable. Your workspace will work in memory, but changes will not persist after refreshing or closing the browser.';

const INITIAL_EMBEDDING_STATUS = {
  status: 'idle', // 'idle' | 'loading_model' | 'indexing' | 'ready' | 'unavailable' | 'error'
  progress: { phase: '', completed: 0, total: 0, modelProgress: null },
  indexedChunkCount: 0,
  totalChunkCount: 0,
  error: null,
  modelId: EMBEDDING_MODEL_ID,
};

export function WorkspaceProvider({ children, vectorIndexFactory = createVectorIndex }) {
  const [projectName, setProjectName] = useState('Forge Core');
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('workspace');
  const [projectSource, setProjectSource] = useState({ type: 'local' });
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [githubImportState, setGithubImportState] = useState(INITIAL_GITHUB_IMPORT_STATE);
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const [isRestoringWorkspace, setIsRestoringWorkspace] = useState(true);
  const [storageStatus, setStorageStatus] = useState('initializing'); // 'initializing' | 'ready' | 'unavailable' | 'error'
  const [storageError, setStorageError] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  const latestStateRef = useRef({ files: [], projectName: 'Forge Core', projectSource: { type: 'local' } });
  const restorePromiseRef = useRef(null);
  const restoreFailedRef = useRef(false);
  const latestMutationRevRef = useRef(0);
  const hasUnsavedChangesRef = useRef(false);
  const hasUserMutatedRef = useRef(false);
  const githubAbortControllerRef = useRef(null);
  const [activityLog, setActivityLog] = useState([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: 'session',
      title: 'Workspace Initialized',
      detail: 'Started fresh FORGE session. Ready for project ingestion.',
    },
  ]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedLineRange, setSelectedLineRange] = useState(null);
  const [placeholderModal, setPlaceholderModal] = useState(null);

  // Search & vector index state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState('hybrid'); // 'hybrid' | 'keyword' | 'semantic'
  const [lastSearchMeta, setLastSearchMeta] = useState(null);
  const [embeddingStatus, setEmbeddingStatus] = useState(INITIAL_EMBEDDING_STATUS);

  // AI Assistant (RAG) session state
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState(null);
  const [assistantBackendStatus, setAssistantBackendStatus] = useState({
    checked: false,
    reachable: false,
    geminiConfigured: false,
    model: null,
    error: null,
  });

  const vectorIndexRef = useRef(null);
  const workspaceEpochRef = useRef(0);
  const searchRequestSeqRef = useRef(0);
  const assistantRequestSeqRef = useRef(0);
  const assistantAbortControllerRef = useRef(null);
  const assistantMessagesRef = useRef([]);
  useEffect(() => {
    assistantMessagesRef.current = assistantMessages;
  }, [assistantMessages]);

  const getVectorIndex = useCallback(() => {
    if (!vectorIndexRef.current) {
      vectorIndexRef.current = vectorIndexFactory();
    }
    return vectorIndexRef.current;
  }, [vectorIndexFactory]);

  const resetSearchAndVectorState = useCallback(() => {
    workspaceEpochRef.current += 1;
    searchRequestSeqRef.current += 1;
    assistantRequestSeqRef.current += 1;
    if (assistantAbortControllerRef.current) {
      assistantAbortControllerRef.current.abort();
      assistantAbortControllerRef.current = null;
    }
    setIsSearching(false);
    setSearchResults(null);
    setSearchQuery('');
    setLastSearchMeta(null);
    setAssistantMessages([]);
    setIsAssistantLoading(false);
    setAssistantError(null);
    setSelectedLineRange(null);

    if (vectorIndexRef.current) {
      vectorIndexRef.current.clear();
      const viStatus = vectorIndexRef.current.getStatus();
      setEmbeddingStatus({
        status: viStatus.status === 'unavailable' ? 'unavailable' : 'idle',
        progress: { phase: '', completed: 0, total: 0, modelProgress: null },
        indexedChunkCount: 0,
        totalChunkCount: 0,
        error: viStatus.error || null,
        modelId: viStatus.modelId || EMBEDDING_MODEL_ID,
      });
    } else {
      setEmbeddingStatus(INITIAL_EMBEDDING_STATUS);
    }
  }, []);

  useEffect(() => {
    return () => {
      searchRequestSeqRef.current += 1;
      assistantRequestSeqRef.current += 1;
      workspaceEpochRef.current += 1;
      if (assistantAbortControllerRef.current) {
        assistantAbortControllerRef.current.abort();
        assistantAbortControllerRef.current = null;
      }
      if (vectorIndexRef.current) {
        vectorIndexRef.current.dispose();
        vectorIndexRef.current = null;
      }
    };
  }, []);

  const addActivity = useCallback((type, title, detail) => {
    const newEntry = {
      id: 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type,
      title,
      detail,
    };
    setActivityLog((prev) => [newEntry, ...prev]);
  }, []);

  useEffect(() => {
    latestStateRef.current = { files, projectName, projectSource };
  }, [files, projectName, projectSource]);

  const handleStorageResult = useCallback((result, actionLabel, opRev, isFullSync = false) => {
    if (!result || result.ok) {
      if (isFullSync) {
        if (opRev >= latestMutationRevRef.current) {
          restoreFailedRef.current = false;
          setRestoreFailed(false);
          hasUnsavedChangesRef.current = false;
          setHasUnsavedChanges(false);
          setStorageStatus('ready');
          setStorageError(null);
        }
      } else if (
        !restoreFailedRef.current &&
        !hasUnsavedChangesRef.current &&
        opRev >= latestMutationRevRef.current
      ) {
        setStorageStatus('ready');
        setStorageError(null);
      }
      return;
    }

    hasUnsavedChangesRef.current = true;
    setHasUnsavedChanges(true);

    if (result.unavailable) {
      if (storageStatus !== 'unavailable') {
        setStorageError(STORAGE_UNAVAILABLE_MESSAGE);
        addActivity('import_warning', 'In-Memory Mode Only', STORAGE_UNAVAILABLE_MESSAGE);
      }
      setStorageStatus('unavailable');
      return;
    }

    const msg = `${actionLabel} could not be saved to browser storage (${result.error}). Your in-memory workspace remains active, but unsaved changes exist.`;
    setStorageStatus('error');
    setStorageError(msg);
    addActivity('import_warning', 'Storage Save Warning', msg);
  }, [storageStatus, addActivity]);

  const dismissStorageError = useCallback(() => {
    setStorageError(null);
  }, []);

  const waitForRestore = useCallback(async () => {
    if (restorePromiseRef.current) {
      await restorePromiseRef.current;
    }
    return latestStateRef.current;
  }, []);

  const applyRestoredResult = useCallback((result) => {
    if (!result.ok) {
      hasUnsavedChangesRef.current = true;
      setHasUnsavedChanges(true);
      if (result.unavailable) {
        restoreFailedRef.current = false;
        setRestoreFailed(false);
        setStorageStatus('unavailable');
        setStorageError(STORAGE_UNAVAILABLE_MESSAGE);
        addActivity('import_warning', 'In-Memory Mode Only', STORAGE_UNAVAILABLE_MESSAGE);
      } else {
        restoreFailedRef.current = true;
        setRestoreFailed(true);
        setStorageStatus('error');
        setStorageError(
          `Could not restore saved workspace (${result.error}). Retry restore or explicitly confirm overwriting saved data.`
        );
        addActivity(
          'import_warning',
          'Workspace Restore Failed',
          `Could not restore saved workspace from IndexedDB (${result.error}).`
        );
      }
      return false;
    }

    const savedFiles = Array.isArray(result.data?.files) ? result.data.files : [];
    const savedName = result.data?.projectName || 'Forge Core';
    const savedSource = result.data?.projectSource || { type: 'local' };
    const hasSavedData = savedFiles.length > 0 || savedName !== 'Forge Core' || savedSource.type !== 'local';

    if (hasUserMutatedRef.current && hasSavedData) {
      setStorageStatus('error');
      setStorageError(
        'Saved workspace is now readable, but you have newer in-memory changes. Click "Overwrite Saved" to replace it, or reload the page to load the saved workspace.'
      );
      return false;
    }

    restoreFailedRef.current = false;
    setRestoreFailed(false);

    if (!hasUserMutatedRef.current && hasSavedData) {
      const resolvedSavedFiles = savedFiles.length > 0 ? resolveFileDependencies(savedFiles) : [];
      latestStateRef.current = {
        files: resolvedSavedFiles,
        projectName: savedName,
        projectSource: savedSource,
      };
      setFiles(resolvedSavedFiles);
      setProjectName(savedName);
      setProjectSource(savedSource);
      if (resolvedSavedFiles.length > 0) {
        addActivity(
          'session',
          'Restored Saved Workspace',
          `Restored ${resolvedSavedFiles.length} file${resolvedSavedFiles.length === 1 ? '' : 's'} for "${savedName}" from IndexedDB.`
        );
      }
    }

    if (!hasUserMutatedRef.current || !hasSavedData) {
      if (!hasUnsavedChangesRef.current || !hasUserMutatedRef.current) {
        hasUnsavedChangesRef.current = false;
        setHasUnsavedChanges(false);
        setStorageStatus('ready');
        setStorageError(null);
      }
    }
    return true;
  }, [addActivity]);

  const retryRestoreWorkspace = useCallback(async () => {
    const result = await workspaceStorage.loadWorkspace();
    return applyRestoredResult(result);
  }, [applyRestoredResult]);

  const syncWorkspaceToStorage = useCallback(async ({ confirmOverwrite = false } = {}) => {
    await waitForRestore();
    if (restoreFailedRef.current && !confirmOverwrite) {
      const msg =
        'Previous saved workspace failed to restore. Retry restore first or confirm overwriting saved data.';
      setStorageError(msg);
      return { ok: false, requiresConfirmation: true, error: msg };
    }

    const snapshot = latestStateRef.current;
    const opRev = ++latestMutationRevRef.current;
    const res = await workspaceStorage.replaceWorkspace(snapshot);
    handleStorageResult(res, 'Full workspace sync', opRev, true);
    return res;
  }, [waitForRestore, handleStorageResult]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSavedWorkspace() {
      const result = await workspaceStorage.loadWorkspace();
      if (cancelled) return;
      applyRestoredResult(result);
      setIsRestoringWorkspace(false);
    }

    const promise = restoreSavedWorkspace();
    restorePromiseRef.current = promise;
    return () => {
      cancelled = true;
    };
  }, [applyRestoredResult]);

  const updateProjectName = useCallback(async (newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    const current = await waitForRestore();
    if (trimmed === current.projectName) return;

    hasUserMutatedRef.current = true;
    const opRev = ++latestMutationRevRef.current;
    latestStateRef.current = { ...current, projectName: trimmed };
    setProjectName(trimmed);
    addActivity('rename', 'Project Renamed', `Project name updated to "${trimmed}"`);

    const res = await workspaceStorage.updateMetadata({
      projectName: trimmed,
      projectSource: current.projectSource,
    });
    handleStorageResult(res, 'Project rename', opRev, false);
  }, [waitForRestore, addActivity, handleStorageResult]);

  const importFiles = useCallback(async (fileList) => {
    const initialState = await waitForRestore();
    hasUserMutatedRef.current = true;

    const validFiles = [];
    const skippedFiles = [];
    const duplicatePaths = [];
    const existingPaths = new Set(initialState.files.map((f) => getFilePath(f)));
    const seenBatchPaths = new Set();

    for (let i = 0; i < fileList.length; i++) {
      const rawItem = fileList[i];
      const rawFile = rawItem?.file || rawItem;
      if (!rawFile) continue;

      const rawPath =
        rawItem?.path ||
        rawItem?.relativePath ||
        rawFile.path ||
        rawFile.relativePath ||
        rawFile.webkitRelativePath ||
        rawFile.name ||
        '';
      const filePath = getFilePath(rawPath) || rawFile.name || '';
      const fileName = getFileNameFromPath(filePath) || rawFile.name || filePath;

      if (!isSupportedFile(filePath)) {
        skippedFiles.push(filePath || rawFile.name || 'unknown');
        continue;
      }

      if (existingPaths.has(filePath) || seenBatchPaths.has(filePath)) {
        duplicatePaths.push(filePath);
        continue;
      }

      try {
        const content = await rawFile.text();
        const lines = content.split('\n');
        const astMetadata = extractAstMetadata(content, filePath);
        seenBatchPaths.add(filePath);
        validFiles.push({
          id: 'file-' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 6),
          name: fileName,
          path: filePath,
          extension: getFileExtension(filePath),
          size: rawFile.size,
          lineCount: lines.length,
          content,
          lastModified: rawFile.lastModified || Date.now(),
          astMetadata,
        });
      } catch (err) {
        console.error(`Failed to read file ${filePath}:`, err);
        skippedFiles.push(filePath);
      }
    }

    if (validFiles.length > 0) {
      const postRead = latestStateRef.current;
      const wasEmpty = postRead.files.length === 0;
      const nextSource = wasEmpty ? { type: 'local' } : postRead.projectSource;
      const currentPaths = new Set(postRead.files.map((f) => getFilePath(f)));
      const filesToPersist = validFiles.filter((f) => !currentPaths.has(getFilePath(f)));

      const opRev = ++latestMutationRevRef.current;
      latestStateRef.current = {
        files: [...postRead.files, ...filesToPersist],
        projectName: postRead.projectName,
        projectSource: nextSource,
      };
      setFiles((prev) => {
        // Use normalized paths (file.path || file.name) for duplicate detection so files with
        // identical basenames in different directories are not incorrectly discarded.
        const existingPaths = new Set(prev.map((f) => f.path || f.name));
        const filteredNew = validFiles.filter((f) => !existingPaths.has(f.path || f.name));
        return resolveFileDependencies([...prev, ...filteredNew]);
      });
      if (wasEmpty) {
        setProjectSource(nextSource);
      }

      if (filesToPersist.length > 0 || wasEmpty) {
        const persistResult = await workspaceStorage.appendFiles(
          filesToPersist,
          wasEmpty ? { projectName: postRead.projectName, projectSource: nextSource } : null
        );
        handleStorageResult(persistResult, 'Imported files', opRev, false);
      }

      const details = [`Ingested: ${validFiles.map((f) => f.path || f.name).join(', ')}`];
      if (duplicatePaths.length > 0) {
        details.push(
          `${duplicatePaths.length} duplicate${duplicatePaths.length === 1 ? '' : 's'} skipped`
        );
      }
      if (skippedFiles.length > 0) {
        details.push(`${skippedFiles.length} unsupported skipped`);
      }

      addActivity(
        'import',
        `Imported ${validFiles.length} File${validFiles.length === 1 ? '' : 's'}`,
        details.join(' • ')
      );
    } else if (duplicatePaths.length > 0 || skippedFiles.length > 0) {
      const notes = [];
      if (duplicatePaths.length > 0) {
        notes.push(`Already in workspace: ${duplicatePaths.join(', ')}`);
      }
      if (skippedFiles.length > 0) {
        notes.push(`Unsupported or unreadable: ${skippedFiles.join(', ')}`);
      }
      addActivity(
        'import_warning',
        duplicatePaths.length > 0 && skippedFiles.length === 0 ? 'Duplicate Files Skipped' : 'Files Skipped',
        notes.join(' • ')
      );
    }

    return {
      addedCount: validFiles.length,
      duplicateCount: duplicatePaths.length,
      skippedCount: skippedFiles.length,
    };
  }, [waitForRestore, addActivity, handleStorageResult]);

  const loadSampleProject = useCallback(async () => {
    await waitForRestore();
    hasUserMutatedRef.current = true;

    const sampleFilesWithAst = resolveFileDependencies(
      SAMPLE_PROJECT_FILES.map((sample) => {
        const samplePath = getFilePath(sample);
        return {
          ...sample,
          path: samplePath,
          astMetadata: extractAstMetadata(sample.content, samplePath),
        };
      })
    );

    const sampleName = 'Forge Core Engine (Sample)';
    const sampleSource = { type: 'sample' };
    const opRev = ++latestMutationRevRef.current;

    latestStateRef.current = {
      files: sampleFilesWithAst,
      projectName: sampleName,
      projectSource: sampleSource,
    };

    resetSearchAndVectorState();
    setFiles(sampleFilesWithAst);
    setProjectName(sampleName);
    setProjectSource(sampleSource);
    setLastImportSummary(null);
    addActivity(
      'import',
      'Loaded Sample Project',
      `Loaded ${SAMPLE_PROJECT_FILES.length} reference files across TypeScript, JavaScript, Python, JSON, and Markdown.`
    );

    const res = await workspaceStorage.replaceWorkspace({
      files: sampleFilesWithAst,
      projectName: sampleName,
      projectSource: sampleSource,
    });
    handleStorageResult(res, 'Sample project', opRev, true);
  },
  [waitForRestore, resetSearchAndVectorState, addActivity, handleStorageResult]
);

const removeFile = useCallback(async (fileId) => {
  const current = await waitForRestore();
  const target = current.files.find((f) => f.id === fileId);
  if (!target) return;

  hasUserMutatedRef.current = true;
  const opRev = ++latestMutationRevRef.current;
  const remainingFiles = current.files.filter((f) => f.id !== fileId);
  const resolvedRemainingFiles = resolveFileDependencies(remainingFiles);

  latestStateRef.current = {
    ...current,
    files: resolvedRemainingFiles,
  };

  getVectorIndex().removeFile(fileId);
  setFiles(resolvedRemainingFiles);

  addActivity(
    'remove',
    'File Removed',
    `Removed ${target.path || target.name} from current workspace.`
  );

    if (selectedFile?.id === fileId) {
      setSelectedFile(null);
    }

    // Refresh search results if active
    if (searchResults) {
      setSearchResults((prev) => (prev ? prev.filter((r) => r.fileId !== fileId) : null));
    }

    const res = await workspaceStorage.removeFile(fileId);
    handleStorageResult(res, 'File removal', opRev, false);
  }, [waitForRestore, getVectorIndex, addActivity, selectedFile, searchResults, handleStorageResult]);

  const clearAllFiles = useCallback(async () => {
    const current = await waitForRestore();
    hasUserMutatedRef.current = true;
    const count = current.files.length;
    const opRev = ++latestMutationRevRef.current;

    latestStateRef.current = {
      files: [],
      projectName: current.projectName,
      projectSource: { type: 'local' },
    };
    setFiles([]);
    setSelectedFile(null);
    resetSearchAndVectorState();
    setProjectSource({ type: 'local' });
    setLastImportSummary(null);
    addActivity('clear', 'Workspace Cleared', `Cleared all ${count} files from the active session.`);

    // Preserve current projectName when clearing files
    const res = await workspaceStorage.clearWorkspace({
      projectName: current.projectName,
      projectSource: { type: 'local' },
    });
    handleStorageResult(res, 'Workspace clear', opRev, true);
  }, [waitForRestore, resetSearchAndVectorState, addActivity, handleStorageResult]);

  const searchArtifacts = useMemo(() => {
    const chunks = chunkWorkspaceFiles(files);
    const bm25Index = createBm25Index(chunks);
    return { chunks, bm25Index };
  }, [files]);

  // Automatically restore cached vectors and index new/modified chunks when workspace files change
  useEffect(() => {
    if (isRestoringWorkspace) return;

    let cancelled = false;
    const runEpoch = workspaceEpochRef.current;
    const { chunks } = searchArtifacts;
    const vi = getVectorIndex();

    if (files.length === 0 || chunks.length === 0) {
      vi.indexFiles([], { chunks: [] }).then(() => {
        if (cancelled || runEpoch !== workspaceEpochRef.current) return;
        const s = vi.getStatus();
        setEmbeddingStatus({
          status: s.status === 'unavailable' ? 'unavailable' : 'idle',
          progress: { phase: '', completed: 0, total: 0, modelProgress: null },
          indexedChunkCount: 0,
          totalChunkCount: 0,
          error: s.error || null,
          modelId: s.modelId || EMBEDDING_MODEL_ID,
        });
      });
      return () => {
        cancelled = true;
      };
    }

    vi.indexFiles(files, {
      chunks,
      onProgress: (prog) => {
        if (cancelled || runEpoch !== workspaceEpochRef.current) return;
        setEmbeddingStatus((prev) => ({
          ...prev,
          status: prog.phase === 'indexing' ? 'indexing' : 'loading_model',
          progress: {
            phase: prog.phase,
            completed: prog.completed || 0,
            total: prog.total || chunks.length,
            modelProgress:
              typeof prog.info?.progress === 'number'
                ? Math.round(prog.info.progress)
                : prog.phase === 'indexing'
                  ? 100
                  : prev.progress.modelProgress,
          },
          totalChunkCount: chunks.length,
          error: null,
        }));
      },
    }).then((res) => {
      if (cancelled || runEpoch !== workspaceEpochRef.current || res?.cancelled) return;
      const s = vi.getStatus();
      setEmbeddingStatus({
        status: s.status,
        progress: {
          phase: s.status,
          completed: s.status === 'ready' ? chunks.length : 0,
          total: chunks.length,
          modelProgress: s.status === 'ready' ? 100 : null,
        },
        indexedChunkCount: s.indexedChunkCount,
        totalChunkCount: chunks.length,
        error: res?.error || s.error || null,
        modelId: s.modelId || EMBEDDING_MODEL_ID,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [files, searchArtifacts, isRestoringWorkspace, getVectorIndex]);

  const executeSearch = useCallback(
    async (query, options = {}) => {
      const raw = typeof query === 'string' ? query.trim() : '';
      const searchSeq = ++searchRequestSeqRef.current;
      const epochAtStart = workspaceEpochRef.current;
      setSearchQuery(raw);

      if (!raw) {
        setSearchResults(null);
        setIsSearching(false);
        setLastSearchMeta(null);
        return null;
      }

      if (files.length === 0) {
        setSearchResults([]);
        setIsSearching(false);
        setLastSearchMeta({
          query: raw,
          modeUsed: 'keyword',
          semanticUsed: false,
          totalMatchedChunks: 0,
          grandTotalMatches: 0,
        });
        return [];
      }

      const { chunks, bm25Index } = searchArtifacts;
      const requestedMode = options.mode || searchMode || 'hybrid';
      const vi = getVectorIndex();
      const viState = vi.getStatus();
      const vectorMap = vi.getVectorMap();
      const canTrySemantic =
        requestedMode !== 'keyword' &&
        vectorMap.size > 0 &&
        viState.status !== 'unavailable';

      // Immediate lexical baseline (BM25 + AST) whenever keyword matching is included
      if (requestedMode !== 'semantic') {
        const lexicalRes = performHybridSearch(files, raw, {
          mode: requestedMode,
          chunks,
          bm25Index,
          queryVector: null,
          vectorMap: null,
        });
        setSearchResults(lexicalRes.results);
        setLastSearchMeta({
          query: raw,
          modeUsed: canTrySemantic ? 'hybrid_pending' : lexicalRes.modeUsed,
          semanticUsed: false,
          totalMatchedChunks: lexicalRes.totalMatchedChunks,
          grandTotalMatches: lexicalRes.grandTotalMatches,
        });

        if (!canTrySemantic) {
          setIsSearching(false);
          addActivity(
            'search',
            `Searched "${raw}"`,
            lexicalRes.results.length > 0
              ? `Found ${lexicalRes.grandTotalMatches} match${lexicalRes.grandTotalMatches === 1 ? '' : 'es'} across ${lexicalRes.results.length} file${lexicalRes.results.length === 1 ? '' : 's'} (BM25 + AST).`
              : `No matches found across ${files.length} loaded files.`
          );
          return lexicalRes.results;
        }
      }

      // If semantic-only is requested while vectors are unavailable, fall back to BM25 + AST
      if (!canTrySemantic) {
        const fallbackRes = performHybridSearch(files, raw, {
          mode: 'hybrid',
          chunks,
          bm25Index,
          queryVector: null,
          vectorMap: null,
        });
        setSearchResults(fallbackRes.results);
        setIsSearching(false);
        setLastSearchMeta({
          query: raw,
          modeUsed: 'lexical_fallback',
          semanticUsed: false,
          totalMatchedChunks: fallbackRes.totalMatchedChunks,
          grandTotalMatches: fallbackRes.grandTotalMatches,
        });
        addActivity(
          'search',
          `Searched "${raw}"`,
          fallbackRes.results.length > 0
            ? `Found ${fallbackRes.grandTotalMatches} match${fallbackRes.grandTotalMatches === 1 ? '' : 'es'} across ${fallbackRes.results.length} file${fallbackRes.results.length === 1 ? '' : 's'} (lexical fallback).`
            : `No matches found across ${files.length} loaded files.`
        );
        return fallbackRes.results;
      }

      setIsSearching(true);
      let queryVector = null;
      try {
        queryVector = await vi.embedQuery(raw);
      } catch {
        queryVector = null;
      }

      if (searchSeq !== searchRequestSeqRef.current || epochAtStart !== workspaceEpochRef.current) {
        return null;
      }

      const semanticAvailable = Boolean(queryVector && vectorMap.size > 0);
      const effectiveMode =
        requestedMode === 'semantic' && !semanticAvailable ? 'hybrid' : requestedMode;

      const finalRes = performHybridSearch(files, raw, {
        mode: effectiveMode,
        chunks,
        bm25Index,
        queryVector: semanticAvailable ? queryVector : null,
        vectorMap: semanticAvailable ? vectorMap : null,
      });

      setSearchResults(finalRes.results);
      setIsSearching(false);
      setLastSearchMeta({
        query: raw,
        modeUsed:
          requestedMode === 'semantic' && !semanticAvailable
            ? 'lexical_fallback'
            : finalRes.modeUsed,
        semanticUsed: semanticAvailable,
        totalMatchedChunks: finalRes.totalMatchedChunks,
        grandTotalMatches: finalRes.grandTotalMatches,
      });

      addActivity(
        'search',
        `Searched "${raw}"`,
        finalRes.results.length > 0
          ? `Found ${finalRes.grandTotalMatches} match${finalRes.grandTotalMatches === 1 ? '' : 'es'} across ${finalRes.results.length} file${finalRes.results.length === 1 ? '' : 's'}${semanticAvailable ? ` (${effectiveMode})` : ' (lexical fallback)'}.`
          : `No matches found across ${files.length} loaded files.`
      );
      return finalRes.results;
    },
    [files, searchArtifacts, searchMode, getVectorIndex, addActivity]
  );

  const clearActivityLog = useCallback(() => {
    setActivityLog([
      {
        id: 'init-cleared',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'session',
        title: 'Activity Log Reset',
        detail: 'Session events cleared by user.',
      },
    ]);
  }, []);

  const openPlaceholder = useCallback((featureName, targetMilestone = 'Milestone 2') => {
    setPlaceholderModal({
      isOpen: true,
      featureName,
      targetMilestone,
    });
  }, []);

  const closePlaceholder = useCallback(() => {
    setPlaceholderModal(null);
  }, []);

  const cancelGitHubImport = useCallback(() => {
    if (githubAbortControllerRef.current) {
      const activeController = githubAbortControllerRef.current;
      githubAbortControllerRef.current = null;
      activeController.abort();
    }
    setGithubImportState(INITIAL_GITHUB_IMPORT_STATE);
  }, []);

  const openGitHubModal = useCallback(() => {
    setGithubImportState((prev) =>
      prev.status === 'fetching' || prev.status === 'parsing' ? prev : INITIAL_GITHUB_IMPORT_STATE
    );
    setIsGitHubModalOpen(true);
  }, []);

  const closeGitHubModal = useCallback(() => {
    cancelGitHubImport();
    setIsGitHubModalOpen(false);
  }, [cancelGitHubImport]);

  const dismissImportSummary = useCallback(() => {
    setLastImportSummary(null);
  }, []);

  const importFromGitHub = useCallback(async ({ url, branch = '', replaceWorkspace = true }) => {
    if (githubAbortControllerRef.current) {
      return { success: false, cancelled: false };
    }

    const controller = new AbortController();
    githubAbortControllerRef.current = controller;
    const { signal } = controller;
    const isActiveRun = () => githubAbortControllerRef.current === controller && !signal.aborted;

    setGithubImportState({
      status: 'fetching',
      progress: { phase: 'metadata', completed: 0, total: 0, currentPath: '' },
      error: null,
    });

    try {
      await waitForRestore();
      if (!isActiveRun()) {
        throw new DOMException('GitHub import cancelled.', 'AbortError');
      }

      // Snapshot mutation revision after restoration completes to detect conflicting edits during import
      const baseMutationRev = latestMutationRevRef.current;

      const repoResult = await fetchGitHubRepository({
        url,
        branch,
        signal,
        onProgress: (progress) => {
          if (isActiveRun()) {
            setGithubImportState((prev) => ({ ...prev, status: 'fetching', progress }));
          }
        },
      });

      if (!isActiveRun()) {
        throw new DOMException('GitHub import cancelled.', 'AbortError');
      }

      const { owner, repo, branch: resolvedBranch, commitSha, repoUrl, files: downloaded, stats } = repoResult;
      if (!downloaded || downloaded.length === 0) {
        throw new Error(`No source files could be downloaded from "${owner}/${repo}".`);
      }

      // When merging, check post-restore workspace files
      const preParseState = latestStateRef.current;
      const existingPaths = replaceWorkspace
        ? new Set()
        : new Set(preParseState.files.map((f) => getFilePath(f)));
      const seenBatchPaths = new Set();
      const toParse = [];
      let duplicateCount = 0;

      for (const item of downloaded) {
        const filePath = getFilePath(item.path || item.name);
        if (!replaceWorkspace && existingPaths.has(filePath)) {
          duplicateCount++;
          continue;
        }
        if (seenBatchPaths.has(filePath)) {
          duplicateCount++;
          continue;
        }
        seenBatchPaths.add(filePath);
        toParse.push({ ...item, path: filePath });
      }

      // Cooperative yielding AST parsing staged into a local array (never touching workspace until complete)
      const stagedFiles = [];
      const totalToParse = toParse.length;
      setGithubImportState({
        status: 'parsing',
        progress: { phase: 'parsing', completed: 0, total: totalToParse, currentPath: '' },
        error: null,
      });

      const now = Date.now();
      for (let i = 0; i < totalToParse; i++) {
        if (!isActiveRun()) {
          throw new DOMException('GitHub import cancelled.', 'AbortError');
        }
        const item = toParse[i];
        const lines = item.content.split('\n');
        const astMetadata = extractAstMetadata(item.content, item.path);
        stagedFiles.push({
          id: `gh-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          name: item.name,
          path: item.path,
          extension: item.extension || getFileExtension(item.path),
          size: item.size,
          lineCount: lines.length,
          content: item.content,
          lastModified: now,
          astMetadata,
        });

        if ((i + 1) % 15 === 0 || i + 1 === totalToParse) {
          if (!isActiveRun()) {
            throw new DOMException('GitHub import cancelled.', 'AbortError');
          }
          setGithubImportState({
            status: 'parsing',
            progress: { phase: 'parsing', completed: i + 1, total: totalToParse, currentPath: item.path },
            error: null,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      if (!isActiveRun()) {
        throw new DOMException('GitHub import cancelled.', 'AbortError');
      }

      // Prevent GitHub Replace from overwriting workspace changes made while downloading/parsing
      if (replaceWorkspace && latestMutationRevRef.current !== baseMutationRev) {
        const conflictMsg =
          'Workspace was modified while the GitHub import was running. Your current changes were preserved—please retry the import.';
        addActivity('import_warning', 'GitHub Replace Cancelled (Workspace Changed)', conflictMsg);
        throw new Error(conflictMsg);
      }

      // Atomic commit after download + parsing succeed
      hasUserMutatedRef.current = true;
      const commitBaseState = latestStateRef.current;
      const wasEmpty = commitBaseState.files.length === 0;
      const nextName = `${owner}/${repo}`;
      const nextSource = { type: 'github', owner, repo, branch: resolvedBranch, commitSha, repoUrl };

         if (replaceWorkspace) {
      const opRev = ++latestMutationRevRef.current;
      const resolvedFiles = resolveFileDependencies(stagedFiles);

      resetSearchAndVectorState();
      latestStateRef.current = {
        files: resolvedFiles,
        projectName: nextName,
        projectSource: nextSource,
      };

      setFiles(resolvedFiles);
      setProjectName(nextName);
      setProjectSource(nextSource);
      setSelectedFile(null);

      const persistResult = await workspaceStorage.replaceWorkspace({
        files: resolvedFiles,
        projectName: nextName,
        projectSource: nextSource,
      });

      handleStorageResult(
        persistResult,
        'GitHub repository import',
        opRev,
        true
      );
    } else if (stagedFiles.length > 0) {
        const currentPaths = new Set(commitBaseState.files.map((f) => getFilePath(f)));
        const filesToPersist = stagedFiles.filter((f) => !currentPaths.has(getFilePath(f)));
        duplicateCount += stagedFiles.length - filesToPersist.length;

        if (filesToPersist.length > 0 || wasEmpty) {
               const opRev = ++latestMutationRevRef.current;

          const nextFiles = resolveFileDependencies([
            ...commitBaseState.files,
            ...filesToPersist,
          ]);

          latestStateRef.current = {
            files: nextFiles,
            projectName: wasEmpty ? nextName : commitBaseState.projectName,
            projectSource: wasEmpty ? nextSource : commitBaseState.projectSource,
          };

          setFiles((prev) => {
            const prevPaths = new Set(prev.map((f) => getFilePath(f)));
            const uniqueStaged = stagedFiles.filter(
              (f) => !prevPaths.has(getFilePath(f))
            );
            return resolveFileDependencies([...prev, ...uniqueStaged]);
          });
          if (wasEmpty) {
            setProjectName(nextName);
            setProjectSource(nextSource);
          }

          const persistResult = await workspaceStorage.appendFiles(
            filesToPersist,
            wasEmpty ? { projectName: nextName, projectSource: nextSource } : null
          );
          handleStorageResult(persistResult, 'Merged GitHub files', opRev, false);
        }
      }

      const summary = {
        repoLabel: `${owner}/${repo}`,
        branch: resolvedBranch,
        replaceWorkspace,
        addedCount: stagedFiles.length,
        duplicateCount,
        stats,
      };
      setLastImportSummary(summary);

      const detailParts = [
        `${replaceWorkspace ? 'Loaded' : 'Merged'} ${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'} from ${owner}/${repo} (${resolvedBranch})`,
      ];
      if (duplicateCount > 0) {
        detailParts.push(`${duplicateCount} existing duplicate path${duplicateCount === 1 ? '' : 's'} preserved`);
      }
      if (stats.failedCount > 0) {
        detailParts.push(`${stats.failedCount} download${stats.failedCount === 1 ? '' : 's'} failed`);
      }
      if (stats.oversizedCount > 0) {
        detailParts.push(`${stats.oversizedCount} oversized skipped`);
      }
      if (stats.cappedCount > 0) {
        detailParts.push(`${stats.cappedCount} skipped by repo cap`);
      }
      if (stats.truncated) {
        detailParts.push('Git tree truncated by GitHub');
      }

      addActivity(
        stagedFiles.length > 0 ? 'import' : 'import_warning',
        stagedFiles.length > 0 ? `Imported GitHub Repo ${owner}/${repo}` : `Merged GitHub Repo ${owner}/${repo} (No New Files)`,
        detailParts.join(' • ')
      );

      githubAbortControllerRef.current = null;
      setGithubImportState(INITIAL_GITHUB_IMPORT_STATE);
      setIsGitHubModalOpen(false);
      return { success: true, summary };
    } catch (err) {
      const stillCurrent = githubAbortControllerRef.current === controller;
      if (stillCurrent) {
        githubAbortControllerRef.current = null;
      }

      if (err?.name === 'AbortError' || signal.aborted || !stillCurrent) {
        if (stillCurrent) {
          setGithubImportState(INITIAL_GITHUB_IMPORT_STATE);
        }
        return { success: false, cancelled: true };
      }

      setGithubImportState({
        status: 'error',
        progress: { phase: '', completed: 0, total: 0, currentPath: '' },
        error: err?.message || 'Failed to import GitHub repository.',
      });
      return { success: false, error: err?.message };
    }
  }, [waitForRestore, resetSearchAndVectorState, addActivity, handleStorageResult]);

  const structuralMetrics = useMemo(() => {
    return calculateStructuralMetrics(files);
  }, [files]);

  const architectureModel = useMemo(() => {
    return analyzeCodebaseArchitecture(files, { projectName });
  }, [files, projectName]);

  const interviewPrep = useMemo(() => {
    return generateInterviewQuestions(files, architectureModel, { projectName });
  }, [files, architectureModel, projectName]);

  const refreshAssistantHealth = useCallback(async () => {
    const status = await checkAssistantHealth();
    setAssistantBackendStatus({ checked: true, ...status });
    return status;
  }, []);

  const dismissAssistantError = useCallback(() => {
    setAssistantError(null);
  }, []);

  const cancelAssistantRequest = useCallback(() => {
    assistantRequestSeqRef.current += 1;
    if (assistantAbortControllerRef.current) {
      assistantAbortControllerRef.current.abort();
      assistantAbortControllerRef.current = null;
    }
    setIsAssistantLoading(false);
  }, []);

  const clearAssistantConversation = useCallback(() => {
    cancelAssistantRequest();
    setAssistantMessages([]);
    setAssistantError(null);
  }, [cancelAssistantRequest]);

  const openFileAtLine = useCallback(
    (fileOrId, lineRange = null) => {
      if (!fileOrId) return;
      let target = null;
      if (typeof fileOrId === 'object' && fileOrId.content !== undefined) {
        target = fileOrId;
      } else {
        const lookup = typeof fileOrId === 'string' ? fileOrId : fileOrId.fileId || fileOrId.filePath;
        target =
          files.find((f) => f.id === lookup) ||
          files.find((f) => getFilePath(f) === lookup) ||
          files.find((f) => f.name === lookup) ||
          null;
      }
      if (!target) return;
      setSelectedFile(target);
      setSelectedLineRange(
        lineRange && Number.isInteger(lineRange.startLine)
          ? {
              startLine: lineRange.startLine,
              endLine: lineRange.endLine || lineRange.startLine,
            }
          : null
      );
    },
    [files]
  );

  const askAssistant = useCallback(
    async (rawQuestion) => {
      const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : '';
      if (!question) return null;

      if (files.length === 0) {
        setAssistantError({
          code: 'EMPTY_WORKSPACE',
          message: 'Load a sample project, import local files, or connect a GitHub repository before asking the AI Assistant.',
        });
        return null;
      }

      if (assistantAbortControllerRef.current) {
        assistantAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      assistantAbortControllerRef.current = controller;

      const reqSeq = ++assistantRequestSeqRef.current;
      const epochAtStart = workspaceEpochRef.current;
      const timestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      const priorHistory = assistantMessagesRef.current
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const userMessage = {
        id: `msg-user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: question,
        timestamp,
      };

      setAssistantMessages((prev) => [...prev, userMessage]);
      setIsAssistantLoading(true);
      setAssistantError(null);

      try {
        const rag = await retrieveRagContext({
          question,
          files,
          chunks: searchArtifacts.chunks,
          bm25Index: searchArtifacts.bm25Index,
          vectorIndex: getVectorIndex(),
          conversationHistory: priorHistory,
        });

        if (
          reqSeq !== assistantRequestSeqRef.current ||
          epochAtStart !== workspaceEpochRef.current ||
          controller.signal.aborted
        ) {
          return null;
        }

        const response = await requestAssistantAnswer({
          question,
          projectName,
          contextChunks: rag.contextChunks,
          conversationHistory: priorHistory,
          signal: controller.signal,
        });

        if (
          reqSeq !== assistantRequestSeqRef.current ||
          epochAtStart !== workspaceEpochRef.current ||
          controller.signal.aborted
        ) {
          return null;
        }

        const assistantMessage = {
          id: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          content: response.answer,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          sources: rag.sources,
          citationsUsed: response.citationsUsed,
          retrievalMode: rag.retrievalMode,
          semanticUsed: rag.semanticUsed,
          model: response.model,
          usage: response.usage,
        };

        setAssistantMessages((prev) => [...prev, assistantMessage]);
        setAssistantBackendStatus((prev) => ({
          ...prev,
          checked: true,
          reachable: true,
          geminiConfigured: true,
          model: response.model || prev.model,
          error: null,
        }));
        setIsAssistantLoading(false);
        if (assistantAbortControllerRef.current === controller) {
          assistantAbortControllerRef.current = null;
        }

        addActivity(
          'search',
          'Asked AI Assistant',
          `Answered "${question.slice(0, 70)}${question.length > 70 ? '...' : ''}" using ${rag.sources.length} retrieved code chunk${rag.sources.length === 1 ? '' : 's'} (${rag.semanticUsed ? 'Hybrid' : 'Lexical Fallback'}).`
        );

        return assistantMessage;
      } catch (err) {
        if (assistantAbortControllerRef.current === controller) {
          assistantAbortControllerRef.current = null;
        }
        if (
          err?.name === 'AbortError' ||
          reqSeq !== assistantRequestSeqRef.current ||
          epochAtStart !== workspaceEpochRef.current
        ) {
          return null;
        }

        const errorCode = err?.code || 'REQUEST_FAILED';
        const errorMessage = err?.message || 'Failed to generate AI Assistant response.';
        setAssistantError({ code: errorCode, message: errorMessage });
        if (errorCode === 'MISSING_API_KEY') {
          setAssistantBackendStatus((prev) => ({
            ...prev,
            checked: true,
            reachable: true,
            geminiConfigured: false,
            error: errorMessage,
          }));
        } else if (errorCode === 'BACKEND_UNREACHABLE') {
          setAssistantBackendStatus((prev) => ({
            ...prev,
            checked: true,
            reachable: false,
            error: errorMessage,
          }));
        }
        setIsAssistantLoading(false);
        return null;
      }
    },
    [files, searchArtifacts, projectName, getVectorIndex, addActivity]
  );

  return (
    <WorkspaceContext.Provider
      value={{
        projectName,
        updateProjectName,
        files,
        importFiles,
        loadSampleProject,
        removeFile,
        clearAllFiles,
        activeTab,
        setActiveTab,
        activityLog,
        clearActivityLog,
        selectedFile,
        setSelectedFile,
        selectedLineRange,
        setSelectedLineRange,
        openFileAtLine,
        searchQuery,
        setSearchQuery,
        searchResults,
        isSearching,
        executeSearch,
        searchMode,
        setSearchMode,
        lastSearchMeta,
        embeddingStatus,
        isIndexingEmbeddings:
          embeddingStatus.status === 'loading_model' || embeddingStatus.status === 'indexing',
        assistantMessages,
        isAssistantLoading,
        assistantError,
        assistantBackendStatus,
        askAssistant,
        clearAssistantConversation,
        cancelAssistantRequest,
        refreshAssistantHealth,
        dismissAssistantError,
        placeholderModal,
        openPlaceholder,
        closePlaceholder,
        projectSource,
        isGitHubModalOpen,
        openGitHubModal,
        closeGitHubModal,
        githubImportState,
        importFromGitHub,
        cancelGitHubImport,
        lastImportSummary,
        dismissImportSummary,
        isRestoringWorkspace,
        storageStatus,
        storageError,
        hasUnsavedChanges,
        restoreFailed,
        dismissStorageError,
        retryRestoreWorkspace,
        syncWorkspaceToStorage,
        structuralMetrics,
        architectureModel,
        interviewPrep,
        totalFunctions: structuralMetrics.totalFunctions,
        totalClasses: structuralMetrics.totalClasses,
        totalVariables: structuralMetrics.totalVariables,
        totalImports: structuralMetrics.totalImports,
        totalExports: structuralMetrics.totalExports,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
