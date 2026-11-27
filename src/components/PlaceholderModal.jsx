import React from 'react';
import { X, Construction, Calendar } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function PlaceholderModal() {
  const { placeholderModal, closePlaceholder } = useWorkspace();

  if (!placeholderModal || !placeholderModal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div className="forge-dialog bg-card border border-white/14 rounded-xl shadow-[inset_0_1px_0_rgba(242,243,237,0.09),0_28px_70px_-15px_rgba(0,0,0,0.92)] max-w-md w-full overflow-hidden p-6 text-foreground">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-secondary border border-border text-primary">
              <Construction className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {placeholderModal.featureName}
              </h3>
              <p className="text-[11px] text-primary font-mono mt-0.5">
                Scheduled for {placeholderModal.targetMilestone || 'Milestone 2'}
              </p>
            </div>
          </div>
          <button
            onClick={closePlaceholder}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-secondary transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 text-xs text-muted-foreground leading-relaxed space-y-3 border-t border-border pt-4">
          <p>
            This capability is planned for a future release and is intentionally kept out of the current workspace shell without mock facades.
          </p>
          <div className="p-3 rounded-md bg-muted border border-border text-[11px] space-y-1.5">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span>Roadmap Milestones</span>
            </div>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
              <li><strong className="text-foreground">Phase 1–3:</strong> AST parsing, Dependency Graph, GitHub ingestion, Hybrid Search & Local Embeddings.</li>
              <li><strong className="text-foreground">Phase 4:</strong> Grounded AI Assistant (RAG) & AI Code Review via Gemini.</li>
              <li><strong className="text-foreground">Next:</strong> Multi-workspace switching & live Git sync.</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={closePlaceholder}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-border transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
