import React, { useState, useEffect, useMemo } from 'react';
import {
  GitCompareArrows,
  ShieldAlert,
  Play,
  Loader2,
  StopCircle,
  Trash2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  X,
  FileCode,
  FolderGit2,
  Code2,
  FlaskConical,
  ListOrdered,
  HelpCircle,
  Network,
  History,
  Lock,
  Sparkles,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { getFilePath } from '../constants/fileTypes';
import { getReviewableSymbols } from '../utils/codeReviewPipeline';
import { generateExampleChanges } from '../utils/changeImpactEngine';
import { ProjectGraphView } from './ProjectGraphView';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational'];

const SEVERITY_STYLES = {
  Critical: {
    badge: 'bg-[#EF7777]/16 text-[#F59B9B] border-[#EF7777]/40',
    stripe: 'border-l-[#EF7777]',
    bar: 'bg-[#EF7777]',
    count: 'text-[#EF7777]',
  },
  High: {
    badge: 'bg-[#E89B63]/16 text-[#F2B588] border-[#E89B63]/40',
    stripe: 'border-l-[#E89B63]',
    bar: 'bg-[#E89B63]',
    count: 'text-[#E89B63]',
  },
  Medium: {
    badge: 'bg-[#E8B66D]/16 text-[#E8B66D] border-[#E8B66D]/40',
    stripe: 'border-l-[#E8B66D]',
    bar: 'bg-[#E8B66D]',
    count: 'text-[#E8B66D]',
  },
  Low: {
    badge: 'bg-[#8CB8E8]/15 text-[#A6CBF2] border-[#8CB8E8]/35',
    stripe: 'border-l-[#8CB8E8]',
    bar: 'bg-[#8CB8E8]',
    count: 'text-[#8CB8E8]',
  },
  Informational: {
    badge: 'bg-secondary text-muted-foreground border-border',
    stripe: 'border-l-white/25',
    bar: 'bg-[#646E64]',
    count: 'text-muted-foreground',
  },
};

const CONFIDENCE_STYLES = {
  High: 'bg-[#8CCB9A]/14 text-[#8CCB9A] border-[#8CCB9A]/35',
  Medium: 'bg-[#E8B66D]/14 text-[#E8B66D] border-[#E8B66D]/35',
  Low: 'bg-[#EF7777]/14 text-[#F59B9B] border-[#EF7777]/35',
};

const EVIDENCE_LABELS = {
  verified_dependency: {
    label: 'Verified Dependency',
    cls: 'bg-[#C5F467]/12 text-[#C5F467] border-[#C5F467]/30',
  },
  evidence_backed_impact: {
    label: 'Evidence Backed',
    cls: 'bg-[#8CCB9A]/12 text-[#8CCB9A] border-[#8CCB9A]/30',
  },
  ai_inferred_risk: {
    label: 'AI Inferred',
    cls: 'bg-[#E8B66D]/12 text-[#E8B66D] border-[#E8B66D]/30',
  },
  insufficient_evidence: {
    label: 'Insufficient Evidence',
    cls: 'bg-[#EF7777]/12 text-[#F59B9B] border-[#EF7777]/30',
  },
};

const OVERALL_ASSESSMENT_STYLES = {
  'High Impact': 'bg-[#EF7777]/16 text-[#F59B9B] border-[#EF7777]/40',
  'Moderate Impact': 'bg-[#E8B66D]/16 text-[#E8B66D] border-[#E8B66D]/40',
  'Low Impact': 'bg-[#8CB8E8]/15 text-[#A6CBF2] border-[#8CB8E8]/35',
  'Minimal / Isolated Impact': 'bg-[#8CCB9A]/14 text-[#8CCB9A] border-[#8CCB9A]/35',
  'Insufficient Evidence': 'bg-secondary text-muted-foreground border-border',
};

const DEPENDENCY_TYPE_BADGES = {
  target: { label: 'Target', cls: 'bg-[#C5F467]/15 text-[#C5F467] border-[#C5F467]/35' },
  direct_dependent: { label: 'Direct Dependent', cls: 'bg-[#EF7777]/14 text-[#F59B9B] border-[#EF7777]/35' },
  indirect_dependent: { label: 'Indirect Dependent', cls: 'bg-[#E8B66D]/14 text-[#E8B66D] border-[#E8B66D]/35' },
  shared_dependency: { label: 'Shared Dependency', cls: 'bg-[#8CB8E8]/14 text-[#A6CBF2] border-[#8CB8E8]/35' },
  related_context: { label: 'Related Context', cls: 'bg-secondary text-muted-foreground border-border' },
};

function ImpactFindingCard({ finding, onOpenFinding }) {
  const [expanded, setExpanded] = useState(true);
  const sev = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.Medium;
  const confStyle = CONFIDENCE_STYLES[finding.confidence] || CONFIDENCE_STYLES.Medium;
  const evMeta = EVIDENCE_LABELS[finding.evidenceType] || EVIDENCE_LABELS.evidence_backed_impact;

  const lineLabel = finding.startLine
    ? finding.endLine && finding.endLine !== finding.startLine
      ? `L${finding.startLine}-L${finding.endLine}`
      : `L${finding.startLine}`
    : '';

  return (
    <div className={`forge-panel border-l-[3px] ${sev.stripe} transition-colors`}>
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className={`px-2 py-0.5 rounded-[5px] text-[10px] font-semibold border ${sev.badge}`}>
                Severity: {finding.severity}
              </span>
              <span className={`px-2 py-0.5 rounded-[5px] text-[10px] font-semibold border ${confStyle}`}>
                Confidence: {finding.confidence}
              </span>
              <span className={`px-2 py-0.5 rounded-[5px] text-[10px] font-mono border ${evMeta.cls}`}>
                {evMeta.label}
              </span>
              {finding.dependencyType && (
                <span className="px-2 py-0.5 rounded-[5px] text-[10px] font-mono bg-muted text-muted-foreground border border-border">
                  {finding.dependencyType.replace('_', ' ')}
                </span>
              )}
              {finding.symbol && (
                <span className="px-2 py-0.5 rounded-[5px] text-[10px] font-mono bg-secondary text-foreground border border-border">
                  {finding.symbol}()
                </span>
              )}
            </div>

            <h4 className="text-[14px] font-semibold text-foreground leading-snug">
              {finding.title}
            </h4>

            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => onOpenFinding(finding)}
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#C5F467] hover:underline"
                title={`Open ${finding.filePath} in Code Viewer`}
              >
                <FileCode className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[340px]">{finding.filePath}</span>
                {lineLabel && <span className="text-muted-foreground">:{lineLabel}</span>}
                <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-75" />
              </button>

              {finding.dependencyPath?.length > 1 && (
                <span className="text-[10.5px] font-mono text-muted-foreground">
                  via {finding.dependencyPath.join(' → ')}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={expanded ? 'Collapse details' : 'Expand details'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border/70 space-y-2.5">
            {finding.explanation && (
              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-muted-foreground">
                  Why Affected
                </span>
                <p className="text-[12.5px] text-foreground/95 leading-relaxed mt-0.5">
                  {finding.explanation}
                </p>
              </div>
            )}

            {finding.potentialConsequence && (
              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-[#E8B66D]">
                  Potential Consequence
                </span>
                <p className="text-[12.5px] text-foreground/90 leading-relaxed mt-0.5">
                  {finding.potentialConsequence}
                </p>
              </div>
            )}

            {finding.evidenceSnippet && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-muted-foreground">
                    Source Evidence ({finding.filePath}:{lineLabel || 'L1'})
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenFinding(finding)}
                    className="text-[10px] font-mono text-[#C5F467] hover:underline"
                  >
                    Inspect in Viewer
                  </button>
                </div>
                <pre className="p-2.5 rounded-lg bg-[#0B0D0C] border border-border font-mono text-[11px] text-foreground/90 overflow-x-auto leading-relaxed">
                  {finding.evidenceSnippet}
                </pre>
              </div>
            )}

            {finding.recommendedModification && (
              <div className="p-2.5 rounded-lg bg-secondary/70 border border-border">
                <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-[#8CCB9A]">
                  Recommended Adjustment
                </span>
                <p className="text-[12px] text-foreground/90 mt-0.5 leading-relaxed">
                  {finding.recommendedModification}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChangeImpactView() {
  const {
    files,
    projectName,
    assistantBackendStatus,
    refreshAssistantHealth,
    impactAnalysis,
    impactHistory,
    isAnalyzingImpact,
    impactProgress,
    impactError,
    runChangeImpactAnalysis,
    selectImpactHistoryItem,
    cancelImpactAnalysis,
    clearImpactAnalysis,
    dismissImpactError,
    openFileAtLine,
    setActiveTab,
  } = useWorkspace();

  const [description, setDescription] = useState('');
  const [targetScopeMode, setTargetScopeMode] = useState('workspace'); // 'workspace' | 'file' | 'symbol'
  const [selectedFileId, setSelectedFileId] = useState('');
  const [selectedSymbolId, setSelectedSymbolId] = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [activeResultTab, setActiveResultTab] = useState('overview'); // 'overview' | 'graph' | 'tests'

  useEffect(() => {
    if (!assistantBackendStatus.checked) {
      refreshAssistantHealth();
    }
  }, [assistantBackendStatus.checked, refreshAssistantHealth]);

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) =>
      (getFilePath(a) || a.name || '').localeCompare(getFilePath(b) || b.name || '')
    );
  }, [files]);

  const effectiveSelectedFileId = useMemo(() => {
    if (selectedFileId && sortedFiles.some((f) => f.id === selectedFileId)) {
      return selectedFileId;
    }
    return sortedFiles[0]?.id || '';
  }, [sortedFiles, selectedFileId]);

  const selectedFile = useMemo(
    () => sortedFiles.find((f) => f.id === effectiveSelectedFileId) || null,
    [sortedFiles, effectiveSelectedFileId]
  );

  const fileSymbols = useMemo(
    () => (selectedFile ? getReviewableSymbols(selectedFile) : []),
    [selectedFile]
  );

  const effectiveSelectedSymbolId = useMemo(() => {
    if (selectedSymbolId && fileSymbols.some((s) => s.id === selectedSymbolId)) {
      return selectedSymbolId;
    }
    return fileSymbols[0]?.id || '';
  }, [fileSymbols, selectedSymbolId]);

  const exampleChanges = useMemo(() => generateExampleChanges(files), [files]);

  const activeTargetSelection = useMemo(() => {
    if (targetScopeMode === 'workspace' || !selectedFile) return null;
    const sym =
      targetScopeMode === 'symbol'
        ? fileSymbols.find((s) => s.id === effectiveSelectedSymbolId) || null
        : null;
    return {
      fileId: selectedFile.id,
      filePath: getFilePath(selectedFile) || selectedFile.name,
      symbolName: sym?.symbolName || null,
      symbolType: sym?.symbolType || null,
      startLine: sym?.startLine || null,
      endLine: sym?.endLine || null,
    };
  }, [targetScopeMode, selectedFile, fileSymbols, effectiveSelectedSymbolId]);

  const handleAnalyze = async (overrideDesc = null) => {
    const text = overrideDesc !== null ? overrideDesc : description;
    if (overrideDesc !== null) setDescription(overrideDesc);
    setSeverityFilter('All');
    setActiveResultTab('overview');
    await runChangeImpactAnalysis({
      description: text,
      targetSelection: activeTargetSelection,
    });
  };

  const handleOpenFinding = (finding) => {
    if (!finding) return;
    openFileAtLine(finding.fileId || finding.filePath, {
      startLine: finding.startLine || 1,
      endLine: finding.endLine || finding.startLine || 1,
    });
  };

  const handleOpenComponent = (comp) => {
    if (!comp) return;
    const line =
      comp.importEvidence?.[0]?.line ||
      comp.symbolReferences?.[0]?.line ||
      1;
    openFileAtLine(comp.fileId || comp.filePath, {
      startLine: line,
      endLine: line,
    });
  };

  const handleNarrowAmbiguous = async (candidate) => {
    setTargetScopeMode(candidate.symbolName ? 'symbol' : 'file');
    setSelectedFileId(candidate.fileId);
    setSeverityFilter('All');
    await runChangeImpactAnalysis({
      description,
      targetSelection: {
        fileId: candidate.fileId,
        filePath: candidate.filePath,
        symbolName: candidate.symbolName || null,
      },
    });
  };

  const filteredFindings = useMemo(() => {
    const list = impactAnalysis?.findings || [];
    if (severityFilter === 'All') return list;
    return list.filter((f) => f.severity === severityFilter);
  }, [impactAnalysis, severityFilter]);

  const sevBreakdown = impactAnalysis?.severityBreakdown || {};
  const totalFindings = impactAnalysis?.totalFindings || 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
      {/* Compact Header Strip */}
      <div className="px-6 py-3.5 border-b border-border bg-card/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#C5F467]/12 border border-[#C5F467]/30 flex items-center justify-center shrink-0">
            <GitCompareArrows className="w-4.5 h-4.5 text-[#C5F467]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                Change Impact Simulator
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-[10px] font-mono font-semibold bg-[#8CCB9A]/12 text-[#8CCB9A] border border-[#8CCB9A]/30">
                <Lock className="w-2.5 h-2.5" />
                Read-Only Simulation
              </span>
            </div>
            <p className="text-[11.5px] text-muted-foreground truncate">
              Understand what could break before changing your code — AST dependencies + hybrid retrieval + grounded reasoning.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshAssistantHealth}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            title="Check Gemini reasoning backend status"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                assistantBackendStatus.reachable && assistantBackendStatus.geminiConfigured
                  ? 'bg-[#8CCB9A]'
                  : assistantBackendStatus.reachable
                  ? 'bg-[#E8B66D]'
                  : 'bg-[#EF7777]'
              }`}
            />
            {assistantBackendStatus.reachable && assistantBackendStatus.geminiConfigured
              ? `Gemini Ready`
              : assistantBackendStatus.reachable
              ? 'Backend (No Key)'
              : 'Backend Offline'}
            <RefreshCw className="w-3 h-3 opacity-70" />
          </button>

          {(impactAnalysis || description) && (
            <button
              type="button"
              onClick={() => {
                clearImpactAnalysis();
                setDescription('');
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary border border-border text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 forge-ambient-canvas">
        {/* Empty Workspace Guard */}
        {files.length === 0 ? (
          <div className="forge-panel p-8 max-w-2xl mx-auto text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center mx-auto">
              <FolderGit2 className="w-6 h-6 text-[#C5F467]" />
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-foreground">
                No Workspace Loaded
              </h3>
              <p className="text-[12.5px] text-muted-foreground mt-1 max-w-md mx-auto">
                Load or import a repository first so FORGE can parse AST symbols, dependency edges, and tests before simulating changes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('workspace')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C5F467] text-[#0B0D0C] text-[12.5px] font-semibold hover:bg-[#D5FF7B] transition-colors"
            >
              Open Workspace
            </button>
          </div>
        ) : (
          <>
            {/* Simulation Input Panel */}
            <div className="forge-panel p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <label
                    htmlFor="change-impact-input"
                    className="text-[12.5px] font-semibold text-foreground"
                  >
                    Proposed Change Description
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Describe what you want to remove, rename, refactor, or replace in <span className="font-mono text-foreground">{projectName || 'this project'}</span>.
                  </p>
                </div>

                {/* Target Scope Selector */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg bg-[#0B0D0C] border border-border p-0.5 text-[11px]">
                    {[
                      { id: 'workspace', label: 'Entire Workspace' },
                      { id: 'file', label: 'Specific File' },
                      { id: 'symbol', label: 'Specific Symbol' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTargetScopeMode(opt.id)}
                        className={`px-2.5 py-1 rounded-[6px] font-medium transition-colors ${
                          targetScopeMode === opt.id
                            ? 'bg-secondary text-[#C5F467]'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {targetScopeMode !== 'workspace' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg bg-[#0B0D0C]/70 border border-border">
                  <div>
                    <label className="block text-[10.5px] font-mono uppercase tracking-[0.06em] text-muted-foreground mb-1">
                      Target File
                    </label>
                    <select
                      value={effectiveSelectedFileId}
                      onChange={(e) => setSelectedFileId(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-secondary border border-border text-[12px] font-mono text-foreground focus:outline-none focus:border-[#C5F467]/60"
                    >
                      {sortedFiles.map((f) => (
                        <option key={f.id} value={f.id}>
                          {getFilePath(f) || f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {targetScopeMode === 'symbol' && (
                    <div>
                      <label className="block text-[10.5px] font-mono uppercase tracking-[0.06em] text-muted-foreground mb-1">
                        Target Symbol (AST)
                      </label>
                      <select
                        value={effectiveSelectedSymbolId}
                        onChange={(e) => setSelectedSymbolId(e.target.value)}
                        disabled={fileSymbols.length === 0}
                        className="w-full px-3 py-1.5 rounded-lg bg-secondary border border-border text-[12px] font-mono text-foreground focus:outline-none focus:border-[#C5F467]/60 disabled:opacity-50"
                      >
                        {fileSymbols.length === 0 ? (
                          <option value="">No top-level symbols parsed</option>
                        ) : (
                          fileSymbols.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <textarea
                id="change-impact-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isAnalyzingImpact) {
                    e.preventDefault();
                    handleAnalyze();
                  }
                }}
                placeholder="e.g., What if I change the return signature of verifyToken or replace PostgreSQL with MongoDB?"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D0C] border border-border text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-[#C5F467]/60 resize-y"
              />

              {/* Actions + Example Chips */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-[10.5px] font-mono text-muted-foreground mr-1">
                    Try:
                  </span>
                  {exampleChanges.map((ex, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDescription(ex)}
                      disabled={isAnalyzingImpact}
                      className="px-2.5 py-1 rounded-md bg-secondary/80 hover:bg-secondary border border-border text-[11px] text-muted-foreground hover:text-foreground truncate max-w-[260px] transition-colors"
                      title={ex}
                    >
                      {ex}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isAnalyzingImpact ? (
                    <button
                      type="button"
                      onClick={cancelImpactAnalysis}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#EF7777]/15 border border-[#EF7777]/40 text-[#F59B9B] text-[12.5px] font-semibold hover:bg-[#EF7777]/25 transition-colors"
                    >
                      <StopCircle className="w-4 h-4" />
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAnalyze()}
                      disabled={!description.trim() && targetScopeMode === 'workspace'}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C5F467] text-[#0B0D0C] text-[12.5px] font-semibold hover:bg-[#D5FF7B] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Analyse Change
                    </button>
                  )}
                </div>
              </div>

              {/* Session History Chips */}
              {impactHistory.length > 1 && (
                <div className="pt-2.5 border-t border-border/70 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-mono text-muted-foreground mr-1">
                    <History className="w-3 h-3" />
                    Recent Simulations:
                  </span>
                  {impactHistory.slice(0, 6).map((item) => {
                    const active = impactAnalysis?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectImpactHistoryItem(item.id)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono border truncate max-w-[230px] transition-colors ${
                          active
                            ? 'bg-[#C5F467]/14 text-[#C5F467] border-[#C5F467]/35'
                            : 'bg-secondary/70 text-muted-foreground border-border hover:text-foreground'
                        }`}
                        title={`${item.proposedChange} (${item.timestamp})`}
                      >
                        {item.timestamp} · {item.proposedChange}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Progress Banner */}
            {isAnalyzingImpact && impactProgress && (
              <div className="forge-panel p-4 border-[#C5F467]/35 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Loader2 className="w-4.5 h-4.5 text-[#C5F467] animate-spin shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-foreground">
                      Running Change Impact Simulation
                    </div>
                    <div className="text-[11.5px] font-mono text-muted-foreground truncate">
                      {impactProgress.label}
                    </div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-secondary border border-border text-[10px] font-mono text-[#C5F467] uppercase">
                  {impactProgress.phase}
                </span>
              </div>
            )}

            {/* Honest Error Banner (preserves partial deterministic results if present) */}
            {impactError && (
              <div className="p-4 rounded-xl bg-[#EF7777]/10 border border-[#EF7777]/35 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertCircle className="w-4.5 h-4.5 text-[#EF7777] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-[#F59B9B]">
                      {impactError.code === 'MISSING_API_KEY'
                        ? 'Gemini API Key Missing on Backend'
                        : impactError.code === 'BACKEND_UNREACHABLE'
                        ? 'FORGE Backend Server Unreachable'
                        : impactError.code === 'ENDPOINT_NOT_FOUND'
                        ? 'Backend Restart Required (HTTP 404)'
                        : 'Impact Reasoning Issue'}
                    </div>
                    <p className="text-[12px] text-foreground/90 mt-0.5">
                      {impactError.message}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={dismissImpactError}
                  className="p-1 rounded hover:bg-[#EF7777]/20 text-[#F59B9B]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Ambiguity State */}
            {impactAnalysis?.status === 'ambiguous' && (
              <div className="forge-panel p-5 border-[#E8B66D]/45 bg-[#E8B66D]/8 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-[#E8B66D] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-[14px] font-bold text-foreground">
                      Ambiguous Target Detected
                    </h3>
                    <p className="text-[12.5px] text-foreground/90 mt-1">
                      {impactAnalysis.ambiguity?.reason || impactAnalysis.executiveSummary}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {(impactAnalysis.ambiguity?.candidates || []).map((cand, idx) => (
                    <button
                      key={`${cand.fileId}-${idx}`}
                      type="button"
                      onClick={() => handleNarrowAmbiguous(cand)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border hover:border-[#C5F467]/50 text-[12px] font-mono text-foreground transition-colors"
                    >
                      <Code2 className="w-3.5 h-3.5 text-[#C5F467]" />
                      {cand.filePath}
                      {cand.symbolName ? ` · ${cand.symbolName}()` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Not Found / Unrelated Target State */}
            {impactAnalysis?.status === 'not_found' && (
              <div className="forge-panel p-6 space-y-3 border-border">
                <div className="flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-[14px] font-bold text-foreground">
                      No Matching Targets Found in Workspace
                    </h3>
                    <p className="text-[12.5px] text-muted-foreground mt-1">
                      {impactAnalysis.executiveSummary}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground mt-2">
                      Tip: Check exact symbol/file spelling or use the <span className="text-foreground font-medium">Specific File / Symbol</span> Target Selector above.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Full / Partial Analysis Results */}
            {impactAnalysis &&
              (impactAnalysis.status === 'completed' ||
                impactAnalysis.status === 'partial_deterministic') && (
                <div className="space-y-5">
                  {/* Executive Summary + KPI Cards */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-8 forge-panel p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-[5px] text-[11px] font-semibold border ${
                              OVERALL_ASSESSMENT_STYLES[impactAnalysis.overallAssessment] ||
                              OVERALL_ASSESSMENT_STYLES['Moderate Impact']
                            }`}
                          >
                            {impactAnalysis.overallAssessment || 'Moderate Impact'}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-[5px] text-[11px] font-semibold border ${
                              CONFIDENCE_STYLES[impactAnalysis.overallConfidence] ||
                              CONFIDENCE_STYLES.Medium
                            }`}
                          >
                            Confidence: {impactAnalysis.overallConfidence || 'Medium'}
                          </span>
                          <span className="px-2 py-0.5 rounded-[5px] text-[10.5px] font-mono bg-secondary text-muted-foreground border border-border">
                            Retrieval: {impactAnalysis.retrievalMode}
                            {impactAnalysis.semanticUsed ? ' (Semantic)' : ''}
                          </span>
                          {impactAnalysis.model && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-[10.5px] font-mono bg-secondary text-muted-foreground border border-border">
                              <Sparkles className="w-2.5 h-2.5 text-[#C5F467]" />
                              {impactAnalysis.model}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          Blast Score: {impactAnalysis.blastRadiusScore ?? 0}/100
                        </span>
                      </div>

                      <p className="text-[13px] text-foreground/95 leading-relaxed">
                        {impactAnalysis.executiveSummary}
                      </p>

                      {impactAnalysis.parsedChange?.isVague && (
                        <div className="p-2.5 rounded-lg bg-[#E8B66D]/10 border border-[#E8B66D]/30 text-[11.5px] text-[#E8B66D]">
                          Note: {impactAnalysis.parsedChange.vaguenessReason}
                        </div>
                      )}

                      {/* Resolved Targets Pills */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[10.5px] font-mono uppercase tracking-[0.06em] text-muted-foreground mr-1">
                          Resolved Targets:
                        </span>
                        {impactAnalysis.resolvedTargets.map((t, i) => (
                          <button
                            key={`${t.fileId}-${i}`}
                            type="button"
                            onClick={() =>
                              openFileAtLine(t.fileId || t.filePath, {
                                startLine: t.startLine || 1,
                                endLine: t.endLine || t.startLine || 1,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] bg-[#C5F467]/12 text-[#C5F467] border border-[#C5F467]/30 text-[11px] font-mono hover:bg-[#C5F467]/20 transition-colors"
                            title={t.matchReason}
                          >
                            <FileCode className="w-3 h-3" />
                            {t.filePath}
                            {t.symbolName ? `:${t.symbolName}` : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Impact Metrics Tile */}
                    <div className="lg:col-span-4 forge-panel p-5 flex flex-col justify-between gap-3">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="p-2.5 rounded-lg bg-[#0B0D0C] border border-border">
                          <div className="text-[10px] font-mono uppercase text-muted-foreground">
                            Impacted Files
                          </div>
                          <div className="text-[20px] font-bold text-foreground mt-0.5 tabular-nums">
                            {impactAnalysis.impactedComponents.length}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#0B0D0C] border border-border">
                          <div className="text-[10px] font-mono uppercase text-muted-foreground">
                            Direct / Indirect
                          </div>
                          <div className="text-[20px] font-bold text-[#C5F467] mt-0.5 tabular-nums">
                            {impactAnalysis.directDependents.length}
                            <span className="text-muted-foreground text-[14px] font-normal"> / </span>
                            {impactAnalysis.indirectDependents.length}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#0B0D0C] border border-border">
                          <div className="text-[10px] font-mono uppercase text-muted-foreground">
                            Risk Findings
                          </div>
                          <div className="text-[20px] font-bold text-foreground mt-0.5 tabular-nums">
                            {totalFindings}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#0B0D0C] border border-border">
                          <div className="text-[10px] font-mono uppercase text-muted-foreground">
                            Affected Tests
                          </div>
                          <div className="text-[20px] font-bold text-[#8CCB9A] mt-0.5 tabular-nums">
                            {impactAnalysis.testRecommendations?.existingTests?.length || 0}
                          </div>
                        </div>
                      </div>

                      {/* Severity Distribution Bar */}
                      {totalFindings > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex h-2 rounded-full overflow-hidden bg-[#0B0D0C] border border-border">
                            {SEVERITIES.map((sev) => {
                              const count = sevBreakdown[sev] || 0;
                              if (count === 0) return null;
                              const pct = (count / totalFindings) * 100;
                              return (
                                <div
                                  key={sev}
                                  style={{ width: `${pct}%` }}
                                  className={SEVERITY_STYLES[sev].bar}
                                  title={`${sev}: ${count}`}
                                />
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-mono">
                            {SEVERITIES.filter((s) => (sevBreakdown[s] || 0) > 0).map((s) => (
                              <span key={s} className={SEVERITY_STYLES[s].count}>
                                {s}: {sevBreakdown[s]}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sub-Navigation Tabs inside Result */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
                    <div className="flex items-center gap-1.5">
                      {[
                        { id: 'overview', label: `Impact & Risks (${totalFindings})`, icon: ShieldAlert },
                        { id: 'graph', label: `Impact Graph (${impactAnalysis.impactedComponents.length})`, icon: Network },
                        {
                          id: 'tests',
                          label: `Testing & Sequence (${(impactAnalysis.testRecommendations?.existingTests?.length || 0) + (impactAnalysis.testRecommendations?.recommendedNewTests?.length || 0)})`,
                          icon: FlaskConical,
                        },
                      ].map((tab) => {
                        const Icon = tab.icon;
                        const active = activeResultTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveResultTab(tab.id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                              active
                                ? 'bg-[#C5F467]/14 text-[#C5F467] border-[#C5F467]/35'
                                : 'bg-secondary/60 text-muted-foreground border-border hover:text-foreground'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {activeResultTab === 'overview' && totalFindings > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {['All', ...SEVERITIES].map((sev) => {
                          const count = sev === 'All' ? totalFindings : sevBreakdown[sev] || 0;
                          if (sev !== 'All' && count === 0) return null;
                          return (
                            <button
                              key={sev}
                              type="button"
                              onClick={() => setSeverityFilter(sev)}
                              className={`px-2 py-1 rounded text-[10.5px] font-mono border transition-colors ${
                                severityFilter === sev
                                  ? 'bg-secondary text-[#C5F467] border-[#C5F467]/40'
                                  : 'bg-transparent text-muted-foreground border-border hover:text-foreground'
                              }`}
                            >
                              {sev} ({count})
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* TAB 1: Overview (Affected Components + Findings + Uncertainties) */}
                  {activeResultTab === 'overview' && (
                    <div className="space-y-5">
                      {/* Affected Components Table */}
                      <div className="forge-panel p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[13px] font-bold text-foreground">
                            Affected Components & Dependency Paths
                          </h3>
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {impactAnalysis.impactedComponents.length} node
                            {impactAnalysis.impactedComponents.length === 1 ? '' : 's'}
                          </span>
                        </div>

                        <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                          {impactAnalysis.impactedComponents.map((comp) => {
                            const badge =
                              DEPENDENCY_TYPE_BADGES[comp.dependencyType] ||
                              DEPENDENCY_TYPE_BADGES.related_context;
                            return (
                              <div
                                key={comp.fileId}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0B0D0C]/80 border border-border hover:border-white/20 transition-colors"
                              >
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                  <span className={`px-2 py-0.5 rounded-[5px] text-[10px] font-mono border shrink-0 ${badge.cls}`}>
                                    {badge.label}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenComponent(comp)}
                                    className="text-[12px] font-mono text-foreground hover:text-[#C5F467] hover:underline truncate"
                                  >
                                    {comp.filePath}
                                  </button>
                                  {comp.isTestFile && (
                                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-[#8CCB9A]/12 text-[#8CCB9A] border border-[#8CCB9A]/25">
                                      Test
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                                  {comp.dependencyPath?.length > 1 && (
                                    <span className="truncate max-w-[380px]">
                                      {comp.dependencyPath.join(' → ')}
                                    </span>
                                  )}
                                  <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                                    hop {comp.depth}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Risk Findings */}
                      <div className="space-y-3">
                        <h3 className="text-[13px] font-bold text-foreground">
                          Potential Breakages & Behavioral Risks
                        </h3>
                        {filteredFindings.length > 0 ? (
                          <div className="space-y-3">
                            {filteredFindings.map((finding) => (
                              <ImpactFindingCard
                                key={finding.id}
                                finding={finding}
                                onOpenFinding={handleOpenFinding}
                              />
                            ))}
                          </div>
                        ) : impactAnalysis.status === 'partial_deterministic' ? (
                          <div className="forge-panel p-5 text-[12.5px] text-muted-foreground">
                            Deterministic dependency analysis is shown above. Start the backend server with a configured Gemini key to evaluate line-level behavioral risks.
                          </div>
                        ) : (
                          <div className="forge-panel p-5 flex items-center gap-2.5 text-[12.5px] text-[#8CCB9A]">
                            <CheckCircle2 className="w-4.5 h-4.5 shrink-0" />
                            No concrete breaking risks were substantiated for the current filter.
                          </div>
                        )}
                      </div>

                      {/* Uncertainties & Caveats */}
                      {impactAnalysis.uncertainties?.length > 0 && (
                        <div className="forge-panel p-4 space-y-2 border-[#E8B66D]/30">
                          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#E8B66D]">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            Analysis Uncertainties & Scope Caveats
                          </div>
                          <ul className="space-y-1 text-[12px] text-muted-foreground list-disc pl-5">
                            {impactAnalysis.uncertainties.map((u, idx) => (
                              <li key={idx}>{u}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: Embedded Interactive ProjectGraphView with Impact Overlay */}
                  {activeResultTab === 'graph' && (
                    <div className="forge-panel overflow-hidden h-[560px] flex flex-col">
                      <ProjectGraphView
                        impactOverlay={impactAnalysis.graphData}
                        embedded
                        onOpenFileAtLine={openFileAtLine}
                      />
                    </div>
                  )}

                  {/* TAB 3: Testing Intelligence + Change Sequence */}
                  {activeResultTab === 'tests' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Existing vs Recommended Tests */}
                      <div className="space-y-4">
                        <div className="forge-panel p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                              <FlaskConical className="w-4 h-4 text-[#8CCB9A]" />
                              Existing Workspace Tests Affected
                            </h3>
                            <span className="text-[11px] font-mono text-muted-foreground">
                              {impactAnalysis.testRecommendations?.totalWorkspaceTestFiles || 0} total test files
                            </span>
                          </div>

                          {(impactAnalysis.testRecommendations?.existingTests || []).length > 0 ? (
                            <div className="space-y-2">
                              {impactAnalysis.testRecommendations.existingTests.map((t, idx) => (
                                <div
                                  key={`${t.fileId}-${idx}`}
                                  className="p-2.5 rounded-lg bg-[#0B0D0C] border border-border flex items-start justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openFileAtLine(t.fileId || t.filePath, { startLine: 1, endLine: 1 })
                                      }
                                      className="text-[12px] font-mono text-[#8CCB9A] hover:underline truncate block"
                                    >
                                      {t.filePath}
                                    </button>
                                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                                      {t.reason}
                                    </p>
                                  </div>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-secondary border border-border text-foreground shrink-0">
                                    {t.relation}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[12px] text-muted-foreground">
                              No existing test files in the workspace were found importing or referencing the affected targets.
                            </p>
                          )}
                        </div>

                        <div className="forge-panel p-4 space-y-3">
                          <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-[#C5F467]" />
                            Recommended New Tests (Suggested Coverage)
                          </h3>
                          {(impactAnalysis.testRecommendations?.recommendedNewTests || []).length > 0 ? (
                            <div className="space-y-2">
                              {impactAnalysis.testRecommendations.recommendedNewTests.map((rec, idx) => (
                                <div
                                  key={idx}
                                  className="p-2.5 rounded-lg bg-[#0B0D0C] border border-border space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[12px] font-semibold text-foreground">
                                      {rec.title}
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                                        (SEVERITY_STYLES[rec.priority] || SEVERITY_STYLES.Medium).badge
                                      }`}
                                    >
                                      {rec.priority || 'Medium'}
                                    </span>
                                  </div>
                                  {rec.targetFile && (
                                    <div className="text-[11px] font-mono text-[#C5F467]">
                                      Target: {rec.targetFile}
                                    </div>
                                  )}
                                  <p className="text-[11.5px] text-muted-foreground">
                                    {rec.scenario}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[12px] text-muted-foreground">
                              Existing tests already cover the primary resolved targets.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Suggested Safe Change Sequence */}
                      <div className="forge-panel p-4 space-y-3 h-fit">
                        <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                          <ListOrdered className="w-4 h-4 text-[#C5F467]" />
                          Suggested Safe Modification Order
                        </h3>
                        {(impactAnalysis.changeSequence || []).length > 0 ? (
                          <div className="space-y-2.5">
                            {impactAnalysis.changeSequence.map((stepText, idx) => (
                              <div
                                key={idx}
                                className="p-3 rounded-lg bg-[#0B0D0C] border border-border flex items-start gap-3"
                              >
                                <span className="w-6 h-6 rounded-full bg-[#C5F467]/15 border border-[#C5F467]/35 text-[#C5F467] text-[11px] font-mono font-bold flex items-center justify-center shrink-0">
                                  {idx + 1}
                                </span>
                                <p className="text-[12.5px] text-foreground/95 leading-relaxed pt-0.5">
                                  {typeof stepText === 'string' ? stepText : stepText?.action || String(stepText)}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[12px] text-muted-foreground">
                            Run with Gemini reasoning enabled to generate an ordered refactoring checklist.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
}
