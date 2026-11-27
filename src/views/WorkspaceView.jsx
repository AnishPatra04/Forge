import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  FileCode,
  Trash2,
  Search,
  Sparkles,
  Edit2,
  Check,
  X,
  Eye,
  AlertCircle,
  Hash,
  Code2,
  Filter,
  FolderOpen,
  FolderGit2,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { SUPPORTED_EXTENSIONS, EXTENSION_CONFIG } from '../constants/fileTypes';

function readFileFromEntry(fileEntry) {
  return new Promise((resolve, reject) => {
    fileEntry.file(resolve, reject);
  });
}

function readAllDirectoryEntries(directoryReader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const readBatch = () => {
      directoryReader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        reject
      );
    };
    readBatch();
  });
}

async function collectEntryFiles(entry) {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await readFileFromEntry(entry);
    const cleanPath = (entry.fullPath || file.name).replace(/^\/+/, '');
    return [{ file, path: cleanPath }];
  }
  if (entry.isDirectory) {
    const entries = await readAllDirectoryEntries(entry.createReader());
    const nested = await Promise.all(entries.map((child) => collectEntryFiles(child)));
    return nested.flat();
  }
  return [];
}

export function WorkspaceView() {
  const {
    projectName,
    updateProjectName,
    files,
    importFiles,
    loadSampleProject,
    removeFile,
    clearAllFiles,
    setSelectedFile,
    searchQuery,
    searchResults,
    isSearching,
    executeSearch,
    searchMode,
    setSearchMode,
    lastSearchMeta,
    embeddingStatus,
    isIndexingEmbeddings,
    openGitHubModal,
    projectSource,
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
  } = useWorkspace();

  const fileInputRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const prevSearchQueryRef = useRef(searchQuery);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(projectName);
  const [localInputQuery, setLocalInputQuery] = useState('');
  const [fileExtensionFilter, setFileExtensionFilter] = useState('ALL');
  const [dragActive, setDragActive] = useState(false);
  const [confirmOverwriteStorage, setConfirmOverwriteStorage] = useState(false);

  useEffect(() => {
    if (prevSearchQueryRef.current && !searchQuery) {
      setLocalInputQuery('');
    }
    prevSearchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const handleNameSave = () => {
    if (tempName.trim()) {
      updateProjectName(tempName);
    }
    setIsEditingName(false);
  };

  const handleFileInputChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      await importFiles(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragActive(false);

    const items = e.dataTransfer.items ? Array.from(e.dataTransfer.items) : [];
    const entries = items
      .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
      .filter(Boolean);

    if (entries.length > 0) {
      try {
        const collected = (await Promise.all(entries.map((entry) => collectEntryFiles(entry)))).flat();
        if (collected.length > 0) {
          await importFiles(collected);
          return;
        }
      } catch (err) {
        console.error('Failed to traverse dropped entries:', err);
      }
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await importFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleSearchInputChange = (e) => {
    const nextValue = e.target.value;
    setLocalInputQuery(nextValue);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    if (!nextValue.trim()) {
      if (searchQuery || searchResults !== null) {
        executeSearch('');
      }
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      executeSearch(nextValue);
    }, 250);
  };

  const handleClearSearch = () => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    setLocalInputQuery('');
    executeSearch('');
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    executeSearch(localInputQuery);
  };

  const handleSuggestedQuery = (suggested) => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    setLocalInputQuery(suggested);
    executeSearch(suggested);
  };

  const handleSearchModeChange = (mode) => {
    setSearchMode(mode);
    const activeText = localInputQuery.trim() || searchQuery.trim();
    if ((searchQuery || searchResults !== null) && activeText) {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      executeSearch(activeText, { mode });
    }
  };

  // Real statistics calculation
  const totalLines = files.reduce((acc, f) => acc + f.lineCount, 0);
  const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalSizeKb = (totalSizeBytes / 1024).toFixed(1);

  // Group extensions
  const extensionCounts = files.reduce((acc, f) => {
    acc[f.extension] = (acc[f.extension] || 0) + 1;
    return acc;
  }, {});

  // Filtered files
  const filteredFiles = files.filter((f) => {
    if (fileExtensionFilter === 'ALL') return true;
    return f.extension === fileExtensionFilter;
  });

  return (
    <div className="flex-1 overflow-y-auto forge-ambient-canvas text-foreground">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Workspace Title & Supporting Statement */}
        <div className="border-b border-border pb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-primary/10 text-primary border border-primary/25">
                  DEVELOPER WORKSPACE
                </span>
                <span className="text-muted-foreground text-xs font-mono">• Client-Side Assistant</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground font-sans">
                Your codebase, understood.
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base mt-2 max-w-2xl leading-relaxed">
                Explore your projects, ask better questions, and understand how your code works.
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2.5 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-primary hover:bg-[#D2FA81] text-primary-foreground shadow-sm  transition-colors"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Import Files</span>
              </button>

              <button
                onClick={openGitHubModal}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-secondary hover:bg-accent text-foreground border border-white/15 hover:border-primary/40 transition-colors"
              >
                <FolderGit2 className="w-4 h-4 text-primary" />
                <span>Import GitHub</span>
              </button>

              {!isRestoringWorkspace && files.length === 0 && (
                <button
                  onClick={loadSampleProject}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-secondary hover:bg-accent text-primary border border-white/15 hover:border-primary/40 transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span>Load Sample Project</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Non-blocking Storage Notice (Unavailable or Error) */}
        {storageError && (
          <div className="p-3.5 rounded-lg bg-warning/10 border border-amber-800/50 text-xs text-foreground flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {storageStatus === 'unavailable'
                    ? 'In-Memory Workspace Only'
                    : 'Browser Storage Warning'}
                </p>
                <p className="text-[11px] text-warning/90 mt-0.5">{storageError}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {restoreFailed ? (
                <>
                  <button
                    onClick={retryRestoreWorkspace}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-foreground border border-amber-500/40 transition-colors"
                  >
                    Retry Restore
                  </button>
                  {confirmOverwriteStorage ? (
                    <>
                      <button
                        onClick={async () => {
                          setConfirmOverwriteStorage(false);
                          await syncWorkspaceToStorage({ confirmOverwrite: true });
                        }}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-700/60 transition-colors"
                      >
                        Confirm Overwrite
                      </button>
                      <button
                        onClick={() => setConfirmOverwriteStorage(false)}
                        className="px-2 py-1 rounded-md text-[11px] text-foreground/90 hover:text-foreground bg-secondary border border-white/15 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmOverwriteStorage(true)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-secondary hover:bg-accent text-foreground border border-white/15 transition-colors"
                    >
                      Overwrite Saved
                    </button>
                  )}
                </>
              ) : (
                storageStatus === 'error' &&
                hasUnsavedChanges && (
                  <button
                    onClick={() => syncWorkspaceToStorage()}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-foreground border border-amber-500/40 transition-colors"
                  >
                    Retry Sync
                  </button>
                )
              )}
              <button
                onClick={() => {
                  setConfirmOverwriteStorage(false);
                  dismissStorageError();
                }}
                className="text-warning hover:text-amber-100 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Empty State / Initial Importer Interface */}
        {isRestoringWorkspace && files.length === 0 ? (
          <div className="border border-border rounded-lg p-12 text-center bg-secondary/30">
            <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center text-primary">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <h2 className="text-base font-semibold text-foreground mb-1">
              Restoring Saved Workspace...
            </h2>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Checking browser IndexedDB storage for your previous files and project metadata.
            </p>
          </div>
        ) : files.length === 0 ? (
          <div className="space-y-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-all ${
                dragActive
                  ? 'border-primary bg-primary/8'
                  : 'border-border hover:border-white/15 bg-secondary/30'
              }`}
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center text-primary">
                <Code2 className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">
                Import Source Code to Begin
              </h2>
              <p className="text-xs text-muted-foreground max-w-md mx-auto mb-6 leading-relaxed">
                Select your codebase files from your local disk. Files are processed entirely inside
                your browser in memory.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs font-semibold bg-primary hover:bg-[#D2FA81] text-primary-foreground transition-colors cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4" />
                  Choose Files from Computer
                </button>
                <button
                  onClick={openGitHubModal}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-secondary hover:bg-accent text-foreground border border-white/15 transition-colors"
                >
                  <FolderGit2 className="w-4 h-4 text-primary" />
                  Import from GitHub
                </button>
                <button
                  onClick={loadSampleProject}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-secondary hover:bg-accent text-primary border border-white/15 transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-primary" />
                  Explore with Sample Files
                </button>
              </div>

              {/* Supported Extensions List */}
              <div className="mt-8 pt-6 border-t border-border max-w-2xl mx-auto">
                <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-3">
                  Supported File Extensions
                </p>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {SUPPORTED_EXTENSIONS.map((ext) => {
                    const cfg = EXTENSION_CONFIG[ext];
                    return (
                      <span
                        key={ext}
                        className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                          cfg ? cfg.color : 'text-muted-foreground border-border bg-secondary'
                        }`}
                      >
                        {ext}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Architecture Explainer Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-5 rounded-lg bg-muted border border-border">
                <div className="text-primary font-mono text-xs mb-2 font-semibold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" /> 01. Ingest
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Local & Private</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Source code never leaves your local browser sandbox. No backend servers or third-party telemetry.
                </p>
              </div>

              <div className="p-5 rounded-lg bg-muted border border-border">
                <div className="text-primary font-mono text-xs mb-2 font-semibold flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" /> 02. Search & Inspect
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Local Keyword Index</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Rapidly locate symbols, functions, configurations, and imports across all loaded files.
                </p>
              </div>

              <div className="p-5 rounded-lg bg-muted border border-border">
                <div className="text-primary font-mono text-xs mb-2 font-semibold flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5" /> 03. Future Roadmap
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Milestones 2 & 3</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Upcoming AST code graph, vector embeddings, and LLM-powered architectural explanations.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Populated Workspace: Project Overview & Code Assistant */
          <div className="space-y-6">
            {/* GitHub Import Warning / Summary Banner */}
            {lastImportSummary &&
              (lastImportSummary.stats?.failedCount > 0 ||
                lastImportSummary.stats?.truncated ||
                lastImportSummary.stats?.cappedCount > 0 ||
                lastImportSummary.stats?.oversizedCount > 0 ||
                lastImportSummary.duplicateCount > 0) && (
                <div className="p-3.5 rounded-lg bg-warning/10 border border-amber-800/50 text-xs text-foreground flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        GitHub Import Summary for <span className="font-mono">{lastImportSummary.repoLabel}</span> ({lastImportSummary.branch})
                      </p>
                      <p className="text-[11px] text-warning/90 font-mono">
                        Loaded {lastImportSummary.addedCount} files
                        {lastImportSummary.duplicateCount > 0 ? ` • ${lastImportSummary.duplicateCount} existing paths preserved` : ''}
                        {lastImportSummary.stats?.failedCount > 0 ? ` • ${lastImportSummary.stats.failedCount} download(s) failed` : ''}
                        {lastImportSummary.stats?.oversizedCount > 0 ? ` • ${lastImportSummary.stats.oversizedCount} oversized skipped` : ''}
                        {lastImportSummary.stats?.cappedCount > 0 ? ` • ${lastImportSummary.stats.cappedCount} skipped by repo cap` : ''}
                        {lastImportSummary.stats?.truncated ? ' • Repository tree was truncated by GitHub' : ''}
                      </p>
                    </div>
                  </div>
                  <button onClick={dismissImportSummary} className="text-warning hover:text-amber-100 p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

            {/* Project Overview Card */}
            <div className="p-6 rounded-lg bg-card border border-border shadow-lg shadow-black/20">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-border">
                {/* Editable Project Name */}
                <div className="flex items-center gap-3">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleNameSave();
                          if (e.key === 'Escape') setIsEditingName(false);
                        }}
                        autoFocus
                        className="px-3 py-1.5 bg-[#0E120F] border border-primary rounded-md text-sm font-semibold text-foreground focus:outline-hidden"
                      />
                      <button
                        onClick={handleNameSave}
                        className="p-1.5 rounded-lg bg-primary hover:bg-[#D2FA81] text-primary-foreground transition-colors"
                        title="Save name"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setIsEditingName(false)}
                        className="p-1.5 rounded-lg bg-secondary hover:bg-accent text-foreground/90 transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <h2 className="text-xl font-bold text-foreground font-sans tracking-tight">
                        {projectName}
                      </h2>
                      <button
                        onClick={() => {
                          setTempName(projectName);
                          setIsEditingName(true);
                        }}
                        className="p-1.5 text-muted-foreground hover:text-primary rounded transition-colors"
                        title="Rename Project"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {projectSource?.type === 'github' && (
                        <a
                          href={projectSource.repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-primary/10 text-primary border border-primary/25 hover:bg-primary/15 transition-colors"
                        >
                          <span>{projectSource.branch}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Clear and Add Controls */}
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-white/15 transition-colors"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-primary" />
                    <span>Add Files</span>
                  </button>

                  <button
                    onClick={() => {
                      setLocalInputQuery('');
                      clearAllFiles();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 hover:bg-red-950/60 text-destructive border border-red-900/50 transition-colors"
                    title="Remove all imported files"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    <span>Clear Selection</span>
                  </button>
                </div>
              </div>

              {/* Real Project Statistics (No fabricated metrics) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5">
                <div className="p-3.5 rounded-lg bg-muted border border-border">
                  <span className="text-[11px] font-mono uppercase text-muted-foreground block mb-1">
                    Total Files
                  </span>
                  <span className="text-xl font-bold text-foreground font-mono">
                    {files.length}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-muted border border-border">
                  <span className="text-[11px] font-mono uppercase text-muted-foreground block mb-1">
                    Lines of Code
                  </span>
                  <span className="text-xl font-bold text-foreground font-mono">
                    {totalLines.toLocaleString()}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-muted border border-border">
                  <span className="text-[11px] font-mono uppercase text-muted-foreground block mb-1">
                    Memory Footprint
                  </span>
                  <span className="text-xl font-bold text-foreground font-mono">
                    {totalSizeKb} <span className="text-xs font-normal text-muted-foreground">KB</span>
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-muted border border-border">
                  <span className="text-[11px] font-mono uppercase text-muted-foreground block mb-1">
                    Language Breakdown
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(extensionCounts).map(([ext, count]) => (
                      <span
                        key={ext}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-foreground/90 border border-white/15/60"
                      >
                        {ext}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Split Workspace: Left = File Inventory, Right = Local Code Search Assistant */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: File Inventory & Management (5 cols) */}
              <div className="lg:col-span-5 space-y-4">
                <div className="p-5 rounded-xl forge-panel">
                  <div className="flex items-center justify-between pb-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">
                        Imported Files ({files.length})
                      </h3>
                    </div>

                    {/* Filter by extension */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <Filter className="w-3 h-3 text-muted-foreground" />
                      <select
                        value={fileExtensionFilter}
                        onChange={(e) => setFileExtensionFilter(e.target.value)}
                        className="bg-secondary border border-border rounded px-2 py-1 text-[11px] font-mono text-foreground/90 focus:outline-none"
                      >
                        <option value="ALL">All ({files.length})</option>
                        {Object.keys(extensionCounts).map((ext) => (
                          <option key={ext} value={ext}>
                            {ext} ({extensionCounts[ext]})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* File List */}
                  <div className="divide-y divide-slate-800/60 max-h-[520px] overflow-y-auto pr-1 mt-2">
                    {filteredFiles.map((file) => {
                      const cfg = EXTENSION_CONFIG[file.extension] || {
                        label: file.extension,
                        color: 'text-muted-foreground border-white/15 bg-secondary',
                      };
                      return (
                        <div
                          key={file.id}
                          className="py-3 flex items-center justify-between gap-3 hover:bg-muted px-2 rounded-lg transition-colors group"
                        >
                          <div
                            onClick={() => setSelectedFile(file)}
                            className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                          >
                            <FileCode className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                            <div className="min-w-0">
                              <p
                                className="text-xs font-mono text-foreground group-hover:text-foreground truncate font-medium"
                                title={file.path || file.name}
                              >
                                {file.path || file.name}
                              </p>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono mt-0.5">
                                <span>{file.lineCount} lines</span>
                                <span>•</span>
                                <span>{(file.size / 1024).toFixed(1)} KB</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${cfg.color}`}
                            >
                              {cfg.label}
                            </span>
                            <button
                              onClick={() => setSelectedFile(file)}
                              className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                              title="Inspect File"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => removeFile(file.id)}
                              className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/12 rounded transition-colors"
                              title="Remove file"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Column: Basic Assistant - Local Code Search (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                <div className="p-5 rounded-xl forge-panel space-y-5">
                  {/* Search Header, Mode Selector & Semantic Index Status */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10 border border-primary/25 text-primary">
                          <Search className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">
                            Hybrid Code Search
                          </h3>
                          <span className="text-[10px] text-primary font-mono">
                            BM25 + AST + Local Embeddings
                          </span>
                        </div>
                      </div>

                      {/* Search Mode Selector */}
                      <div
                        role="group"
                        aria-label="Search mode"
                        className="inline-flex items-center p-0.5 rounded-lg bg-[#0E120F] border border-border"
                      >
                        {[
                          { id: 'keyword', label: 'Keyword' },
                          { id: 'hybrid', label: 'Hybrid' },
                          { id: 'semantic', label: 'Semantic' },
                        ].map((modeOption) => {
                          const isActive = searchMode === modeOption.id;
                          return (
                            <button
                              key={modeOption.id}
                              type="button"
                              aria-pressed={isActive}
                              onClick={() => handleSearchModeChange(modeOption.id)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                                isActive
                                  ? 'bg-primary text-primary-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {modeOption.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Embedding / Indexing Status & Fallback Indicator */}
                    {(() => {
                      const status = embeddingStatus?.status || 'idle';
                      const prog = embeddingStatus?.progress || {};
                      const semanticUnavailable = status === 'unavailable' || status === 'error';
                      const fallbackActive =
                        semanticUnavailable ||
                        (lastSearchMeta?.query === searchQuery &&
                          lastSearchMeta?.modeUsed === 'lexical_fallback');

                      if (isIndexingEmbeddings) {
                        const pct =
                          status === 'indexing' && prog.total > 0
                            ? Math.min(100, Math.round(((prog.completed || 0) / prog.total) * 100))
                            : typeof prog.modelProgress === 'number'
                              ? prog.modelProgress
                              : null;
                        return (
                          <div className="mt-3 p-3 rounded-lg bg-primary/8 border border-primary/25 text-[11px] text-foreground/90 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 font-medium text-primary">
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                {status === 'loading_model'
                                  ? 'Loading client-side embedding model...'
                                  : `Indexing code chunks (${prog.completed || 0}/${prog.total || embeddingStatus?.totalChunkCount || 0})...`}
                              </span>
                              {pct !== null && (
                                <span className="font-mono text-[10px] text-primary">{pct}%</span>
                              )}
                            </div>
                            <div className="w-full h-1 rounded-full bg-secondary overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all duration-200"
                                style={{ width: `${pct !== null ? pct : 25}%` }}
                              />
                            </div>
                          </div>
                        );
                      }

                      if (fallbackActive) {
                        return (
                          <div className="mt-3 p-3 rounded-lg bg-warning/10 border border-warning/30 text-[11px] text-foreground/90 leading-normal flex items-start gap-2.5">
                            <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                            <div>
                              <strong className="text-warning">
                                Semantic Search Unavailable — Lexical Fallback Active:
                              </strong>{' '}
                              Using local BM25 + AST keyword matching.
                              {embeddingStatus?.error ? ` (${embeddingStatus.error})` : ''}
                            </div>
                          </div>
                        );
                      }

                      if (status === 'ready') {
                        return (
                          <div className="mt-3 px-3 py-2 rounded-lg bg-[#0E120F] border border-border text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                              <span className="text-foreground/90 font-medium">Semantic Index Ready</span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                • {embeddingStatus.indexedChunkCount} chunk{embeddingStatus.indexedChunkCount === 1 ? '' : 's'} embedded locally
                              </span>
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground/80">Client-side ONNX</span>
                          </div>
                        );
                      }

                      return (
                        <div className="mt-3 p-3 rounded-lg bg-[#0E120F] border border-border text-[11px] text-muted-foreground leading-normal flex items-start gap-2.5">
                          <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <div>
                            <strong className="text-foreground/90">Client-Side Hybrid Search:</strong>{' '}
                            Combines AST exact matches, BM25 keyword ranking, and local semantic
                            embeddings — zero server calls required.
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Search Query Input */}
                  <form onSubmit={handleSearchSubmit} className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        value={localInputQuery}
                        onChange={handleSearchInputChange}
                        placeholder="Ask a question or enter keywords (e.g., auth, token, retry, database)..."
                        className="w-full bg-[#0E120F] border border-white/15 focus:border-primary rounded-lg pl-10 pr-28 py-2.5 text-xs text-foreground placeholder-slate-400 focus:outline-none transition-colors"
                      />
                      {isSearching ? (
                        <Loader2 className="w-4 h-4 text-primary animate-spin absolute left-3.5 top-3" />
                      ) : (
                        <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3" />
                      )}
                      {localInputQuery && (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={handleClearSearch}
                          className="absolute right-16 top-2.5 text-muted-foreground hover:text-foreground p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="submit"
                        className="absolute right-2 top-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary hover:bg-[#D2FA81] text-primary-foreground transition-colors"
                      >
                        {isSearching ? 'Searching...' : 'Search'}
                      </button>
                    </div>

                    {/* Suggested keyword chips */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground font-mono text-[10px]">Suggested:</span>
                      {['auth', 'token', 'retry', 'database', 'config', 'interface', 'export'].map(
                        (term) => (
                          <button
                            key={term}
                            type="button"
                            onClick={() => handleSuggestedQuery(term)}
                            className="px-2 py-0.5 rounded bg-secondary hover:bg-accent text-foreground/90 border border-border hover:border-white/15 font-mono text-[10px] transition-colors"
                          >
                            {term}
                          </button>
                        )
                      )}
                    </div>
                  </form>

                  {/* Search Results Display */}
                  <div className="pt-2">
                    {searchQuery && searchResults === null && isSearching && (
                      <div className="p-8 text-center rounded-lg bg-[#0E120F]/40 border border-border">
                        <Loader2 className="w-7 h-7 text-primary animate-spin mx-auto mb-2" />
                        <p className="text-xs font-medium text-foreground/90">
                          Searching "{searchQuery}"...
                        </p>
                      </div>
                    )}

                    {searchQuery && searchResults !== null && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pb-2 border-b border-border">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-muted-foreground">
                              Results for{' '}
                              <span className="text-primary font-mono font-medium">
                                "{searchQuery}"
                              </span>
                            </span>
                            {lastSearchMeta?.query === searchQuery && (
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                  lastSearchMeta.modeUsed === 'lexical_fallback' ||
                                  (searchMode !== 'keyword' &&
                                    !lastSearchMeta.semanticUsed &&
                                    lastSearchMeta.modeUsed !== 'hybrid_pending')
                                    ? 'bg-warning/10 text-warning border-warning/25'
                                    : 'bg-secondary text-foreground/90 border-white/15'
                                }`}
                              >
                                {lastSearchMeta.modeUsed === 'lexical_fallback' ||
                                (searchMode !== 'keyword' &&
                                  !lastSearchMeta.semanticUsed &&
                                  lastSearchMeta.modeUsed !== 'hybrid_pending')
                                  ? 'Lexical Fallback (BM25 + AST)'
                                  : lastSearchMeta.modeUsed === 'hybrid_pending'
                                    ? 'BM25 + AST (refining vectors...)'
                                    : lastSearchMeta.semanticUsed
                                      ? searchMode === 'semantic'
                                        ? 'Semantic Vector Match'
                                        : 'Hybrid (BM25 + AST + Vector)'
                                      : 'Keyword (BM25 + AST)'}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-2">
                            {isSearching && (
                              <Loader2 className="w-3 h-3 animate-spin text-primary" />
                            )}
                            {searchResults.length} file{searchResults.length === 1 ? '' : 's'} matched
                          </span>
                        </div>

                        {searchResults.length === 0 ? (
                          <div className="p-8 text-center rounded-lg bg-[#0E120F]/40 border border-border">
                            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                            <p className="text-xs font-medium text-foreground/90 mb-1">
                              No matching code snippets found
                            </p>
                            <p className="text-[11px] text-muted-foreground max-w-sm mx-auto leading-relaxed">
                              No relevant matches for "{searchQuery}" were detected in your loaded files.
                              Try different keywords, a conceptual description, or another search mode.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
                            {searchResults.map((res) => {
                              const targetFile = files.find((f) => f.id === res.fileId);
                              return (
                                <div
                                  key={res.fileId}
                                  className="rounded-lg bg-[#0E120F] border border-border overflow-hidden"
                                >
                                  {/* Result File Header */}
                                  <div className="px-3.5 py-2 bg-muted border-b border-border flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <FileCode className="w-3.5 h-3.5 text-primary shrink-0" />
                                      <span
                                        className="text-xs font-mono font-medium text-foreground truncate"
                                        title={res.filePath || res.fileName}
                                      >
                                        {res.filePath || res.fileName}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {res.matchType && (
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary/90 text-foreground/90 border border-white/15/70 capitalize">
                                          {res.matchType}
                                        </span>
                                      )}
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/25">
                                        {res.totalMatches} match{res.totalMatches === 1 ? '' : 'es'}
                                      </span>
                                      {targetFile && (
                                        <button
                                          onClick={() => setSelectedFile(targetFile)}
                                          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 font-mono hover:underline"
                                        >
                                          View Full File
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Code Snippets with Line Numbers */}
                                  <div className="p-2 space-y-1 font-mono text-[11px]">
                                    {res.matches.slice(0, 5).map((match, mIdx) => {
                                      const lineLabel =
                                        match.endLine && match.endLine !== match.lineNumber
                                          ? `L${match.lineNumber}-${match.endLine}`
                                          : `L${match.lineNumber}`;
                                      return (
                                        <div
                                          key={mIdx}
                                          className="flex items-start gap-2 hover:bg-muted px-2 py-1 rounded transition-colors group"
                                        >
                                          <span className="text-muted-foreground select-none text-[10px] min-w-12 text-right shrink-0 pt-0.5">
                                            {lineLabel}
                                          </span>
                                          <span className="text-foreground/90 whitespace-pre-wrap break-all flex-1">
                                            {match.lineContent}
                                          </span>
                                        </div>
                                      );
                                    })}
                                    {res.matches.length > 5 && (
                                      <div className="text-[10px] text-muted-foreground pt-1 pl-14">
                                        + {res.matches.length - 5} more matching lines in file
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {!searchQuery && (
                      <div className="p-8 text-center rounded-lg bg-[#0E120F]/30 border border-border/40">
                        <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-xs font-medium text-foreground/90 mb-1">
                          Search Across Ingested Code
                        </p>
                        <p className="text-[11px] text-muted-foreground max-w-sm mx-auto leading-relaxed">
                          Type a symbol name, keyword, or natural-language question above to search
                          your workspace files.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
