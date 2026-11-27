import React from 'react';
import { HardDrive, Files, PanelLeft, FolderGit2, Search, Command } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function Header({ isSidebarCollapsed = false, onToggleSidebar, onOpenCommandPalette }) {
  const { activeTab, projectName, projectSource, files } = useWorkspace();

  const tabLabels = {
    workspace: 'Workspace',
    assistant: 'AI Assistant',
    review: 'Code Review',
    impact: 'Change Impact',
    graph: 'Project Graph',
    architecture: 'Architecture Diagrams',
    interview: 'Interview Prep',
    tests: 'Test Case Generator',
    projects: 'Projects',
    activity: 'Activity',
    settings: 'Settings',
  };

  const totalLines = files.reduce((acc, f) => acc + (f.lineCount || 0), 0);
  const totalKb = (files.reduce((acc, f) => acc + (f.size || 0), 0) / 1024).toFixed(1);
  const isGitHub = projectSource?.type === 'github';

  return (
    <header className="h-14 border-b border-border bg-[#090A0D]/95 px-4 sm:px-6 flex items-center justify-between shrink-0 select-none z-10">
      {/* Left: Sidebar Toggle & Breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent hover:border-border transition-colors cursor-pointer shrink-0"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle Sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        <div className="h-4 w-px bg-border max-sm:hidden shrink-0" />

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs min-w-0">
          <span className="font-semibold text-sm text-foreground tracking-tight truncate">
            {tabLabels[activeTab] || 'Workspace'}
          </span>
          <span className="text-muted-foreground/30">/</span>
          <span
            className="font-mono text-[11px] text-muted-foreground bg-card px-2.5 py-0.5 rounded-md border border-border truncate max-w-[150px] sm:max-w-xs"
            title={projectName}
          >
            {projectName}
          </span>
        </nav>
      </div>

      {/* Middle: Command Palette Quick Trigger */}
      <div className="hidden lg:flex items-center">
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-card hover:bg-secondary border border-border hover:border-white/20 text-xs text-muted-foreground hover:text-foreground transition-all cursor-pointer group shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          title="Open Command Palette (Ctrl+K or Cmd+K)"
        >
          <Search className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="text-[12px]">Jump to command or file...</span>
          <span className="flex items-center gap-0.5 font-mono text-[10px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-white/50">
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </span>
        </button>
      </div>

      {/* Right: Workspace Metrics & Origin Indicator */}
      <div className="flex items-center gap-2.5">
        {onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors cursor-pointer"
            title="Open Command Palette"
          >
            <Search className="w-4 h-4" />
          </button>
        )}

        {files.length > 0 && (
          <div className="hidden md:flex items-center gap-2.5 text-[11px] font-mono text-muted-foreground bg-card px-3 py-1.5 rounded-lg border border-border shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <span className="flex items-center gap-1.5 text-foreground">
              <Files className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{files.length}</span>
            </span>
            <span className="text-border">·</span>
            <span>{totalLines.toLocaleString()} LOC</span>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{totalKb} KB</span>
            </span>
          </div>
        )}

        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-[11px] font-medium text-foreground"
          title={
            isGitHub
              ? `GitHub: ${projectSource.owner}/${projectSource.repo} (${projectSource.branch})`
              : 'Local browser workspace'
          }
        >
          {isGitHub ? (
            <FolderGit2 className="w-3.5 h-3.5 text-white/70" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          )}
          <span className="font-mono text-[11px] text-muted-foreground">
            {isGitHub ? `${projectSource.branch}` : 'Local'}
          </span>
        </div>

        <a
          href="https://github.com/AnishPatra04/Forge"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-secondary cursor-pointer"
        >
          <svg className="w-3.5 h-3.5 fill-current shrink-0 text-white/70" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
          <span className="font-mono text-[11px] hidden sm:inline text-muted-foreground">Forge</span>
        </a>
      </div>
    </header>
  );
}
