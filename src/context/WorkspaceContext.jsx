import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
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
  performAstAwareSearch,
  resolveFileDependencies,
} from '../utils/astParser';
import { fetchGitHubRepository } from '../utils/githubClient.js';

const WorkspaceContext = createContext(null);

const INITIAL_GITHUB_IMPORT_STATE = {
  status: 'idle', // 'idle' | 'fetching' | 'parsing' | 'error'
  progress: { phase: '', completed: 0, total: 0, currentPath: '' },
  error: null,
};

export function WorkspaceProvider({ children }) {
  const [projectName, setProjectName] = useState('Forge Core');
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('workspace');
  const [projectSource, setProjectSource] = useState({ type: 'local' });
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [githubImportState, setGithubImportState] = useState(INITIAL_GITHUB_IMPORT_STATE);
  const [lastImportSummary, setLastImportSummary] = useState(null);
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
  const [placeholderModal, setPlaceholderModal] = useState(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

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

  const updateProjectName = useCallback((newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setProjectName(trimmed);
    addActivity('rename', 'Project Renamed', `Project name updated to "${trimmed}"`);
  }, [addActivity]);

  const importFiles = useCallback(async (fileList) => {
    const validFiles = [];
    const skippedFiles = [];
    const duplicatePaths = [];
    const existingPaths = new Set(files.map((f) => getFilePath(f)));
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
      const wasEmpty = files.length === 0;
      setFiles((prev) => {
        // Use normalized paths (file.path || file.name) for duplicate detection so files with
        // identical basenames in different directories are not incorrectly discarded.
        const existingPaths = new Set(prev.map((f) => f.path || f.name));
        const filteredNew = validFiles.filter((f) => !existingPaths.has(f.path || f.name));
        return resolveFileDependencies([...prev, ...filteredNew]);
      });
      if (wasEmpty) {
        setProjectSource({ type: 'local' });
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
  }, [files, addActivity]);

  const loadSampleProject = useCallback(() => {
    const sampleFilesWithAst = SAMPLE_PROJECT_FILES.map((sample) => ({
      ...sample,
      astMetadata: extractAstMetadata(sample.content, sample.name),
    }));
    setFiles(resolveFileDependencies(sampleFilesWithAst));
    setProjectName('Forge Core Engine (Sample)');
    setProjectSource({ type: 'sample' });
    setLastImportSummary(null);
    addActivity(
      'import',
      'Loaded Sample Project',
      `Loaded ${SAMPLE_PROJECT_FILES.length} reference files across TypeScript, JavaScript, Python, JSON, and Markdown.`
    );
  }, [addActivity]);

  const removeFile = useCallback((fileId) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === fileId);
      if (target) {
        addActivity('remove', 'File Removed', `Removed ${target.name} from current workspace.`);
      }
      const remaining = prev.filter((f) => f.id !== fileId);
      return resolveFileDependencies(remaining);
    });

    if (selectedFile?.id === fileId) {
      setSelectedFile(null);
    }

    // Refresh search results if active
    if (searchResults) {
      setSearchResults((prev) => (prev ? prev.filter((r) => r.fileId !== fileId) : null));
    }
  }, [files, addActivity, selectedFile, searchResults]);

  const clearAllFiles = useCallback(() => {
    const count = files.length;
    setFiles([]);
    setSelectedFile(null);
    setSearchResults(null);
    setSearchQuery('');
    setProjectSource({ type: 'local' });
    setLastImportSummary(null);
    addActivity('clear', 'Workspace Cleared', `Cleared all ${count} files from the active session.`);
  }, [files.length, addActivity]);

  const executeSearch = useCallback((query) => {
    const raw = query.trim();
    setSearchQuery(raw);

    if (!raw) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);

    const { results, grandTotalMatches } = performAstAwareSearch(files, raw);

    setSearchResults(results);
    setIsSearching(false);

    addActivity(
      'search',
      `Searched "${raw}"`,
      results && results.length > 0
        ? `Found ${grandTotalMatches} match${grandTotalMatches === 1 ? '' : 'es'} across ${results.length} file${results.length === 1 ? '' : 's'}.`
        : `No matches found across ${files.length} loaded files.`
    );
  }, [files, addActivity]);

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

      // When merging, preserve existing files with duplicate paths before parsing
      const existingPaths = replaceWorkspace ? new Set() : new Set(files.map((f) => getFilePath(f)));
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

      // Atomic commit after download + parsing succeed
      if (replaceWorkspace) {
        setFiles(resolveFileDependencies(stagedFiles));
        setProjectName(`${owner}/${repo}`);
        setProjectSource({ type: 'github', owner, repo, branch: resolvedBranch, commitSha, repoUrl });
        setSelectedFile(null);
        setSearchResults(null);
        setSearchQuery('');
      } else if (stagedFiles.length > 0) {
        setFiles((prev) => {
          const prevPaths = new Set(prev.map((f) => getFilePath(f)));
          const uniqueStaged = stagedFiles.filter((f) => !prevPaths.has(getFilePath(f)));
          return resolveFileDependencies([...prev, ...uniqueStaged]);
        });
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
  }, [files, addActivity]);

  const structuralMetrics = useMemo(() => {
    return calculateStructuralMetrics(files);
  }, [files]);

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
        searchQuery,
        setSearchQuery,
        searchResults,
        isSearching,
        executeSearch,
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
        structuralMetrics,
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
