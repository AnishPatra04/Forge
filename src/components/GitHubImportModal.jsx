import React, { useState, useEffect } from 'react';
import { X, FolderGit2, GitBranch, AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { MAX_FILE_SIZE_BYTES, MAX_REPO_FILES, MAX_TOTAL_BYTES } from '../utils/githubClient.js';

function GitHubImportModalContent() {
  const {
    files,
    closeGitHubModal,
    importFromGitHub,
    cancelGitHubImport,
    githubImportState,
  } = useWorkspace();

  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [replaceWorkspace, setReplaceWorkspace] = useState(true);

  const isBusy = githubImportState.status === 'fetching' || githubImportState.status === 'parsing';
  const { progress, error } = githubImportState;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeGitHubModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeGitHubModal]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isBusy) return;
    await importFromGitHub({
      url: repoUrl,
      branch,
      replaceWorkspace: files.length === 0 ? true : replaceWorkspace,
    });
  };

  const progressPercent =
    progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  const phaseLabels = {
    metadata: 'Checking repository metadata...',
    branch: `Resolving branch ${progress.currentPath || ''}...`,
    tree: 'Scanning repository file tree...',
    fetching: `Downloading files (${progress.completed} / ${progress.total})...`,
    parsing: `Parsing AST (${progress.completed} / ${progress.total})...`,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#12141d] border border-slate-700/80 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden p-6 text-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Import GitHub Repository
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Fetch supported source files from any public GitHub repository.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeGitHubModal}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Public Repository URL or <span className="font-mono text-indigo-400">owner/repo</span>
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isBusy}
              autoFocus
              placeholder="https://github.com/AnishPatra04/Forge or owner/repo"
              className="w-full bg-[#0a0c12] border border-slate-700/80 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] font-mono text-slate-400">Example:</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setRepoUrl('https://github.com/AnishPatra04/Forge')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-mono text-[10px] transition-colors disabled:opacity-50"
              >
                AnishPatra04/Forge
              </button>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
              <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
              <span>Branch (optional)</span>
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={isBusy}
              placeholder="Auto-detect default branch (supports feature/login)"
              className="w-full bg-[#0a0c12] border border-slate-700/80 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          {files.length > 0 && (
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
              <span className="block text-[11px] font-mono uppercase text-slate-400">
                Workspace Import Mode
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setReplaceWorkspace(true)}
                  className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                    replaceWorkspace
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-200 font-medium'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div>Replace Workspace</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Start fresh with this repo</div>
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setReplaceWorkspace(false)}
                  className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                    !replaceWorkspace
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-200 font-medium'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div>Merge Files</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Keep existing duplicate paths</div>
                </button>
              </div>
            </div>
          )}

          {/* Safeguards Notice */}
          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              Public repos only • Max {MAX_REPO_FILES} supported files •{' '}
              {Math.round(MAX_FILE_SIZE_BYTES / 1024)} KB/file •{' '}
              {Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB total limit • Skips{' '}
              <span className="font-mono text-slate-300">node_modules</span>, lockfiles, and build outputs.
            </span>
          </div>

          {/* Live Progress */}
          {isBusy && (
            <div className="p-3 rounded-lg bg-slate-950/70 border border-indigo-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-indigo-300 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {phaseLabels[progress.phase] || 'Importing repository...'}
                </span>
                {progress.total > 0 && (
                  <span className="font-mono text-[11px] text-slate-400">{progressPercent}%</span>
                )}
              </div>
              {progress.total > 0 && (
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-150"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
              {progress.currentPath && (
                <p className="text-[10px] font-mono text-slate-400 truncate" title={progress.currentPath}>
                  {progress.currentPath}
                </p>
              )}
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-lg bg-red-950/30 border border-red-900/60 text-xs text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            {isBusy ? (
              <button
                type="button"
                onClick={cancelGitHubImport}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-red-950/40 hover:bg-red-950/70 text-red-300 border border-red-900/60 transition-colors"
              >
                Cancel Import
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={closeGitHubModal}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!repoUrl.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                >
                  Import Repository
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export function GitHubImportModal() {
  const { isGitHubModalOpen } = useWorkspace();
  if (!isGitHubModalOpen) return null;
  return <GitHubImportModalContent />;
}
