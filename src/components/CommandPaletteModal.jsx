import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search,
  LayoutDashboard,
  Bot,
  ShieldAlert,
  GitCompareArrows,
  Network,
  Layers,
  BookOpen,
  FlaskConical,
  FolderGit2,
  Activity,
  Settings2,
  FolderDown,
  Sparkles,
  FileCode,
  ArrowRight,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function CommandPaletteModal({ isOpen, onClose }) {
  const {
    activeTab: _activeTab,
    setActiveTab,
    files,
    setSelectedFile,
    openGitHubModal,
    loadSampleProject,
    openPlaceholder,
  } = useWorkspace();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const views = useMemo(
    () => [
      { id: 'workspace', label: 'Workspace & Code Explorer', icon: LayoutDashboard, category: 'Views' },
      { id: 'graph', label: 'Project Graph (Dependencies)', icon: Network, category: 'Views' },
      { id: 'architecture', label: 'Architecture Diagrams', icon: Layers, category: 'Views' },
      { id: 'assistant', label: 'AI Code Assistant (RAG)', icon: Bot, category: 'Views' },
      { id: 'review', label: 'AI Code Review & Audit', icon: ShieldAlert, category: 'Views' },
      { id: 'impact', label: 'Change Impact Simulator', icon: GitCompareArrows, category: 'Views' },
      { id: 'interview', label: 'Interview Question Prep', icon: BookOpen, category: 'Views' },
      { id: 'tests', label: 'Test Case Generator', icon: FlaskConical, category: 'Views' },
      { id: 'projects', label: 'Projects & Manifests', icon: FolderGit2, category: 'Views' },
      { id: 'activity', label: 'Session Activity Log', icon: Activity, category: 'Views' },
      { id: 'settings', label: 'System Settings', icon: Settings2, category: 'Views' },
    ],
    []
  );

  const actions = useMemo(
    () => [
      {
        id: 'action-github',
        label: 'Import from GitHub Repository',
        icon: FolderDown,
        category: 'Actions',
        perform: () => openGitHubModal(),
      },
      {
        id: 'action-sample',
        label: 'Load Sample Codebase',
        icon: Sparkles,
        category: 'Actions',
        perform: () => loadSampleProject(),
      },
      {
        id: 'action-switch',
        label: 'Switch Workspace / Link Repository',
        icon: FolderGit2,
        category: 'Actions',
        perform: () => openPlaceholder('Multi-Project Switching & Git Sync', 'Milestone 2'),
      },
    ],
    [openGitHubModal, loadSampleProject, openPlaceholder]
  );

  const matchedFiles = useMemo(() => {
    if (!query.trim() || files.length === 0) return [];
    const q = query.toLowerCase();
    return files
      .filter((f) => (f.path || f.name).toLowerCase().includes(q))
      .slice(0, 8)
      .map((f) => ({
        id: `file-${f.path || f.name}`,
        label: f.path || f.name,
        icon: FileCode,
        category: 'Files',
        file: f,
        perform: () => {
          setSelectedFile(f);
          setActiveTab('workspace');
        },
      }));
  }, [query, files, setSelectedFile, setActiveTab]);

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) {
      return [...views, ...actions];
    }
    const matchedViews = views.filter((v) => v.label.toLowerCase().includes(q));
    const matchedActions = actions.filter((a) => a.label.toLowerCase().includes(q));
    return [...matchedViews, ...matchedFiles, ...matchedActions];
  }, [query, views, actions, matchedFiles]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const executeItem = useCallback((item) => {
    if (item.perform) {
      item.perform();
    } else if (item.category === 'Views') {
      setActiveTab(item.id);
    }
    onClose();
  }, [setActiveTab, onClose]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filteredItems.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + (filteredItems.length || 1)) % (filteredItems.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filteredItems[selectedIndex];
        if (item) {
          executeItem(item);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose, executeItem]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      {/* Monochromatic backdrop */}
      <div
        className="fixed inset-0 bg-[#08090A]/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette surface */}
      <div className="relative w-full max-w-xl bg-[#111215] border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] overflow-hidden forge-dialog">
        {/* Search header */}
        <div className="flex items-center px-3.5 py-3 border-b border-white/8 gap-2.5">
          <Search className="w-4 h-4 text-white/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, views, or files..."
            className="w-full bg-transparent text-sm text-[#EDEDED] placeholder-white/40 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-white/40 bg-white/5 border border-white/10 rounded">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <div className="max-h-80 overflow-y-auto p-1.5 space-y-0.5">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-white/40 font-mono">
              No matching commands or files
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={`${item.category}-${item.id || item.label}`}
                  onClick={() => executeItem(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                    isSelected
                      ? 'bg-white/10 text-white font-medium border border-white/15'
                      : 'text-white/70 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-white/50'}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-white/40 px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                      {item.category}
                    </span>
                    {isSelected && <ArrowRight className="w-3 h-3 text-white/70" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-3.5 py-2 border-t border-white/8 bg-[#0C0D10] flex items-center justify-between text-[11px] text-white/40 font-mono">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white/5 rounded border border-white/10 text-[10px]">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white/5 rounded border border-white/10 text-[10px]">↵</kbd> select
            </span>
          </div>
          <span>FORGE Engine</span>
        </div>
      </div>
    </div>
  );
}
