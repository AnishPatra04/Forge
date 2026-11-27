import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  Send,
  Trash2,
  Sparkles,
  FileCode,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FolderGit2,
  ExternalLink,
  X,
  StopCircle,
  CheckCircle2,
  Cpu,
  User,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { EXTENSION_CONFIG } from '../constants/fileTypes';
import { generateSuggestedQuestions } from '../utils/ragPipeline';

/**
 * Renders inline markdown tokens (bold, inline code, and clickable [S#] citations)
 * safely as React elements without innerHTML.
 */
function renderInlineTokens(text, sourcesById, onOpenSource) {
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-secondary border border-border text-primary font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const citeMatch = part.match(/^\[(S\d+)\]$/);
    if (citeMatch) {
      const sourceId = citeMatch[1];
      const sourceObj = sourcesById.get(sourceId);
      if (sourceObj) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onOpenSource(sourceObj)}
            title={`Open ${sourceObj.filePath} (L${sourceObj.startLine}-L${sourceObj.endLine})`}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[10px] font-mono font-semibold bg-primary/15 text-primary border border-primary/35 hover:bg-primary/25 transition-colors cursor-pointer align-baseline"
          >
            {sourceId}
          </button>
        );
      }
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

/**
 * Lightweight, safe markdown block renderer for assistant answers.
 */
function FormattedAnswer({ content, sources = [], onOpenSource }) {
  const sourcesById = useMemo(() => {
    const map = new Map();
    for (const s of sources) {
      if (s?.id) map.set(s.id, s);
    }
    return map;
  }, [sources]);

  const blocks = useMemo(() => {
    const result = [];
    const lines = (content || '').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        result.push({ type: 'code', lang, text: codeLines.join('\n') });
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        result.push({
          type: 'heading',
          level: headingMatch[1].length,
          text: headingMatch[2].trim(),
        });
        i++;
        continue;
      }

      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
          i++;
        }
        result.push({ type: 'list', items });
        continue;
      }

      if (!line.trim()) {
        i++;
        continue;
      }

      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].trim().startsWith('```') &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      result.push({ type: 'paragraph', text: paraLines.join(' ') });
    }

    return result;
  }, [content]);

  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed text-foreground/95 select-text">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <div
              key={idx}
              className="rounded-md bg-[#0E120F] border border-border overflow-hidden my-2"
            >
              {block.lang && (
                <div className="px-3 py-1 bg-muted border-b border-border text-[10px] font-mono text-muted-foreground uppercase">
                  {block.lang}
                </div>
              )}
              <pre className="p-3 overflow-x-auto text-xs font-mono text-foreground/90 leading-relaxed">
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }

        if (block.type === 'heading') {
          return (
            <h4
              key={idx}
              className={`font-semibold text-foreground pt-1 ${
                block.level === 1 ? 'text-sm' : 'text-[13px]'
              }`}
            >
              {renderInlineTokens(block.text, sourcesById, onOpenSource)}
            </h4>
          );
        }

        if (block.type === 'list') {
          return (
            <ul key={idx} className="space-y-1.5 pl-4 list-disc marker:text-primary">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="text-foreground/95">
                  {renderInlineTokens(item, sourcesById, onOpenSource)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={idx} className="text-foreground/95">
            {renderInlineTokens(block.text, sourcesById, onOpenSource)}
          </p>
        );
      })}
    </div>
  );
}

function SourceCitationCard({ source, isCited, onOpenSource }) {
  const [expanded, setExpanded] = useState(false);
  const badgeStyle = EXTENSION_CONFIG[source.extension] || {
    label: source.extension || 'CODE',
    color: 'text-muted-foreground border-border bg-secondary',
  };

  const matchLabel =
    source.matchSources?.includes('semantic') && source.matchSources?.includes('bm25')
      ? 'Hybrid'
      : source.matchSources?.includes('semantic')
        ? 'Semantic'
        : 'BM25';

  return (
    <div
      className={`rounded-md border transition-colors overflow-hidden ${
        isCited
          ? 'bg-primary/6 border-primary/35'
          : 'bg-muted border-border hover:border-white/15'
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 border ${
              isCited
                ? 'bg-primary/20 text-primary border-primary/40'
                : 'bg-secondary text-muted-foreground border-border'
            }`}
          >
            {source.id}
          </span>
          <button
            type="button"
            onClick={() => onOpenSource(source)}
            className="flex items-center gap-1.5 min-w-0 text-left group cursor-pointer"
            title={`Open ${source.filePath} at L${source.startLine}-L${source.endLine}`}
          >
            <FileCode className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="font-mono text-xs font-medium text-foreground group-hover:text-primary truncate">
              {source.fileName}
            </span>
            {source.filePath && source.filePath !== source.fileName && (
              <span className="font-mono text-[10px] text-muted-foreground truncate hidden sm:inline">
                ({source.filePath})
              </span>
            )}
          </button>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border shrink-0">
            L{source.startLine}-L{source.endLine}
          </span>
          <span
            className={`hidden md:inline-flex text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${badgeStyle.color}`}
          >
            {matchLabel}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="px-2 py-1 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>Snippet</span>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={() => onOpenSource(source)}
            className="px-2 py-1 rounded text-[10px] font-mono text-primary hover:bg-primary/15 bg-primary/10 border border-primary/30 flex items-center gap-1 transition-colors cursor-pointer"
            title="Navigate to file in Code Viewer"
          >
            <span>Open</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-[#0E120F] px-3 py-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mb-1.5">
            <span>{source.filePath}</span>
            {source.symbolName && source.symbolName !== 'module' && (
              <span className="text-primary">
                {source.symbolType}: {source.symbolName}
              </span>
            )}
          </div>
          <pre className="text-[11px] font-mono text-foreground/90 overflow-x-auto leading-relaxed whitespace-pre select-text">
            <code>{source.snippet}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

export function AssistantView() {
  const {
    files,
    projectName,
    loadSampleProject,
    openGitHubModal,
    embeddingStatus,
    isIndexingEmbeddings,
    assistantMessages,
    isAssistantLoading,
    assistantError,
    assistantBackendStatus,
    askAssistant,
    clearAssistantConversation,
    cancelAssistantRequest,
    refreshAssistantHealth,
    dismissAssistantError,
    openFileAtLine,
  } = useWorkspace();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    refreshAssistantHealth();
  }, [refreshAssistantHealth]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [assistantMessages, isAssistantLoading]);

  const suggestedQuestions = useMemo(() => generateSuggestedQuestions(files), [files]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isAssistantLoading || files.length === 0) return;
    setInput('');
    await askAssistant(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSuggestionClick = async (question) => {
    if (isAssistantLoading || files.length === 0) return;
    setInput('');
    await askAssistant(question);
  };

  const handleOpenSource = (source) => {
    openFileAtLine(source.fileId || source.filePath || source.fileName, {
      startLine: source.startLine,
      endLine: source.endLine,
    });
  };

  const semanticReady = embeddingStatus?.status === 'ready' && embeddingStatus?.indexedChunkCount > 0;

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Top Status & Controls Bar */}
      <div className="px-4 sm:px-6 py-3 border-b border-border bg-sidebar flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-md bg-secondary border border-border text-primary shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground tracking-tight truncate">
              AI Codebase Assistant
            </h1>
            <p className="text-[11px] text-muted-foreground truncate">
              Grounded RAG over <span className="font-mono text-foreground/85">{projectName}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Retrieval Engine Pill */}
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono ${
              semanticReady
                ? 'bg-success/10 border-success/25 text-success'
                : isIndexingEmbeddings
                  ? 'bg-primary/10 border-primary/25 text-primary'
                  : 'bg-warning/10 border-warning/25 text-warning'
            }`}
            title="Active retrieval mode used for RAG context selection"
          >
            {isIndexingEmbeddings ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Cpu className="w-3 h-3" />
            )}
            <span>
              {semanticReady
                ? `Hybrid Vectors (${embeddingStatus.indexedChunkCount} chunks)`
                : isIndexingEmbeddings
                  ? 'Indexing Embeddings...'
                  : 'Lexical Retrieval (BM25 + AST)'}
            </span>
          </div>

          {/* Backend / Gemini Status Pill */}
          <button
            type="button"
            onClick={refreshAssistantHealth}
            title="Click to re-check backend and Gemini API status"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono transition-colors cursor-pointer ${
              !assistantBackendStatus.checked
                ? 'bg-secondary border-border text-muted-foreground'
                : assistantBackendStatus.reachable && assistantBackendStatus.geminiConfigured
                  ? 'bg-success/10 border-success/25 text-success hover:bg-success/15'
                  : 'bg-warning/10 border-warning/25 text-warning hover:bg-warning/15'
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

          {assistantMessages.length > 0 && (
            <button
              type="button"
              onClick={clearAssistantConversation}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Clear session conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear Chat</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Conversation Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 forge-ambient-canvas">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Backend Setup Banner */}
          {assistantBackendStatus.checked &&
            (!assistantBackendStatus.reachable || !assistantBackendStatus.geminiConfigured) && (
              <div className="p-3.5 rounded-md bg-warning/10 border border-warning/30 text-xs text-foreground flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-warning">
                    {!assistantBackendStatus.reachable
                      ? 'AI Assistant Backend Not Running'
                      : 'Gemini API Key Not Configured'}
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    {!assistantBackendStatus.reachable
                      ? 'Start the Express backend server in a second terminal with `npm run server` (port 3001). Your hybrid search and local embeddings continue working offline.'
                      : 'Copy `.env.example` to `.env`, set `GEMINI_API_KEY` to a valid Google Gemini API key, and restart the backend server (`npm run server`).'}
                  </p>
                </div>
              </div>
            )}

          {files.length === 0 ? (
            <div className="my-10 p-8 rounded-lg bg-card border border-border text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-lg bg-secondary border border-border flex items-center justify-center text-primary">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-foreground">
                  No Codebase Loaded Yet
                </h2>
                <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Import local source files, load the built-in sample project, or ingest a public GitHub repository to ask grounded questions about your code.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={loadSampleProject}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold bg-primary hover:bg-[#D2FA81] text-primary-foreground transition-colors cursor-pointer"
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
          ) : assistantMessages.length === 0 ? (
            <div className="my-8 space-y-6">
              <div className="space-y-2.5 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/25 text-primary text-[11px] font-medium">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Grounded Codebase Intelligence</span>
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                  Ask anything about {projectName}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  FORGE retrieves relevant code across your {files.length} loaded file
                  {files.length === 1 ? '' : 's'} using Hybrid Search (BM25 + AST + Local Embeddings) and generates answers grounded in clickable line citations.
                </p>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Suggested starting questions
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {suggestedQuestions.map((question, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSuggestionClick(question)}
                      disabled={isAssistantLoading}
                      className="p-4 rounded-xl forge-card-3d text-left text-[13px] text-foreground/95 leading-snug cursor-pointer disabled:opacity-50"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {assistantMessages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg bg-secondary border border-primary/30 px-4 py-3 space-y-1">
                        <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono text-muted-foreground">
                          <span>You</span>
                          <span>·</span>
                          <span>{msg.timestamp}</span>
                          <User className="w-3 h-3 text-primary" />
                        </div>
                        <p className="text-[13px] text-foreground whitespace-pre-wrap select-text leading-relaxed">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  );
                }

                const citedSet = new Set(msg.citationsUsed || []);
                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="w-full rounded-lg bg-card border border-border p-4 space-y-4">
                      {/* Assistant Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border">
                        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                          <Bot className="w-3.5 h-3.5 text-primary" />
                          <span className="font-sans font-semibold text-foreground">FORGE Assistant</span>
                          {msg.model && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                              {msg.model}
                            </span>
                          )}
                          <span>·</span>
                          <span>{msg.timestamp}</span>
                        </div>

                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            msg.semanticUsed
                              ? 'bg-success/10 text-success border-success/25'
                              : 'bg-warning/10 text-warning border-warning/25'
                          }`}
                        >
                          {msg.semanticUsed
                            ? 'Hybrid (BM25 + Vector)'
                            : 'Lexical Fallback (BM25 + AST)'}
                        </span>
                      </div>

                      {/* Formatted Answer Body */}
                      <FormattedAnswer
                        content={msg.content}
                        sources={msg.sources || []}
                        onOpenSource={handleOpenSource}
                      />

                      {/* Grounded Source Citations */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="pt-3 border-t border-border space-y-2">
                          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            <span>
                              Sources Retrieved ({msg.sources.length})
                              {citedSet.size > 0 ? ` · ${citedSet.size} directly cited` : ''}
                            </span>
                            <span className="normal-case font-sans text-muted-foreground/80">
                              Click any source to inspect code
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {msg.sources.map((src) => (
                              <SourceCitationCard
                                key={src.id}
                                source={src}
                                isCited={citedSet.has(src.id)}
                                onOpenSource={handleOpenSource}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Non-blocking Loading Indicator */}
          {isAssistantLoading && (
            <div className="p-3.5 rounded-lg bg-card border border-primary/35 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">
                    Retrieving relevant code chunks & generating answer...
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    You can switch tabs or cancel at any time.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={cancelAssistantRequest}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-border transition-colors cursor-pointer shrink-0"
              >
                <StopCircle className="w-3.5 h-3.5 text-destructive" />
                <span>Cancel</span>
              </button>
            </div>
          )}

          {/* Error Display */}
          {assistantError && (
            <div className="p-3.5 rounded-md bg-destructive/10 border border-destructive/35 text-xs text-foreground flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-destructive">
                    Assistant Error ({assistantError.code || 'ERROR'})
                  </p>
                  <p className="text-foreground/90 leading-relaxed">{assistantError.message}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissAssistantError}
                className="p-1 rounded hover:bg-destructive/15 text-destructive cursor-pointer shrink-0"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom Chat Composer */}
      <div className="px-4 sm:px-6 py-3 border-t border-border bg-sidebar shrink-0">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="flex items-end gap-2 rounded-lg bg-[#0E120F] border border-border focus-within:border-primary p-2 transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={files.length === 0 || isAssistantLoading}
              rows={1}
              placeholder={
                files.length === 0
                  ? 'Load a project to start asking questions...'
                  : 'Ask a question about your codebase (e.g., "How does authentication work?")...'
              }
              className="flex-1 bg-transparent resize-none px-2 py-1.5 text-xs sm:text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden max-h-32 overflow-y-auto disabled:opacity-50 select-text"
            />
            <button
              type="submit"
              disabled={!input.trim() || files.length === 0 || isAssistantLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-primary hover:bg-[#D2FA81] disabled:bg-secondary disabled:text-muted-foreground text-primary-foreground transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
            >
              {isAssistantLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Ask</span>
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground px-1">
            <span>Enter to send · Shift+Enter for new line</span>
            <span>Answers are grounded strictly in retrieved workspace snippets</span>
          </div>
        </form>
      </div>
    </div>
  );
}
