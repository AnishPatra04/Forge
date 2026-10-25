import React from 'react';
import {
  LayoutDashboard,
  FolderGit2,
  Activity,
  Settings2,
  Plus,
  Layers,
  Sparkles,
  Terminal,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function Sidebar() {
  const {
    activeTab,
    setActiveTab,
    projectName,
    files,
    activityLog,
    loadSampleProject,
    openPlaceholder,
  } = useWorkspace();

  const navItems = [
    {
      id: 'workspace',
      label: 'Workspace',
      icon: LayoutDashboard,
      badge: files.length > 0 ? `${files.length} files` : null,
      desc: 'Active code exploration',
    },
    {
      id: 'projects',
      label: 'Projects',
      icon: FolderGit2,
      badge: null,
      desc: 'Repositories & manifests',
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: Activity,
      badge: activityLog.length > 0 ? `${activityLog.length}` : null,
      desc: 'Session audit trail',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings2,
      badge: null,
      desc: 'System info & roadmap',
    },
  ];

  return (
    <aside className="w-64 bg-[#090b10] border-r border-slate-800/80 flex flex-col justify-between select-none h-screen shrink-0">
      {/* Brand & Logo */}
      <div>
        <div className="p-5 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Original Geometric FORGE Logo */}
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 p-0.5 shadow-md shadow-indigo-950/40 flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {/* Geometrical forged faceted prism */}
                <polygon points="12 2 21 8 12 14 3 8" fill="rgba(255,255,255,0.2)" stroke="currentColor" />
                <polygon points="12 14 21 8 21 16 12 22" fill="rgba(255,255,255,0.05)" stroke="currentColor" />
                <polygon points="12 14 3 8 3 16 12 22" fill="rgba(255,255,255,0.12)" stroke="currentColor" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-wider text-slate-100 font-mono">
                  FORGE
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  MVP
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">Codebase Assistant</p>
            </div>
          </div>
        </div>

        {/* Navigation Section */}
        <div className="p-3">
          <p className="px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-mono">
            Navigation
          </p>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group ${
                    isActive
                      ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm shadow-indigo-950/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-300'
                      }`}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                        isActive
                          ? 'bg-indigo-500/25 text-indigo-200'
                          : 'bg-slate-800 text-slate-400 group-hover:text-slate-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Recent Projects Section */}
        <div className="p-3 pt-1">
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-mono">
              Active Project
            </span>
            <button
              onClick={() => openPlaceholder('Multi-Project Switching & Git Sync', 'Milestone 2')}
              className="text-slate-400 hover:text-slate-300 p-0.5 rounded transition-colors"
              title="Add or link another repository"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-3 py-2.5 rounded-lg bg-slate-900/60 border border-slate-800/70">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-xs font-medium text-slate-200 truncate" title={projectName}>
                {projectName}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
              <span>{files.length} source file{files.length === 1 ? '' : 's'}</span>
              <button
                onClick={() => setActiveTab('workspace')}
                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
              >
                Inspect <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {files.length === 0 && (
            <button
              onClick={loadSampleProject}
              className="w-full mt-2.5 py-1.5 px-2.5 rounded text-xs font-medium bg-slate-800/50 hover:bg-slate-800 text-indigo-300 border border-slate-700/60 hover:border-indigo-500/40 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Load Sample Codebase
            </button>
          )}
        </div>
      </div>

      {/* Footer / Status Area */}
      <div className="p-3 border-t border-slate-800/60 space-y-2">
        <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/50">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              Status
            </span>
            <span className="text-emerald-400 font-mono text-[10px]">Client Ready</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1 leading-normal">
            Local Ingestion & Keyword Search Engine
          </p>
        </div>

        <div className="flex items-center justify-between px-2 pt-1 text-[11px] text-slate-400 font-mono">
          <span>v0.1.0-alpha</span>
          <a
            href="https://github.com/AnishPatra04/Forge"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-indigo-400 transition-colors"
          >
            <span>GitHub</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </aside>
  );
}
