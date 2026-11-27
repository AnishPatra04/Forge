import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Filter,
  FlaskConical,
  FolderGit2,
  Info,
  Loader2,
  MessageSquareWarning,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { FRAMEWORK_LABELS, formatTestPlanMarkdown } from '../utils/testGenerator.js';

const REVIEW_STATUS_META = {
  pending_review: {
    label: 'Pending Review',
    badgeClass: 'bg-secondary text-muted-foreground border-border',
  },
  approved: {
    label: 'Approved',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  },
  needs_changes: {
    label: 'Needs Changes',
    badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  },
};

const TIER_BADGE_CLASSES = {
  High: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Medium: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  Standard: 'bg-secondary text-muted-foreground border-border',
};

const CATEGORY_META = {
  normal: {
    label: 'Normal',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  },
  edge: {
    label: 'Edge',
    badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  },
  failure: {
    label: 'Failure',
    badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
  },
};

function sanitizeDownloadFilename(name, fallback = 'generated-tests.txt') {
  const base = String(name || '').split('/').pop()?.trim();
  return (base || fallback).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function triggerFileDownload(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function getEffectiveReview(target, testReviewState) {
  const entry = testReviewState?.[target.id];
  const initialStatus = target?.reviewMetadata?.initialStatus || 'pending_review';
  return {
    status: entry?.status || initialStatus,
    reviewNote: entry?.reviewNote || '',
    editedDrafts: entry?.editedDrafts || {},
  };
}

function formatInputPreview(inputs) {
  if (inputs === null || inputs === undefined) return '';
  if (typeof inputs === 'string') return inputs;
  try {
    return JSON.stringify(inputs);
  } catch {
    return String(inputs);
  }
}

function normalizeDependencyItem(dep) {
  if (typeof dep === 'string') {
    return { name: dep, kind: '' };
  }
  if (dep && typeof dep === 'object') {
    return {
      name: String(dep.name || dep.label || ''),
      kind: String(dep.kind || ''),
    };
  }
  return { name: '', kind: '' };
}

export function TestCasesView() {
  const {
    files,
    projectName,
    testSuiteResult,
    isGeneratingTests,
    testGenerationError,
    testReviewState,
    generateProjectTests,
    clearTestSuite,
    dismissTestGenerationError,
    setTargetReviewStatus,
    updateTargetDraftCode,
    resetTargetDraft,
    openFileAtLine,
    loadSampleProject,
    openGitHubModal,
  } = useWorkspace();

  // Filter & UI state
  const [reviewFilter, setReviewFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [fileFilter, setFileFilter] = useState('all');
  const [verificationOnly, setVerificationOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Per-target interactive state
  const [expandedDrafts, setExpandedDrafts] = useState({});
  const [selectedFrameworkByTarget, setSelectedFrameworkByTarget] = useState({});
  const [editingDraftKey, setEditingDraftKey] = useState(null); // `${targetId}::${framework}`
  const [noteComposerTargetId, setNoteComposerTargetId] = useState(null);
  const [noteDraftByTarget, setNoteDraftByTarget] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const [regenerationNotice, setRegenerationNotice] = useState(false);
  const regenerationTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (regenerationTimerRef.current) {
        clearTimeout(regenerationTimerRef.current);
      }
    };
  }, []);

  const plan = testSuiteResult?.plan || null;
  const targets = useMemo(() => (Array.isArray(plan?.targets) ? plan.targets : []), [plan]);
  const summary = plan?.summary || null;

  // Derived filter dropdown options from current plan targets
  const filterOptions = useMemo(() => {
    const modules = new Map();
    const filePaths = new Map();
    const kinds = new Set();

    for (const t of targets) {
      if (t.moduleId) {
        modules.set(t.moduleId, t.moduleLabel || t.moduleId);
      }
      if (t.filePath) {
        filePaths.set(t.filePath, t.filePath);
      }
      if (t.targetKind) {
        kinds.add(t.targetKind);
      }
    }

    return {
      modules: Array.from(modules.entries()).sort((a, b) => a[1].localeCompare(b[1])),
      files: Array.from(filePaths.keys()).sort((a, b) => a.localeCompare(b)),
      kinds: Array.from(kinds).sort((a, b) => a.localeCompare(b)),
    };
  }, [targets]);

  // Live review breakdown computed from current targets + testReviewState
  const reviewStats = useMemo(() => {
    let approved = 0;
    let needsChanges = 0;
    let pending = 0;

    for (const t of targets) {
      const { status } = getEffectiveReview(t, testReviewState);
      if (status === 'approved') approved += 1;
      else if (status === 'needs_changes') needsChanges += 1;
      else pending += 1;
    }

    const total = targets.length;
    const reviewed = approved + needsChanges;
    const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

    return { total, approved, needsChanges, pending, reviewed, progressPct };
  }, [targets, testReviewState]);

  const filteredTargets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return targets.filter((t) => {
      const review = getEffectiveReview(t, testReviewState);
      if (reviewFilter !== 'all' && review.status !== reviewFilter) return false;
      if (tierFilter !== 'all' && t.importanceTier !== tierFilter) return false;
      if (kindFilter !== 'all' && t.targetKind !== kindFilter) return false;
      if (moduleFilter !== 'all' && t.moduleId !== moduleFilter) return false;
      if (fileFilter !== 'all' && t.filePath !== fileFilter) return false;

      if (verificationOnly) {
        const hasUnverified =
          (t.reviewMetadata?.unverifiedAssertionCount || 0) > 0 ||
          (t.scenarios || []).some((s) => s.verificationStatus === 'needs_manual_verification');
        if (!hasUnverified) return false;
      }

      if (q) {
        const scenarioText = (t.scenarios || [])
          .map((s) => `${s.title || ''} ${s.description || ''} ${s.expectedOutcome || ''}`)
          .join(' ');
        const haystack = [
          t.symbolName,
          t.displayName,
          t.filePath,
          t.moduleLabel,
          t.targetKind,
          t.behaviour?.summary,
          scenarioText,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    targets,
    testReviewState,
    reviewFilter,
    tierFilter,
    kindFilter,
    moduleFilter,
    fileFilter,
    verificationOnly,
    searchQuery,
  ]);

  // Group filtered targets by filePath while preserving score/plan order
  const groupedByFile = useMemo(() => {
    const groups = new Map();
    for (const target of filteredTargets) {
      const key = target.filePath || target.fileName || 'unknown-file';
      if (!groups.has(key)) {
        groups.set(key, {
          filePath: key,
          fileId: target.fileId,
          moduleLabel: target.moduleLabel,
          language: target.language,
          targets: [],
        });
      }
      groups.get(key).targets.push(target);
    }
    return Array.from(groups.values());
  }, [filteredTargets]);

  const hasActiveFilters =
    reviewFilter !== 'all' ||
    tierFilter !== 'all' ||
    kindFilter !== 'all' ||
    moduleFilter !== 'all' ||
    fileFilter !== 'all' ||
    verificationOnly ||
    searchQuery.trim().length > 0;

  const allVisibleDraftsExpanded =
    filteredTargets.length > 0 && filteredTargets.every((t) => Boolean(expandedDrafts[t.id]));

  const handleResetFilters = () => {
    setReviewFilter('all');
    setTierFilter('all');
    setKindFilter('all');
    setModuleFilter('all');
    setFileFilter('all');
    setVerificationOnly(false);
    setSearchQuery('');
  };

  const handleToggleAllDrafts = () => {
    const nextValue = !allVisibleDraftsExpanded;
    setExpandedDrafts((prev) => {
      const next = { ...prev };
      for (const t of filteredTargets) {
        next[t.id] = nextValue;
      }
      return next;
    });
  };

  const handleCopyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 2000);
    } catch {
      // Clipboard write may fail if document is unfocused; fail silently without crashing
    }
  };

  const handleDownloadPlanMarkdown = () => {
    if (!plan) return;
    const markdown = formatTestPlanMarkdown(plan);
    const baseName = sanitizeDownloadFilename(
      `${plan.projectName || projectName || 'forge'}-test-plan.md`,
      'forge-test-plan.md'
    );
    triggerFileDownload(baseName, markdown, 'text/markdown;charset=utf-8');
  };

  const handleApproveTarget = (target) => {
    const current = getEffectiveReview(target, testReviewState);
    const nextStatus = current.status === 'approved' ? 'pending_review' : 'approved';
    setTargetReviewStatus(target.id, nextStatus, current.reviewNote);
    if (noteComposerTargetId === target.id) {
      setNoteComposerTargetId(null);
    }
  };

  const handleOpenNeedsChanges = (target) => {
    const current = getEffectiveReview(target, testReviewState);
    if (noteComposerTargetId === target.id) {
      setNoteComposerTargetId(null);
      return;
    }
    setNoteDraftByTarget((prev) => ({
      ...prev,
      [target.id]: prev[target.id] ?? current.reviewNote ?? '',
    }));
    setNoteComposerTargetId(target.id);
    if (current.status !== 'needs_changes') {
      setTargetReviewStatus(target.id, 'needs_changes', current.reviewNote || '');
    }
  };

  const handleSaveNeedsChangesNote = (target) => {
    const note = (noteDraftByTarget[target.id] ?? '').trim();
    setTargetReviewStatus(target.id, 'needs_changes', note);
    setNoteComposerTargetId(null);
  };

  const clearRegenerationTimer = () => {
    if (regenerationTimerRef.current) {
      clearTimeout(regenerationTimerRef.current);
      regenerationTimerRef.current = null;
    }
  };

  const handleGenerateTests = async () => {
    const isRegenerating = Boolean(plan);
    clearRegenerationTimer();
    setRegenerationNotice(false);

    const generatedPlan = await generateProjectTests();
    if (isRegenerating && generatedPlan) {
      setRegenerationNotice(true);
      regenerationTimerRef.current = setTimeout(() => {
        setRegenerationNotice(false);
        regenerationTimerRef.current = null;
      }, 3500);
    }
  };

  const handleClearTestSuite = () => {
    clearRegenerationTimer();
    setRegenerationNotice(false);
    clearTestSuite();
  };

  const renderHeaderToolbar = () => (
    <div className="shrink-0 px-6 py-4 border-b border-border bg-background/70 backdrop-blur-sm flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center text-primary">
            <FlaskConical className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-foreground tracking-tight">
            Test Cases &amp; Draft Generator
          </h2>
          {projectName && (
            <span className="px-2 py-0.5 rounded bg-secondary border border-border text-[11px] font-mono text-muted-foreground">
              {projectName}
            </span>
          )}
          <span className="px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Offline Drafts • Review-Gated
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Deterministic normal, edge, and failure test scenarios generated locally from parsed
          symbols. Review warnings and edit drafts before using them in your test suite.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {regenerationNotice && !testGenerationError && (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            Test cases regenerated successfully!
          </span>
        )}
        <button
          onClick={handleGenerateTests}
          disabled={files.length === 0 || isGeneratingTests}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold transition-all shadow-sm"
        >
          {isGeneratingTests ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              {plan ? 'Regenerate Test Cases' : 'Generate Test Cases'}
            </>
          )}
        </button>

        {plan && (
          <>
            <button
              onClick={handleDownloadPlanMarkdown}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs font-medium transition-colors"
              title="Download full test plan as Markdown"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              Export Plan (.md)
            </button>
            <button
              onClick={handleClearTestSuite}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary/60 hover:bg-rose-500/15 hover:text-rose-400 hover:border-rose-500/30 text-muted-foreground border border-border text-xs font-medium transition-colors"
              title="Clear generated test suite from this session"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );

  // State 1: Empty workspace
  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-background overflow-hidden">
        {renderHeaderToolbar()}
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-secondary border border-border flex items-center justify-center mb-4">
            <FlaskConical className="w-7 h-7 text-primary opacity-80" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">No Project Files Loaded</h3>
          <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
            Load a local repository, import from GitHub, or open the sample project first to
            analyze functions, classes, and components for test case generation.
          </p>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <button
              onClick={loadSampleProject}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-95 transition-opacity inline-flex items-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Load Sample Project
            </button>
            <button
              onClick={openGitHubModal}
              className="px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs font-medium transition-colors inline-flex items-center gap-2"
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              Import GitHub Repo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {renderHeaderToolbar()}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Error banner */}
        {testGenerationError && (
          <div className="max-w-6xl mx-auto p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-rose-300 uppercase tracking-wider">
                  Test Generation Failed ({testGenerationError.code || 'ERROR'})
                </div>
                <p className="text-xs text-rose-200/90 mt-1">{testGenerationError.message}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => generateProjectTests()}
                className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-semibold transition-colors"
              >
                Retry
              </button>
              <button
                onClick={dismissTestGenerationError}
                className="p-1 rounded hover:bg-rose-500/20 text-rose-300 transition-colors"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isGeneratingTests && !plan && (
          <div className="max-w-3xl mx-auto py-20 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-9 h-9 text-primary animate-spin mb-4" />
            <h3 className="text-base font-semibold text-foreground">
              Analyzing Workspace Symbols...
            </h3>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-md">
              Inspecting {files.length} workspace file(s) to rank targets, extract parameter
              constraints, and draft framework-specific unit tests.
            </p>
          </div>
        )}

        {/* Pre-generation ready state */}
        {!isGeneratingTests && !plan && (
          <div className="max-w-3xl mx-auto my-8 p-8 rounded-2xl bg-card border border-border text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center mx-auto mb-4 text-primary">
              <FlaskConical className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-foreground">
              Ready to Generate Test Case Drafts
            </h3>
            <p className="text-xs text-muted-foreground max-w-lg mx-auto mt-2 leading-relaxed">
              FORGE inspects functions, methods, classes, components, and hooks across{' '}
              <span className="text-foreground font-semibold">{files.length} loaded files</span> to
              propose normal, edge, and failure scenarios with editable draft test code. Drafts are
              never auto-executed and stay in this browser session only.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => generateProjectTests()}
                className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-95 transition-opacity inline-flex items-center gap-2 shadow-sm"
              >
                <Sparkles className="w-4 h-4" />
                Generate Test Cases
              </button>
            </div>
          </div>
        )}

        {/* Zero-target state */}
        {plan && targets.length === 0 && (
          <div className="max-w-3xl mx-auto my-8 p-8 rounded-2xl bg-card border border-border text-center">
            <Info className="w-10 h-10 text-amber-400 mx-auto mb-3 opacity-85" />
            <h3 className="text-base font-bold text-foreground">No Testable Targets Found</h3>
            <p className="text-xs text-muted-foreground max-w-lg mx-auto mt-2 leading-relaxed">
              No supported functions, methods, classes, components, or hooks were extracted from the
              current workspace files
              {summary?.skippedTestFiles > 0
                ? ` (${summary.skippedTestFiles} existing test file(s) were skipped)`
                : ''}
              . Add source files in JS/TS, Python, or Java and regenerate.
            </p>
          </div>
        )}

        {/* Active Test Plan */}
        {plan && targets.length > 0 && (
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Overview Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Targets Card */}
              <div className="p-4 rounded-xl bg-card border border-border">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Test Targets
                </div>
                <div className="text-2xl font-bold text-foreground mt-1">
                  {summary?.totalTargets ?? targets.length}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>{summary?.coveredFiles ?? groupedByFile.length} file(s)</span>
                  <span>•</span>
                  <span>{summary?.coveredModules ?? 0} module(s)</span>
                  {summary?.skippedTestFiles > 0 && (
                    <span className="text-muted-foreground/80">
                      ({summary.skippedTestFiles} test file(s) skipped)
                    </span>
                  )}
                </div>
              </div>

              {/* Scenarios Card */}
              <div className="p-4 rounded-xl bg-card border border-border">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Generated Scenarios
                </div>
                <div className="text-2xl font-bold text-foreground mt-1">
                  {summary?.totalScenarios ?? 0}
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] flex-wrap">
                  <span className="text-emerald-400 font-medium">
                    {summary?.byCategory?.normal ?? 0} Normal
                  </span>
                  <span className="text-amber-300 font-medium">
                    {summary?.byCategory?.edge ?? 0} Edge
                  </span>
                  <span className="text-rose-400 font-medium">
                    {summary?.byCategory?.failure ?? 0} Failure
                  </span>
                </div>
              </div>

              {/* Manual Verification Warning Card */}
              <div className="p-4 rounded-xl bg-card border border-amber-500/25">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                    Manual Verification
                  </span>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                </div>
                <div className="text-2xl font-bold text-amber-300 mt-1">
                  {summary?.unverifiedAssertionsCount ?? 0}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Scenarios requiring human confirmation before relying on draft assertions.
                </p>
              </div>

              {/* Review Progress Card */}
              <div className="p-4 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Review Progress</span>
                  <span className="text-foreground font-mono">{reviewStats.progressPct}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-secondary mt-2 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${reviewStats.progressPct}%` }}
                  />
                </div>
                <div className="flex items-center gap-2.5 mt-2.5 text-[11px] flex-wrap">
                  <span className="text-emerald-400 font-medium">
                    {reviewStats.approved} Approved
                  </span>
                  <span className="text-rose-400 font-medium">
                    {reviewStats.needsChanges} Needs Changes
                  </span>
                  <span className="text-muted-foreground">{reviewStats.pending} Pending</span>
                </div>
              </div>
            </div>

            {/* Advisory Notice Banner */}
            {(summary?.unverifiedAssertionsCount ?? 0) > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/90 leading-relaxed">
                  <span className="font-semibold text-amber-300">Human Review Required:</span>{' '}
                  Drafts are synthesized statically without executing code or resolving external
                  side effects. Scenarios marked{' '}
                  <span className="font-mono text-amber-300">Manual Verification Required</span>{' '}
                  contain inferred outcomes or incomplete mock setup and must be verified before
                  approval.
                </p>
              </div>
            )}

            {/* Filter & Action Toolbar */}
            <div className="p-4 rounded-xl bg-card border border-border space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Review Status Pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-medium text-muted-foreground mr-1 inline-flex items-center gap-1">
                    <Filter className="w-3 h-3" /> Review:
                  </span>
                  {[
                    { id: 'all', label: `All (${reviewStats.total})` },
                    { id: 'pending_review', label: `Pending (${reviewStats.pending})` },
                    { id: 'approved', label: `Approved (${reviewStats.approved})` },
                    { id: 'needs_changes', label: `Needs Changes (${reviewStats.needsChanges})` },
                  ].map((pill) => (
                    <button
                      key={pill.id}
                      onClick={() => setReviewFilter(pill.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        reviewFilter === pill.id
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-secondary/60 text-muted-foreground border-border hover:text-foreground'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>

                {/* Expand All & Reset */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleAllDrafts}
                    disabled={filteredTargets.length === 0}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-foreground border border-border text-xs font-medium transition-colors"
                  >
                    <Code2 className="w-3.5 h-3.5 text-primary" />
                    {allVisibleDraftsExpanded ? 'Collapse All Drafts' : 'Expand All Drafts'}
                  </button>
                  {hasActiveFilters && (
                    <button
                      onClick={handleResetFilters}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border text-xs transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset Filters
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {/* Search */}
                <div className="relative lg:col-span-2">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by symbol, file, or scenario..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Tier Filter */}
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:border-primary"
                  aria-label="Filter by importance tier"
                >
                  <option value="all">All Tiers</option>
                  <option value="High">High Priority</option>
                  <option value="Medium">Medium Priority</option>
                  <option value="Standard">Standard Priority</option>
                </select>

                {/* Kind Filter */}
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:border-primary"
                  aria-label="Filter by target kind"
                >
                  <option value="all">All Kinds</option>
                  {filterOptions.kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>

                {/* Module Filter */}
                <select
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:border-primary"
                  aria-label="Filter by module"
                >
                  <option value="all">All Modules</option>
                  {filterOptions.modules.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <select
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:border-primary max-w-xs"
                    aria-label="Filter by file"
                  >
                    <option value="all">All Files ({filterOptions.files.length})</option>
                    {filterOptions.files.map((fp) => (
                      <option key={fp} value={fp}>
                        {fp}
                      </option>
                    ))}
                  </select>

                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={verificationOnly}
                      onChange={(e) => setVerificationOnly(e.target.checked)}
                      className="rounded border-border bg-background text-primary focus:ring-primary"
                    />
                    <span>Show only targets needing manual verification</span>
                  </label>
                </div>

                <div className="text-[11px] text-muted-foreground font-mono">
                  Showing {filteredTargets.length} of {targets.length} targets
                </div>
              </div>
            </div>

            {/* Filtered empty state */}
            {filteredTargets.length === 0 ? (
              <div className="p-10 rounded-xl bg-card border border-border text-center">
                <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-60" />
                <div className="text-sm font-semibold text-foreground">
                  No targets match the current filters
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Try clearing your search query or switching review status filters.
                </p>
                {hasActiveFilters && (
                  <button
                    onClick={handleResetFilters}
                    className="mt-4 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs font-medium"
                  >
                    Reset All Filters
                  </button>
                )}
              </div>
            ) : (
              /* Targets grouped cleanly by source file */
              <div className="space-y-6">
                {groupedByFile.map((group) => (
                  <section key={group.filePath} className="space-y-3">
                    {/* File Group Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode2 className="w-4 h-4 text-primary shrink-0" />
                        <h3 className="text-xs font-mono font-semibold text-foreground truncate">
                          {group.filePath}
                        </h3>
                        {group.moduleLabel && (
                          <span className="px-2 py-0.5 rounded bg-secondary border border-border text-[10px] text-muted-foreground">
                            {group.moduleLabel}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {group.targets.length} target{group.targets.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {/* Target Cards */}
                    <div className="space-y-4">
                      {group.targets.map((target) => {
                        const review = getEffectiveReview(target, testReviewState);
                        const reviewMeta =
                          REVIEW_STATUS_META[review.status] || REVIEW_STATUS_META.pending_review;
                        const tierClass =
                          TIER_BADGE_CLASSES[target.importanceTier] || TIER_BADGE_CLASSES.Standard;
                        const supportedFrameworks =
                          Array.isArray(target.supportedFrameworks) &&
                          target.supportedFrameworks.length > 0
                            ? target.supportedFrameworks
                            : Object.keys(target.draftsByFramework || {});
                        const activeFramework =
                          selectedFrameworkByTarget[target.id] &&
                          supportedFrameworks.includes(selectedFrameworkByTarget[target.id])
                            ? selectedFrameworkByTarget[target.id]
                            : target.defaultFramework || supportedFrameworks[0] || '';
                        const originalDraft =
                          (activeFramework && target.draftsByFramework?.[activeFramework]) || '';
                        const editedDraft = activeFramework
                          ? review.editedDrafts?.[activeFramework]
                          : undefined;
                        const isDraftModified =
                          typeof editedDraft === 'string' && editedDraft !== originalDraft;
                        const currentDraftCode =
                          typeof editedDraft === 'string' ? editedDraft : originalDraft;
                        const isDraftExpanded = Boolean(expandedDrafts[target.id]);
                        const draftEditKey = `${target.id}::${activeFramework}`;
                        const isEditingDraft = editingDraftKey === draftEditKey;
                        const unverifiedCount = target.reviewMetadata?.unverifiedAssertionCount || 0;
                        const isComposingNote = noteComposerTargetId === target.id;

                        return (
                          <div
                            key={target.id}
                            className="rounded-xl bg-card border border-border overflow-hidden transition-colors"
                          >
                            {/* Target Card Header */}
                            <div className="p-4 border-b border-border/60 bg-secondary/20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                              <div className="space-y-1.5 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold font-mono text-foreground">
                                    {target.displayName || target.symbolName}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${tierClass}`}
                                  >
                                    {target.importanceTier}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-secondary border border-border text-[10px] font-mono text-muted-foreground">
                                    {target.targetKind}
                                  </span>
                                  {target.startLine > 0 && (
                                    <span className="text-[11px] font-mono text-muted-foreground">
                                      L{target.startLine}
                                      {target.endLine && target.endLine !== target.startLine
                                        ? `-L${target.endLine}`
                                        : ''}
                                    </span>
                                  )}
                                  <span
                                    className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${reviewMeta.badgeClass}`}
                                  >
                                    {reviewMeta.label}
                                  </span>
                                  {unverifiedCount > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30 text-[10px] font-medium">
                                      <AlertTriangle className="w-3 h-3" />
                                      {unverifiedCount} manual check
                                      {unverifiedCount === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>

                                {target.importanceReasons?.length > 0 && (
                                  <div className="text-[11px] text-muted-foreground">
                                    Selected because: {target.importanceReasons.join(' • ')}
                                  </div>
                                )}
                              </div>

                              {/* Target Review & Source Actions */}
                              <div className="flex items-center gap-2 flex-wrap shrink-0">
                                {target.fileId && (
                                  <button
                                    onClick={() =>
                                      openFileAtLine(target.fileId, {
                                        startLine: target.startLine,
                                        endLine: target.endLine,
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs font-medium transition-colors"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5 text-primary" />
                                    View Source
                                  </button>
                                )}

                                <button
                                  onClick={() => handleApproveTarget(target)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                    review.status === 'approved'
                                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                      : 'bg-secondary/70 hover:bg-emerald-500/15 text-foreground hover:text-emerald-300 border-border hover:border-emerald-500/30'
                                  }`}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {review.status === 'approved' ? 'Approved' : 'Approve'}
                                </button>

                                <button
                                  onClick={() => handleOpenNeedsChanges(target)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                    review.status === 'needs_changes'
                                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                      : 'bg-secondary/70 hover:bg-rose-500/15 text-foreground hover:text-rose-300 border-border hover:border-rose-500/30'
                                  }`}
                                >
                                  <MessageSquareWarning className="w-3.5 h-3.5" />
                                  Needs Changes
                                </button>
                              </div>
                            </div>

                            {/* Saved review note or inline note composer */}
                            {(review.reviewNote || isComposingNote) && (
                              <div className="px-4 py-3 bg-rose-500/5 border-b border-rose-500/20 space-y-2">
                                {isComposingNote ? (
                                  <div className="space-y-2">
                                    <label className="block text-[11px] font-semibold text-rose-300">
                                      Review Note (optional explanation of what needs changes):
                                    </label>
                                    <textarea
                                      rows={2}
                                      value={noteDraftByTarget[target.id] ?? ''}
                                      onChange={(e) =>
                                        setNoteDraftByTarget((prev) => ({
                                          ...prev,
                                          [target.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="e.g., Replace inferred assertion with mocked API failure response..."
                                      className="w-full p-2 rounded-lg bg-background border border-rose-500/30 text-xs text-foreground focus:outline-none focus:border-rose-400"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => handleSaveNeedsChangesNote(target)}
                                        className="px-3 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 text-xs font-semibold"
                                      >
                                        Save Review Note
                                      </button>
                                      <button
                                        onClick={() => setNoteComposerTargetId(null)}
                                        className="px-2.5 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground text-xs"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="text-xs text-rose-200/90">
                                      <span className="font-semibold text-rose-300">
                                        Reviewer Note:{' '}
                                      </span>
                                      {review.reviewNote}
                                    </div>
                                    <button
                                      onClick={() => {
                                        setNoteDraftByTarget((prev) => ({
                                          ...prev,
                                          [target.id]: review.reviewNote || '',
                                        }));
                                        setNoteComposerTargetId(target.id);
                                      }}
                                      className="text-[11px] text-rose-300 hover:underline shrink-0"
                                    >
                                      Edit note
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Target Behaviour & Scenarios */}
                            <div className="p-4 space-y-4">
                              {/* Observed Behaviour Summary */}
                              {target.behaviour && (
                                <div className="p-3 rounded-lg bg-background/70 border border-border/70 space-y-2">
                                  <div className="text-xs font-semibold text-foreground">
                                    Observed Behaviour
                                  </div>
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    {target.behaviour.summary}
                                  </p>
                                  {target.behaviour.dependenciesToMock?.length > 0 && (
                                    <div className="text-[11px] text-amber-300/90 flex items-center gap-1.5 flex-wrap pt-1">
                                      <span className="font-semibold">Dependencies to mock:</span>
                                      {target.behaviour.dependenciesToMock.map((dep, depIndex) => {
                                        const depInfo = normalizeDependencyItem(dep);
                                        if (!depInfo.name) return null;
                                        return (
                                          <span
                                            key={`${target.id}-dep-${depInfo.kind || 'dep'}-${depInfo.name}-${depIndex}`}
                                            title={depInfo.kind || undefined}
                                            className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 font-mono"
                                          >
                                            {depInfo.name}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Scenarios */}
                              <div className="space-y-2.5">
                                <div className="text-xs font-semibold text-foreground">
                                  Scenarios ({target.scenarios?.length || 0})
                                </div>
                                <div className="grid grid-cols-1 gap-2.5">
                                  {(target.scenarios || []).map((scenario) => {
                                    const catMeta =
                                      CATEGORY_META[scenario.category] || CATEGORY_META.normal;
                                    const needsManualVerification =
                                      scenario.verificationStatus === 'needs_manual_verification';
                                    const inputPreview = formatInputPreview(scenario.inputs);

                                    return (
                                      <div
                                        key={scenario.id}
                                        className={`p-3 rounded-lg border ${
                                          needsManualVerification
                                            ? 'bg-amber-500/[0.04] border-amber-500/25'
                                            : 'bg-background/60 border-border/70'
                                        }`}
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span
                                              className={`px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${catMeta.badgeClass}`}
                                            >
                                              {catMeta.label}
                                            </span>
                                            <span className="text-xs font-semibold text-foreground">
                                              {scenario.title}
                                            </span>
                                          </div>
                                          <span
                                            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                              needsManualVerification
                                                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                            }`}
                                          >
                                            {needsManualVerification
                                              ? 'Manual Verification Required'
                                              : 'Observed From Code'}
                                          </span>
                                        </div>

                                        {scenario.description && (
                                          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                                            {scenario.description}
                                          </p>
                                        )}

                                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                                          {inputPreview && (
                                            <div className="text-muted-foreground">
                                              <span className="font-semibold text-foreground/80">
                                                Inputs:{' '}
                                              </span>
                                              <code className="font-mono text-primary/90 break-all">
                                                {inputPreview}
                                              </code>
                                            </div>
                                          )}
                                          {scenario.expectedOutcome && (
                                            <div className="text-muted-foreground">
                                              <span className="font-semibold text-foreground/80">
                                                Expected:{' '}
                                              </span>
                                              <span>{scenario.expectedOutcome}</span>
                                            </div>
                                          )}
                                        </div>

                                        {scenario.preconditions && (
                                          <div className="mt-1.5 text-[11px] text-muted-foreground">
                                            <span className="font-semibold text-foreground/80">
                                              Preconditions:{' '}
                                            </span>
                                            {scenario.preconditions}
                                          </div>
                                        )}

                                        {needsManualVerification && scenario.verificationNote && (
                                          <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/25 flex items-start gap-2 text-[11px] text-amber-200/90">
                                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                            <span>{scenario.verificationNote}</span>
                                          </div>
                                        )}

                                        {scenario.sourceEvidence && (
                                          <div className="mt-1.5 text-[10px] font-mono text-muted-foreground/80">
                                            Evidence: {scenario.sourceEvidence}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Expandable Draft Test Code Section */}
                              {supportedFrameworks.length > 0 && (
                                <div className="rounded-lg border border-border bg-background/70 overflow-hidden">
                                  <button
                                    onClick={() =>
                                      setExpandedDrafts((prev) => ({
                                        ...prev,
                                        [target.id]: !prev[target.id],
                                      }))
                                    }
                                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 bg-secondary/40 hover:bg-secondary/60 transition-colors text-left"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {isDraftExpanded ? (
                                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                      ) : (
                                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                      )}
                                      <Code2 className="w-4 h-4 text-primary shrink-0" />
                                      <span className="text-xs font-semibold text-foreground">
                                        Draft Test Code
                                      </span>
                                      {target.suggestedFilePath && (
                                        <span className="text-[11px] font-mono text-muted-foreground truncate">
                                          {target.suggestedFilePath}
                                        </span>
                                      )}
                                      {isDraftModified && (
                                        <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-[10px] font-semibold text-sky-300">
                                          Edited
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                                      {FRAMEWORK_LABELS[activeFramework] || activeFramework}
                                    </span>
                                  </button>

                                  {isDraftExpanded && (
                                    <div className="p-3.5 border-t border-border space-y-3">
                                      {/* Framework Switcher & Draft Toolbar */}
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {supportedFrameworks.map((fw) => {
                                            const isActive = fw === activeFramework;
                                            const fwModified =
                                              typeof review.editedDrafts?.[fw] === 'string' &&
                                              review.editedDrafts[fw] !==
                                                (target.draftsByFramework?.[fw] || '');
                                            return (
                                              <button
                                                key={fw}
                                                onClick={() => {
                                                  setSelectedFrameworkByTarget((prev) => ({
                                                    ...prev,
                                                    [target.id]: fw,
                                                  }));
                                                  setEditingDraftKey(null);
                                                }}
                                                className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
                                                  isActive
                                                    ? 'bg-primary text-primary-foreground border-primary'
                                                    : 'bg-secondary/60 text-muted-foreground border-border hover:text-foreground'
                                                }`}
                                              >
                                                {FRAMEWORK_LABELS[fw] || fw}
                                                {fwModified ? ' *' : ''}
                                              </button>
                                            );
                                          })}
                                        </div>

                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <button
                                            onClick={() =>
                                              setEditingDraftKey(
                                                isEditingDraft ? null : draftEditKey
                                              )
                                            }
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
                                              isEditingDraft
                                                ? 'bg-primary/15 text-primary border-primary/30'
                                                : 'bg-secondary hover:bg-secondary/80 text-foreground border-border'
                                            }`}
                                          >
                                            <Pencil className="w-3 h-3" />
                                            {isEditingDraft ? 'Done Editing' : 'Edit Draft'}
                                          </button>

                                          {isDraftModified && (
                                            <button
                                              onClick={() => {
                                                resetTargetDraft(target.id, activeFramework);
                                                setEditingDraftKey(null);
                                              }}
                                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border text-xs transition-colors"
                                              title="Restore original generated draft"
                                            >
                                              <RotateCcw className="w-3 h-3" />
                                              Reset Draft
                                            </button>
                                          )}

                                          <button
                                            onClick={() =>
                                              handleCopyText(draftEditKey, currentDraftCode)
                                            }
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs transition-colors"
                                          >
                                            {copiedKey === draftEditKey ? (
                                              <>
                                                <Check className="w-3 h-3 text-emerald-400" />
                                                Copied
                                              </>
                                            ) : (
                                              <>
                                                <Copy className="w-3 h-3" />
                                                Copy
                                              </>
                                            )}
                                          </button>

                                          <button
                                            onClick={() =>
                                              triggerFileDownload(
                                                sanitizeDownloadFilename(
                                                  target.suggestedFilePath,
                                                  `${target.symbolName || 'test'}.draft.txt`
                                                ),
                                                currentDraftCode
                                              )
                                            }
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs transition-colors"
                                          >
                                            <Download className="w-3 h-3 text-primary" />
                                            Download
                                          </button>
                                        </div>
                                      </div>

                                      {isDraftModified && (
                                        <div className="text-[11px] text-sky-300/90">
                                          Draft edited in this session. Review and click{' '}
                                          <span className="font-semibold">Approve</span> when ready.
                                        </div>
                                      )}

                                      {isEditingDraft ? (
                                        <textarea
                                          rows={14}
                                          value={currentDraftCode}
                                          onChange={(e) =>
                                            updateTargetDraftCode(
                                              target.id,
                                              activeFramework,
                                              e.target.value
                                            )
                                          }
                                          spellCheck={false}
                                          className="w-full p-3 rounded-lg bg-[#0b101b] border border-primary/40 font-mono text-xs text-foreground leading-relaxed focus:outline-none"
                                        />
                                      ) : (
                                        <pre className="p-3.5 rounded-lg bg-[#0b101b] border border-border font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed whitespace-pre">
                                          <code>{currentDraftCode}</code>
                                        </pre>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
