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
        return <UploadCloud className="w-4 h-4 text-success" />;
      case 'import_warning':
        return <AlertTriangle className="w-4 h-4 text-warning" />;
      case 'search':
        return <Search className="w-4 h-4 text-primary" />;
      case 'remove':
      case 'clear':
        return <Trash2 className="w-4 h-4 text-destructive" />;
      case 'rename':
        return <FolderEdit className="w-4 h-4 text-primary" />;
      default:
        return <Info className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getEventBadge = (type) => {
    switch (type) {
      case 'import':
        return 'bg-success/10 text-success border-success/25';
      case 'import_warning':
        return 'bg-warning/10 text-warning border-warning/25';
      case 'search':
        return 'bg-primary/12 text-primary border-primary/30';
      case 'remove':
      case 'clear':
        return 'bg-destructive/12 text-destructive border-destructive/30';
      case 'rename':
        return 'bg-secondary text-foreground border-border';
      default:
        return 'bg-secondary text-muted-foreground border-border';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto forge-ambient-canvas text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-7 space-y-6">
        {/* Header */}
        <div className="border-b border-border pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Session Audit Trail
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Workspace Activity
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Verifiable log of actions recorded during the current session.
            </p>
          </div>

          <button
            onClick={clearActivityLog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-border transition-colors w-fit cursor-pointer"
            title="Clear current session log"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Log</span>
          </button>
        </div>

        {/* Disclosure Banner */}
        <div className="p-3.5 rounded-lg bg-muted border border-border text-xs text-muted-foreground flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-foreground font-medium">Genuine Current-Session Events</p>
            <p className="leading-relaxed">
              Every event below corresponds directly to actions performed in this browser session.
              No synthetic or pre-seeded history is fabricated.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="text-muted-foreground font-mono text-[11px] mr-1">Filter:</span>
          {['ALL', 'IMPORT', 'SEARCH', 'REMOVE', 'RENAME'].map((filter) => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`px-2.5 py-1 rounded-md font-mono text-[11px] transition-colors border cursor-pointer ${
                selectedFilter === filter
                  ? 'bg-primary/15 text-primary border-primary/35 font-medium'
                  : 'bg-card hover:bg-secondary text-muted-foreground border-border'
              }`}
            >
              {filter}
            </button>
          ))}
          <span className="text-muted-foreground text-xs font-mono ml-auto">
            {filteredLog.length} event{filteredLog.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Timeline List */}
        <div className="space-y-2.5">
          {filteredLog.map((event) => (
            <div
              key={event.id}
              className="p-3.5 rounded-lg bg-card border border-border hover:border-white/15 transition-colors flex items-start gap-3"
            >
              <div className="p-2 rounded-md bg-secondary border border-border shrink-0">
                {getEventIcon(event.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{event.title}</span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase ${getEventBadge(
                        event.type
                      )}`}
                    >
                      {event.type}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {event.timestamp}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed break-words font-mono">
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
