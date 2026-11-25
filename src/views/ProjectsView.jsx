import React from 'react';
import {
  FolderGit2,
  FileCode,
  Download,
  Plus,
  GitBranch,
  Calendar,
  Layers,
  ArrowRight,
  ExternalLink,
  HardDrive,
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
    <div className="flex-1 overflow-y-auto bg-[#0c0d12] text-slate-200">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="border-b border-slate-800/80 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <FolderGit2 className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                Project Registry
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-sans">
              Projects & Manifests
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Manage your local codebase sessions and export project metadata.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={exportManifest}
              disabled={files.length === 0}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                files.length === 0
                  ? 'bg-slate-900 text-slate-400 border-slate-800 cursor-not-allowed'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Export Manifest</span>
            </button>

            <button
              onClick={openGitHubModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Import from GitHub</span>
            </button>
          </div>
        </div>

        {/* Active Project Card */}
        <div className="p-6 rounded-xl bg-[#11131c] border border-slate-800/80 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <FolderGit2 className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-100">{projectName}</h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Active Session
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  Origin:{' '}
                  {projectSource?.type === 'github'
                    ? `GitHub Public Repo (${projectSource.owner}/${projectSource.repo} • ${projectSource.branch})`
                    : projectSource?.type === 'sample'
                      ? 'Built-in Sample Reference Codebase'
                      : 'Local In-Memory Workspace'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('workspace')}
              className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors w-fit"
            >
              <span>Open in Workspace</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-5 border-b border-slate-800 text-xs">
            <div>
              <span className="text-slate-400 block text-[11px] font-mono uppercase mb-0.5">
                Total Files
              </span>
              <span className="text-base font-bold text-slate-200 font-mono">{files.length}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px] font-mono uppercase mb-0.5">
                Total Code Volume
              </span>
              <span className="text-base font-bold text-slate-200 font-mono">
                {totalLines.toLocaleString()} LOC
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px] font-mono uppercase mb-0.5">
                Size on Memory
              </span>
              <span className="text-base font-bold text-slate-200 font-mono">{totalSizeKb} KB</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px] font-mono uppercase mb-0.5">
                Git Remote
              </span>
              {projectSource?.type === 'github' ? (
                <a
                  href={projectSource.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:underline flex items-center gap-1 font-mono truncate"
                >
                  <span>{projectSource.owner}/{projectSource.repo}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-xs text-slate-400 font-mono">Local session (no remote)</span>
              )}
            </div>
          </div>

          {/* Files breakdown in project */}
          <div className="pt-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono mb-3">
              Included Files ({files.length})
            </h3>
            {files.length === 0 ? (
              <div className="p-6 text-center rounded-lg bg-slate-900/40 border border-slate-800 text-xs text-slate-400">
                No files loaded yet. Switch to the Workspace tab to import your codebase.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {files.map((file) => {
                  const cfg = EXTENSION_CONFIG[file.extension] || {
                    label: file.extension,
                    color: 'text-slate-400 border-slate-700 bg-slate-800',
                  };
                  return (
                    <div
                      key={file.id}
                      className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-2 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span
                          className="text-xs font-mono text-slate-200 truncate font-medium"
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
                          className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
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

        {/* Future Capabilities Preview */}
        <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800/70 text-xs text-slate-400 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200 mb-1">
              Public GitHub Repository Ingestion
            </h3>
            <p className="leading-relaxed max-w-xl">
              Import any public GitHub repository directly into your in-memory workspace with preserved
              folder paths, branch selection, and client-side size/rate-limit safeguards.
            </p>
          </div>
          <button
            onClick={openGitHubModal}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-mono underline shrink-0 mt-1"
          >
            Import Repository
          </button>
        </div>
      </div>
    </div>
  );
}
