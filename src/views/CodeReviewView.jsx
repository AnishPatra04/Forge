import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Bug,
  Lock,
  Zap,
  Sparkles,
  Wrench,
  FileCode,
  FolderGit2,
  Play,
  Loader2,
  StopCircle,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  X,
  Layers,
  Code2,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { getFilePath } from '../constants/fileTypes';
import {
  REVIEW_CATEGORIES,
  REVIEW_SEVERITIES,
  getReviewableSymbols,
  buildProjectReviewBatches,
} from '../utils/codeReviewPipeline';

const SEVERITY_STYLES = {
  Critical: {
    badge: 'bg-white/15 text-white font-semibold border-white/30',
    card: 'border-white/25 bg-white/5',
    stripe: 'border-l-white',
    bar: 'bg-white',
    count: 'text-white font-semibold',
  },
  High: {
    badge: 'bg-white/10 text-white/90 font-medium border-white/20',
    card: 'border-white/20 bg-white/5',
    stripe: 'border-l-white/70',
    bar: 'bg-white/70',
    count: 'text-white/90',
  },
  Medium: {
    badge: 'bg-white/5 text-white/70 border-white/15',
    card: 'border-white/15 bg-white/5',
    stripe: 'border-l-white/40',
    bar: 'bg-white/40',
    count: 'text-white/70',
  },
  Low: {
    badge: 'bg-white/5 text-white/50 border-white/10',
    card: 'border-white/10 bg-white/5',
    stripe: 'border-l-white/20',
    bar: 'bg-white/20',
    count: 'text-white/50',
  },
  Informational: {
    badge: 'bg-white/5 text-white/40 border-white/10',
    card: 'border-white/10 bg-secondary',
    stripe: 'border-l-white/10',
    bar: 'bg-white/10',
    count: 'text-muted-foreground',
  },
};

const CATEGORY_ICONS = {
  'Bug Detection': Bug,
  'Security Analysis': Lock,
  'Performance Analysis': Zap,
  'Code Quality': Code2,
  Maintainability: Wrench,
};

function FindingCard({ finding, onOpenFinding }) {
  const [expanded, setExpanded] = useState(
    finding.severity === 'Critical' || finding.severity === 'High'
  );
  const sevStyle = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.Medium;

  return (
    <div
      className={`rounded-xl forge-panel border-l-[3px] ${sevStyle.stripe} hover:border-white/16 transition-colors overflow-hidden`}
    >
      {/* Summary Header Row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
        className="px-4 py-3 flex items-start justify-between gap-3 cursor-pointer hover:bg-secondary/40 transition-colors"
      >
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${sevStyle.badge}`}
            >
              {finding.severity}
            </span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                finding.confidence === 'confirmed'
                  ? 'bg-primary/12 text-primary border-primary/30'
                  : 'bg-secondary text-muted-foreground border-border'
              }`}
              title={
                finding.confidence === 'confirmed'
                  ? 'Definite issue directly visible in the source code'
                  : 'Potential risk depending on callers or runtime inputs'
              }
            >
              {finding.confidence === 'confirmed' ? 'Confirmed' : 'Potential Risk'}
            </span>
            <h4 className="text-xs sm:text-[13px] font-semibold text-foreground">
              {finding.title}
            </h4>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFinding(finding);
              }}
              className="inline-flex items-center gap-1.5 text-primary hover:underline cursor-pointer"
              title={`Open ${finding.filePath} at L${finding.startLine}-L${finding.endLine}`}
            >
              <FileCode className="w-3 h-3" />
              <span>{finding.filePath}</span>
              <span className="px-1.5 py-0.2 rounded bg-secondary border border-border text-[10px] text-foreground">
                L{finding.startLine}
                {finding.endLine > finding.startLine ? `-L${finding.endLine}` : ''}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFinding(finding);
            }}
            className="px-2 py-1 rounded text-[10px] font-mono text-primary hover:bg-primary/15 bg-primary/10 border border-primary/30 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>Inspect</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
          <span className="p-1 text-muted-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </div>

      {/* Expandable Details */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-border space-y-3 text-xs select-text">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-muted border border-border space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Explanation
              </p>
              <p className="text-foreground/95 leading-relaxed">{finding.explanation}</p>
            </div>
            <div className="p-3 rounded-md bg-muted border border-border space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Why It Matters
              </p>
              <p className="text-muted-foreground leading-relaxed">{finding.whyItMatters}</p>
            </div>
          </div>

          <div className="p-3 rounded-md bg-success/8 border border-success/25 space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-success">
              Recommended Fix
            </p>
            <p className="text-foreground/95 leading-relaxed">{finding.recommendedFix}</p>
          </div>

          {/* Before / After Code Comparison */}
          {(finding.currentCode || finding.suggestedCode) && (
            <div
              className={`grid grid-cols-1 ${
                finding.currentCode && finding.suggestedCode ? 'lg:grid-cols-2' : ''
              } gap-3`}
            >
              {finding.currentCode && (
                <div className="rounded-md bg-[#0D0E11] border border-white/15 overflow-hidden">
                  <div className="px-3 py-1.5 bg-white/5 border-b border-white/10 flex items-center justify-between text-[10px] font-mono text-white/80">
                    <span>Current Code (L{finding.startLine}-L{finding.endLine})</span>
                    <span>Before</span>
                  </div>
                  <pre className="p-3 text-[11px] font-mono text-foreground/90 overflow-x-auto leading-relaxed whitespace-pre">
                    <code>{finding.currentCode}</code>
                  </pre>
                </div>
              )}

              {finding.suggestedCode && (
                <div className="rounded-md bg-[#0D0E11] border border-white/20 overflow-hidden">
                  <div className="px-3 py-1.5 bg-white/10 border-b border-white/15 flex items-center justify-between text-[10px] font-mono text-white">
                    <span>Suggested Improvement</span>
                    <span>After</span>
                  </div>
                  <pre className="p-3 text-[11px] font-mono text-foreground/95 overflow-x-auto leading-relaxed whitespace-pre">
                    <code>{finding.suggestedCode}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CodeReviewView() {
  const {
    files,
    projectName,
    loadSampleProject,
    openGitHubModal,
    assistantBackendStatus,
    refreshAssistantHealth,
    codeReviewResult,
    isReviewingCode,
    codeReviewProgress,
    codeReviewError,
    runFileCodeReview,
    runProjectCodeReview,
    cancelCodeReview,
    clearCodeReview,
    dismissCodeReviewError,
    openFileAtLine,
  } = useWorkspace();

  const [reviewMode, setReviewMode] = useState('file'); // 'file' | 'project'
  const [selectedFileId, setSelectedFileId] = useState('');
  const [selectedSymbolId, setSelectedSymbolId] = useState('__full__');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  useEffect(() => {
    refreshAssistantHealth();
  }, [refreshAssistantHealth]);

  const effectiveFileId = useMemo(() => {
    if (files.length === 0) return '';
    if (selectedFileId && files.some((f) => f.id === selectedFileId)) {
      return selectedFileId;
    }
    return files[0].id;
  }, [files, selectedFileId]);

  const activeFile = useMemo(
    () => files.find((f) => f.id === effectiveFileId) || null,
    [files, effectiveFileId]
  );

  const reviewableSymbols = useMemo(
    () => (activeFile ? getReviewableSymbols(activeFile) : []),
    [activeFile]
  );

  const projectPlan = useMemo(() => buildProjectReviewBatches(files), [files]);

  const handleFileChange = (newId) => {
    setSelectedFileId(newId);
    setSelectedSymbolId('__full__');
  };

  const handleStartReview = async () => {
    setSeverityFilter('ALL');
    if (reviewMode === 'project') {
      await runProjectCodeReview();
      return;
    }
    if (!activeFile) return;
    const scope =
      selectedSymbolId !== '__full__'
        ? reviewableSymbols.find((s) => s.id === selectedSymbolId) || null
        : null;
    await runFileCodeReview(activeFile.id, scope);
  };

  const handleOpenFinding = (finding) => {
    openFileAtLine(finding.fileId || finding.filePath || finding.fileName, {
      startLine: finding.startLine,
      endLine: finding.endLine,
    });
  };

  const groupedFindings = useMemo(() => {
    if (!codeReviewResult?.findings) return [];
    const filtered =
      severityFilter === 'ALL'
        ? codeReviewResult.findings
        : codeReviewResult.findings.filter((f) => f.severity === severityFilter);

    return REVIEW_CATEGORIES.map((category) => ({
      category,
      items: filtered.filter((f) => f.category === category),
    })).filter((group) => group.items.length > 0);
  }, [codeReviewResult, severityFilter]);

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Top Bar */}
      <div className="px-4 sm:px-6 py-3 border-b border-border bg-sidebar flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-md bg-secondary border border-border text-primary shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground tracking-tight truncate">
              AI Code Review
            </h1>
            <p className="text-[11px] text-muted-foreground truncate">
              Bugs · Security · Performance · Quality · Maintainability
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mode Toggle */}
          <div
            role="group"
            aria-label="Review scope mode"
            className="inline-flex items-center p-0.5 rounded-md bg-[#111215] border border-border"
          >
            <button
              type="button"
              onClick={() => setReviewMode('file')}
              disabled={isReviewingCode}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                reviewMode === 'file'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Single File
            </button>
            <button
              type="button"
              onClick={() => setReviewMode('project')}
              disabled={isReviewingCode}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                reviewMode === 'project'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Full Project
            </button>
          </div>

          {/* Backend Status Pill */}
          <button
            type="button"
            onClick={refreshAssistantHealth}
            title="Re-check backend & Gemini status"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono transition-colors cursor-pointer ${
              !assistantBackendStatus.checked
                ? 'bg-secondary border-border text-muted-foreground'
                : assistantBackendStatus.reachable && assistantBackendStatus.geminiConfigured
                  ? 'bg-success/10 border-success/25 text-success'
                  : 'bg-warning/10 border-warning/25 text-warning'
            }`}
          >
            {assistantBackendStatus.reachable && assistantBackendStatus.geminiConfigured ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            <span>
              {!assistantBackendStatus.checked
                ? 'Checking API...'
                : !assistantBackendStatus.reachable
                  ? 'Backend Offline'
                  : assistantBackendStatus.geminiConfigured
                    ? assistantBackendStatus.model || 'Gemini Ready'
                    : 'API Key Missing'}
            </span>
          </button>

          {codeReviewResult && (
            <button
              type="button"
              onClick={clearCodeReview}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 forge-ambient-canvas">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Backend Setup Banner */}
          {assistantBackendStatus.checked &&
            (!assistantBackendStatus.reachable || !assistantBackendStatus.geminiConfigured) && (
              <div className="p-3.5 rounded-md bg-warning/10 border border-warning/30 text-xs text-foreground flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-warning">
                    {!assistantBackendStatus.reachable
                      ? 'AI Backend Server Not Running'
                      : 'Gemini API Key Not Configured'}
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    {!assistantBackendStatus.reachable
                      ? 'Start the Express backend server with `npm run server` to enable AI Code Review.'
                      : 'Add your `GEMINI_API_KEY` to `.env` and restart `npm run server`.'}
                  </p>
                </div>
              </div>
            )}

          {files.length === 0 ? (
            <div className="my-10 p-8 rounded-lg bg-card border border-border text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-lg bg-secondary border border-border flex items-center justify-center text-primary">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-foreground">
                  Load a Codebase to Start Reviewing
                </h2>
                <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Import local files, load the built-in sample project, or ingest a public GitHub repository to run grounded bug, security, performance, and maintainability reviews.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={loadSampleProject}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold bg-primary hover:bg-white text-primary-foreground transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load Sample Codebase</span>
                </button>
                <button
                  type="button"
                  onClick={openGitHubModal}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-border transition-colors cursor-pointer"
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-primary" />
                  <span>Import from GitHub</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Review Controls Card */}
              <div className="p-4 rounded-xl forge-panel space-y-4">
                {reviewMode === 'file' ? (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-5 space-y-1.5">
                      <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Target File
                      </label>
                      <select
                        value={effectiveFileId}
                        onChange={(e) => handleFileChange(e.target.value)}
                        disabled={isReviewingCode}
                        className="w-full bg-[#111215] border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground focus:outline-hidden focus:border-primary disabled:opacity-50"
                      >
                        {files.map((f) => (
                          <option key={f.id} value={f.id}>
                            {getFilePath(f) || f.name} ({f.lineCount} LOC)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-4 space-y-1.5">
                      <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Function / Scope (Optional)
                      </label>
                      <select
                        value={selectedSymbolId}
                        onChange={(e) => setSelectedSymbolId(e.target.value)}
                        disabled={isReviewingCode || reviewableSymbols.length === 0}
                        className="w-full bg-[#111215] border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground focus:outline-hidden focus:border-primary disabled:opacity-50"
                      >
                        <option value="__full__">Entire File</option>
                        {reviewableSymbols.map((sym) => (
                          <option key={sym.id} value={sym.id}>
                            {sym.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-3 flex gap-2">
                      <button
                        type="button"
                        onClick={handleStartReview}
                        disabled={isReviewingCode || !activeFile}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-primary hover:bg-white disabled:bg-secondary disabled:text-muted-foreground text-primary-foreground transition-colors cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isReviewingCode ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        <span>Run Review</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <Layers className="w-4 h-4 text-primary" />
                        <span>Full-Project Batched Review ({projectName})</span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        {projectPlan.prioritizedFiles.length} prioritized code file
                        {projectPlan.prioritizedFiles.length === 1 ? '' : 's'} queued in{' '}
                        {projectPlan.batches.length} batch
                        {projectPlan.batches.length === 1 ? '' : 'es'}
                        {projectPlan.skippedCount > 0
                          ? ` · ${projectPlan.skippedCount} docs/non-code skipped`
                          : ''}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleStartReview}
                      disabled={isReviewingCode || projectPlan.batches.length === 0}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-primary hover:bg-white disabled:bg-secondary disabled:text-muted-foreground text-primary-foreground transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isReviewingCode ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      <span>Review Project</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Loading & Progress State */}
              {isReviewingCode && (
                <div className="p-4 rounded-lg bg-card border border-primary/35 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                      <span className="text-xs font-medium text-foreground truncate">
                        {codeReviewProgress?.currentLabel || 'Running AI Code Review...'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={cancelCodeReview}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-border cursor-pointer shrink-0"
                    >
                      <StopCircle className="w-3.5 h-3.5 text-destructive" />
                      <span>Cancel</span>
                    </button>
                  </div>

                  {codeReviewProgress?.totalBatches > 1 && (
                    <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{
                          width: `${Math.max(
                            8,
                            Math.round(
                              ((codeReviewProgress.completedBatches || 0) /
                                codeReviewProgress.totalBatches) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Error Banner */}
              {codeReviewError && (
                <div className="p-3.5 rounded-md bg-destructive/10 border border-destructive/35 text-xs text-foreground flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-destructive">
                        Code Review Error ({codeReviewError.code || 'ERROR'})
                      </p>
                      <p className="text-foreground/90 leading-relaxed">{codeReviewError.message}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={dismissCodeReviewError}
                    className="p-1 rounded hover:bg-destructive/15 text-destructive cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Review Summary & Findings Dashboard */}
              {codeReviewResult && (
                <div className="space-y-5">
                  <div className="p-5 rounded-xl forge-panel space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
                      <div className="space-y-0.5">
                        <h2 className="text-sm font-semibold text-foreground">
                          {codeReviewResult.mode === 'project'
                            ? `Project Review Summary (${codeReviewResult.reviewedFiles?.length || 0} files)`
                            : `Review Summary: ${codeReviewResult.targetFile}`}
                        </h2>
                        <p className="text-[11px] font-mono text-muted-foreground">
                          {codeReviewResult.model || 'Gemini'} · {codeReviewResult.timestamp}
                          {codeReviewResult.scope?.symbolName
                            ? ` · Scope: ${codeReviewResult.scope.symbolType} ${codeReviewResult.scope.symbolName}`
                            : ''}
                          {codeReviewResult.truncated ? ' · Large file truncated for review bounds' : ''}
                        </p>
                      </div>

                      <span className="px-2.5 py-1 rounded-md bg-primary/12 border border-primary/30 text-primary font-mono text-xs font-semibold">
                        {codeReviewResult.totalFindings} Finding
                        {codeReviewResult.totalFindings === 1 ? '' : 's'}
                      </span>
                    </div>

                    <p className="text-xs sm:text-[13px] text-foreground/95 leading-relaxed select-text">
                      {codeReviewResult.summary}
                    </p>

                    {/* Proportional Severity Distribution Bar */}
                    {codeReviewResult.totalFindings > 0 && (
                      <div className="space-y-1.5">
                        <div className="w-full h-2 rounded-full bg-secondary overflow-hidden flex gap-0.5">
                          {REVIEW_SEVERITIES.map((sev) => {
                            const count = codeReviewResult.severityBreakdown?.[sev] || 0;
                            if (count === 0) return null;
                            const pct = (count / codeReviewResult.totalFindings) * 100;
                            return (
                              <div
                                key={sev}
                                className={`h-full ${SEVERITY_STYLES[sev].bar} transition-all duration-300`}
                                style={{ width: `${pct}%` }}
                                title={`${sev}: ${count}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Severity Breakdown & Filter Tiles */}
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSeverityFilter('ALL')}
                        className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                          severityFilter === 'ALL'
                            ? 'bg-primary/12 border-primary/45'
                            : 'bg-muted border-border hover:border-white/15'
                        }`}
                      >
                        <div className="text-[10px] font-mono text-muted-foreground uppercase">All</div>
                        <div className="text-lg font-mono font-semibold text-foreground">
                          {codeReviewResult.totalFindings}
                        </div>
                      </button>

                      {REVIEW_SEVERITIES.map((sev) => {
                        const count = codeReviewResult.severityBreakdown?.[sev] || 0;
                        const style = SEVERITY_STYLES[sev];
                        const isSelected = severityFilter === sev;
                        return (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => setSeverityFilter(isSelected ? 'ALL' : sev)}
                            className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                              isSelected
                                ? style.card
                                : 'bg-muted border-border hover:border-white/15'
                            }`}
                          >
                            <div className="text-[10px] font-mono text-muted-foreground uppercase truncate">
                              {sev}
                            </div>
                            <div className={`text-lg font-mono font-semibold ${style.count}`}>
                              {count}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Category-Grouped Findings */}
                  {codeReviewResult.totalFindings === 0 ? (
                    <div className="p-5 rounded-lg bg-success/8 border border-success/25 flex items-center gap-3 text-xs text-foreground">
                      <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                      <div>
                        <p className="font-semibold text-success">No Issues Detected</p>
                        <p className="text-muted-foreground">
                          The AI reviewer did not identify any grounded bugs, security risks, or maintainability problems in the reviewed code.
                        </p>
                      </div>
                    </div>
                  ) : groupedFindings.length === 0 ? (
                    <div className="p-5 rounded-xl forge-panel text-xs text-muted-foreground text-center">
                      No findings match the "{severityFilter}" severity filter.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {groupedFindings.map(({ category, items }) => {
                        const Icon = CATEGORY_ICONS[category] || ShieldAlert;
                        return (
                          <section key={category} className="space-y-2.5">
                            <div className="flex items-center justify-between px-1">
                              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Icon className="w-3.5 h-3.5 text-primary" />
                                <span>{category}</span>
                                <span className="px-1.5 py-0.5 rounded bg-secondary border border-border text-foreground font-mono text-[10px]">
                                  {items.length}
                                </span>
                              </h3>
                            </div>

                            <div className="space-y-2">
                              {items.map((finding) => (
                                <FindingCard
                                  key={finding.id}
                                  finding={finding}
                                  onOpenFinding={handleOpenFinding}
                                />
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
