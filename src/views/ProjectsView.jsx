import React from 'react';
import {
  FolderGit2,
  FileCode,
  Download,
  Plus,
  ArrowRight,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { EXTENSION_CONFIG } from '../constants/fileTypes';

export function ProjectsView() {
  const {
    projectName,
    files,
    setActiveTab,
    setSelectedFile,
    openGitHubModal,
    projectSource,
    isRestoringWorkspace,
  } = useWorkspace();

  const totalLines = files.reduce((acc, f) => acc + f.lineCount, 0);
  const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalSizeKb = (totalSizeBytes / 1024).toFixed(1);

  const exportManifest = () => {
    const manifest = {
      product: 'FORGE Codebase Assistant',
      version: '0.1.0',
      exportedAt: new Date().toISOString(),
      projectName,
      source: projectSource,
      stats: {
        totalFiles: files.length,
        totalLines,
        totalSizeKb,
      },
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path || f.name,
        extension: f.extension,
        size: f.size,
        lineCount: f.lineCount,
      })),
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.toLowerCase().replace(/\s+/g, '-')}-manifest.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto forge-ambient-canvas text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-7 space-y-6">
        {/* Header */}
        <div className="border-b border-border pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FolderGit2 className="w-4 h-4 text-primary" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Project Registry
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Projects & Manifests
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Manage your active codebase session and export structured project metadata.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportManifest}
              disabled={files.length === 0}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium border transition-colors ${
                files.length === 0
                  ? 'bg-muted text-muted-foreground border-border cursor-not-allowed opacity-60'
                  : 'bg-secondary hover:bg-accent text-foreground border-border cursor-pointer'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              <span>Export Manifest</span>
            </button>

            <button
              onClick={openGitHubModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-primary hover:bg-[#D2FA81] text-primary-foreground transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Import from GitHub</span>
            </button>
          </div>
        </div>

        {/* Active Project Card */}
        <div className="p-5 rounded-xl forge-panel">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-secondary border border-border flex items-center justify-center text-primary">
                <FolderGit2 className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">{projectName}</h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-success/10 text-success border border-success/25">
                    Active Session
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  Origin:{' '}
                  {projectSource?.type === 'github'
                    ? `GitHub Public Repo (${projectSource.owner}/${projectSource.repo} · ${projectSource.branch})`
                    : projectSource?.type === 'sample'
                      ? 'Built-in Sample Reference Codebase'
                      : 'Local Browser Workspace'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('workspace')}
              className="flex items-center gap-1.5 text-xs text-primary hover:bg-primary/15 font-medium px-3 py-1.5 rounded-md bg-primary/10 border border-primary/30 transition-colors w-fit cursor-pointer"
            >
              <span>Open in Workspace</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-b border-border text-xs">
            <div>
              <span className="text-muted-foreground block text-[10px] font-mono uppercase mb-0.5">
                Total Files
              </span>
              <span className="text-base font-semibold text-foreground font-mono">{files.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] font-mono uppercase mb-0.5">
                Total Code Volume
              </span>
              <span className="text-base font-semibold text-foreground font-mono">
                {totalLines.toLocaleString()} LOC
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] font-mono uppercase mb-0.5">
                Size in Memory
              </span>
              <span className="text-base font-semibold text-foreground font-mono">{totalSizeKb} KB</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] font-mono uppercase mb-0.5">
                Git Remote
              </span>
              {projectSource?.type === 'github' ? (
                <a
                  href={projectSource.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 font-mono truncate"
                >
                  <span>{projectSource.owner}/{projectSource.repo}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-xs text-muted-foreground font-mono">Local session (no remote)</span>
              )}
            </div>
          </div>

          {/* Files breakdown */}
          <div className="pt-4">
            <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider font-mono mb-3">
              Included Files ({files.length})
            </h3>
            {isRestoringWorkspace && files.length === 0 ? (
              <div className="p-6 text-center rounded-md bg-muted border border-border text-xs text-muted-foreground">
                Restoring saved workspace from browser storage...
              </div>
            ) : files.length === 0 ? (
              <div className="p-6 text-center rounded-md bg-muted border border-border text-xs text-muted-foreground">
                No files loaded yet. Switch to the Workspace tab to import your codebase.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {files.map((file) => {
                  const cfg = EXTENSION_CONFIG[file.extension] || {
                    label: file.extension,
                    color: 'text-muted-foreground border-border bg-secondary',
                  };
                  return (
                    <div
                      key={file.id}
                      className="p-2.5 rounded-md bg-muted border border-border flex items-center justify-between gap-2 hover:border-white/15 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span
                          className="text-xs font-mono text-foreground truncate font-medium"
                          title={file.path || file.name}
                        >
                          {file.path || file.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${cfg.color}`}
                        >
                          {cfg.label}
                        </span>
                        <button
                          onClick={() => setSelectedFile(file)}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors cursor-pointer"
                          title="View file"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* GitHub Ingestion Info */}
        <div className="p-4 rounded-lg bg-muted border border-border text-xs text-muted-foreground flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Public GitHub Repository Ingestion
            </h3>
            <p className="leading-relaxed max-w-xl">
              Import any public GitHub repository directly into your workspace with preserved
              folder paths, branch selection, and client-side size/rate-limit safeguards.
            </p>
          </div>
          <button
            onClick={openGitHubModal}
            className="text-xs text-primary hover:underline font-mono shrink-0 mt-1 cursor-pointer"
          >
            Import Repository
          </button>
        </div>
      </div>
    </div>
  );
}
