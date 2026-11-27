import React from 'react';
import {
  LayoutDashboard,
  Bot,
  Network,
  FolderGit2,
  Activity,
  Settings2,
  Plus,
  Sparkles,
  Terminal,
  ExternalLink,
  ChevronRight,
  Folder,
  Layers,
  BookOpen,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function Sidebar({ isCollapsed = false, onToggle: _onToggle }) {
  const {
    activeTab,
    setActiveTab,
    projectName,
    files,
    architectureModel,
    interviewPrep,
    activityLog,
    loadSampleProject,
    openPlaceholder,
    isRestoringWorkspace,
  } = useWorkspace();

  const navItems = [
    {
      id: 'workspace',
      label: 'Workspace',
      icon: LayoutDashboard,
      badge: files.length > 0 ? `${files.length}` : null,
      desc: 'Active code exploration',
    },
    {
      id: 'assistant',
      label: 'AI Assistant',
      icon: Bot,
      badge: 'RAG',
      desc: 'Grounded codebase Q&A',
    },
    {
      id: 'graph',
      label: 'Project Graph',
      icon: Network,
      badge: null,
      desc: 'Visual dependency graph',
    },
    {
      id: 'architecture',
      label: 'Architecture',
      icon: Layers,
      badge:
        files.length > 0 && architectureModel?.summary?.totalModules > 0
          ? `${architectureModel.summary.totalModules}`
          : null,
      desc: 'System architecture diagrams',
    },
    {
      id: 'interview',
      label: 'Interview Prep',
      icon: BookOpen,
      badge:
        files.length > 0 && interviewPrep?.summary?.totalQuestions > 0
          ? `${interviewPrep.summary.totalQuestions}`
          : null,
      desc: 'Technical interview questions',
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
    <aside
      className={`bg-sidebar border-r border-sidebar-border flex flex-col justify-between select-none h-screen shrink-0 transition-all duration-200 ease-in-out ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Top Header / Brand Logo */}
      <div>
        <div
          className={`h-14 border-b border-sidebar-border flex items-center ${
            isCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Preserved Geometric FORGE Logo Mark */}
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 p-0.5 shadow-md shadow-indigo-950/40 flex items-center justify-center shrink-0">
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 21 8 12 14 3 8" fill="rgba(255,255,255,0.2)" stroke="currentColor" />
                <polygon points="12 14 21 8 21 16 12 22" fill="rgba(255,255,255,0.05)" stroke="currentColor" />
                <polygon points="12 14 3 8 3 16 12 22" fill="rgba(255,255,255,0.12)" stroke="currentColor" />
              </svg>
            </div>

            {!isCollapsed && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm tracking-wider text-sidebar-foreground font-mono truncate">
                  FORGE
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-sidebar-accent text-primary border border-sidebar-border">
                  v0.1.0
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Main Navigation Section */}
        <div className="p-2 space-y-1">
          {!isCollapsed && (
            <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 font-mono">
              Platform
            </p>
          )}

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  title={isCollapsed ? `${item.label} (${item.desc})` : undefined}
                  className={`w-full flex items-center rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer group relative ${
                    isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
                  } ${
                    isActive
                      ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/70 border border-transparent'
                  }`}
                >
                  <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
                    <Icon
                      className={`w-4 h-4 transition-colors shrink-0 ${
                        isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-sidebar-foreground'
                      }`}
                    />
                    {!isCollapsed && <span>{item.label}</span>}
                  </div>

                  {!isCollapsed && item.badge && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-medium transition-colors ${
                        isActive
                          ? 'bg-primary/25 text-primary border border-primary/30'
                          : 'bg-sidebar-accent text-muted-foreground border border-sidebar-border group-hover:text-sidebar-foreground'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}

                  {/* Small badge dot in collapsed view */}
                  {isCollapsed && item.badge && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Active Project Section */}
        <div className="p-2 pt-2">
          {!isCollapsed ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-3 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 font-mono">
                  Active Project
                </span>
                <button
                  onClick={() => openPlaceholder('Multi-Project Switching & Git Sync', 'Milestone 2')}
                  className="text-muted-foreground hover:text-sidebar-foreground p-0.5 rounded hover:bg-sidebar-accent transition-colors cursor-pointer"
                  title="Add or link another repository"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-3 rounded-xl bg-sidebar-accent/40 border border-sidebar-border hover:border-sidebar-border/80 transition-all">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-medium text-sidebar-foreground truncate" title={projectName}>
                    {projectName}
                  </span>
                </div>

                <div className="mt-2.5 pt-2 border-t border-sidebar-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-mono">{files.length} file{files.length === 1 ? '' : 's'}</span>
                  <button
                    onClick={() => setActiveTab('workspace')}
                    className="text-primary hover:text-primary/80 flex items-center gap-0.5 font-medium transition-colors cursor-pointer"
                  >
                    <span>Inspect</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {!isRestoringWorkspace && files.length === 0 && (
                <button
                  onClick={loadSampleProject}
                  className="w-full mt-2 py-1.5 px-2.5 rounded-lg text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span>Load Sample Codebase</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center pt-2">
              <button
                onClick={() => setActiveTab('workspace')}
                className="p-2.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent border border-sidebar-border/40 relative cursor-pointer"
                title={`Active: ${projectName} (${files.length} files)`}
              >
                <Folder className="w-4 h-4 text-primary" />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer / System Status Area */}
      <div className="p-2 border-t border-sidebar-border space-y-2">
        {!isCollapsed ? (
          <>
            <div className="p-2.5 rounded-xl bg-sidebar-accent/30 border border-sidebar-border">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                  <Terminal className="w-3.5 h-3.5 text-primary" />
                  Status
                </span>
                <span className="text-emerald-400 font-mono text-[10px] bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  Client Ready
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground/80 mt-1.5 leading-normal font-mono">
                Local Parser & Keyword Engine
              </p>
            </div>

            <div className="flex items-center justify-between px-2 pt-1 text-[11px] text-muted-foreground font-mono">
              <span className="opacity-75">v0.1.0-alpha</span>
              <a
                href="https://github.com/AnishPatra04/Forge"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
              >
                <span>GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-1">
            <span
              className="w-2.5 h-2.5 rounded-full bg-emerald-500"
              title="Client Ready - Local Ingestion Engine"
            />
            <a
              href="https://github.com/AnishPatra04/Forge"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors p-1"
              title="GitHub Repository"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
