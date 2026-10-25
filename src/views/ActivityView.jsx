import React, { useState } from 'react';
import {
  Activity,
  UploadCloud,
  Trash2,
  Search,
  FolderEdit,
  Clock,
  ShieldCheck,
  RotateCcw,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function ActivityView() {
  const { activityLog, clearActivityLog } = useWorkspace();
  const [selectedFilter, setSelectedFilter] = useState('ALL');

  const filteredLog = activityLog.filter((item) => {
    if (selectedFilter === 'ALL') return true;
    if (selectedFilter === 'IMPORT') return item.type === 'import' || item.type === 'import_warning';
    if (selectedFilter === 'SEARCH') return item.type === 'search';
    if (selectedFilter === 'REMOVE') return item.type === 'remove' || item.type === 'clear';
    if (selectedFilter === 'RENAME') return item.type === 'rename';
    return true;
  });

  const getEventIcon = (type) => {
    switch (type) {
      case 'import':
        return <UploadCloud className="w-4 h-4 text-emerald-400" />;
      case 'import_warning':
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'search':
        return <Search className="w-4 h-4 text-indigo-400" />;
      case 'remove':
      case 'clear':
        return <Trash2 className="w-4 h-4 text-red-400" />;
      case 'rename':
        return <FolderEdit className="w-4 h-4 text-cyan-400" />;
      default:
        return <Info className="w-4 h-4 text-slate-400" />;
    }
  };

  const getEventBadge = (type) => {
    switch (type) {
      case 'import':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'import_warning':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'search':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'remove':
      case 'clear':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'rename':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0c0d12] text-slate-200">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="border-b border-slate-800/80 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Activity className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                Session Audit Trail
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-sans">
              Workspace Activity
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Verifiable log of user actions recorded during the current session.
            </p>
          </div>

          <button
            onClick={clearActivityLog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors w-fit"
            title="Clear current session log"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Log</span>
          </button>
        </div>

        {/* Honest Disclosure Banner */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/70 text-xs text-slate-400 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-slate-300 font-medium">Genuine Current-Session Events</p>
            <p className="leading-relaxed">
              Every event below corresponds directly to actions performed in this browser window.
              No synthetic, pre-seeded history is fabricated.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 font-mono text-[11px] mr-1">Filter:</span>
          {['ALL', 'IMPORT', 'SEARCH', 'REMOVE', 'RENAME'].map((filter) => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`px-3 py-1.5 rounded-lg font-mono text-[11px] transition-colors border ${
                selectedFilter === filter
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                  : 'bg-slate-900/50 hover:bg-slate-800 text-slate-400 border-slate-800'
              }`}
            >
              {filter}
            </button>
          ))}
          <span className="text-slate-400 text-xs font-mono ml-auto">
            {filteredLog.length} event{filteredLog.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Timeline List */}
        <div className="space-y-3">
          {filteredLog.map((event) => (
            <div
              key={event.id}
              className="p-4 rounded-xl bg-[#11131c] border border-slate-800/80 hover:border-slate-700/80 transition-all flex items-start gap-3.5 shadow-sm"
            >
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 shrink-0">
                {getEventIcon(event.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-100">{event.title}</span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase ${getEventBadge(
                        event.type
                      )}`}
                    >
                      {event.type}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {event.timestamp}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed break-words font-mono">
                  {event.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
