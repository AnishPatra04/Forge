import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Sparkles,
  Search,
  X,
  Eye,
  Copy,
  Check,
  Download,
  ChevronDown,
  ChevronUp,
  FileCode,
  Box,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';

const EMPTY_INTERVIEW_PREP = {
  projectName: 'Workspace',
  summary: {
    totalQuestions: 0,
    byDifficulty: { Easy: 0, Medium: 0, Hard: 0 },
    byCategory: {},
    coveredModules: [],
    coveredFiles: [],
  },
  questions: [],
  markdown: '',
};

const DIFFICULTY_STYLES = {
  Easy: 'bg-white/10 text-white border-white/20',
  Medium: 'bg-white/10 text-white/90 border-white/20',
  Hard: 'bg-white/15 text-white font-semibold border-white/30',
};

function formatSingleQuestionText(q) {
  const lines = [
    `[${q.difficulty}] ${q.category}`,
    `Question: ${q.question}`,
  ];
  if (q.filePath) {
    const anchor = q.symbolName ? `${q.filePath}:${q.startLine}-${q.endLine} (${q.symbolName})` : q.filePath;
    lines.push(`Source: ${anchor} · Module: ${q.moduleLabel}`);
  }
  lines.push(`Suggested Answer: ${q.suggestedAnswer}`);
  if (q.keyPoints?.length > 0) {
    lines.push('Key Points:');
    for (const kp of q.keyPoints) {
      lines.push(`- ${kp}`);
    }
  }
  if (q.followUp) {
    lines.push(`Follow-Up: ${q.followUp}`);
  }
  return lines.join('\n');
}

export function InterviewView() {
  const { files, interviewPrep, loadSampleProject, setSelectedFile } = useWorkspace();

  const prep = interviewPrep || EMPTY_INTERVIEW_PREP;
  const summary = prep.summary || EMPTY_INTERVIEW_PREP.summary;
  const questions = useMemo(() => (Array.isArray(prep.questions) ? prep.questions : []), [prep.questions]);

  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [moduleFilter, setModuleFilter] = useState('All');
  const [fileFilter, setFileFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [copiedId, setCopiedId] = useState(null);

  const filesById = useMemo(() => {
    const map = new Map();
    files.forEach((f) => {
      if (f?.id) map.set(f.id, f);
    });
    return map;
  }, [files]);

  const filesByPath = useMemo(() => {
    const map = new Map();
    files.forEach((f) => {
      const p = (f?.path || f?.relativePath || f?.name || '').replace(/\\/g, '/');
      if (p) map.set(p, f);
    });
    return map;
  }, [files]);

  const categories = useMemo(() => {
    const set = new Set();
    questions.forEach((q) => {
      if (q.category) set.add(q.category);
    });
    return Array.from(set).sort();
  }, [questions]);

  const modules = useMemo(() => {
    const set = new Set();
    questions.forEach((q) => {
      if (q.moduleLabel) set.add(q.moduleLabel);
    });
    return Array.from(set).sort();
  }, [questions]);

  const filePaths = useMemo(() => {
    const set = new Set();
    questions.forEach((q) => {
      if (q.filePath) set.add(q.filePath);
    });
    return Array.from(set).sort();
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return questions.filter((q) => {
      if (difficultyFilter !== 'All' && q.difficulty !== difficultyFilter) return false;
      if (categoryFilter !== 'All' && q.category !== categoryFilter) return false;
      if (moduleFilter !== 'All' && q.moduleLabel !== moduleFilter) return false;
      if (fileFilter !== 'All' && q.filePath !== fileFilter) return false;

      if (needle) {
        const haystack = [
          q.question,
          q.suggestedAnswer,
          q.followUp,
          q.category,
          q.difficulty,
          q.moduleLabel,
          q.filePath,
          q.symbolName,
          q.targetLabel,
          ...(q.keyPoints || []),
          ...(q.evidenceTags || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [questions, difficultyFilter, categoryFilter, moduleFilter, fileFilter, searchQuery]);

  const hasActiveFilters =
    difficultyFilter !== 'All' ||
    categoryFilter !== 'All' ||
    moduleFilter !== 'All' ||
    fileFilter !== 'All' ||
    searchQuery.trim().length > 0;

  const allFilteredExpanded =
    filteredQuestions.length > 0 && filteredQuestions.every((q) => expandedIds.has(q.id));

  const resetFilters = () => {
    setDifficultyFilter('All');
    setCategoryFilter('All');
    setModuleFilter('All');
    setFileFilter('All');
    setSearchQuery('');
  };

  const toggleQuestion = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAllVisible = () => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredExpanded) {
        filteredQuestions.forEach((q) => next.delete(q.id));
      } else {
        filteredQuestions.forEach((q) => next.add(q.id));
      }
      return next;
    });
  };

  const handleCopyQuestion = async (q) => {
    try {
      await globalThis.navigator?.clipboard?.writeText?.(formatSingleQuestionText(q));
      setCopiedId(q.id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === q.id ? null : curr));
      }, 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const handleDownloadMarkdown = () => {
    const content = prep.markdown || '';
    if (!content) return;
    const slug = (prep.projectName || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-interview-questions.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resolveRawFile = (q) => {
    if (q.fileId && filesById.has(q.fileId)) return filesById.get(q.fileId);
    if (q.filePath && filesByPath.has(q.filePath)) return filesByPath.get(q.filePath);
    return null;
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Top Toolbar */}
      <div className="h-14 border-b border-border bg-card/60 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between shrink-0 z-20 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-semibold text-foreground tracking-tight">Interview Questions</h1>
              <p className="text-[10px] text-muted-foreground font-mono">
                Code-grounded questions, explanations & follow-ups
              </p>
            </div>
          </div>

          {questions.length > 0 && (
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono">
              <span className="px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
                <span className="font-semibold text-white">{summary.totalQuestions}</span>{' '}
                <span className="text-muted-foreground">questions</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-white/10 border border-white/20 text-white">
                {summary.byDifficulty?.Easy || 0} Easy
              </span>
              <span className="px-2 py-0.5 rounded bg-white/10 border border-white/20 text-white">
                {summary.byDifficulty?.Medium || 0} Med
              </span>
              <span className="px-2 py-0.5 rounded bg-white/10 border border-white/20 text-white font-semibold">
                {summary.byDifficulty?.Hard || 0} Hard
              </span>
              <span className="px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
                <span className="font-semibold text-white">{summary.coveredModules?.length || 0}</span>{' '}
                <span className="text-muted-foreground">modules</span>
              </span>
            </div>
          )}
        </div>

        {questions.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleAllVisible}
              disabled={filteredQuestions.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border border-border rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {allFilteredExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Collapse All</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Expand All</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadMarkdown}
              title="Download all questions as Markdown"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .md</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {files.length === 0 ? (
          <div className="h-full min-h-[360px] flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-secondary/80 border border-border flex items-center justify-center mb-4 text-muted-foreground">
              <BookOpen className="w-8 h-8 opacity-45 text-indigo-400" />
            </div>
            <h2 className="text-base font-semibold text-foreground mb-1">No Project Files Loaded</h2>
            <p className="text-xs text-muted-foreground max-w-sm mb-5 leading-relaxed">
              Import source files, connect a GitHub repository, or load the sample codebase to generate tailored technical interview questions.
            </p>
            <button
              type="button"
              onClick={loadSampleProject}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Load Sample Codebase</span>
            </button>
          </div>
        ) : questions.length === 0 ? (
          <div className="h-full min-h-[360px] flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-secondary/80 border border-border flex items-center justify-center mb-4 text-muted-foreground">
              <MessageSquare className="w-8 h-8 opacity-45 text-indigo-400" />
            </div>
            <h2 className="text-base font-semibold text-foreground mb-1">No Interview Questions Available</h2>
            <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
              No recognizable functions, classes, configuration keys, or architectural links were detected in the currently loaded files. Try importing JS, TS, Python, Java, or JSON source modules.
            </p>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-5">
            {/* Overview Breakdown Card */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="text-[10px] font-mono uppercase text-muted-foreground">Total Questions</div>
                <div className="text-lg font-bold text-foreground font-mono mt-0.5">{summary.totalQuestions}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="text-[10px] font-mono uppercase text-muted-foreground">Easy</div>
                <div className="text-lg font-bold text-white font-mono mt-0.5">{summary.byDifficulty?.Easy || 0}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="text-[10px] font-mono uppercase text-muted-foreground">Medium</div>
                <div className="text-lg font-bold text-white font-mono mt-0.5">{summary.byDifficulty?.Medium || 0}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="text-[10px] font-mono uppercase text-muted-foreground">Hard</div>
                <div className="text-lg font-bold text-white font-mono mt-0.5">{summary.byDifficulty?.Hard || 0}</div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 rounded-xl bg-card border border-border space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Difficulty Segmented Control */}
                <div
                  role="group"
                  aria-label="Filter by difficulty"
                  className="inline-flex items-center p-0.5 rounded-lg bg-secondary border border-border"
                >
                  {['All', 'Easy', 'Medium', 'Hard'].map((diff) => {
                    const active = difficultyFilter === diff;
                    const count =
                      diff === 'All' ? summary.totalQuestions : summary.byDifficulty?.[diff] || 0;
                    return (
                      <button
                        key={diff}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setDifficultyFilter(diff)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                          active
                            ? 'bg-primary text-primary-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {diff} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Keyword Search Input */}
                <div className="relative flex-1 min-w-[210px] max-w-sm">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search questions, functions, or files..."
                    aria-label="Search interview questions"
                    className="w-full bg-secondary/80 border border-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-1 focus:ring-primary font-mono"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear question search"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Dropdown Filters + Result Counter */}
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <select
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-secondary/80 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="All">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by module"
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                  className="bg-secondary/80 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="All">All Modules</option>
                  {modules.map((mod) => (
                    <option key={mod} value={mod}>
                      {mod}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by file"
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  className="bg-secondary/80 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-foreground max-w-xs truncate focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="All">All Files</option>
                  {filePaths.map((fp) => (
                    <option key={fp} value={fp}>
                      {fp}
                    </option>
                  ))}
                </select>

                <div className="ml-auto flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                  <span>
                    Showing {filteredQuestions.length} of {questions.length}
                  </span>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary hover:bg-accent text-foreground border border-border cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset Filters</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Filtered Results */}
            {filteredQuestions.length === 0 ? (
              <div className="p-8 rounded-xl bg-card border border-border text-center space-y-3">
                <p className="text-sm font-medium text-foreground">No Matching Questions Found</p>
                <p className="text-xs text-muted-foreground font-mono">
                  Adjust or clear your active difficulty, category, module, file, or search filters.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Filters</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredQuestions.map((q) => {
                  const isExpanded = expandedIds.has(q.id);
                  const isCopied = copiedId === q.id;
                  const rawFile = resolveRawFile(q);
                  const diffBadge = DIFFICULTY_STYLES[q.difficulty] || DIFFICULTY_STYLES.Medium;

                  return (
                    <article
                      key={q.id}
                      className="rounded-xl bg-card border border-border hover:border-slate-600/80 transition-colors overflow-hidden"
                    >
                      <div className="p-4 sm:p-5 space-y-3">
                        {/* Meta Header Row */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                            <span className={`px-2 py-0.5 rounded border font-semibold ${diffBadge}`}>
                              {q.difficulty}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                              {q.category}
                            </span>
                            {q.moduleLabel && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
                                <Box className="w-3 h-3 text-slate-400" />
                                <span>{q.moduleLabel}</span>
                              </span>
                            )}
                            {q.filePath && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/70 text-slate-300 border border-border">
                                <FileCode className="w-3 h-3 text-indigo-400" />
                                <span>
                                  {q.symbolName ? `${q.filePath}:${q.startLine}-${q.endLine}` : q.filePath}
                                </span>
                              </span>
                            )}
                          </div>

                          {/* Card Actions */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCopyQuestion(q)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono bg-secondary hover:bg-accent text-foreground border border-border cursor-pointer"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3 h-3 text-white" />
                                  <span className="text-white">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy Q&A</span>
                                </>
                              )}
                            </button>

                            {rawFile && (
                              <button
                                type="button"
                                onClick={() => setSelectedFile(rawFile)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono bg-white/10 text-white hover:bg-white/15 border border-white/20 cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>View Source Code</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Question Text */}
                        <h3 className="text-sm font-medium text-foreground leading-relaxed select-text">
                          {q.question}
                        </h3>

                        {/* Evidence Tags & Code Excerpt Preview */}
                        {q.evidenceTags?.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {q.evidenceTags.map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary/80 text-muted-foreground border border-border/80"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {q.codeExcerpt && (
                          <pre className="p-3 rounded-lg bg-[#111215] border border-border text-[11px] font-mono text-[#EDEDED] overflow-x-auto leading-relaxed select-text">
                            {q.codeExcerpt}
                          </pre>
                        )}

                        {/* Answer Toggle */}
                        <div className="pt-1">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleQuestion(q.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-secondary/70 hover:bg-accent text-white/80 border border-border cursor-pointer"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5" />
                                <span>Hide Suggested Answer</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                <span>Show Suggested Answer</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Expanded Suggested Answer, Key Points & Follow-Up */}
                        {isExpanded && (
                          <div className="mt-2 pt-3 border-t border-border/70 space-y-3 text-xs select-text">
                            <div className="p-3 rounded-lg bg-secondary/40 border border-border/80 space-y-1">
                              <div className="text-[10px] font-mono uppercase font-semibold text-white">
                                Suggested Answer
                              </div>
                              <p className="text-[#EDEDED] leading-relaxed">{q.suggestedAnswer}</p>
                            </div>

                            {q.keyPoints?.length > 0 && (
                              <div>
                                <div className="text-[10px] font-mono uppercase font-semibold text-white/90 mb-1.5">
                                  Key Talking Points
                                </div>
                                <ul className="list-disc list-inside space-y-1 text-white/70">
                                  {q.keyPoints.map((kp, i) => (
                                    <li key={i} className="leading-relaxed">
                                      {kp}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {q.followUp && (
                              <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1">
                                <div className="text-[10px] font-mono uppercase font-semibold text-white/80">
                                  Follow-Up Probe
                                </div>
                                <p className="text-white/70 leading-relaxed">{q.followUp}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
