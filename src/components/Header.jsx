import React from 'react';
import { HardDrive, Files, PanelLeft } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function Header({ isSidebarCollapsed = false, onToggleSidebar }) {
  const { activeTab, projectName, files } = useWorkspace();

  const tabLabels = {
    workspace: 'Workspace',
    assistant: 'AI Codebase Assistant',
    graph: 'Project Dependency Graph',
    projects: 'Project Inventory',
    activity: 'Audit Activity Log',
    settings: 'Settings & Roadmap',
  };

  const totalLines = files.reduce((acc, f) => acc + f.lineCount, 0);
  const totalKb = (files.reduce((acc, f) => acc + f.size, 0) / 1024).toFixed(1);

  return (
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between shrink-0 select-none z-10">
      {/* Left Area: Sidebar Toggle & Breadcrumb Navigation */}
      <div className="flex items-center gap-2.5 min-w-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent hover:border-border transition-colors cursor-pointer shrink-0"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle Sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        <div className="h-4 w-px bg-border max-sm:hidden shrink-0" />

        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="font-mono text-muted-foreground/80 font-medium hidden sm:inline">
            FORGE
          </span>
          <span className="text-border hidden sm:inline">/</span>
          <span className="font-medium text-foreground truncate">
            {tabLabels[activeTab] || 'Workspace'}
          </span>
          <span className="text-border">•</span>
          <span className="font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 truncate max-w-[120px] sm:max-w-xs text-[11px]">
            {projectName}
          </span>
        </div>
      </div>

      {/* Right Area: Metrics Pills & GitHub Repository */}
      <div className="flex items-center gap-3">
        {files.length > 0 && (
          <div className="hidden md:flex items-center gap-2.5 text-xs font-mono text-muted-foreground bg-secondary/50 px-3 py-1 rounded-lg border border-border shadow-xs">
            <span className="flex items-center gap-1.5">
              <Files className="w-3.5 h-3.5 text-primary" />
              <span>{files.length} files</span>
            </span>
            <span className="text-border">•</span>
            <span>{totalLines.toLocaleString()} LOC</span>
            <span className="text-border">•</span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-primary" />
              <span>{totalKb} KB</span>
            </span>
          </div>
        )}

        <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Local Sandbox</span>
        </div>

        <a
          href="https://github.com/AnishPatra04/Forge"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-all px-2.5 py-1 rounded-lg border border-border bg-secondary/40 hover:bg-accent hover:border-border/80 shadow-xs cursor-pointer"
        >
          <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
          <span className="font-mono text-[11px] hidden sm:inline">AnishPatra04/Forge</span>
        </a>
      </div>
    </header>
  );
}
