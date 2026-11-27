import React from 'react';
import {
  Settings2,
  CheckCircle2,
  Clock,
  Sparkles,
  Cpu,
  Layers,
  ExternalLink,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

export function SettingsView() {
  const { files, storageStatus } = useWorkspace();

  const totalLines = files.reduce((acc, f) => acc + f.lineCount, 0);
  const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalSizeKb = (totalSizeBytes / 1024).toFixed(1);

  const featuresComparison = [
    {
      category: 'Code Ingestion & Persistence',
      implemented: [
        'Client-side multi-file parser (.js, .jsx, .ts, .tsx, .py, .java, .html, .css, .json, .md)',
        'Public GitHub repository ingestion with branch selection and path preservation',
        'IndexedDB workspace and embedding cache persistence',
        'Interactive code viewer with line numbering, highlighting, and clipboard copy',
      ],
      planned: [
        'Multi-workspace project switching',
        'Authenticated private repository sync',
        'Local filesystem watcher integration',
      ],
    },
    {
      category: 'Structural Analysis & Hybrid Search',
      implemented: [
        'Babel AST extraction (functions, classes, variables, imports, exports)',
        'File-to-file dependency mapping and interactive Project Dependency Graph',
        'Hybrid Search combining BM25, AST awareness, and local ONNX vector embeddings',
        'Graceful lexical fallback when local embeddings are loading or unavailable',
      ],
      planned: [
        'Cross-file call graph and symbol reference tracing',
        'Configurable embedding model selection',
      ],
    },
    {
      category: 'AI Assistant & Code Review',
      implemented: [
        'Grounded RAG AI Assistant powered by Express + Google Gemini API',
        'Clickable source citations with line-level Code Viewer navigation',
        'AI Code Review across bugs, security, performance, quality, and maintainability',
        'Single-file, function-scoped, and batched full-project code reviews',
      ],
      planned: [
        'Automated test-case and PR summary generation',
        'Exportable SARIF / Markdown code review reports',
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto forge-ambient-canvas text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-7 space-y-7">
        {/* Header */}
        <div className="border-b border-border pb-5">
          <div className="flex items-center gap-2 mb-1">
            <Settings2 className="w-4 h-4 text-primary" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              System Specifications
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            Settings & Architecture
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Overview of FORGE architecture, runtime diagnostics, and engineering roadmap.
          </p>
        </div>

        {/* Product Identity & Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl forge-panel">
            <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">
              Product
            </span>
            <div className="text-base font-semibold text-foreground">FORGE</div>
            <p className="text-xs text-muted-foreground mt-1">
              AI-Powered Codebase Intelligence Workspace
            </p>
          </div>

          <div className="p-4 rounded-xl forge-panel">
            <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">
              Platform Release
            </span>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-success">Phase 4 Integrated</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-success/10 text-success border border-success/25">
                Active
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">Version 0.1.0-alpha</p>
          </div>

          <div className="p-4 rounded-xl forge-panel">
            <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">
              GitHub Repository
            </span>
            <a
              href="https://github.com/AnishPatra04/Forge"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-primary hover:underline flex items-center gap-1 font-mono mt-0.5 truncate"
            >
              <span>AnishPatra04/Forge</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
            <p className="text-xs text-muted-foreground mt-1 font-mono">Branch: main</p>
          </div>
        </div>

        {/* Project Description */}
        <div className="p-5 rounded-xl forge-panel space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Architecture & Design Philosophy
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            FORGE combines client-side AST parsing, dependency graph visualization, local ONNX embeddings, and a grounded Google Gemini RAG backend so developers can inspect, search, question, and review unfamiliar codebases with verifiable line-level citations.
          </p>
          <div className="p-3 rounded-md bg-[#111215] border border-border text-xs text-muted-foreground leading-relaxed font-mono">
            "FORGE treats your codebase as structured knowledge, bridging raw source files and grounded semantic comprehension."
          </div>
        </div>

        {/* Implemented vs Planned Features Matrix */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Capability Matrix
            </h2>
            <span className="text-xs font-mono text-muted-foreground">Active vs Planned</span>
          </div>

          <div className="space-y-3">
            {featuresComparison.map((group, idx) => (
              <div
                key={idx}
                className="rounded-lg bg-card border border-border overflow-hidden"
              >
                <div className="px-4 py-2.5 bg-muted border-b border-border font-semibold text-xs text-foreground">
                  {group.category}
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                  <div>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-white font-medium mb-2.5 uppercase tracking-wider">
                      <CheckCircle2 className="w-3.5 h-3.5 text-white/80" /> Implemented
                    </div>
                    <ul className="space-y-2">
                      {group.implemented.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-foreground/90">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/70 mt-1.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-white/70 font-medium mb-2.5 uppercase tracking-wider">
                      <Clock className="w-3.5 h-3.5" /> Planned
                    </div>
                    <ul className="space-y-2">
                      {group.planned.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-muted-foreground">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/20 mt-1.5 shrink-0" />
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
        <div className="p-4 rounded-lg bg-muted border border-border text-xs space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            Runtime Diagnostics
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px] text-foreground">
            <div className="p-2.5 rounded-md bg-[#111215] border border-border">
              <span className="text-muted-foreground block text-[10px]">Loaded Files</span>
              <span>{files.length}</span>
            </div>
            <div className="p-2.5 rounded-md bg-[#111215] border border-border">
              <span className="text-muted-foreground block text-[10px]">Lines Scanned</span>
              <span>{totalLines.toLocaleString()} LOC</span>
            </div>
            <div className="p-2.5 rounded-md bg-[#111215] border border-border">
              <span className="text-muted-foreground block text-[10px]">Memory Footprint</span>
              <span>{totalSizeKb} KB</span>
            </div>
            <div className="p-2.5 rounded-md bg-[#111215] border border-border">
              <span className="text-muted-foreground block text-[10px]">Persistence</span>
              {storageStatus === 'ready' ? (
                <span className="text-success">IndexedDB Active</span>
              ) : storageStatus === 'unavailable' ? (
                <span className="text-warning">In-Memory Only</span>
              ) : storageStatus === 'error' ? (
                <span className="text-destructive">Storage Error</span>
              ) : (
                <span className="text-muted-foreground">Checking...</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
