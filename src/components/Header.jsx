import React from 'react';
import { HardDrive, Files, ExternalLink } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function Header() {
  const { activeTab, projectName, files } = useWorkspace();

  const tabLabels = {
    workspace: 'Workspace',
    projects: 'Project Inventory',
    activity: 'Audit Activity Log',
    settings: 'Settings & Roadmap',
  };

  const totalLines = files.reduce((acc, f) => acc + f.lineCount, 0);
  const totalKb = (files.reduce((acc, f) => acc + f.size, 0) / 1024).toFixed(1);

  return (
    <header className="h-14 border-b border-slate-800/80 bg-[#0b0d14]/80 backdrop-blur-md px-6 flex items-center justify-between shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-slate-400">FORGE</span>
        <span className="text-slate-400 text-xs">/</span>
        <span className="text-xs font-medium text-slate-200">
          {tabLabels[activeTab] || 'Workspace'}
        </span>
        <span className="text-slate-400 text-xs">•</span>
        <span className="text-xs text-indigo-400 font-mono truncate max-w-xs">
          {projectName}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {files.length > 0 && (
          <div className="hidden md:flex items-center gap-3 text-xs font-mono text-slate-400 bg-slate-900/60 px-3 py-1 rounded-md border border-slate-800">
            <span className="flex items-center gap-1.5">
              <Files className="w-3.5 h-3.5 text-slate-400" />
              {files.length} files
            </span>
            <span>•</span>
            <span>{totalLines.toLocaleString()} LOC</span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-slate-400" />
              {totalKb} KB
            </span>
          </div>
        )}

        <a
          href="https://github.com/AnishPatra04/Forge"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-2.5 py-1 rounded border border-slate-800 hover:border-slate-700 bg-slate-900/40"
        >
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          <span className="font-mono">AnishPatra04/Forge</span>
        </a>
      </div>
    </header>
  );
}
