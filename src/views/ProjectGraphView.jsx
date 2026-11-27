import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Layers,
  Eye,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { EXTENSION_CONFIG, getFileExtension } from '../constants/fileTypes';

const NODE_WIDTH = 170;
const NODE_HEIGHT = 56;

// Helper to compute intersection of directed ray from center with rectangle boundary
function getNodeEdgeIntersection(cx, cy, tx, ty, width = NODE_WIDTH, height = NODE_HEIGHT, extraPadding = 8) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = width / 2 + extraPadding;
  const halfH = height / 2 + extraPadding;

  const scaleX = Math.abs(dx) > 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

export function ProjectGraphView({
  impactOverlay = null,
  embedded = false,
  onOpenFileAtLine = null,
} = {}) {
  const {
    files,
    loadSampleProject,
    setSelectedFile,
  } = useWorkspace();

  const svgRef = useRef(null);
  const containerRef = useRef(null);

  // Viewport transformation: pan and zoom
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedNodeName, setSelectedNodeName] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [showLegend, setShowLegend] = useState(true);
  const [focusImpactedOnly, setFocusImpactedOnly] = useState(false);

  const isImpactActive = Boolean(impactOverlay?.active);
  const impactEdgeSet = useMemo(
    () => new Set(impactOverlay?.highlightedEdges || []),
    [impactOverlay]
  );

  const getImpactStateForFile = useCallback(
    (file) => {
      if (!isImpactActive || !file || !impactOverlay?.nodeStates) return null;
      return (
        impactOverlay.nodeStates[file.id] ||
        impactOverlay.nodeStates[file.path] ||
        impactOverlay.nodeStates[file.name] ||
        null
      );
    },
    [isImpactActive, impactOverlay]
  );

  // Node positions: { [fileName]: { x, y } }
  const [nodePositions, setNodePositions] = useState({});

  // Dragging state
  const isDraggingCanvas = useRef(false);
  const isDraggingNode = useRef(false);
  const dragTargetNode = useRef(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const initialPanOrNodePos = useRef({ x: 0, y: 0 });

  // Map of file objects by name
  const filesByName = useMemo(() => {
    const map = new Map();
    files.forEach((f) => map.set(f.name, f));
    return map;
  }, [files]);

  // Compute all resolved edges: { id, source (importing), target (imported) }
  const edges = useMemo(() => {
    const list = [];
    const edgeSet = new Set();

    files.forEach((file) => {
      const rawDeps = Array.isArray(file.dependencies)
        ? file.dependencies
        : file.dependencies?.resolved || [];

      rawDeps.forEach((dep) => {
        const targetName =
          typeof dep === 'string'
            ? dep
            : dep?.resolvedFileName || dep?.name || dep?.source;

        // Only create edge if target file actually exists in workspace
        if (targetName && filesByName.has(targetName)) {
          const edgeId = `${file.name}->${targetName}`;
          if (!edgeSet.has(edgeId)) {
            edgeSet.add(edgeId);
            list.push({
              id: edgeId,
              source: file.name,
              target: targetName,
            });
          }
        }
      });
    });

    return list;
  }, [files, filesByName]);

  // Determine connected vs isolated files
  const nodeMetadata = useMemo(() => {
    const meta = new Map();

    files.forEach((file) => {
      const rawDeps = Array.isArray(file.dependencies)
        ? file.dependencies
        : file.dependencies?.resolved || [];
      const resolvedDeps = [];
      const seenDeps = new Set();

      rawDeps.forEach((dep) => {
        const targetName =
          typeof dep === 'string'
            ? dep
            : dep?.resolvedFileName || dep?.name || dep?.source;

        if (targetName && filesByName.has(targetName) && !seenDeps.has(targetName)) {
          seenDeps.add(targetName);
          resolvedDeps.push(targetName);
        }
      });

      const rawImporters = file.importedBy || [];
      const importers = [];
      const seenImporters = new Set();

      rawImporters.forEach((imp) => {
        const impName =
          typeof imp === 'string' ? imp : imp?.fileName || imp?.name;

        if (impName && filesByName.has(impName) && !seenImporters.has(impName)) {
          seenImporters.add(impName);
          importers.push(impName);
        }
      });

      const isIsolated = resolvedDeps.length === 0 && importers.length === 0;

      const rawUnresolved =
        file.dependencies?.unresolved || file.unresolvedImports || [];
      const unresolved = rawUnresolved.map((u) => ({
        path: u.path || u.source || 'unknown',
        type: u.type || (u.isExternal ? 'external' : 'missing_relative'),
      }));

      meta.set(file.name, {
        file,
        resolvedDeps,
        importers,
        isIsolated,
        unresolved,
      });
    });

    return meta;
  }, [files, filesByName]);

  // Layout calculation: spring/force relaxation
  const calculateLayout = useCallback(() => {
    if (files.length === 0) {
      setNodePositions({});
      return;
    }

    const containerW = containerRef.current?.clientWidth || 1000;
    const containerH = containerRef.current?.clientHeight || 650;
    const centerX = containerW / 2;
    const centerY = containerH / 2;

    const positions = {};
    const count = files.length;

    // Distinguish connected and isolated files
    const connectedFiles = files.filter((f) => !nodeMetadata.get(f.name)?.isIsolated);
    const isolatedFiles = files.filter((f) => nodeMetadata.get(f.name)?.isIsolated);

    // Initial placement: connected nodes in a circle, isolated nodes in an outer ring or bottom row
    if (connectedFiles.length > 0) {
      const radius = Math.max(160, Math.min(containerW, containerH) * 0.32);
      connectedFiles.forEach((f, idx) => {
        const angle = (idx / connectedFiles.length) * 2 * Math.PI - Math.PI / 2;
        positions[f.name] = {
          x: centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 20,
          y: centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 20,
        };
      });
    }

    if (isolatedFiles.length > 0) {
      const isoRadius = Math.max(260, Math.min(containerW, containerH) * 0.44);
      isolatedFiles.forEach((f, idx) => {
        const angle = (idx / isolatedFiles.length) * 2 * Math.PI + Math.PI / 4;
        positions[f.name] = {
          x: centerX + isoRadius * Math.cos(angle),
          y: centerY + isoRadius * Math.sin(angle),
        };
      });
    }

    // Force simulation relaxation (run 60 iterations synchronously)
    const iterations = 60;
    const kRepulsion = 18000;
    const kSpring = 0.04;
    const desiredLength = 220;

    for (let iter = 0; iter < iterations; iter++) {
      const forces = {};
      files.forEach((f) => {
        forces[f.name] = { fx: 0, fy: 0 };
      });

      // Repulsion between all node pairs
      for (let i = 0; i < count; i++) {
        const nameA = files[i].name;
        const posA = positions[nameA];
        for (let j = i + 1; j < count; j++) {
          const nameB = files[j].name;
          const posB = positions[nameB];
          const dx = posB.x - posA.x;
          const dy = posB.y - posA.y;
          const distSq = dx * dx + dy * dy + 400; // soft min distance
          const dist = Math.sqrt(distSq);
          const force = kRepulsion / distSq;

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          forces[nameA].fx -= fx;
          forces[nameA].fy -= fy;
          forces[nameB].fx += fx;
          forces[nameB].fy += fy;
        }
      }

      // Spring attraction along edges
      edges.forEach((edge) => {
        const posSource = positions[edge.source];
        const posTarget = positions[edge.target];
        if (posSource && posTarget) {
          const dx = posTarget.x - posSource.x;
          const dy = posTarget.y - posSource.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const delta = dist - desiredLength;
          const force = delta * kSpring;

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          forces[edge.source].fx += fx;
          forces[edge.source].fy += fy;
          forces[edge.target].fx -= fx;
          forces[edge.target].fy -= fy;
        }
      });

      // Centering force
      files.forEach((f) => {
        const pos = positions[f.name];
        const dx = centerX - pos.x;
        const dy = centerY - pos.y;
        forces[f.name].fx += dx * 0.015;
        forces[f.name].fy += dy * 0.015;
      });

      // Apply displacement with damping
      const damping = Math.max(0.2, 1 - iter / iterations);
      files.forEach((f) => {
        const force = forces[f.name];
        positions[f.name].x += Math.max(-25, Math.min(25, force.fx * damping));
        positions[f.name].y += Math.max(-25, Math.min(25, force.fy * damping));
      });
    }

    setNodePositions(positions);
  }, [files, edges, nodeMetadata]);

  // Initial layout on file changes
  useEffect(() => {
    calculateLayout();
  }, [calculateLayout]);

  // Reset view to center and 1x zoom
  const handleResetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setSelectedNodeName(null);
    setFocusImpactedOnly(false);
    calculateLayout();
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(2.5, +(prev * 1.2).toFixed(2)));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.3, +(prev / 1.2).toFixed(2)));
  };

  // Canvas wheel zooming
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setZoom((prev) => Math.min(2.5, Math.max(0.3, +(prev * zoomFactor).toFixed(2))));
  };

  // Node Drag Handlers
  const handleNodePointerDown = (e, fileName) => {
    e.stopPropagation();
    isDraggingNode.current = true;
    dragTargetNode.current = fileName;
    dragStartPos.current = { x: e.clientX, y: e.clientY };

    const currentPos = nodePositions[fileName] || { x: 0, y: 0 };
    initialPanOrNodePos.current = { ...currentPos };

    if (e.target.setPointerCapture) {
      e.target.setPointerCapture(e.pointerId);
    }
  };

  // Canvas Pan Handlers
  const handleCanvasPointerDown = (e) => {
    if (e.button !== 0) return; // Only primary button
    isDraggingCanvas.current = true;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    initialPanOrNodePos.current = { ...pan };

    if (svgRef.current?.setPointerCapture) {
      svgRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e) => {
    if (isDraggingNode.current && dragTargetNode.current) {
      const dx = (e.clientX - dragStartPos.current.x) / zoom;
      const dy = (e.clientY - dragStartPos.current.y) / zoom;

      setNodePositions((prev) => ({
        ...prev,
        [dragTargetNode.current]: {
          x: initialPanOrNodePos.current.x + dx,
          y: initialPanOrNodePos.current.y + dy,
        },
      }));
    } else if (isDraggingCanvas.current) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;

      setPan({
        x: initialPanOrNodePos.current.x + dx,
        y: initialPanOrNodePos.current.y + dy,
      });
    }
  };

  const handlePointerUp = (e) => {
    if (isDraggingNode.current) {
      isDraggingNode.current = false;
      dragTargetNode.current = null;
      if (e.target?.releasePointerCapture) {
        try {
          e.target.releasePointerCapture(e.pointerId);
        } catch {}
      }
    }
    if (isDraggingCanvas.current) {
      isDraggingCanvas.current = false;
      if (svgRef.current?.releasePointerCapture) {
        try {
          svgRef.current.releasePointerCapture(e.pointerId);
        } catch {}
      }
    }
  };

  // Selected file details
  const selectedMeta = selectedNodeName ? nodeMetadata.get(selectedNodeName) : null;

  // Filtered files count for search
  const searchMatches = useMemo(() => {
    if (!searchFilter.trim()) return new Set();
    const q = searchFilter.toLowerCase();
    const set = new Set();
    files.forEach((f) => {
      if (f.name.toLowerCase().includes(q)) {
        set.add(f.name);
      }
    });
    return set;
  }, [files, searchFilter]);

  // Overall statistics
  const totalConnected = files.filter((f) => !nodeMetadata.get(f.name)?.isIsolated).length;
  const totalIsolated = files.length - totalConnected;
  const visibleFiles = useMemo(() => {
    if (!isImpactActive || !focusImpactedOnly) return files;
    const filtered = files.filter((f) => Boolean(getImpactStateForFile(f)));
    return filtered.length > 0 ? filtered : files;
  }, [files, isImpactActive, focusImpactedOnly, getImpactStateForFile]);
  const visibleNameSet = useMemo(
    () => new Set(visibleFiles.map((f) => f.name)),
    [visibleFiles]
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col h-full w-full overflow-hidden bg-background relative select-none"
    >
      {/* Top Toolbar */}
      <div
        className={`${
          embedded ? 'h-12 px-3 sm:px-4' : 'h-14 px-4 sm:px-6'
        } border-b border-border bg-card/60 flex items-center justify-between shrink-0 z-20 gap-3`}
      >
        {/* Left: View Title & Metrics */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Network className="w-4 h-4" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-semibold text-foreground tracking-tight">
                {isImpactActive ? 'Change Impact Graph' : 'Project Dependency Graph'}
              </h1>
              {!embedded && (
                <p className="text-[10px] text-muted-foreground font-mono">
                  Visualizing file dependencies & architecture
                </p>
              )}
            </div>
          </div>

          {files.length > 0 && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary border border-border text-foreground">
                <span className="font-semibold text-primary">{visibleFiles.length}</span>
                <span className="text-muted-foreground">nodes</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary border border-border text-foreground">
                <span className="font-semibold text-primary">{edges.length}</span>
                <span className="text-muted-foreground">edges</span>
              </span>
              {!isImpactActive && (
                <>
                  <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-success/10 text-success border border-success/25">
                    {totalConnected} connected
                  </span>
                  {totalIsolated > 0 && (
                    <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-warning/10 text-warning border border-warning/25">
                      {totalIsolated} isolated
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Center: Search / Filter in Graph */}
        {files.length > 0 && (
          <div className="relative max-w-xs w-full hidden sm:block">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Find node in graph..."
              className="w-full bg-secondary/80 border border-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-primary font-mono transition-all"
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Right: Controls & Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isImpactActive && (
            <button
              type="button"
              onClick={() => setFocusImpactedOnly((prev) => !prev)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                focusImpactedOnly
                  ? 'bg-primary/15 text-primary border-primary/35'
                  : 'bg-secondary text-muted-foreground hover:text-foreground border-border'
              }`}
              title="Toggle between impacted components only and full workspace"
            >
              {focusImpactedOnly ? 'Show All' : 'Focus Impacted'}
            </button>
          )}
          <div className="flex items-center bg-secondary border border-border rounded-lg p-0.5 shadow-xs">
            <button
              onClick={handleZoomIn}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors cursor-pointer"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono text-muted-foreground px-1.5 min-w-[38px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomOut}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors cursor-pointer"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={handleResetView}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border border-border rounded-lg transition-colors cursor-pointer shadow-xs"
            title="Reset Pan, Zoom, and Auto-Layout"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reset Layout</span>
          </button>

          <button
            onClick={() => setShowLegend((prev) => !prev)}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-xs ${
              showLegend
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
            }`}
            title="Toggle Graph Legend"
            aria-label="Toggle Legend"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas Area */}
      <div className="flex-1 relative w-full h-full overflow-hidden forge-graph-stage">
        {files.length === 0 ? (
          /* Empty Workspace State */
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10">
            <div className="w-16 h-16 rounded-xl forge-panel flex items-center justify-center mb-4 text-primary">
              <Network className="w-7 h-7" />
            </div>
            <h2 className="font-display text-lg font-semibold text-foreground mb-1.5">
              No Project Files Loaded
            </h2>
            <p className="text-xs text-muted-foreground max-w-sm mb-5 leading-relaxed">
              Import project files or load the built-in sample codebase to explore file relationships in an interactive spatial dependency graph.
            </p>
            <button
              onClick={loadSampleProject}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-white transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Load Sample Codebase</span>
            </button>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="w-full h-full cursor-grab active:cursor-grabbing select-none"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          >
            {/* SVG Markers, Glow Filter & Spatial Grid */}
            <defs>
              <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <marker
                id="arrow-default"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#52525B" />
              </marker>

              <marker
                id="arrow-outgoing"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#FFFFFF" />
              </marker>

              <marker
                id="arrow-incoming"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#A1A1AA" />
              </marker>

              <marker
                id="arrow-dimmed"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#27272A" opacity="0.4" />
              </marker>

              <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1" fill="#27272A" opacity="0.4" />
              </pattern>
            </defs>

            {/* Background Grid */}
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Transform Group (Pan & Zoom) */}
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Edges Layer */}
              <g className="edges-layer">
                {edges.map((edge) => {
                  if (!visibleNameSet.has(edge.source) || !visibleNameSet.has(edge.target)) return null;
                  const sourcePos = nodePositions[edge.source];
                  const targetPos = nodePositions[edge.target];
                  if (!sourcePos || !targetPos) return null;

                  const isSelectedOutgoing = selectedNodeName === edge.source;
                  const isSelectedIncoming = selectedNodeName === edge.target;
                  const hasSelection = Boolean(selectedNodeName);
                  const isImpactEdge = isImpactActive && impactEdgeSet.has(edge.id);
                  const isHighlighted = hasSelection
                    ? isSelectedOutgoing || isSelectedIncoming
                    : isImpactEdge;
                  const isDimmed = hasSelection
                    ? !(isSelectedOutgoing || isSelectedIncoming)
                    : isImpactActive && !isImpactEdge;

                  const startPoint = getNodeEdgeIntersection(
                    sourcePos.x,
                    sourcePos.y,
                    targetPos.x,
                    targetPos.y,
                    NODE_WIDTH,
                    NODE_HEIGHT,
                    2
                  );

                  const endPoint = getNodeEdgeIntersection(
                    targetPos.x,
                    targetPos.y,
                    sourcePos.x,
                    sourcePos.y,
                    NODE_WIDTH,
                    NODE_HEIGHT,
                    8
                  );

                  let markerUrl = 'url(#arrow-default)';
                  let strokeColor = '#3F3F46';
                  let strokeWidth = 1.5;

                  if (isSelectedOutgoing) {
                    markerUrl = 'url(#arrow-outgoing)';
                    strokeColor = '#FFFFFF';
                    strokeWidth = 2.2;
                  } else if (isSelectedIncoming) {
                    markerUrl = 'url(#arrow-incoming)';
                    strokeColor = '#A1A1AA';
                    strokeWidth = 2.0;
                  } else if (isImpactEdge && !hasSelection) {
                    markerUrl = 'url(#arrow-outgoing)';
                    strokeColor = '#D4D4D4';
                    strokeWidth = 2.0;
                  } else if (isDimmed) {
                    markerUrl = 'url(#arrow-dimmed)';
                    strokeColor = '#27272A';
                    strokeWidth = 1;
                  }

                  return (
                    <g key={edge.id}>
                      {/* Base static path */}
                      <line
                        x1={startPoint.x}
                        y1={startPoint.y}
                        x2={endPoint.x}
                        y2={endPoint.y}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeOpacity={isDimmed ? 0.18 : isHighlighted ? 0.45 : 0.78}
                        markerEnd={markerUrl}
                        filter={isHighlighted ? 'url(#edge-glow)' : undefined}
                      />
                      {/* Animated directional flow overlay on active dependency paths */}
                      {isHighlighted && (
                        <line
                          x1={startPoint.x}
                          y1={startPoint.y}
                          x2={endPoint.x}
                          y2={endPoint.y}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeOpacity={0.95}
                          className="forge-edge-animated"
                        />
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Nodes Layer */}
              <g className="nodes-layer">
                {visibleFiles.map((file) => {
                  const pos = nodePositions[file.name] || { x: 0, y: 0 };
                  const meta = nodeMetadata.get(file.name);
                  const impactState = getImpactStateForFile(file);
                  const isSelected = selectedNodeName === file.name;
                  const isOutgoingTarget =
                    selectedNodeName && selectedMeta?.resolvedDeps?.includes(file.name);
                  const isIncomingSource =
                    selectedNodeName && selectedMeta?.importers?.includes(file.name);

                  const hasSelection = Boolean(selectedNodeName);
                  const isDirectlyConnected = isSelected || isOutgoingTarget || isIncomingSource;
                  const isDimmed = hasSelection
                    ? !isDirectlyConnected
                    : isImpactActive && !impactState;

                  const isSearchMatch =
                    searchMatches.size > 0 && searchMatches.has(file.name);

                  const ext = getFileExtension(file.name);
                  const extConfig = EXTENSION_CONFIG[ext] || {
                    label: ext.replace('.', '').toUpperCase() || 'FILE',
                    color: 'text-muted-foreground border-white/10 bg-secondary',
                  };

                  const impactCardClass =
                    impactState?.state === 'target'
                      ? 'bg-[#18191E] border-white ring-2 ring-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_14px_28px_-10px_rgba(0,0,0,0.9)] z-30'
                      : impactState?.state === 'high_risk'
                        ? 'bg-[#18191E] border-destructive ring-1 ring-destructive/40 z-20'
                        : impactState?.state === 'medium_risk'
                          ? 'bg-[#18191E] border-white/40 ring-1 ring-white/20 z-20'
                          : impactState?.state === 'low_risk' || impactState?.state === 'related'
                            ? 'bg-[#141519] border-white/20 z-20'
                            : null;

                  return (
                    <g
                      key={file.id}
                      transform={`translate(${pos.x - NODE_WIDTH / 2}, ${pos.y - NODE_HEIGHT / 2})`}
                      className="cursor-pointer"
                      onPointerDown={(e) => handleNodePointerDown(e, file.name)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNodeName((prev) => (prev === file.name ? null : file.name));
                      }}
                    >
                      <foreignObject width={NODE_WIDTH} height={NODE_HEIGHT} className="overflow-visible">
                        <div
                          className={`w-full h-full rounded-lg p-2.5 flex flex-col justify-between transition-all duration-200 select-none border ${
                            isSelected
                              ? 'bg-[#1E2026] border-white ring-2 ring-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_18px_36px_-10px_rgba(0,0,0,0.95)] scale-[1.06] z-30'
                              : impactCardClass
                              ? impactCardClass
                              : isOutgoingTarget
                              ? 'bg-[#18191E] border-white/60 ring-1 ring-white/20 shadow-[0_14px_26px_-12px_rgba(0,0,0,0.9)] z-20'
                              : isIncomingSource
                              ? 'bg-[#18191E] border-white/40 ring-1 ring-white/20 shadow-[0_14px_26px_-12px_rgba(0,0,0,0.9)] z-20'
                              : isSearchMatch
                              ? 'bg-card border-white ring-2 ring-white/30 shadow-lg z-20'
                              : meta?.isIsolated
                              ? 'bg-[#111215]/85 border-white/10 border-dashed text-muted-foreground hover:border-white/20'
                              : 'forge-card-3d text-foreground'
                          } ${isDimmed ? 'opacity-25' : 'opacity-100'}`}
                        >
                          {/* Top Row: File Name & Extension Badge */}
                          <div className="flex items-center justify-between gap-1.5 min-w-0">
                            <span
                              className="font-mono text-[11px] font-semibold text-foreground truncate"
                              title={file.name}
                            >
                              {file.name}
                            </span>
                            <span
                              className={`text-[9px] font-mono px-1 py-0.2 rounded border shrink-0 ${extConfig.color}`}
                            >
                              {extConfig.label.slice(0, 4)}
                            </span>
                          </div>

                          {/* Bottom Row: Status Indicator & Dependency Counts */}
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono pt-1 border-t border-border/50">
                            <div className="flex items-center gap-1.5">
                              {meta?.isIsolated ? (
                                <span className="flex items-center gap-1 text-muted-foreground/70 text-[9px]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
                                  <span>isolated</span>
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-success text-[9px]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                                  <span>connected</span>
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-[9px]">
                              {/* Outgoing (depends on) */}
                              <span
                                className="flex items-center gap-0.5 text-primary"
                                title={`${meta?.resolvedDeps.length || 0} dependencies imported by this file`}
                              >
                                <ArrowRight className="w-2.5 h-2.5" />
                                <span>{meta?.resolvedDeps.length || 0}</span>
                              </span>

                              {/* Incoming (imported by) */}
                              <span
                                className="flex items-center gap-0.5 text-success"
                                title={`Imported by ${meta?.importers.length || 0} files`}
                              >
                                <ArrowLeft className="w-2.5 h-2.5" />
                                <span>{meta?.importers.length || 0}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </foreignObject>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}

        {/* Legend Overlay Card */}
        {showLegend && files.length > 0 && (
          <div className="absolute bottom-4 left-4 p-3 rounded-lg bg-card/95 border border-border shadow-lg z-20 text-xs font-mono space-y-2 max-w-xs">
            <div className="flex items-center justify-between pb-1 border-b border-border/60 text-[11px] text-muted-foreground uppercase font-semibold">
              <span>{isImpactActive ? 'Impact Legend' : 'Graph Legend'}</span>
              <button
                onClick={() => setShowLegend(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {isImpactActive ? (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-primary shrink-0" />
                  <span className="text-primary">Target Component</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-destructive shrink-0" />
                  <span className="text-destructive">Critical / High Impact</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-warning shrink-0" />
                  <span className="text-warning">Medium Impact / Direct</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-success shrink-0" />
                  <span className="text-success">Low Impact / Indirect</span>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                  <span className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/40 shrink-0" />
                  <span className="text-muted-foreground">Unaffected</span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                  <span className="text-foreground">Connected Node</span>
                  <span className="text-muted-foreground text-[10px] ml-auto">Has links</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/60 shrink-0" />
                  <span className="text-muted-foreground">Isolated Node</span>
                  <span className="text-muted-foreground text-[10px] ml-auto">No local links</span>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                  <div className="w-3 h-0.5 bg-primary shrink-0" />
                  <span className="text-primary">Dependency (Outgoing)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-success shrink-0" />
                  <span className="text-success">Importer (Incoming)</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Selected Node Details Drawer */}
        {selectedMeta && (
          <div className="absolute top-4 right-4 w-80 sm:w-88 max-h-[calc(100%-2rem)] flex flex-col rounded-lg bg-card/95  border border-border shadow-2xl z-30 overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-border flex items-start justify-between gap-2 bg-secondary/30">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-bold text-foreground truncate">
                    {selectedMeta.file.name}
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                      EXTENSION_CONFIG[getFileExtension(selectedMeta.file.name)]?.color || ''
                    }`}
                  >
                    {EXTENSION_CONFIG[getFileExtension(selectedMeta.file.name)]?.label || 'FILE'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                  <span>{selectedMeta.file.lineCount} LOC</span>
                  <span>•</span>
                  <span>{(selectedMeta.file.size / 1024).toFixed(1)} KB</span>
                  <span>•</span>
                  {selectedMeta.isIsolated ? (
                    <span className="text-warning">Isolated</span>
                  ) : (
                    <span className="text-success">Connected</span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSelectedNodeName(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="p-4 overflow-y-auto space-y-4 text-xs font-mono max-h-[420px]">
              {isImpactActive && getImpactStateForFile(selectedMeta.file) && (
                <div className="p-2.5 rounded-lg bg-[#111215] border border-white/15 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] uppercase text-white font-semibold">
                    <span>Impact Role: {getImpactStateForFile(selectedMeta.file).dependencyType.replace(/_/g, ' ')}</span>
                    {getImpactStateForFile(selectedMeta.file).severity && (
                      <span>{getImpactStateForFile(selectedMeta.file).severity}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-foreground/90 break-all">
                    Path: {getImpactStateForFile(selectedMeta.file).dependencyPath.join(' → ')}
                  </p>
                </div>
              )}

              {/* Dependencies Section (Files imported by this file) */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase mb-2">
                  <span className="flex items-center gap-1.5 text-primary">
                    <ArrowRight className="w-3.5 h-3.5" />
                    Dependencies ({selectedMeta.resolvedDeps.length})
                  </span>
                  <span className="text-[10px] lowercase text-muted-foreground/70">imported by this</span>
                </div>

                {selectedMeta.resolvedDeps.length > 0 ? (
                  <div className="space-y-1">
                    {selectedMeta.resolvedDeps.map((depName) => (
                      <button
                        key={depName}
                        onClick={() => setSelectedNodeName(depName)}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-primary/10 border border-border/80 hover:border-primary/30 text-left transition-colors cursor-pointer group"
                      >
                        <span className="font-mono text-[11px] text-foreground group-hover:text-primary truncate">
                          {depName}
                        </span>
                        <ArrowRight className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground/70 italic px-2 py-1 bg-secondary/30 rounded border border-border/40">
                    No local workspace dependencies imported.
                  </p>
                )}
              </div>

              {/* Imported By Section (Files that import this file) */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase mb-2">
                  <span className="flex items-center gap-1.5 text-success">
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Imported By ({selectedMeta.importers.length})
                  </span>
                  <span className="text-[10px] lowercase text-muted-foreground/70">callers / importers</span>
                </div>

                {selectedMeta.importers.length > 0 ? (
                  <div className="space-y-1">
                    {selectedMeta.importers.map((impName) => (
                      <button
                        key={impName}
                        onClick={() => setSelectedNodeName(impName)}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-success/10 border border-border/80 hover:border-success/35 text-left transition-colors cursor-pointer group"
                      >
                        <span className="font-mono text-[11px] text-foreground group-hover:text-success truncate">
                          {impName}
                        </span>
                        <ArrowLeft className="w-3 h-3 text-muted-foreground group-hover:text-success shrink-0" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground/70 italic px-2 py-1 bg-secondary/30 rounded border border-border/40">
                    Not imported by any workspace files (root entry or utility).
                  </p>
                )}
              </div>

              {/* External & Unresolved Imports */}
              {selectedMeta.unresolved.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-2">
                    External & Unresolved ({selectedMeta.unresolved.length})
                  </div>
                  <div className="space-y-1">
                    {selectedMeta.unresolved.map((u, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-1.5 rounded-md bg-secondary/30 border border-border/60 text-[11px]"
                      >
                        <span className="text-foreground truncate">{u.path}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded border ${
                            u.type === 'external'
                              ? 'bg-secondary text-muted-foreground border-border'
                              : 'bg-warning/10 text-warning border-warning/25'
                          }`}
                        >
                          {u.type === 'external' ? 'package' : 'missing'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Drawer Actions */}
            <div className="p-3 border-t border-border bg-secondary/20 flex items-center gap-2">
              <button
                onClick={() =>
                  onOpenFileAtLine
                    ? onOpenFileAtLine(selectedMeta.file, { startLine: 1, endLine: 1 })
                    : setSelectedFile(selectedMeta.file)
                }
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition-all cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Source Code</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
