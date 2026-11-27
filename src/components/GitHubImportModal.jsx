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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div className="forge-dialog bg-card border border-white/14 rounded-xl shadow-[inset_0_1px_0_rgba(242,243,237,0.09),0_28px_70px_-15px_rgba(0,0,0,0.92)] max-w-lg w-full overflow-hidden p-6 text-foreground">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-secondary border border-border text-primary">
              <FolderGit2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Import GitHub Repository
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fetch supported source files from any public GitHub repository.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeGitHubModal}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-secondary transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Public Repository URL or <span className="font-mono text-primary">owner/repo</span>
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isBusy}
              autoFocus
              placeholder="https://github.com/AnishPatra04/Forge or owner/repo"
              className="w-full bg-[#131513] border border-border focus:border-primary rounded-md px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] text-muted-foreground">Example:</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setRepoUrl('https://github.com/AnishPatra04/Forge')}
                className="px-2 py-0.5 rounded bg-secondary hover:bg-accent text-foreground border border-border font-mono text-[10px] transition-colors disabled:opacity-50 cursor-pointer"
              >
                AnishPatra04/Forge
              </button>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1.5">
              <GitBranch className="w-3.5 h-3.5 text-primary" />
              <span>Branch (optional)</span>
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={isBusy}
              placeholder="Auto-detect default branch (supports feature/login)"
              className="w-full bg-[#131513] border border-border focus:border-primary rounded-md px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden disabled:opacity-60"
            />
          </div>

          {files.length > 0 && (
            <div className="p-3 rounded-md bg-muted border border-border space-y-2">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Workspace Import Mode
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setReplaceWorkspace(true)}
                  className={`px-3 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                    replaceWorkspace
                      ? 'bg-primary/12 border-primary/40 text-foreground font-medium'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div>Replace Workspace</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Start fresh with this repo</div>
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setReplaceWorkspace(false)}
                  className={`px-3 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                    !replaceWorkspace
                      ? 'bg-primary/12 border-primary/40 text-foreground font-medium'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div>Merge Files</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Keep existing duplicate paths</div>
                </button>
              </div>
            </div>
          )}

          {/* Safeguards Notice */}
          <div className="p-3 rounded-md bg-muted border border-border text-[11px] text-muted-foreground flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span>
              Public repos only · Max {MAX_REPO_FILES} supported files ·{' '}
              {Math.round(MAX_FILE_SIZE_BYTES / 1024)} KB/file ·{' '}
              {Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB total limit · Skips{' '}
              <span className="font-mono text-foreground">node_modules</span>, lockfiles, and build outputs.
            </span>
          </div>

          {/* Live Progress */}
          {isBusy && (
            <div className="p-3 rounded-md bg-[#131513] border border-primary/35 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-primary font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {phaseLabels[progress.phase] || 'Importing repository...'}
                </span>
                {progress.total > 0 && (
                  <span className="font-mono text-[11px] text-muted-foreground">{progressPercent}%</span>
                )}
              </div>
              {progress.total > 0 && (
                <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-150"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
              {progress.currentPath && (
                <p className="text-[10px] font-mono text-muted-foreground truncate" title={progress.currentPath}>
                  {progress.currentPath}
                </p>
              )}
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/35 text-xs text-destructive flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2">
            {isBusy ? (
              <button
                type="button"
                onClick={cancelGitHubImport}
                className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-destructive/15 hover:bg-destructive/25 text-destructive border border-destructive/35 transition-colors cursor-pointer"
              >
                Cancel Import
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={closeGitHubModal}
                  className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-border transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!repoUrl.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary hover:bg-[#D2FA81] disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground transition-colors cursor-pointer"
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
