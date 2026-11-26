import React from 'react';
import {
  Settings2,
  CheckCircle2,
  Clock,
  Sparkles,
  Cpu,
  Layers,
  Terminal,
  ExternalLink,
  ShieldCheck,
  FileCode,
  HardDrive,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function SettingsView() {
  const { files, projectName, storageStatus } = useWorkspace();

  const totalLines = files.reduce((acc, f) => acc + f.lineCount, 0);
  const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalSizeKb = (totalSizeBytes / 1024).toFixed(1);

  const featuresComparison = [
    {
      category: 'Code Ingestion & Filesystem',
      implemented: [
        'Client-side multi-file parser (.js, .jsx, .ts, .tsx, .py, .java, .html, .css, .json, .md)',
        'In-memory file store with safe sandboxing',
        'Direct file removal & workspace selection reset',
        'Interactive code inspector with line numbering and clipboard copy',
      ],
      planned: [
        'Directory tree recursive walking (Milestone 2)',
        'Direct GitHub repository cloning via API token (Milestone 2)',
        'Local file watching with automatic hot reload (Milestone 2)',
      ],
    },
    {
      category: 'Search & Understanding',
      implemented: [
        'Local keyword & token search engine',
        'Line-by-line snippet extraction with context',
        'Ranking matching files by keyword density',
        'Zero-mock, honest empty state handling',
      ],
      planned: [
        'Abstract Syntax Tree (AST) symbol & dependency extraction (Milestone 2)',
        'Local client-side vector embeddings with Wasm indexer (Milestone 2)',
        'Full Semantic Search & hybrid lexical/dense retrieval (Milestone 2)',
      ],
    },
    {
      category: 'AI Assistant & Explanations',
      implemented: [
        'Honest local preview search interface',
        'No mock LLM answers or fake generative hallucinations',
      ],
      planned: [
        'Configurable LLM provider integration (Claude, Gemini, OpenAI) (Milestone 3)',
        'Retrieval-Augmented Generation (RAG) conversational codebase assistant (Milestone 3)',
        'Technical interview question & test case generator (Milestone 3)',
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#0c0d12] text-slate-200">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="border-b border-slate-800/80 pb-6">
          <div className="flex items-center gap-2 mb-1.5">
            <Settings2 className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              System Specifications
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-sans">
            Product Settings & Roadmap
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Overview of FORGE architecture, runtime diagnostic information, and engineering roadmap.
          </p>
        </div>

        {/* Product Identity & Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="p-5 rounded-xl bg-[#11131c] border border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-400 uppercase block mb-1">
              Product Name
            </span>
            <div className="text-lg font-bold text-slate-100 font-sans">
              FORGE
            </div>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              AI-Powered Codebase Assistant Workspace
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#11131c] border border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-400 uppercase block mb-1">
              Current Milestone
            </span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-emerald-400 font-sans">
                Milestone 1 MVP
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Version 0.1.0-alpha
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#11131c] border border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-400 uppercase block mb-1">
              GitHub Repository
            </span>
            <a
              href="https://github.com/AnishPatra04/Forge"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-mono mt-0.5 truncate"
            >
              <span>AnishPatra04/Forge</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Branch: main
            </p>
          </div>
        </div>

        {/* Project Description */}
        <div className="p-6 rounded-xl bg-[#11131c] border border-slate-800/80 space-y-3">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Project Description & Vision
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
            FORGE is being engineered as an intelligent codebase assistant designed to solve a fundamental
            developer problem: navigating, grokking, and explaining complex, unfamiliar software architectures.
            Through a staged delivery across three milestones, FORGE evolves from a lightweight, private
            in-browser file explorer and keyword inspector into a sophisticated RAG-powered developer assistant.
          </p>
          <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800/70 text-xs text-slate-400 leading-relaxed font-mono">
            "FORGE treats your codebase as structured knowledge, bridging the gap between raw source files and deep semantic comprehension."
          </div>
        </div>

        {/* Implemented vs Planned Features Matrix */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              Feature Implementation Matrix
            </h2>
            <span className="text-xs font-mono text-slate-400">Milestone 1 vs Future Milestones</span>
          </div>

          <div className="space-y-4">
            {featuresComparison.map((group, idx) => (
              <div
                key={idx}
                className="rounded-xl bg-[#11131c] border border-slate-800/80 overflow-hidden"
              >
                <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800 font-semibold text-xs text-slate-200">
                  {group.category}
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                  {/* Implemented in Milestone 1 */}
                  <div>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400 font-medium mb-3 uppercase tracking-wider">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Implemented in Current Milestone
                    </div>
                    <ul className="space-y-2">
                      {group.implemented.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-slate-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Planned for Milestone 2 & 3 */}
                  <div>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-400 font-medium mb-3 uppercase tracking-wider">
                      <Clock className="w-3.5 h-3.5" /> Planned for Milestones 2 & 3
                    </div>
                    <ul className="space-y-2">
                      {group.planned.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-slate-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-600 mt-1.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Runtime Diagnostics */}
        <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800/70 text-xs space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            Runtime Diagnostics & Sandbox Status
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px] text-slate-300">
            <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Loaded Files</span>
              <span>{files.length}</span>
            </div>
            <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Lines Scanned</span>
              <span>{totalLines.toLocaleString()} LOC</span>
            </div>
            <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Memory Allocated</span>
              <span>{totalSizeKb} KB</span>
            </div>
            <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Sandbox Environment</span>
              {storageStatus === 'ready' ? (
                <span className="text-emerald-400">IndexedDB (Persistent)</span>
              ) : storageStatus === 'unavailable' ? (
                <span className="text-amber-400">Client Memory (IndexedDB Unavailable)</span>
              ) : storageStatus === 'error' ? (
                <span className="text-red-400">Client Memory (Storage Error)</span>
              ) : (
                <span className="text-slate-400">Checking Storage...</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
