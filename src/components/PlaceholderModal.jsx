import React from 'react';
import { X, Construction, Calendar, ArrowRight, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function PlaceholderModal() {
  const { placeholderModal, closePlaceholder } = useWorkspace();

  if (!placeholderModal || !placeholderModal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#12141d] border border-slate-700/80 rounded-xl shadow-2xl max-w-md w-full overflow-hidden p-6 text-slate-200">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Construction className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {placeholderModal.featureName}
              </h3>
              <p className="text-xs text-indigo-400 font-mono mt-0.5">
                Scheduled for {placeholderModal.targetMilestone || 'Milestone 2'}
              </p>
            </div>
          </div>
          <button
            onClick={closePlaceholder}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 text-xs text-slate-400 leading-relaxed space-y-2 border-t border-slate-800/80 pt-4">
          <p>
            This feature is deliberately not implemented in the Milestone 1 MVP to maintain a clean, lightweight, client-side architecture without mock facades.
          </p>
          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] space-y-1.5">
            <div className="flex items-center gap-2 text-slate-300 font-medium">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span>Roadmap Timeline:</span>
            </div>
            <ul className="list-disc list-inside text-slate-400 space-y-1 pl-1">
              <li><strong className="text-slate-300">Milestone 1 (Current):</strong> Local file ingestion, code viewer & keyword search.</li>
              <li><strong className="text-slate-300">Milestone 2:</strong> AST parsing, Git remote clone & local vector embeddings.</li>
              <li><strong className="text-slate-300">Milestone 3:</strong> LLM reasoning backend, conversational RAG & architectural diagrams.</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={closePlaceholder}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
}
