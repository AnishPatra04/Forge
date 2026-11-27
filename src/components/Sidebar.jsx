import React from 'react';
import {
  LayoutDashboard,
  Bot,
  ShieldAlert,
  GitCompareArrows,
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
  FlaskConical,
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
    testSuiteResult,
    activityLog,
    loadSampleProject,
    openPlaceholder,
    isRestoringWorkspace,
  } = useWorkspace();

  const navGroups = [
    {
      label: 'Explore',
      items: [
        {
          id: 'workspace',
          label: 'Workspace',
          icon: LayoutDashboard,
          badge: files.length > 0 ? `${files.length}` : null,
          desc: 'Active code exploration',
        },
        {
          id: 'graph',
          label: 'Project Graph',
          icon: Network,
          badge: null,
          desc: 'Spatial dependency visualization',
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
      ],
    },
    {
      label: 'Intelligence',
      items: [
        {
          id: 'assistant',
          label: 'AI Assistant',
          icon: Bot,
          badge: 'RAG',
          desc: 'Grounded codebase Q&A',
        },
        {
          id: 'review',
          label: 'Code Review',
          icon: ShieldAlert,
          badge: 'AI',
          desc: 'Bugs, security & quality audit',
        },
        {
          id: 'impact',
          label: 'Change Impact',
          icon: GitCompareArrows,
          badge: 'SIM',
          desc: 'Blast radius & dependency simulation',
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
          id: 'tests',
          label: 'Test Cases',
          icon: FlaskConical,
          badge:
            files.length > 0 && testSuiteResult?.plan?.summary?.totalTargets > 0
              ? `${testSuiteResult.plan.summary.totalTargets}`
              : null,
          desc: 'Review-gated draft test suites',
        },
      ],
    },
    {
      label: 'System',
      items: [
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
      ],
    },
  ];

  return (
    <aside
      className={`bg-sidebar border-r border-sidebar-border flex flex-col justify-between select-none h-screen shrink-0 transition-[width] duration-200 ease-out ${
        isCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Top Brand & Navigation */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div
          className={`h-14 border-b border-sidebar-border flex items-center shrink-0 ${
            isCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-b from-[#252E24] to-[#141A15] border border-white/12 shadow-[inset_0_1px_0_rgba(197,244,103,0.22),0_4px_12px_rgba(0,0,0,0.5)] flex items-center justify-center shrink-0">
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 text-primary"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 21 8 12 14 3 8" fill="rgba(197,244,103,0.2)" stroke="currentColor" />
                <polygon points="12 14 21 8 21 16 12 22" fill="rgba(197,244,103,0.05)" stroke="currentColor" />
                <polygon points="12 14 3 8 3 16 12 22" fill="rgba(197,244,103,0.11)" stroke="currentColor" />
              </svg>
            </div>

            {!isCollapsed && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-display font-bold text-[15px] tracking-[0.06em] text-foreground truncate">
                  FORGE
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground bg-secondary border border-border">
                  0.1
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Grouped Navigation */}
        <div className="p-2.5 space-y-5">
          {navGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              {!isCollapsed && (
                <p className="px-2.5 pb-0.5 text-[11px] font-medium text-muted-foreground/70">
                  {group.label}
                </p>
              )}

              <nav className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      title={isCollapsed ? `${item.label} — ${item.desc}` : undefined}
                      className={`w-full flex items-center rounded-lg text-[13px] transition-all duration-150 cursor-pointer group relative ${
                        isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
                      } ${
                        isActive
                          ? 'bg-gradient-to-b from-[#232B23] to-[#181E19] text-foreground font-medium border border-white/12 shadow-[inset_0_1px_0_rgba(242,243,237,0.08),0_4px_12px_-6px_rgba(0,0,0,0.8)]'
                          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70 border border-transparent'
                      }`}
                    >
                      {isActive && !isCollapsed && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-primary" />
                      )}

                      <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
                        <Icon
                          className={`w-4 h-4 transition-colors shrink-0 ${
                            isActive
                              ? 'text-primary'
                              : 'text-muted-foreground group-hover:text-foreground'
                          }`}
                        />
                        {!isCollapsed && <span>{item.label}</span>}
                      </div>

                      {!isCollapsed && item.badge && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                            isActive
                              ? 'bg-primary/15 text-primary border border-primary/30'
                              : 'bg-secondary text-muted-foreground border border-border'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}

                      {isCollapsed && item.badge && (
                        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* Active Workspace Card */}
        <div className="px-2.5 pb-3 mt-auto">
          {!isCollapsed ? (
            <div className="space-y-2 pt-3 border-t border-sidebar-border">
              <div className="flex items-center justify-between px-2">
                <span className="text-[11px] font-medium text-muted-foreground/75">
                  Active Workspace
                </span>
                <button
                  onClick={() => openPlaceholder('Multi-Project Switching & Git Sync', 'Milestone 2')}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-sidebar-accent transition-colors cursor-pointer"
                  title="Add or link another repository"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-3 rounded-lg forge-panel">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                  <span className="text-xs font-medium text-foreground truncate" title={projectName}>
                    {projectName}
                  </span>
                </div>

                <div className="mt-2.5 pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-mono">
                    {files.length} file{files.length === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={() => setActiveTab('workspace')}
                    className="text-primary hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
                  >
                    <span>Inspect</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {!isRestoringWorkspace && files.length === 0 && (
                <button
                  onClick={loadSampleProject}
                  className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-primary hover:bg-[#D2FA81] text-primary-foreground flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load Sample Codebase</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center pt-2 border-t border-sidebar-border">
              <button
                onClick={() => setActiveTab('workspace')}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent border border-border relative cursor-pointer"
                title={`Active: ${projectName} (${files.length} files)`}
              >
                <Folder className="w-4 h-4 text-primary" />
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-success" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-2.5 border-t border-sidebar-border space-y-2 shrink-0">
        {!isCollapsed ? (
          <>
            <div className="px-2.5 py-2 rounded-lg bg-muted border border-border flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-primary" />
                <span>Engine</span>
              </span>
              <span className="text-success font-mono text-[10px]">Ready</span>
            </div>

            <div className="flex items-center justify-between px-2 text-[11px] text-muted-foreground font-mono">
              <span className="opacity-70">v0.1.0-alpha</span>
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
            <span className="w-2 h-2 rounded-full bg-success" title="Engine Ready" />
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
