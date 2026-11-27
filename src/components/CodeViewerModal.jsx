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
    color: 'text-muted-foreground border-border bg-secondary',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75">
      <div className="forge-dialog bg-card border border-white/14 rounded-xl shadow-[inset_0_1px_0_rgba(242,243,237,0.09),0_28px_70px_-15px_rgba(0,0,0,0.92)] w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden text-foreground">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-sidebar">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-md bg-secondary border border-border text-primary shrink-0">
              <FileCode className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3
                  className="text-sm font-semibold text-foreground font-mono truncate"
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
              <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground font-mono mt-0.5">
                <span className="flex items-center gap-1">
                  <Hash className="w-3 h-3" />
                  {selectedFile.lineCount} lines
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-accent text-foreground border border-border transition-colors cursor-pointer"
              title="Copy file contents"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-success" />
                  <span className="text-success">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Copy</span>
                </>
              )}
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Code Content Area with Line Numbers */}
        <div className="flex-1 overflow-auto bg-[#0E120F] p-4 font-mono text-xs leading-relaxed">
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
                      ? 'bg-primary/14 hover:bg-primary/18'
                      : 'hover:bg-secondary/60'
                  }`}
                >
                  <span
                    className={`table-cell select-none text-right pr-4 pl-2 font-mono text-[11px] w-12 align-top ${
                      isHighlighted
                        ? 'text-primary font-semibold border-l-2 border-primary'
                        : 'text-muted-foreground/70 group-hover:text-muted-foreground'
                    }`}
                  >
                    {lineNum}
                  </span>
                  <span className="table-cell whitespace-pre text-foreground/90 pl-3 border-l border-border break-all font-mono select-text">
                    {line || ' '}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border bg-sidebar flex items-center justify-between text-[11px] text-muted-foreground font-mono">
          <span>
            {selectedLineRange?.startLine
              ? `Highlighted L${selectedLineRange.startLine}-L${selectedLineRange.endLine || selectedLineRange.startLine}`
              : 'Read-only source inspector'}
          </span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
}
