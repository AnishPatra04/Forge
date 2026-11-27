import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, FileCode, Hash, HardDrive } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { EXTENSION_CONFIG } from '../constants/fileTypes';

export function CodeViewerModal() {
  const { selectedFile, setSelectedFile, selectedLineRange, setSelectedLineRange } = useWorkspace();
  const [copied, setCopied] = useState(false);
  const firstHighlightedRef = useRef(null);

  const handleClose = () => {
    setSelectedFile(null);
    setSelectedLineRange?.(null);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedFile(null);
        setSelectedLineRange?.(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectedFile, setSelectedLineRange]);

  useEffect(() => {
    if (selectedFile && selectedLineRange?.startLine && firstHighlightedRef.current) {
      firstHighlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedFile, selectedLineRange]);

  if (!selectedFile) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = selectedFile.content.split('\n');
  const badgeStyle = EXTENSION_CONFIG[selectedFile.extension] || {
    label: selectedFile.extension || 'TEXT',
    color: 'text-slate-300 border-slate-700 bg-slate-800',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0f1118] border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-[#131620]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
              <FileCode className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3
                  className="text-sm font-semibold text-slate-100 font-mono truncate"
                  title={selectedFile.path || selectedFile.name}
                >
                  {selectedFile.path || selectedFile.name}
                </h3>
                <span
                  className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded border ${badgeStyle.color}`}
                >
                  {badgeStyle.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono mt-0.5">
                <span className="flex items-center gap-1">
                  <Hash className="w-3 h-3 text-slate-400" />
                  {selectedFile.lineCount} lines
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-slate-400" />
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="Copy file contents"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy</span>
                </>
              )}
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Code Content Area with Line Numbers */}
        <div className="flex-1 overflow-auto bg-[#0a0c12] p-4 font-mono text-xs leading-relaxed">
          <div className="table w-full border-collapse">
            {lines.map((line, index) => {
              const lineNum = index + 1;
              const isHighlighted =
                Boolean(selectedLineRange?.startLine) &&
                lineNum >= selectedLineRange.startLine &&
                lineNum <= (selectedLineRange.endLine || selectedLineRange.startLine);
              const isFirstHighlighted =
                Boolean(selectedLineRange?.startLine) && lineNum === selectedLineRange.startLine;

              return (
                <div
                  key={index}
                  ref={isFirstHighlighted ? firstHighlightedRef : null}
                  className={`table-row group ${
                    isHighlighted
                      ? 'bg-indigo-500/15 hover:bg-indigo-500/20'
                      : 'hover:bg-slate-800/40'
                  }`}
                >
                  <span
                    className={`table-cell select-none text-right pr-4 pl-2 font-mono text-[11px] w-12 align-top ${
                      isHighlighted
                        ? 'text-indigo-300 font-semibold border-l-2 border-indigo-400'
                        : 'text-slate-400 group-hover:text-slate-300'
                    }`}
                  >
                    {lineNum}
                  </span>
                  <span className="table-cell whitespace-pre text-slate-300 pl-3 border-l border-slate-800/80 break-all font-mono">
                    {line || ' '}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-800 bg-[#11131c] flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span>
            {selectedLineRange?.startLine
              ? `Highlighted lines L${selectedLineRange.startLine}-L${selectedLineRange.endLine || selectedLineRange.startLine}`
              : 'Client-side in-memory representation'}
          </span>
          <span>Press ESC to close</span>
        </div>
      </div>
    </div>
  );
}
