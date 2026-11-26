import React, { useState, useRef } from 'react';
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
  HardDrive,
  Code2,
  Filter,
  RefreshCw,
  FolderOpen,
  FolderGit2,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { SUPPORTED_EXTENSIONS, EXTENSION_CONFIG, getFileExtension } from '../constants/fileTypes';

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
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(projectName);
  const [localInputQuery, setLocalInputQuery] = useState('');
  const [fileExtensionFilter, setFileExtensionFilter] = useState('ALL');
  const [dragActive, setDragActive] = useState(false);
  const [confirmOverwriteStorage, setConfirmOverwriteStorage] = useState(false);

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

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    executeSearch(localInputQuery);
  };

  const handleSuggestedQuery = (suggested) => {
    setLocalInputQuery(suggested);
    executeSearch(suggested);
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
    <div className="flex-1 overflow-y-auto bg-[#0c0d12] text-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Workspace Title & Supporting Statement */}
        <div className="border-b border-slate-800/80 pb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  DEVELOPER WORKSPACE
                </span>
                <span className="text-slate-400 text-xs font-mono">• Client-Side Assistant</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white font-sans">
                Your codebase, understood.
              </h1>
              <p className="text-slate-400 text-sm sm:text-base mt-2 max-w-2xl leading-relaxed">
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
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-950/40 transition-colors"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Import Files</span>
              </button>

              <button
                onClick={openGitHubModal}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 hover:border-indigo-500/40 transition-colors"
              >
                <FolderGit2 className="w-4 h-4 text-indigo-400" />
                <span>Import GitHub</span>
              </button>

              {!isRestoringWorkspace && files.length === 0 && (
                <button
                  onClick={loadSampleProject}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700/80 hover:border-indigo-500/40 transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>Load Sample Project</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Non-blocking Storage Notice (Unavailable or Error) */}
        {storageError && (
          <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/50 text-xs text-amber-200 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {storageStatus === 'unavailable'
                    ? 'In-Memory Workspace Only'
                    : 'Browser Storage Warning'}
                </p>
                <p className="text-[11px] text-amber-300/90 mt-0.5">{storageError}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {restoreFailed ? (
                <>
                  <button
                    onClick={retryRestoreWorkspace}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 transition-colors"
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
                        className="px-2 py-1 rounded-md text-[11px] text-slate-300 hover:text-white bg-slate-800 border border-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmOverwriteStorage(true)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
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
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 transition-colors"
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
                className="text-amber-300 hover:text-amber-100 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Empty State / Initial Importer Interface */}
        {isRestoringWorkspace && files.length === 0 ? (
          <div className="border border-slate-800 rounded-xl p-12 text-center bg-slate-900/30">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <h2 className="text-base font-semibold text-slate-100 mb-1">
              Restoring Saved Workspace...
            </h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Checking browser IndexedDB storage for your previous files and project metadata.
            </p>
          </div>
        ) : files.length === 0 ? (
          <div className="space-y-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                dragActive
                  ? 'border-indigo-500 bg-indigo-950/20'
                  : 'border-slate-800 hover:border-slate-700 bg-slate-900/30'
              }`}
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Code2 className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-semibold text-slate-100 mb-1">
                Import Source Code to Begin
              </h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
                Select your codebase files from your local disk. Files are processed entirely inside
                your browser in memory.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm shadow-indigo-900/30"
                >
                  <UploadCloud className="w-4 h-4" />
                  Choose Files from Computer
                </button>
                <button
                  onClick={openGitHubModal}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                >
                  <FolderGit2 className="w-4 h-4 text-indigo-400" />
                  Import from GitHub
                </button>
                <button
                  onClick={loadSampleProject}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Explore with Sample Files
                </button>
              </div>

              {/* Supported Extensions List */}
              <div className="mt-8 pt-6 border-t border-slate-800/60 max-w-2xl mx-auto">
                <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-3">
                  Supported File Extensions
                </p>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {SUPPORTED_EXTENSIONS.map((ext) => {
                    const cfg = EXTENSION_CONFIG[ext];
                    return (
                      <span
                        key={ext}
                        className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                          cfg ? cfg.color : 'text-slate-400 border-slate-800 bg-slate-900'
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
              <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800/70">
                <div className="text-indigo-400 font-mono text-xs mb-2 font-semibold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" /> 01. Ingest
                </div>
                <h3 className="text-sm font-semibold text-slate-200 mb-1">Local & Private</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Source code never leaves your local browser sandbox. No backend servers or third-party telemetry.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800/70">
                <div className="text-indigo-400 font-mono text-xs mb-2 font-semibold flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" /> 02. Search & Inspect
                </div>
                <h3 className="text-sm font-semibold text-slate-200 mb-1">Local Keyword Index</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Rapidly locate symbols, functions, configurations, and imports across all loaded files.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800/70">
                <div className="text-indigo-400 font-mono text-xs mb-2 font-semibold flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5" /> 03. Future Roadmap
                </div>
                <h3 className="text-sm font-semibold text-slate-200 mb-1">Milestones 2 & 3</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
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
                <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/50 text-xs text-amber-200 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        GitHub Import Summary for <span className="font-mono">{lastImportSummary.repoLabel}</span> ({lastImportSummary.branch})
                      </p>
                      <p className="text-[11px] text-amber-300/90 font-mono">
                        Loaded {lastImportSummary.addedCount} files
                        {lastImportSummary.duplicateCount > 0 ? ` • ${lastImportSummary.duplicateCount} existing paths preserved` : ''}
                        {lastImportSummary.stats?.failedCount > 0 ? ` • ${lastImportSummary.stats.failedCount} download(s) failed` : ''}
                        {lastImportSummary.stats?.oversizedCount > 0 ? ` • ${lastImportSummary.stats.oversizedCount} oversized skipped` : ''}
                        {lastImportSummary.stats?.cappedCount > 0 ? ` • ${lastImportSummary.stats.cappedCount} skipped by repo cap` : ''}
                        {lastImportSummary.stats?.truncated ? ' • Repository tree was truncated by GitHub' : ''}
                      </p>
                    </div>
                  </div>
                  <button onClick={dismissImportSummary} className="text-amber-300 hover:text-amber-100 p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

            {/* Project Overview Card */}
            <div className="p-6 rounded-xl bg-[#11131c] border border-slate-800/80 shadow-lg shadow-black/20">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
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
                        className="px-3 py-1.5 bg-slate-950 border border-indigo-500 rounded-lg text-sm font-semibold text-white focus:outline-none"
                      />
                      <button
                        onClick={handleNameSave}
                        className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                        title="Save name"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setIsEditingName(false)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <h2 className="text-xl font-bold text-slate-100 font-sans tracking-tight">
                        {projectName}
                      </h2>
                      <button
                        onClick={() => {
                          setTempName(projectName);
                          setIsEditingName(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-indigo-400 rounded transition-colors"
                        title="Rename Project"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {projectSource?.type === 'github' && (
                        <a
                          href={projectSource.repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Add Files</span>
                  </button>

                  <button
                    onClick={() => {
                      setLocalInputQuery('');
                      clearAllFiles();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-950/30 hover:bg-red-950/60 text-red-300 border border-red-900/50 transition-colors"
                    title="Remove all imported files"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span>Clear Selection</span>
                  </button>
                </div>
              </div>

              {/* Real Project Statistics (No fabricated metrics) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5">
                <div className="p-3.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                    Total Files
                  </span>
                  <span className="text-xl font-bold text-slate-100 font-mono">
                    {files.length}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                    Lines of Code
                  </span>
                  <span className="text-xl font-bold text-slate-100 font-mono">
                    {totalLines.toLocaleString()}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                    Memory Footprint
                  </span>
                  <span className="text-xl font-bold text-slate-100 font-mono">
                    {totalSizeKb} <span className="text-xs font-normal text-slate-400">KB</span>
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                    Language Breakdown
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(extensionCounts).map(([ext, count]) => (
                      <span
                        key={ext}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60"
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
                <div className="p-5 rounded-xl bg-[#11131c] border border-slate-800/80">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-indigo-400" />
                      <h3 className="text-sm font-semibold text-slate-200">
                        Imported Files ({files.length})
                      </h3>
                    </div>

                    {/* Filter by extension */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <Filter className="w-3 h-3 text-slate-400" />
                      <select
                        value={fileExtensionFilter}
                        onChange={(e) => setFileExtensionFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] font-mono text-slate-300 focus:outline-none"
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
                        color: 'text-slate-400 border-slate-700 bg-slate-800',
                      };
                      return (
                        <div
                          key={file.id}
                          className="py-3 flex items-center justify-between gap-3 hover:bg-slate-900/40 px-2 rounded-lg transition-colors group"
                        >
                          <div
                            onClick={() => setSelectedFile(file)}
                            className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                          >
                            <FileCode className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                            <div className="min-w-0">
                              <p
                                className="text-xs font-mono text-slate-200 group-hover:text-white truncate font-medium"
                                title={file.path || file.name}
                              >
                                {file.path || file.name}
                              </p>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
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
                              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                              title="Inspect File"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => removeFile(file.id)}
                              className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded transition-colors"
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
                <div className="p-5 rounded-xl bg-[#11131c] border border-slate-800/80 space-y-5">
                  {/* Assistant Header & Honest Disclosure */}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                          <Search className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">
                            Local Code Search
                          </h3>
                          <span className="text-[10px] text-indigo-400 font-mono">
                            Preview Milestone 1
                          </span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800">
                        Exact Keyword Matcher
                      </span>
                    </div>

                    <div className="mt-3 p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 leading-normal flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-slate-300">Client-Side Search Preview:</strong>{' '}
                        This feature searches the raw contents of your loaded codebase files locally
                        for relevant keywords. No LLM or cloud API is utilized in this milestone.
                      </div>
                    </div>
                  </div>

                  {/* Search Query Input */}
                  <form onSubmit={handleSearchSubmit} className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        value={localInputQuery}
                        onChange={(e) => setLocalInputQuery(e.target.value)}
                        placeholder="Ask a question or enter keywords (e.g., auth, token, retry, database)..."
                        className="w-full bg-[#0a0c12] border border-slate-700/80 focus:border-indigo-500 rounded-lg pl-10 pr-24 py-2.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none transition-colors"
                      />
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      {localInputQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setLocalInputQuery('');
                            executeSearch('');
                          }}
                          className="absolute right-16 top-2.5 text-slate-400 hover:text-slate-200 p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="submit"
                        className="absolute right-2 top-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                      >
                        Search
                      </button>
                    </div>

                    {/* Suggested keyword chips */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-400 font-mono text-[10px]">Suggested:</span>
                      {['auth', 'token', 'retry', 'database', 'config', 'interface', 'export'].map(
                        (term) => (
                          <button
                            key={term}
                            type="button"
                            onClick={() => handleSuggestedQuery(term)}
                            className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 font-mono text-[10px] transition-colors"
                          >
                            {term}
                          </button>
                        )
                      )}
                    </div>
                  </form>

                  {/* Search Results Display */}
                  <div className="pt-2">
                    {searchQuery && searchResults !== null && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                          <span className="text-slate-400">
                            Results for{' '}
                            <span className="text-indigo-300 font-mono font-medium">
                              "{searchQuery}"
                            </span>
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {searchResults.length} file{searchResults.length === 1 ? '' : 's'} matched
                          </span>
                        </div>

                        {searchResults.length === 0 ? (
                          <div className="p-8 text-center rounded-lg bg-slate-950/40 border border-slate-800/60">
                            <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                            <p className="text-xs font-medium text-slate-300 mb-1">
                              No matching code snippets found
                            </p>
                            <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-relaxed">
                              No occurrences of "{searchQuery}" were detected in your loaded files.
                              Try searching for function names, variables, imports, or keywords like
                              'export', 'class', or 'return'.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
                            {searchResults.map((res) => {
                              const targetFile = files.find((f) => f.id === res.fileId);
                              return (
                                <div
                                  key={res.fileId}
                                  className="rounded-lg bg-slate-950/80 border border-slate-800/80 overflow-hidden"
                                >
                                  {/* Result File Header */}
                                  <div className="px-3.5 py-2 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                      <span
                                        className="text-xs font-mono font-medium text-slate-200 truncate"
                                        title={res.filePath || res.fileName}
                                      >
                                        {res.filePath || res.fileName}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                        {res.totalMatches} match{res.totalMatches === 1 ? '' : 'es'}
                                      </span>
                                      {targetFile && (
                                        <button
                                          onClick={() => setSelectedFile(targetFile)}
                                          className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 font-mono hover:underline"
                                        >
                                          View Full File
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Code Snippets with Line Numbers */}
                                  <div className="p-2 space-y-1 font-mono text-[11px]">
                                    {res.matches.slice(0, 5).map((match, mIdx) => (
                                      <div
                                        key={mIdx}
                                        className="flex items-start gap-2 hover:bg-slate-900/80 px-2 py-1 rounded transition-colors group"
                                      >
                                        <span className="text-slate-400 select-none text-[10px] w-8 text-right shrink-0 pt-0.5">
                                          L{match.lineNumber}
                                        </span>
                                        <span className="text-slate-300 whitespace-pre-wrap break-all flex-1">
                                          {match.lineContent}
                                        </span>
                                      </div>
                                    ))}
                                    {res.matches.length > 5 && (
                                      <div className="text-[10px] text-slate-400 pt-1 pl-10">
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
                      <div className="p-8 text-center rounded-lg bg-slate-950/30 border border-slate-800/40">
                        <Search className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                        <p className="text-xs font-medium text-slate-300 mb-1">
                          Search Across Ingested Code
                        </p>
                        <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-relaxed">
                          Type any identifier, question, or keyword above to find matching code snippets
                          and file locations.
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
