import React, { useState, useMemo, useRef } from 'react';
import {
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  Box,
  Package,
  FileCode,
  Eye,
  Copy,
  Check,
  Download,
  Code2,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { EXTENSION_CONFIG } from '../constants/fileTypes';

const EMPTY_ARCHITECTURE_MODEL = {
  summary: {
    totalFiles: 0,
    totalModules: 0,
    totalLayers: 0,
    totalModuleEdges: 0,
    totalFileEdges: 0,
    totalExternalDeps: 0,
    totalCircularFiles: 0,
    totalCircularModules: 0,
  },
  layers: [],
  modules: [],
  files: [],
  fileEdges: [],
  moduleEdges: [],
  externalDependencies: [],
  highlights: { entryPoints: [], coreHubs: [], isolatedModules: [], cycles: { fileCycles: [], moduleCycles: [] } },
  mermaid: { systemFlowchart: '', moduleFlowchart: '' },
};

const SYS_COL_W = 248;
const SYS_COL_GAP = 88;
const SYS_CARD_W = 220;
const SYS_CARD_H = 84;
const SYS_CARD_GAP = 14;
const SYS_HEADER_H = 44;
const EXT_CARD_H = 42;
const CANVAS_PAD = 64;

const MOD_BOX_W = 290;
const MOD_COL_GAP = 64;
const MOD_ROW_GAP = 42;
const MOD_HEAD_H = 44;
const MOD_FILE_H = 40;
const MOD_FILE_GAP = 6;
const MOD_BOX_PAD = 12;

function escapeXml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCurvedPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  if (dx < 24) {
    // Same-column vertical loop offset smoothly to the right
    const offset = 52;
    return `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 + offset} ${y2}, ${x2} ${y2}`;
  }
  const cpOffset = Math.max(40, dx * 0.48);
  return `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
}

function buildRoundedPolylinePath(points = [], radius = 10) {
  if (!points || points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const cmds = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1);

    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2);

    if (len1 < 0.5 || len2 < 0.5) {
      cmds.push(`L ${curr.x} ${curr.y}`);
      continue;
    }

    const r = Math.min(radius, len1 / 2, len2 / 2);
    const beforeX = curr.x - (dx1 / len1) * r;
    const beforeY = curr.y - (dy1 / len1) * r;
    const afterX = curr.x + (dx2 / len2) * r;
    const afterY = curr.y + (dy2 / len2) * r;

    cmds.push(`L ${beforeX.toFixed(1)} ${beforeY.toFixed(1)}`);
    cmds.push(`Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${afterX.toFixed(1)} ${afterY.toFixed(1)}`);
  }

  const last = points[points.length - 1];
  cmds.push(`L ${last.x} ${last.y}`);
  return cmds.join(' ');
}

function distributePortsAlongEdge(items = [], box, padding = 14) {
  if (!box || items.length === 0) return new Map();
  const minY = box.y + Math.min(padding, box.height * 0.28);
  const maxY = box.y + box.height - Math.min(padding, box.height * 0.28);
  const span = Math.max(0, maxY - minY);
  const map = new Map();

  items.forEach((item, idx) => {
    const ratio = items.length === 1 ? 0.5 : idx / (items.length - 1);
    map.set(item.edgeId, minY + span * ratio);
  });

  return map;
}

function computeSystemLayout(model) {
  const {
    layers = [],
    modules = [],
    moduleEdges = [],
    externalDependencies = [],
  } = model || {};
  const modulePos = new Map();
  const moduleColIndex = new Map();
  const layerBoxes = [];
  const externalPos = new Map();
  const columnMeta = []; // { colIdx, x, y, width, height, bottom }

  const nonEmptyLayers = layers.filter((l) => modules.some((m) => m.layerId === l.id));

  // Partition layers dynamically: code/connected layers sit before External Packages;
  // purely passive layers (e.g. unlinked Config & Docs) sit after External Packages
  // so active dependency edges do not pass across unrelated passive modules.
  const linkedModIds = new Set();
  for (const e of moduleEdges) {
    linkedModIds.add(e.sourceModuleId);
    linkedModIds.add(e.targetModuleId);
  }
  for (const ext of externalDependencies) {
    for (const mId of ext.usedByModuleIds || []) {
      linkedModIds.add(mId);
    }
  }

  const activeLayers = [];
  const passiveLayers = [];
  for (const layer of nonEmptyLayers) {
    const layerModules = modules.filter((m) => m.layerId === layer.id);
    const hasLinks = layerModules.some((m) => linkedModIds.has(m.id));
    if (layer.id === 'config_docs' && !hasLinks) {
      passiveLayers.push(layer);
    } else {
      activeLayers.push(layer);
    }
  }

  // Keep config_docs last among activeLayers if it only uses externals (e.g. package.json)
  activeLayers.sort((a, b) => {
    if (a.id === 'config_docs' && b.id !== 'config_docs') return 1;
    if (b.id === 'config_docs' && a.id !== 'config_docs') return -1;
    return a.tier - b.tier;
  });

  const visibleExternals = externalDependencies.slice(0, 12);
  const hasExternals = visibleExternals.length > 0;

  let currentColIdx = 0;

  const placeLayerColumn = (layer) => {
    const colIdx = currentColIdx++;
    const colX = CANVAS_PAD + colIdx * (SYS_COL_W + SYS_COL_GAP);
    const layerModules = modules.filter((m) => m.layerId === layer.id);
    const colHeight =
      SYS_HEADER_H +
      layerModules.length * SYS_CARD_H +
      Math.max(0, layerModules.length - 1) * SYS_CARD_GAP +
      16;

    const box = {
      ...layer,
      colIdx,
      x: colX,
      y: CANVAS_PAD,
      width: SYS_COL_W,
      height: colHeight,
    };
    layerBoxes.push(box);
    columnMeta.push({ colIdx, x: colX, y: CANVAS_PAD, width: SYS_COL_W, height: colHeight, bottom: CANVAS_PAD + colHeight });

    layerModules.forEach((mod, rowIdx) => {
      const x = colX + (SYS_COL_W - SYS_CARD_W) / 2;
      const y = CANVAS_PAD + SYS_HEADER_H + rowIdx * (SYS_CARD_H + SYS_CARD_GAP);
      modulePos.set(mod.id, { x, y, width: SYS_CARD_W, height: SYS_CARD_H, colIdx });
      moduleColIndex.set(mod.id, colIdx);
    });
  };

  activeLayers.forEach(placeLayerColumn);

  let externalBox = null;
  let extColIdx = -1;
  if (hasExternals) {
    extColIdx = currentColIdx++;
    const extColX = CANVAS_PAD + extColIdx * (SYS_COL_W + SYS_COL_GAP);

    // Order external packages dynamically by average Y of their importing modules
    // to minimize edge crossings across arbitrary projects
    const sortedExternals = [...visibleExternals].sort((a, b) => {
      const avgY = (ext) => {
        const ys = (ext.usedByModuleIds || [])
          .map((mId) => modulePos.get(mId))
          .filter(Boolean)
          .map((p) => p.y + p.height / 2);
        return ys.length > 0 ? ys.reduce((s, v) => s + v, 0) / ys.length : Number.MAX_SAFE_INTEGER;
      };
      const dy = avgY(a) - avgY(b);
      if (Math.abs(dy) > 1) return dy;
      return b.importCount - a.importCount || a.name.localeCompare(b.name);
    });

    const extHeight =
      SYS_HEADER_H +
      sortedExternals.length * EXT_CARD_H +
      Math.max(0, sortedExternals.length - 1) * 10 +
      16;
    externalBox = {
      id: 'layer:external',
      label: 'External Packages',
      accent: '#D4D4D8',
      colIdx: extColIdx,
      x: extColX,
      y: CANVAS_PAD,
      width: SYS_COL_W,
      height: extHeight,
      totalCount: externalDependencies.length,
    };
    columnMeta.push({
      colIdx: extColIdx,
      x: extColX,
      y: CANVAS_PAD,
      width: SYS_COL_W,
      height: extHeight,
      bottom: CANVAS_PAD + extHeight,
    });

    sortedExternals.forEach((ext, idx) => {
      externalPos.set(ext.id, {
        x: extColX + (SYS_COL_W - SYS_CARD_W) / 2,
        y: CANVAS_PAD + SYS_HEADER_H + idx * (EXT_CARD_H + 10),
        width: SYS_CARD_W,
        height: EXT_CARD_H,
        colIdx: extColIdx,
      });
    });

    passiveLayers.forEach(placeLayerColumn);
    return {
      layerBoxes,
      modulePos,
      moduleColIndex,
      externalBox,
      externalPos,
      extColIdx,
      visibleExternals: sortedExternals,
      columnMeta,
    };
  }

  passiveLayers.forEach(placeLayerColumn);
  return {
    layerBoxes,
    modulePos,
    moduleColIndex,
    externalBox,
    externalPos,
    extColIdx,
    visibleExternals: [],
    columnMeta,
  };
}

/**
 * Computes obstacle-aware SVG edge routes with separated source/target anchors
 * for both module-to-module edges and module-to-external dependency links.
 */
function computeSystemRoutes(model, systemLayout) {
  const { moduleEdges = [] } = model || {};
  const { modulePos, externalPos, visibleExternals = [], columnMeta = [] } = systemLayout;

  const rawConnections = [];

  for (const edge of moduleEdges) {
    const s = modulePos.get(edge.sourceModuleId);
    const t = modulePos.get(edge.targetModuleId);
    if (!s || !t) continue;
    rawConnections.push({
      kind: 'module',
      edgeId: `modedge:${edge.id}`,
      sourceId: edge.sourceModuleId,
      targetId: edge.targetModuleId,
      s,
      t,
      isCycleEdge: Boolean(edge.isCycleEdge),
      weight: edge.weight || 1,
    });
  }

  for (const ext of visibleExternals) {
    const t = externalPos.get(ext.id);
    if (!t) continue;
    for (const modId of ext.usedByModuleIds || []) {
      const s = modulePos.get(modId);
      if (!s) continue;
      rawConnections.push({
        kind: 'external',
        edgeId: `extedge:${modId}->${ext.id}`,
        sourceId: modId,
        targetId: ext.id,
        s,
        t,
        isCycleEdge: false,
        weight: 1,
      });
    }
  }

  // Group outgoing & incoming edges per node to separate anchors cleanly along card borders
  const outgoingByNode = new Map();
  const incomingByNode = new Map();

  for (const conn of rawConnections) {
    if (!outgoingByNode.has(conn.sourceId)) outgoingByNode.set(conn.sourceId, []);
    outgoingByNode.get(conn.sourceId).push(conn);

    if (!incomingByNode.has(conn.targetId)) incomingByNode.set(conn.targetId, []);
    incomingByNode.get(conn.targetId).push(conn);
  }

  const outPortY = new Map();
  for (const [nodeId, list] of outgoingByNode.entries()) {
    list.sort((a, b) => {
      const ay = a.t.y + a.t.height / 2;
      const by = b.t.y + b.t.height / 2;
      if (Math.abs(ay - by) > 1) return ay - by;
      return a.t.colIdx - b.t.colIdx || a.edgeId.localeCompare(b.edgeId);
    });
    const box = modulePos.get(nodeId);
    const ports = distributePortsAlongEdge(list, box, 14);
    for (const [k, v] of ports.entries()) outPortY.set(k, v);
  }

  const inPortY = new Map();
  for (const [nodeId, list] of incomingByNode.entries()) {
    list.sort((a, b) => {
      const ay = a.s.y + a.s.height / 2;
      const by = b.s.y + b.s.height / 2;
      if (Math.abs(ay - by) > 1) return ay - by;
      return a.s.colIdx - b.s.colIdx || a.edgeId.localeCompare(b.edgeId);
    });
    const box = modulePos.get(nodeId) || externalPos.get(nodeId);
    const pad = externalPos.has(nodeId) ? 10 : 14;
    const ports = distributePortsAlongEdge(list, box, pad);
    for (const [k, v] of ports.entries()) inPortY.set(k, v);
  }

  const gutterOutCounts = new Map();
  const gutterInCounts = new Map();
  let topBypassCount = 0;
  let bottomBypassCount = 0;

  const moduleRoutes = [];
  const externalRoutes = [];

  for (const conn of rawConnections) {
    const { s, t, edgeId, kind } = conn;
    const y1 = outPortY.get(edgeId) ?? s.y + s.height / 2;
    const y2 = inPortY.get(edgeId) ?? t.y + t.height / 2;
    const colDelta = t.colIdx - s.colIdx;
    const arrowPad = kind === 'external' ? 5 : 6;

    let path = '';

    if (colDelta === 1) {
      // Directly adjacent columns: clean Bezier across unobstructed gutter
      path = buildCurvedPath(s.x + s.width, y1, t.x - arrowPad, y2);
    } else if (colDelta === 0) {
      // Same-column connection: smooth right-side loop inside column gutter
      const idx = gutterOutCounts.get(s.colIdx) || 0;
      gutterOutCounts.set(s.colIdx, idx + 1);
      const loopX = s.x + s.width + 24 + (idx % 4) * 10;
      const xStart = s.x + s.width;
      const xEnd = t.x + t.width + arrowPad;
      path = buildRoundedPolylinePath(
        [
          { x: xStart, y: y1 },
          { x: loopX, y: y1 },
          { x: loopX, y: y2 },
          { x: xEnd, y: y2 },
        ],
        10
      );
    } else {
      // Multi-column skip or backward edge: route around all intervening column containers
      const minCol = Math.min(s.colIdx, t.colIdx);
      const maxCol = Math.max(s.colIdx, t.colIdx);
      let maxInterBottom = Math.max(s.y + s.height, t.y + t.height);
      for (const col of columnMeta) {
        if (col.colIdx > minCol && col.colIdx < maxCol) {
          maxInterBottom = Math.max(maxInterBottom, col.bottom);
        } else if (col.colIdx === minCol || col.colIdx === maxCol) {
          if (colDelta < 0) {
            maxInterBottom = Math.max(maxInterBottom, col.bottom);
          }
        }
      }

      const outIdx = gutterOutCounts.get(s.colIdx) || 0;
      gutterOutCounts.set(s.colIdx, outIdx + 1);
      const inIdx = gutterInCounts.get(t.colIdx) || 0;
      gutterInCounts.set(t.colIdx, inIdx + 1);

      const xStart = s.x + s.width;
      const xEnd = t.x - arrowPad;
      const gutterX1 = xStart + 14 + (outIdx % 5) * 9;
      const gutterX2 = t.x - 16 - (inIdx % 5) * 9;

      // Choose shorter obstacle-free highway (above column tops vs below intervening column bottoms)
      const topCost = y1 - CANVAS_PAD + (y2 - CANVAS_PAD);
      const bottomCost = Math.max(0, maxInterBottom - y1) + Math.max(0, maxInterBottom - y2);
      const useTopLane = colDelta > 1 && topCost + 40 < bottomCost && CANVAS_PAD >= 48;

      let laneY;
      if (useTopLane) {
        laneY = CANVAS_PAD - 16 - topBypassCount * 10;
        topBypassCount += 1;
      } else {
        laneY = maxInterBottom + 20 + bottomBypassCount * 11;
        bottomBypassCount += 1;
      }

      path = buildRoundedPolylinePath(
        [
          { x: xStart, y: y1 },
          { x: gutterX1, y: y1 },
          { x: gutterX1, y: laneY },
          { x: gutterX2, y: laneY },
          { x: gutterX2, y: y2 },
          { x: xEnd, y: y2 },
        ],
        10
      );
    }

    const routed = { ...conn, path };
    if (kind === 'module') moduleRoutes.push(routed);
    else externalRoutes.push(routed);
  }

  return { moduleRoutes, externalRoutes };
}

function computeModuleBreakdownLayout(model) {
  const { modules = [] } = model || {};
  const colCount = modules.length <= 2 ? Math.max(1, modules.length) : modules.length <= 6 ? 2 : 3;
  const colHeights = new Array(colCount).fill(CANVAS_PAD);
  const moduleBoxes = [];
  const filePos = new Map();

  modules.forEach((mod, idx) => {
    // Pick shortest column to keep vertical height balanced while preserving rough tier progression
    let targetCol = idx % colCount;
    for (let c = 0; c < colCount; c++) {
      if (colHeights[c] < colHeights[targetCol] - 80) {
        targetCol = c;
      }
    }

    const boxX = CANVAS_PAD + targetCol * (MOD_BOX_W + MOD_COL_GAP);
    const boxY = colHeights[targetCol];
    const filesCount = mod.files.length;
    const boxHeight =
      MOD_HEAD_H +
      MOD_BOX_PAD +
      filesCount * MOD_FILE_H +
      Math.max(0, filesCount - 1) * MOD_FILE_GAP +
      MOD_BOX_PAD;

    moduleBoxes.push({
      mod,
      x: boxX,
      y: boxY,
      width: MOD_BOX_W,
      height: boxHeight,
    });

    mod.files.forEach((file, fIdx) => {
      const fX = boxX + MOD_BOX_PAD;
      const fY = boxY + MOD_HEAD_H + MOD_BOX_PAD + fIdx * (MOD_FILE_H + MOD_FILE_GAP);
      filePos.set(file.fileId, {
        x: fX,
        y: fY,
        width: MOD_BOX_W - MOD_BOX_PAD * 2,
        height: MOD_FILE_H,
      });
    });

    colHeights[targetCol] = boxY + boxHeight + MOD_ROW_GAP;
  });

  return { moduleBoxes, filePos };
}

function buildStandaloneSvg(model, viewMode, systemLayout, systemRoutes, breakdownLayout) {
  const parts = [];
  let minY = 0;
  let maxW = 900;
  let maxH = 600;

  if (viewMode === 'system') {
    const allBoxes = [
      ...systemLayout.layerBoxes,
      ...(systemLayout.externalBox ? [systemLayout.externalBox] : []),
    ];
    for (const b of allBoxes) {
      maxW = Math.max(maxW, b.x + b.width + CANVAS_PAD);
      maxH = Math.max(maxH, b.y + b.height + CANVAS_PAD);
      parts.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="12" fill="#0C0D10" stroke="rgba(255,255,255,0.08)" />`
      );
      parts.push(
        `<text x="${b.x + 14}" y="${b.y + 26}" fill="#EDEDED" font-family="monospace" font-size="12" font-weight="bold">${escapeXml(b.label)}</text>`
      );
    }

    for (const route of systemRoutes.moduleRoutes || []) {
      const stroke = route.isCycleEdge ? '#EF4444' : '#52525B';
      const dash = route.isCycleEdge ? ' stroke-dasharray="5 4"' : '';
      const marker = route.isCycleEdge ? 'url(#export-arrow-cycle)' : 'url(#export-arrow)';
      parts.push(
        `<path d="${route.path}" fill="none" stroke="${stroke}" stroke-width="1.8"${dash} marker-end="${marker}" />`
      );
    }

    for (const route of systemRoutes.externalRoutes || []) {
      parts.push(
        `<path d="${route.path}" fill="none" stroke="#71717A" stroke-opacity="0.72" stroke-width="1.3" stroke-dasharray="3 3" marker-end="url(#export-arrow-external)" />`
      );
    }

    // Track bypass lane bounds so exported SVG never clips routed arcs
    for (const route of [...(systemRoutes.moduleRoutes || []), ...(systemRoutes.externalRoutes || [])]) {
      const nums = route.path.match(/-?\d+(?:\.\d+)?/g) || [];
      for (let i = 1; i < nums.length; i += 2) {
        const yVal = Number(nums[i]);
        if (Number.isFinite(yVal)) {
          minY = Math.min(minY, yVal - 24);
          maxH = Math.max(maxH, yVal + 24);
        }
      }
    }

    for (const mod of model.modules || []) {
      const p = systemLayout.modulePos.get(mod.id);
      if (!p) continue;
      parts.push(
        `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="10" fill="#141519" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" />`
      );
      parts.push(
        `<text x="${p.x + 12}" y="${p.y + 28}" fill="#EDEDED" font-family="monospace" font-size="12" font-weight="bold">${escapeXml(mod.label)}</text>`
      );
      parts.push(
        `<text x="${p.x + 12}" y="${p.y + 50}" fill="#8A8B93" font-family="monospace" font-size="10">${mod.fileCount} files · in:${mod.inDegree} out:${mod.outDegree}</text>`
      );
    }
    for (const ext of systemLayout.visibleExternals) {
      const p = systemLayout.externalPos.get(ext.id);
      if (!p) continue;
      parts.push(
        `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="8" fill="#111215" stroke="rgba(255,255,255,0.12)" stroke-opacity="0.6" />`
      );
      parts.push(
        `<text x="${p.x + 12}" y="${p.y + 25}" fill="#EDEDED" font-family="monospace" font-size="11">${escapeXml(ext.name)}</text>`
      );
    }
  } else {
    for (const box of breakdownLayout.moduleBoxes) {
      maxW = Math.max(maxW, box.x + box.width + CANVAS_PAD);
      maxH = Math.max(maxH, box.y + box.height + CANVAS_PAD);
      parts.push(
        `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="12" fill="#0C0D10" stroke="rgba(255,255,255,0.12)" stroke-opacity="0.6" />`
      );
      parts.push(
        `<text x="${box.x + 12}" y="${box.y + 26}" fill="#EDEDED" font-family="monospace" font-size="12" font-weight="bold">${escapeXml(box.mod.label)}</text>`
      );
    }
    for (const edge of model.fileEdges || []) {
      const s = breakdownLayout.filePos.get(edge.sourceFileId);
      const t = breakdownLayout.filePos.get(edge.targetFileId);
      if (!s || !t) continue;
      const x1 = s.x + s.width;
      const y1 = s.y + s.height / 2;
      const x2 = Math.abs(s.x - t.x) < 10 ? t.x + t.width : t.x;
      const y2 = t.y + t.height / 2;
      const stroke = edge.isCycleEdge ? '#EF4444' : '#52525B';
      const dash = edge.isCycleEdge ? ' stroke-dasharray="5 4"' : '';
      parts.push(
        `<path d="${buildCurvedPath(x1, y1, x2, y2)}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash} marker-end="url(#export-arrow)" />`
      );
    }
    for (const f of model.files || []) {
      const p = breakdownLayout.filePos.get(f.fileId);
      if (!p) continue;
      const label = f.hasDuplicateBasename ? f.filePath : f.fileName;
      parts.push(
        `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="8" fill="#141519" stroke="rgba(255,255,255,0.1)" />`
      );
      parts.push(
        `<text x="${p.x + 10}" y="${p.y + 24}" fill="#EDEDED" font-family="monospace" font-size="11">${escapeXml(label)}</text>`
      );
    }
  }

  const vbHeight = maxH - minY;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${maxW}" height="${vbHeight}" viewBox="0 ${minY} ${maxW} ${vbHeight}" style="background:#08090A">`,
    '<defs>',
    '<marker id="export-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#71717A" /></marker>',
    '<marker id="export-arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#EF4444" /></marker>',
    '<marker id="export-arrow-external" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#71717A" /></marker>',
    '</defs>',
    ...parts,
    '</svg>',
  ].join('');
}

export function ArchitectureView() {
  const {
    files,
    architectureModel,
    loadSampleProject,
    setSelectedFile,
  } = useWorkspace();

  const svgRef = useRef(null);
  const [viewMode, setViewMode] = useState('system'); // 'system' | 'modules' | 'mermaid'
  const [mermaidKind, setMermaidKind] = useState('system'); // 'system' | 'module'
  const [copiedMermaid, setCopiedMermaid] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState(null); // { type: 'module' | 'file' | 'external', id }
  const [showHighlights, setShowHighlights] = useState(true);

  const isDraggingCanvas = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialPan = useRef({ x: 0, y: 0 });

  const model = architectureModel || EMPTY_ARCHITECTURE_MODEL;

  const filesById = useMemo(() => {
    const map = new Map();
    files.forEach((f) => {
      if (f?.id) map.set(f.id, f);
    });
    return map;
  }, [files]);

  const modulesById = useMemo(() => {
    const map = new Map();
    model.modules.forEach((m) => map.set(m.id, m));
    return map;
  }, [model.modules]);

  const analyzedFilesById = useMemo(() => {
    const map = new Map();
    model.files.forEach((f) => map.set(f.fileId, f));
    return map;
  }, [model.files]);

  const externalsById = useMemo(() => {
    const map = new Map();
    model.externalDependencies.forEach((ext) => map.set(ext.id, ext));
    return map;
  }, [model.externalDependencies]);

  const systemLayout = useMemo(() => computeSystemLayout(model), [model]);
  const systemRoutes = useMemo(() => computeSystemRoutes(model, systemLayout), [model, systemLayout]);
  const breakdownLayout = useMemo(() => computeModuleBreakdownLayout(model), [model]);

  const filterTerm = searchFilter.trim().toLowerCase();
  const matchesFilter = (label = '', extra = '') => {
    if (!filterTerm) return false;
    return label.toLowerCase().includes(filterTerm) || extra.toLowerCase().includes(filterTerm);
  };

  // Resolve active inspector details
  const selectedDetails = useMemo(() => {
    if (!selectedTarget) return null;

    if (selectedTarget.type === 'module') {
      const mod = modulesById.get(selectedTarget.id);
      if (!mod) return null;
      const outgoing = model.moduleEdges
        .filter((e) => e.sourceModuleId === mod.id)
        .map((e) => ({ id: e.targetModuleId, label: modulesById.get(e.targetModuleId)?.label || e.targetModuleId, weight: e.weight, isCycleEdge: e.isCycleEdge }));
      const incoming = model.moduleEdges
        .filter((e) => e.targetModuleId === mod.id)
        .map((e) => ({ id: e.sourceModuleId, label: modulesById.get(e.sourceModuleId)?.label || e.sourceModuleId, weight: e.weight, isCycleEdge: e.isCycleEdge }));
      const externals = model.externalDependencies.filter((ext) => ext.usedByModuleIds.includes(mod.id));
      return { type: 'module', mod, outgoing, incoming, externals };
    }

    if (selectedTarget.type === 'file') {
      const file = analyzedFilesById.get(selectedTarget.id);
      if (!file) return null;
      const rawFile = filesById.get(file.fileId) || null;
      const outgoing = model.fileEdges
        .filter((e) => e.sourceFileId === file.fileId)
        .map((e) => ({ id: e.targetFileId, label: e.targetPath, specifiers: e.specifiers, isCycleEdge: e.isCycleEdge }));
      const incoming = model.fileEdges
        .filter((e) => e.targetFileId === file.fileId)
        .map((e) => ({ id: e.sourceFileId, label: e.sourcePath, specifiers: e.specifiers, isCycleEdge: e.isCycleEdge }));
      const externals = model.externalDependencies.filter((ext) => ext.usedByFileIds.includes(file.fileId));
      return { type: 'file', file, rawFile, outgoing, incoming, externals };
    }

    if (selectedTarget.type === 'external') {
      const ext = externalsById.get(selectedTarget.id);
      if (!ext) return null;
      const usedByModules = ext.usedByModuleIds.map((mId) => modulesById.get(mId)).filter(Boolean);
      const usedByFiles = ext.usedByFileIds.map((fId) => analyzedFilesById.get(fId)).filter(Boolean);
      return { type: 'external', ext, usedByModules, usedByFiles };
    }

    return null;
  }, [selectedTarget, modulesById, analyzedFilesById, filesById, externalsById, model]);

  const activeMermaidCode =
    mermaidKind === 'module' ? model.mermaid.moduleFlowchart : model.mermaid.systemFlowchart;

  const handleZoomIn = () => setZoom((z) => Math.min(2.5, +(z * 1.2).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.3, +(z / 1.2).toFixed(2)));
  const handleResetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleWheel = (e) => {
    if (e.cancelable) e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    setZoom((z) => Math.min(2.5, Math.max(0.3, +(z * factor).toFixed(2))));
  };

  const handleCanvasPointerDown = (e) => {
    if (e.button !== 0) return;
    isDraggingCanvas.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    initialPan.current = { ...pan };
    if (svgRef.current?.setPointerCapture) {
      svgRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handleCanvasPointerMove = (e) => {
    if (!isDraggingCanvas.current) return;
    setPan({
      x: initialPan.current.x + (e.clientX - dragStart.current.x),
      y: initialPan.current.y + (e.clientY - dragStart.current.y),
    });
  };

  const handleCanvasPointerUp = (e) => {
    if (!isDraggingCanvas.current) return;
    isDraggingCanvas.current = false;
    if (svgRef.current?.releasePointerCapture) {
      try {
        svgRef.current.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors on unmount
      }
    }
  };

  const handleCopyMermaid = async () => {
    try {
      await globalThis.navigator?.clipboard?.writeText?.(activeMermaidCode);
      setCopiedMermaid(true);
      setTimeout(() => setCopiedMermaid(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const handleDownloadFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportSvg = () => {
    const svgString = buildStandaloneSvg(model, viewMode, systemLayout, systemRoutes, breakdownLayout);
    const slug = (model.projectName || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    handleDownloadFile(svgString, `${slug}-architecture-${viewMode}.svg`, 'image/svg+xml');
  };

  const handleDownloadMermaid = () => {
    const slug = (model.projectName || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    handleDownloadFile(activeMermaidCode, `${slug}-architecture-${mermaidKind}.mmd`, 'text/plain');
  };

  const totalCycles =
    (model.highlights?.cycles?.fileCycles?.length || 0) +
    (model.highlights?.cycles?.moduleCycles?.length || 0);
  const coreHubs = model.highlights?.coreHubs || [];
  const entryPoints = model.highlights?.entryPoints || [];
  const isolatedModules = model.highlights?.isolatedModules || [];
  const externalHighlights = model.externalDependencies || [];
  const hasAnyHighlights =
    coreHubs.length > 0 ||
    entryPoints.length > 0 ||
    externalHighlights.length > 0 ||
    isolatedModules.length > 0 ||
    totalCycles > 0;
  const isHighlightsVisible = showHighlights && !selectedDetails;

  const handleToggleHighlights = () => {
    if (isHighlightsVisible) {
      setShowHighlights(false);
      return;
    }
    setSelectedTarget(null);
    setShowHighlights(true);
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-background relative select-none">
      {/* Top Toolbar */}
      <div className="h-14 border-b border-border bg-card/60 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between shrink-0 z-20 gap-3">
        {/* Left: Title & Architecture Metrics */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Layers className="w-4 h-4" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-semibold text-foreground tracking-tight">Architecture Diagrams</h1>
              <p className="text-[10px] text-muted-foreground font-mono">
                Modules, layers, hubs & dependencies
              </p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono">
              <span className="px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
                <span className="font-semibold text-white">{model.summary.totalModules}</span>{' '}
                <span className="text-muted-foreground">modules</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
                <span className="font-semibold text-white">{model.summary.totalModuleEdges}</span>{' '}
                <span className="text-muted-foreground">links</span>
              </span>
              {model.summary.totalExternalDeps > 0 && (
                <span className="px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
                  <span className="font-semibold text-white">{model.summary.totalExternalDeps}</span>{' '}
                  <span className="text-muted-foreground">packages</span>
                </span>
              )}
              {totalCycles > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 text-white border border-white/20">
                  <AlertTriangle className="w-3 h-3 text-white/80" />
                  <span>{totalCycles} cycle{totalCycles === 1 ? '' : 's'}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Center: View Mode Toggle + Filter */}
        {files.length > 0 && (
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Architecture diagram view mode"
              className="inline-flex items-center p-0.5 rounded-lg bg-secondary border border-border"
            >
              {[
                { id: 'system', label: 'System Layers' },
                { id: 'modules', label: 'Module Breakdown' },
                { id: 'mermaid', label: 'Mermaid Spec' },
              ].map((opt) => {
                const active = viewMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setViewMode(opt.id);
                      if (opt.id !== 'mermaid') handleResetView();
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                      active
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {viewMode !== 'mermaid' && (
              <div className="relative w-44 xl:w-56 hidden md:block">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter module or file..."
                  className="w-full bg-secondary/80 border border-border rounded-lg pl-8 pr-7 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-1 focus:ring-primary font-mono"
                />
                {searchFilter && (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => setSearchFilter('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Right: Zoom, Export & Highlights */}
        <div className="flex items-center gap-1.5 shrink-0">
          {files.length > 0 && viewMode !== 'mermaid' && (
            <>
              <div className="flex items-center bg-secondary border border-border rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={handleZoomIn}
                  aria-label="Zoom In"
                  title="Zoom In"
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono text-muted-foreground px-1.5 min-w-[38px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  aria-label="Zoom Out"
                  title="Zoom Out"
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleResetView}
                title="Reset Pan & Zoom"
                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border border-border rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleExportSvg}
                title="Export SVG Diagram"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border border-border rounded-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">SVG</span>
              </button>

              <button
                type="button"
                onClick={handleToggleHighlights}
                title="Toggle Architecture Highlights"
                aria-label="Toggle Architecture Highlights"
                aria-pressed={isHighlightsVisible}
                className={`p-1.5 rounded-lg border cursor-pointer ${
                  isHighlightsVisible
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative w-full h-full overflow-hidden bg-background">
        {files.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10">
            <div className="w-16 h-16 rounded-2xl bg-secondary/80 border border-border flex items-center justify-center mb-4 text-muted-foreground">
              <Layers className="w-8 h-8 opacity-45 text-indigo-400" />
            </div>
            <h2 className="text-base font-semibold text-foreground mb-1">No Project Files Loaded</h2>
            <p className="text-xs text-muted-foreground max-w-sm mb-5 leading-relaxed">
              Import source files, connect a GitHub repository, or load the sample project to generate system architecture diagrams.
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
        ) : viewMode === 'mermaid' ? (
          <div className="h-full overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-card border border-border">
                <div className="flex items-center gap-2.5">
                  <Code2 className="w-4 h-4 text-indigo-400" />
                  <div>
                    <h2 className="text-xs font-semibold text-foreground">Deterministic Mermaid Specification</h2>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      Generated directly from parsed modules, file paths & AST/polyglot edges
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex p-0.5 rounded-lg bg-secondary border border-border text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() => setMermaidKind('system')}
                      className={`px-2.5 py-1 rounded cursor-pointer ${
                        mermaidKind === 'system' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      System (LR)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMermaidKind('module')}
                      className={`px-2.5 py-1 rounded cursor-pointer ${
                        mermaidKind === 'module' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      Modules (TD)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyMermaid}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-secondary hover:bg-accent text-foreground border border-border cursor-pointer"
                  >
                    {copiedMermaid ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedMermaid ? 'Copied' : 'Copy Mermaid'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadMermaid}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[#EDEDED] hover:bg-white text-[#08090A] font-semibold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .mmd</span>
                  </button>
                </div>
              </div>

              <pre className="p-5 rounded-xl bg-[#111215] border border-border text-xs font-mono text-[#EDEDED] overflow-x-auto leading-relaxed select-text">
                {activeMermaidCode}
              </pre>
            </div>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="w-full h-full cursor-grab active:cursor-grabbing select-none"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onWheel={handleWheel}
            onClick={() => setSelectedTarget(null)}
          >
            <defs>
              <marker id="arch-arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#52525B" />
              </marker>
              <marker id="arch-arrow-outgoing" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#FFFFFF" />
              </marker>
              <marker id="arch-arrow-incoming" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#A1A1AA" />
              </marker>
              <marker id="arch-arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#EF4444" />
              </marker>
              <marker id="arch-arrow-external" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#71717A" />
              </marker>
              <marker id="arch-arrow-dimmed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#27272A" opacity="0.4" />
              </marker>
              <pattern id="arch-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#27272A" opacity="0.4" />
              </pattern>
            </defs>

            <rect width="100%" height="100%" fill="url(#arch-grid)" />

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {viewMode === 'system' ? (
                <>
                  {/* Layer Group Containers */}
                  {systemLayout.layerBoxes.map((box) => (
                    <g key={box.id}>
                      <rect
                        x={box.x}
                        y={box.y}
                        width={box.width}
                        height={box.height}
                        rx={14}
                        fill="#0A0B0E"
                        fillOpacity="0.95"
                        stroke="rgba(255, 255, 255, 0.08)"
                        strokeWidth={1.2}
                      />
                      <circle cx={box.x + 18} cy={box.y + 22} r={4} fill="#71717A" />
                      <text
                        x={box.x + 28}
                        y={box.y + 26}
                        fill="#EDEDED"
                        fontSize="11"
                        fontWeight="600"
                        fontFamily="monospace"
                      >
                        {box.label}
                      </text>
                    </g>
                  ))}

                  {/* External Packages Column */}
                  {systemLayout.externalBox && (
                    <g>
                      <rect
                        x={systemLayout.externalBox.x}
                        y={systemLayout.externalBox.y}
                        width={systemLayout.externalBox.width}
                        height={systemLayout.externalBox.height}
                        rx={14}
                        fill="#0A0B0E"
                        fillOpacity="0.92"
                        stroke="rgba(255, 255, 255, 0.12)"
                        strokeWidth={1.2}
                        strokeDasharray="4 3"
                      />
                      <circle cx={systemLayout.externalBox.x + 18} cy={systemLayout.externalBox.y + 22} r={4} fill="#71717A" />
                      <text
                        x={systemLayout.externalBox.x + 28}
                        y={systemLayout.externalBox.y + 26}
                        fill="#EDEDED"
                        fontSize="11"
                        fontWeight="600"
                        fontFamily="monospace"
                      >
                        External ({systemLayout.externalBox.totalCount})
                      </text>
                    </g>
                  )}

                  {/* Cross-Module Dependency Edges (routed cleanly via systemRoutes) */}
                  {systemRoutes.moduleRoutes.map((route) => {
                    const isOut = selectedTarget?.type === 'module' && selectedTarget.id === route.sourceId;
                    const isIn = selectedTarget?.type === 'module' && selectedTarget.id === route.targetId;
                    const hasSel = Boolean(selectedTarget);
                    const isActive = isOut || isIn;
                    const isDimmed = hasSel && !isActive;

                    let stroke = route.isCycleEdge ? '#EF4444' : '#52525B';
                    let marker = route.isCycleEdge ? 'url(#arch-arrow-cycle)' : 'url(#arch-arrow-default)';
                    let strokeWidth = route.isCycleEdge ? 2 : 1.6;
                    if (isOut) {
                      stroke = '#FFFFFF';
                      marker = 'url(#arch-arrow-outgoing)';
                      strokeWidth = 2.4;
                    } else if (isIn) {
                      stroke = '#A1A1AA';
                      marker = 'url(#arch-arrow-incoming)';
                      strokeWidth = 2.4;
                    } else if (isDimmed) {
                      stroke = '#27272A';
                      marker = 'url(#arch-arrow-dimmed)';
                      strokeWidth = 1;
                    }

                    return (
                      <path
                        key={route.edgeId}
                        d={route.path}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        strokeDasharray={route.isCycleEdge ? '5 4' : undefined}
                        strokeOpacity={isDimmed ? 0.2 : 0.85}
                        markerEnd={marker}
                      />
                    );
                  })}

                  {/* External Dependency Links (separated anchors & obstacle-free lane routing) */}
                  {systemRoutes.externalRoutes.map((route) => {
                    const highlighted =
                      (selectedTarget?.type === 'module' && selectedTarget.id === route.sourceId) ||
                      (selectedTarget?.type === 'external' && selectedTarget.id === route.targetId);
                    if (selectedTarget && !highlighted) return null;

                    return (
                      <path
                        key={route.edgeId}
                        d={route.path}
                        fill="none"
                        stroke="#71717A"
                        strokeWidth={highlighted ? 2 : 1.35}
                        strokeDasharray="3 3"
                        strokeOpacity={highlighted ? 0.92 : 0.58}
                        markerEnd="url(#arch-arrow-external)"
                      />
                    );
                  })}

                  {/* Module Cards (fully opaque so lines never bleed through) */}
                  {model.modules.map((mod) => {
                    const pos = systemLayout.modulePos.get(mod.id);
                    if (!pos) return null;
                    const isSelected = selectedTarget?.type === 'module' && selectedTarget.id === mod.id;
                    const isOutgoing =
                      selectedTarget?.type === 'module' &&
                      model.moduleEdges.some((e) => e.sourceModuleId === selectedTarget.id && e.targetModuleId === mod.id);
                    const isIncoming =
                      selectedTarget?.type === 'module' &&
                      model.moduleEdges.some((e) => e.targetModuleId === selectedTarget.id && e.sourceModuleId === mod.id);
                    const isFilterMatch = matchesFilter(
                      mod.label,
                      mod.files.map((f) => f.filePath).join(' ')
                    );
                    const isDimmed =
                      Boolean(selectedTarget) && !isSelected && !isOutgoing && !isIncoming &&
                      !(selectedTarget.type === 'external' && externalsById.get(selectedTarget.id)?.usedByModuleIds.includes(mod.id));

                    return (
                      <g
                        key={mod.id}
                        transform={`translate(${pos.x}, ${pos.y})`}
                        className="cursor-pointer"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTarget((prev) =>
                            prev?.type === 'module' && prev.id === mod.id ? null : { type: 'module', id: mod.id }
                          );
                        }}
                      >
                        <foreignObject width={pos.width} height={pos.height} className="overflow-visible">
                          <div
                            className={`w-full h-full rounded-xl p-2.5 flex flex-col justify-between border bg-[#111215] transition-all ${
                              isSelected
                                ? 'border-white ring-2 ring-white/40 shadow-lg'
                                : isOutgoing
                                ? 'border-white/60 ring-1 ring-white/20'
                                : isIncoming
                                ? 'border-white/40 ring-1 ring-white/20'
                                : isFilterMatch
                                ? 'border-white ring-2 ring-white/30'
                                : 'border-white/10 hover:border-white/25'
                            } ${isDimmed ? 'opacity-35' : 'opacity-100'}`}
                          >
                            <div className="flex items-center justify-between gap-1.5 min-w-0">
                              <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-foreground truncate" title={mod.label}>
                                <Box className="w-3.5 h-3.5 shrink-0 text-white/70" />
                                <span className="truncate">{mod.label}</span>
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                {mod.isEntryPoint && (
                                  <span className="text-[9px] font-mono px-1 rounded bg-white/10 text-white border border-white/20">
                                    Entry
                                  </span>
                                )}
                                {mod.isHub && (
                                  <span className="text-[9px] font-mono px-1 rounded bg-white/10 text-white border border-white/20">
                                    Hub
                                  </span>
                                )}
                                {mod.inCycle && (
                                  <span className="text-[9px] font-mono px-1 rounded bg-white/10 text-white border border-white/20">
                                    Cycle
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/50">
                              <span>{mod.fileCount} file{mod.fileCount === 1 ? '' : 's'} · {mod.totalLoc} LOC</span>
                              <span className="flex items-center gap-1.5">
                                <span className="text-white/80">→{mod.outDegree}</span>
                                <span className="text-white/60">←{mod.inDegree}</span>
                              </span>
                            </div>
                          </div>
                        </foreignObject>
                      </g>
                    );
                  })}

                  {/* External Package Nodes (fully opaque) */}
                  {systemLayout.visibleExternals.map((ext) => {
                    const pos = systemLayout.externalPos.get(ext.id);
                    if (!pos) return null;
                    const isSelected = selectedTarget?.type === 'external' && selectedTarget.id === ext.id;
                    const isFilterMatch = matchesFilter(ext.name);
                    return (
                      <g
                        key={ext.id}
                        transform={`translate(${pos.x}, ${pos.y})`}
                        className="cursor-pointer"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTarget((prev) =>
                            prev?.type === 'external' && prev.id === ext.id ? null : { type: 'external', id: ext.id }
                          );
                        }}
                      >
                        <foreignObject width={pos.width} height={pos.height}>
                          <div
                            className={`w-full h-full rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 border ${
                              isSelected
                                ? 'bg-[#1E2026] border-white ring-1 ring-white/40'
                                : isFilterMatch
                                ? 'bg-[#18191E] border-white ring-1 ring-white/30'
                                : 'bg-[#111215] border-white/10 hover:border-white/20'
                            }`}
                          >
                            <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#EDEDED] truncate">
                              <Package className="w-3 h-3 text-white/60 shrink-0" />
                              <span className="truncate">{ext.name}</span>
                            </span>
                            <span className="text-[9px] font-mono text-white/50 shrink-0">
                              {ext.usedByFileIds.length}f
                            </span>
                          </div>
                        </foreignObject>
                      </g>
                    );
                  })}
                </>
              ) : (
                <>
                  {/* Module Breakdown Containers */}
                  {breakdownLayout.moduleBoxes.map(({ mod, x, y, width, height }) => {
                    const modSelected = selectedTarget?.type === 'module' && selectedTarget.id === mod.id;
                    return (
                      <g key={mod.id}>
                        <rect
                          x={x}
                          y={y}
                          width={width}
                          height={height}
                          rx={12}
                          fill="#090A0D"
                          fillOpacity="0.95"
                          stroke={modSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.15)'}
                          strokeOpacity={modSelected ? 0.9 : 0.6}
                          strokeWidth={modSelected ? 2 : 1.2}
                        />
                        <g
                          className="cursor-pointer"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTarget({ type: 'module', id: mod.id });
                          }}
                        >
                          <text
                            x={x + 14}
                            y={y + 24}
                            fill="#EDEDED"
                            fontSize="11.5"
                            fontWeight="600"
                            fontFamily="monospace"
                          >
                            {mod.label}
                          </text>
                          <text
                            x={x + 14}
                            y={y + 38}
                            fill="#8A8B93"
                            fontSize="9.5"
                            fontFamily="monospace"
                          >
                            {mod.layerLabel} · {mod.fileCount} file{mod.fileCount === 1 ? '' : 's'}
                          </text>
                        </g>
                      </g>
                    );
                  })}

                  {/* File-Level Cross Links (keyed by fileId) */}
                  {model.fileEdges.map((edge) => {
                    const s = breakdownLayout.filePos.get(edge.sourceFileId);
                    const t = breakdownLayout.filePos.get(edge.targetFileId);
                    if (!s || !t) return null;

                    const isOut = selectedTarget?.type === 'file' && selectedTarget.id === edge.sourceFileId;
                    const isIn = selectedTarget?.type === 'file' && selectedTarget.id === edge.targetFileId;
                    const hasSel = selectedTarget?.type === 'file';
                    const isDimmed = hasSel && !isOut && !isIn;

                    const sameCol = Math.abs(s.x - t.x) < 10;
                    const path = buildCurvedPath(
                      s.x + s.width,
                      s.y + s.height / 2,
                      sameCol ? t.x + t.width + 6 : t.x - 6,
                      t.y + t.height / 2
                    );

                    let stroke = edge.isCycleEdge ? '#EF4444' : '#52525B';
                    let marker = edge.isCycleEdge ? 'url(#arch-arrow-cycle)' : 'url(#arch-arrow-default)';
                    if (isOut) {
                      stroke = '#FFFFFF';
                      marker = 'url(#arch-arrow-outgoing)';
                    } else if (isIn) {
                      stroke = '#A1A1AA';
                      marker = 'url(#arch-arrow-incoming)';
                    } else if (isDimmed) {
                      stroke = '#27272A';
                      marker = 'url(#arch-arrow-dimmed)';
                    }

                    return (
                      <path
                        key={edge.id}
                        d={path}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isOut || isIn || edge.isCycleEdge ? 2 : 1.3}
                        strokeDasharray={edge.isCycleEdge ? '5 4' : undefined}
                        strokeOpacity={isDimmed ? 0.16 : 0.78}
                        markerEnd={marker}
                      />
                    );
                  })}

                  {/* File Rows Inside Modules */}
                  {model.files.map((file) => {
                    const pos = breakdownLayout.filePos.get(file.fileId);
                    if (!pos) return null;
                    const isSelected = selectedTarget?.type === 'file' && selectedTarget.id === file.fileId;
                    const isOut =
                      selectedTarget?.type === 'file' &&
                      model.fileEdges.some((e) => e.sourceFileId === selectedTarget.id && e.targetFileId === file.fileId);
                    const isIn =
                      selectedTarget?.type === 'file' &&
                      model.fileEdges.some((e) => e.targetFileId === selectedTarget.id && e.sourceFileId === file.fileId);
                    const isFilterMatch = matchesFilter(file.filePath, file.symbols.exports.join(' '));
                    const extBadge = EXTENSION_CONFIG[file.extension]?.label?.slice(0, 4) || 'FILE';
                    const displayName = file.hasDuplicateBasename ? file.filePath : file.fileName;

                    return (
                      <g
                        key={file.fileId}
                        transform={`translate(${pos.x}, ${pos.y})`}
                        className="cursor-pointer"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTarget((prev) =>
                            prev?.type === 'file' && prev.id === file.fileId ? null : { type: 'file', id: file.fileId }
                          );
                        }}
                      >
                        <foreignObject width={pos.width} height={pos.height}>
                          <div
                            className={`w-full h-full rounded-lg px-2.5 py-1 flex items-center justify-between gap-2 border ${
                              isSelected
                                ? 'bg-[#1E2026] border-white ring-1 ring-white/40'
                                : isOut
                                ? 'bg-[#18191E] border-white/60'
                                : isIn
                                ? 'bg-[#18191E] border-white/40'
                                : isFilterMatch
                                ? 'bg-card border-white ring-1 ring-white/30'
                                : 'bg-[#111215] border-white/10 hover:border-white/20'
                            }`}
                          >
                            <span className="flex items-center gap-1.5 min-w-0 font-mono text-[11px] text-[#EDEDED] truncate" title={file.filePath}>
                              <FileCode className="w-3 h-3 text-white/60 shrink-0" />
                              <span className="truncate">{displayName}</span>
                            </span>
                            <div className="flex items-center gap-1 shrink-0 font-mono text-[9px]">
                              {file.isHub && <span className="px-1 rounded bg-white/10 text-white">Hub</span>}
                              {file.inCycle && <span className="px-1 rounded bg-white/10 text-white">Cycle</span>}
                              <span className="text-white/50">{extBadge}</span>
                            </div>
                          </div>
                        </foreignObject>
                      </g>
                    );
                  })}
                </>
              )}
            </g>
          </svg>
        )}

        {/* Right-Side Inspector Drawer OR Highlights Overlay */}
        {files.length > 0 && viewMode !== 'mermaid' && selectedDetails && (
          <div className="absolute top-4 right-4 w-80 sm:w-96 max-h-[calc(100%-2rem)] flex flex-col rounded-2xl bg-card/95 backdrop-blur-md border border-border shadow-2xl z-30 overflow-hidden">
            <div className="p-4 border-b border-border flex items-start justify-between gap-2 bg-secondary/30">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {selectedDetails.type === 'module' && (
                    <Box className="w-4 h-4 shrink-0 text-white/70" />
                  )}
                  {selectedDetails.type === 'file' && <FileCode className="w-4 h-4 text-white/70 shrink-0" />}
                  {selectedDetails.type === 'external' && <Package className="w-4 h-4 text-white/70 shrink-0" />}
                  <span className="font-mono text-xs font-bold text-foreground truncate">
                    {selectedDetails.type === 'module'
                      ? selectedDetails.mod.label
                      : selectedDetails.type === 'file'
                      ? selectedDetails.file.filePath
                      : selectedDetails.ext.name}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-muted-foreground mt-1">
                  {selectedDetails.type === 'module'
                    ? `${selectedDetails.mod.layerLabel} · ${selectedDetails.mod.fileCount} files · ${selectedDetails.mod.totalLoc} LOC`
                    : selectedDetails.type === 'file'
                    ? `${selectedDetails.file.moduleLabel} · ${selectedDetails.file.lineCount} LOC`
                    : `External dependency · imported ${selectedDetails.ext.importCount} time(s)`}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close inspector"
                onClick={() => setSelectedTarget(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs font-mono max-h-[440px]">
              {selectedDetails.type === 'module' && (
                <>
                  {/* Files inside module */}
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-2">
                      Files in Component ({selectedDetails.mod.files.length})
                    </div>
                    <div className="space-y-1">
                      {selectedDetails.mod.files.map((f) => {
                        const raw = filesById.get(f.fileId);
                        return (
                          <div
                            key={f.fileId}
                            className="flex items-center justify-between gap-2 p-2 rounded-lg bg-secondary/50 border border-border/80"
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedTarget({ type: 'file', id: f.fileId })}
                              className="text-left text-[11px] text-foreground hover:text-indigo-400 truncate cursor-pointer flex-1"
                              title={f.filePath}
                            >
                              {f.hasDuplicateBasename ? f.filePath : f.fileName}
                            </button>
                            {raw && (
                              <button
                                type="button"
                                onClick={() => setSelectedFile(raw)}
                                title="View Source Code"
                                className="text-[10px] text-primary hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Code</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Outgoing module dependencies */}
                  <div>
                    <div className="text-[11px] font-semibold text-indigo-400 uppercase mb-1.5 flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Depends On ({selectedDetails.outgoing.length})</span>
                    </div>
                    {selectedDetails.outgoing.length > 0 ? (
                      <div className="space-y-1">
                        {selectedDetails.outgoing.map((dep) => (
                          <button
                            key={dep.id}
                            type="button"
                            onClick={() => setSelectedTarget({ type: 'module', id: dep.id })}
                            className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-indigo-500/10 border border-border/80 text-left cursor-pointer"
                          >
                            <span className="truncate">{dep.label}</span>
                            <span className="text-[10px] text-indigo-300 shrink-0">{dep.weight} ref{dep.weight === 1 ? '' : 's'}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">No outgoing workspace module links.</p>
                    )}
                  </div>

                  {/* Incoming module dependents */}
                  <div>
                    <div className="text-[11px] font-semibold text-white uppercase mb-1.5 flex items-center gap-1.5">
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Used By ({selectedDetails.incoming.length})</span>
                    </div>
                    {selectedDetails.incoming.length > 0 ? (
                      <div className="space-y-1">
                        {selectedDetails.incoming.map((imp) => (
                          <button
                            key={imp.id}
                            type="button"
                            onClick={() => setSelectedTarget({ type: 'module', id: imp.id })}
                            className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-white/10 border border-border/80 text-left cursor-pointer"
                          >
                            <span className="truncate">{imp.label}</span>
                            <span className="text-[10px] text-white/60 shrink-0">{imp.weight} ref{imp.weight === 1 ? '' : 's'}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">Top-level entry or standalone module.</p>
                    )}
                  </div>
                </>
              )}

              {selectedDetails.type === 'file' && (
                <>
                  {selectedDetails.file.symbols.exports.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">
                        Exported Symbols ({selectedDetails.file.symbols.exports.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {selectedDetails.file.symbols.exports.slice(0, 12).map((sym, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px] text-white/80">
                            {sym}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-[11px] font-semibold text-white uppercase mb-1.5 flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Imports ({selectedDetails.outgoing.length})</span>
                    </div>
                    {selectedDetails.outgoing.length > 0 ? (
                      <div className="space-y-1">
                        {selectedDetails.outgoing.map((dep) => (
                          <button
                            key={dep.id}
                            type="button"
                            onClick={() => setSelectedTarget({ type: 'file', id: dep.id })}
                            className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-white/10 border border-border/80 text-left cursor-pointer"
                          >
                            <span className="truncate">{dep.label}</span>
                            <ArrowRight className="w-3 h-3 text-white/60 shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">No internal workspace imports.</p>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-white uppercase mb-1.5 flex items-center gap-1.5">
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Imported By ({selectedDetails.incoming.length})</span>
                    </div>
                    {selectedDetails.incoming.length > 0 ? (
                      <div className="space-y-1">
                        {selectedDetails.incoming.map((imp) => (
                          <button
                            key={imp.id}
                            type="button"
                            onClick={() => setSelectedTarget({ type: 'file', id: imp.id })}
                            className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-white/10 border border-border/80 text-left cursor-pointer"
                          >
                            <span className="truncate">{imp.label}</span>
                            <ArrowLeft className="w-3 h-3 text-white/60 shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">No workspace callers.</p>
                    )}
                  </div>

                  {selectedDetails.rawFile && (
                    <button
                      type="button"
                      onClick={() => setSelectedFile(selectedDetails.rawFile)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Source Code</span>
                    </button>
                  )}
                </>
              )}

              {selectedDetails.type === 'external' && (
                <div>
                  <div className="text-[11px] font-semibold text-sky-400 uppercase mb-2">
                    Used By Workspace Files ({selectedDetails.usedByFiles.length})
                  </div>
                  <div className="space-y-1">
                    {selectedDetails.usedByFiles.map((f) => (
                      <button
                        key={f.fileId}
                        type="button"
                        onClick={() => setSelectedTarget({ type: 'file', id: f.fileId })}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-sky-500/10 border border-border/80 text-left cursor-pointer"
                      >
                        <span className="truncate">{f.filePath}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{f.moduleLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Architecture Highlights Panel (shown when nothing selected & toggle active) */}
        {files.length > 0 && viewMode !== 'mermaid' && isHighlightsVisible && (
          <div className="absolute bottom-4 right-4 w-72 sm:w-80 max-h-[calc(100%-2rem)] overflow-y-auto p-3.5 rounded-2xl bg-card/90 backdrop-blur-md border border-border shadow-xl z-20 text-xs font-mono space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-border/60">
              <span className="flex items-center gap-1.5 font-semibold text-foreground text-[11px] uppercase">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Architecture Highlights</span>
              </span>
              <button
                type="button"
                aria-label="Hide highlights"
                onClick={() => setShowHighlights(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {!hasAnyHighlights ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed py-1">
                No architectural hubs, entry points, external dependencies, or cycles detected yet.
              </p>
            ) : (
              <>
                {model.summary.totalFileEdges === 0 && (
                  <p className="text-[10px] text-muted-foreground leading-relaxed bg-secondary/40 border border-border/60 rounded-lg px-2.5 py-1.5">
                    No internal workspace imports detected — showing external dependencies and standalone modules.
                  </p>
                )}

                {coreHubs.length > 0 && (
                  <div>
                    <div className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Core Hubs</div>
                    <div className="space-y-1">
                      {coreHubs.slice(0, 4).map((hub) => (
                        <button
                          key={hub.fileId}
                          type="button"
                          onClick={() =>
                            setSelectedTarget(
                              viewMode === 'system'
                                ? { type: 'module', id: hub.moduleId }
                                : { type: 'file', id: hub.fileId }
                            )
                          }
                          className="w-full flex items-center justify-between px-2 py-1 rounded bg-secondary/60 hover:bg-indigo-500/10 text-left cursor-pointer"
                        >
                          <span className="truncate text-[11px] text-foreground">{hub.filePath}</span>
                          <span className="text-[10px] text-indigo-300 shrink-0">←{hub.inDegree}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {entryPoints.length > 0 && (
                  <div>
                    <div className="text-[10px] text-white/50 uppercase font-semibold mb-1">Entry Points</div>
                    <div className="space-y-1">
                      {entryPoints.slice(0, 3).map((ep) => (
                        <button
                          key={ep.fileId}
                          type="button"
                          onClick={() =>
                            setSelectedTarget(
                              viewMode === 'system'
                                ? { type: 'module', id: ep.moduleId }
                                : { type: 'file', id: ep.fileId }
                            )
                          }
                          className="w-full flex items-center justify-between px-2 py-1 rounded bg-secondary/60 hover:bg-white/10 text-left cursor-pointer"
                        >
                          <span className="truncate text-[11px] text-foreground">{ep.filePath}</span>
                          <span className="text-[10px] text-white/60 shrink-0">→{ep.outDegree}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {externalHighlights.length > 0 && (
                  <div>
                    <div className="text-[10px] text-white/50 uppercase font-semibold mb-1">
                      External Dependencies ({externalHighlights.length})
                    </div>
                    <div className="space-y-1">
                      {externalHighlights.slice(0, 5).map((ext) => (
                        <button
                          key={ext.id}
                          type="button"
                          onClick={() => setSelectedTarget({ type: 'external', id: ext.id })}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded bg-secondary/60 hover:bg-white/10 text-left cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5 min-w-0 truncate text-[11px] text-foreground">
                            <Package className="w-3 h-3 text-white/60 shrink-0" />
                            <span className="truncate">{ext.name}</span>
                          </span>
                          <span className="text-[10px] text-white/50 shrink-0">
                            {ext.importCount} ref{ext.importCount === 1 ? '' : 's'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isolatedModules.length > 0 && (
                  <div>
                    <div className="text-[10px] text-white/50 uppercase font-semibold mb-1">
                      Isolated Modules ({isolatedModules.length})
                    </div>
                    <div className="space-y-1">
                      {isolatedModules.slice(0, 4).map((iso) => (
                        <button
                          key={iso.moduleId}
                          type="button"
                          onClick={() => setSelectedTarget({ type: 'module', id: iso.moduleId })}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded bg-secondary/60 hover:bg-white/10 text-left cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5 min-w-0 truncate text-[11px] text-foreground">
                            <Box className="w-3 h-3 text-white/60 shrink-0" />
                            <span className="truncate">{iso.label}</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {iso.fileCount} file{iso.fileCount === 1 ? '' : 's'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {totalCycles > 0 && (
                  <div className="p-2 rounded-lg bg-white/5 border border-white/15 text-white text-[10px]">
                    <div className="font-semibold flex items-center gap-1 mb-0.5">
                      <AlertTriangle className="w-3 h-3 text-white/80" />
                      <span>Circular Dependencies Detected</span>
                    </div>
                    <p className="text-white/70">
                      {model.highlights.cycles.moduleCycles.length} module cycle(s), {model.highlights.cycles.fileCycles.length} file cycle(s)
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
