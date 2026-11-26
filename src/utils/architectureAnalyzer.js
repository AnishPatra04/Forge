import { getFileExtension, getFileNameFromPath, getFilePath } from '../constants/fileTypes.js';
import { extractAstMetadata, isAstSupported, resolveFileDependencies } from './astParser.js';

export const ARCHITECTURE_LAYERS = [
  { id: 'entry', label: 'Entry & App Shell', tier: 0, accent: '#a855f7' },
  { id: 'presentation', label: 'UI & Presentation', tier: 1, accent: '#6366f1' },
  { id: 'state_routing', label: 'State & Routing', tier: 2, accent: '#3b82f6' },
  { id: 'domain_services', label: 'Services & Core Logic', tier: 3, accent: '#10b981' },
  { id: 'data_storage', label: 'Data & Persistence', tier: 4, accent: '#f59e0b' },
  { id: 'config_docs', label: 'Config & Docs', tier: 5, accent: '#64748b' },
];

const LAYER_BY_ID = new Map(ARCHITECTURE_LAYERS.map((l) => [l.id, l]));

function ensureResolvedFiles(filesList = []) {
  if (!Array.isArray(filesList) || filesList.length === 0) return [];

  const needsResolve = filesList.some(
    (f) => f && (!f.dependencies || typeof f.dependencies !== 'object' || !Array.isArray(f.dependencies.resolved))
  );

  if (!needsResolve) {
    return filesList;
  }

  const prepared = filesList.map((file, idx) => {
    if (!file) return file;
    const filePath = getFilePath(file) || file.name || `file-${idx}`;
    const id = file.id || `arch-file:${filePath}`;
    const astMetadata =
      file.astMetadata !== undefined
        ? file.astMetadata
        : isAstSupported(filePath) && typeof file.content === 'string'
          ? extractAstMetadata(file.content, filePath)
          : null;
    return {
      ...file,
      id,
      name: file.name || getFileNameFromPath(filePath),
      path: filePath,
      extension: file.extension || getFileExtension(filePath),
      astMetadata,
    };
  });

  return resolveFileDependencies(prepared);
}

function getModuleInfo(filePath = '', extension = '') {
  const normalized = (filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);

  // Nested path -> group by logical module directory (collapsing >2 levels under src/app/lib/packages)
  if (segments.length > 1) {
    const dirs = segments.slice(0, -1);
    let modPath = dirs.join('/');
    if (dirs.length >= 2) {
      const rootDir = dirs[0].toLowerCase();
      if ((rootDir === 'packages' || rootDir === 'apps') && dirs.length >= 3) {
        modPath = dirs.slice(0, 3).join('/');
      } else if (dirs.length > 2) {
        modPath = dirs.slice(0, 2).join('/');
      }
    }
    return {
      moduleId: `mod:${modPath}`,
      modulePath: modPath,
      label: modPath,
      isRootGroup: false,
    };
  }

  // Root-level file: group by architectural role so flat repos remain legible
  const lower = normalized.toLowerCase();
  const ext = (extension || getFileExtension(normalized)).toLowerCase();

  if (ext === '.md' || ext === '.txt') {
    return { moduleId: 'mod:__root_docs', modulePath: 'docs', label: 'Documentation', isRootGroup: true };
  }
  if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml' || lower.includes('config')) {
    return { moduleId: 'mod:__root_config', modulePath: 'config', label: 'Configuration', isRootGroup: true };
  }
  if (/(^|[._-])(auth|security|jwt|session)/.test(lower)) {
    return { moduleId: 'mod:__root_auth', modulePath: 'auth', label: 'Auth & Security', isRootGroup: true };
  }
  if (/(^|[._-])(db|database|storage|store|repo|model|schema)/.test(lower) || ext === '.py') {
    if (/(db|database|storage|model|schema|sql)/.test(lower)) {
      return { moduleId: 'mod:__root_data', modulePath: 'database', label: 'Data & Storage', isRootGroup: true };
    }
  }
  if (/(^|[._-])(api|client|http|fetch|service|worker)/.test(lower)) {
    return { moduleId: 'mod:__root_services', modulePath: 'services', label: 'API & Services', isRootGroup: true };
  }
  if (/^(main|index|app)\./.test(lower)) {
    return { moduleId: 'mod:__root_entry', modulePath: 'root-entry', label: 'App Entry', isRootGroup: true };
  }

  return { moduleId: 'mod:__root_core', modulePath: 'root', label: 'Core Root', isRootGroup: true };
}

function inferModuleLayer(moduleFiles, moduleLabel = '') {
  const labelLower = moduleLabel.toLowerCase();
  const pathsJoined = moduleFiles.map((f) => f.filePath.toLowerCase()).join(' ');

  if (
    moduleFiles.every((f) => {
      const ext = f.extension.toLowerCase();
      return ext === '.json' || ext === '.md' || ext === '.yaml' || ext === '.yml' || ext === '.toml' || ext === '.txt' || ext === '.css';
    }) ||
    /\b(config|constants|docs|documentation)\b/.test(labelLower)
  ) {
    return 'config_docs';
  }

  if (
    /\b(views|pages|screens|components|ui)\b/.test(labelLower) ||
    (moduleFiles.some((f) => f.extension === '.jsx' || f.extension === '.tsx') &&
      !/\b(main|index|app)\./.test(pathsJoined))
  ) {
    if (/\b(context|store|redux|hooks|router|routes)\b/.test(labelLower)) {
      return 'state_routing';
    }
    return 'presentation';
  }

  if (/\b(context|store|redux|state|hooks|routes|router|controllers)\b/.test(labelLower)) {
    return 'state_routing';
  }

  if (
    /\b(db|database|storage|indexeddb|models|schemas|repositories)\b/.test(labelLower) ||
    moduleFiles.some((f) => /(storage|database|indexeddb|schema|model)/.test(f.fileName.toLowerCase()))
  ) {
    return 'data_storage';
  }

  if (
    /\b(entry|app entry)\b/.test(labelLower) ||
    moduleFiles.some((f) => /^(main|app|index)\.(js|jsx|ts|tsx|py|java)$/.test(f.fileName.toLowerCase()))
  ) {
    return 'entry';
  }

  if (
    /\b(services|api|auth|workers|utils|lib|core|helpers)\b/.test(labelLower) ||
    moduleFiles.some((f) => f.extension === '.js' || f.extension === '.ts' || f.extension === '.py' || f.extension === '.java')
  ) {
    return 'domain_services';
  }

  return 'config_docs';
}

/**
 * Computes strongly connected components (Tarjan) and extracts normalized cycles cleanly.
 */
function detectCycles(nodeIds = [], edges = []) {
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source).push(e.target);
    }
  }
  for (const list of adj.values()) {
    list.sort();
  }

  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component = [];
      while (true) {
        const w = stack.pop();
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      if (component.length > 1) {
        sccs.push(component.sort());
      }
    }
  }

  for (const id of [...nodeIds].sort()) {
    if (!indices.has(id)) {
      strongConnect(id);
    }
  }

  const cycleEdgeIds = new Set();
  const cycleNodeIds = new Set();

  for (const comp of sccs) {
    const compSet = new Set(comp);
    for (const u of comp) {
      cycleNodeIds.add(u);
      for (const v of adj.get(u) || []) {
        if (compSet.has(v)) {
          cycleEdgeIds.add(`${u}->${v}`);
        }
      }
    }
  }

  return {
    cycles: sccs,
    cycleNodeIds,
    cycleEdgeIds,
  };
}

function sanitizeMermaidId(prefix, rawKey, index) {
  const slug = String(rawKey || '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
  return `${prefix}_${index}_${slug || 'node'}`;
}

function escapeMermaidLabel(text = '') {
  return String(text)
    .replace(/"/g, "'")
    .replace(/[<>`]/g, '')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function buildMermaidDiagrams({
  layers,
  modules,
  files,
  fileEdges,
  moduleEdges,
  externalDependencies,
}) {
  if (files.length === 0) {
    return {
      systemFlowchart: 'flowchart LR\n  empty["No workspace files loaded"]',
      moduleFlowchart: 'flowchart TD\n  empty["No workspace files loaded"]',
    };
  }

  // Deterministic IDs
  const moduleMermaidId = new Map();
  modules.forEach((mod, idx) => {
    moduleMermaidId.set(mod.id, sanitizeMermaidId('mod', mod.modulePath || mod.label, idx));
  });

  const fileMermaidId = new Map();
  files.forEach((f, idx) => {
    fileMermaidId.set(f.fileId, sanitizeMermaidId('f', f.filePath, idx));
  });

  // 1. System / Layered Architecture Flowchart
  const sysLines = ['flowchart LR'];
  for (const layer of layers) {
    const layerModules = modules.filter((m) => m.layerId === layer.id);
    if (layerModules.length === 0) continue;

    const sgId = sanitizeMermaidId('layer', layer.id, layer.tier);
    sysLines.push(`  subgraph ${sgId}["${escapeMermaidLabel(layer.label)}"]`);
    for (const mod of layerModules) {
      const mId = moduleMermaidId.get(mod.id);
      const roleTag = mod.isHub ? ' *Hub*' : mod.isEntryPoint ? ' *Entry*' : '';
      const fileWord = mod.fileCount === 1 ? 'file' : 'files';
      sysLines.push(
        `    ${mId}["${escapeMermaidLabel(`${mod.label} (${mod.fileCount} ${fileWord})${roleTag}`)}"]`
      );
    }
    sysLines.push('  end');
  }

  if (externalDependencies.length > 0) {
    const topExternals = externalDependencies.slice(0, 12);
    sysLines.push('  subgraph layer_external["External Packages"]');
    topExternals.forEach((ext, idx) => {
      const extId = sanitizeMermaidId('ext', ext.name, idx);
      sysLines.push(`    ${extId}(["${escapeMermaidLabel(ext.name)}"])`);
    });
    sysLines.push('  end');

    // Connect modules to external packages
    const extIdByName = new Map(
      topExternals.map((ext, idx) => [ext.name, sanitizeMermaidId('ext', ext.name, idx)])
    );
    const seenModExt = new Set();
    for (const ext of topExternals) {
      const targetExtId = extIdByName.get(ext.name);
      for (const modId of ext.usedByModuleIds) {
        const srcModMermaid = moduleMermaidId.get(modId);
        if (!srcModMermaid) continue;
        const edgeKey = `${srcModMermaid}->${targetExtId}`;
        if (!seenModExt.has(edgeKey)) {
          seenModExt.add(edgeKey);
          sysLines.push(`  ${srcModMermaid} -.-> ${targetExtId}`);
        }
      }
    }
  }

  for (const edge of moduleEdges) {
    const src = moduleMermaidId.get(edge.sourceModuleId);
    const tgt = moduleMermaidId.get(edge.targetModuleId);
    if (!src || !tgt) continue;
    const edgeLabel = `${edge.weight} ${edge.weight === 1 ? 'ref' : 'refs'}${edge.isCycleEdge ? ' cycle' : ''}`;
    if (edge.isCycleEdge) {
      sysLines.push(`  ${src} -.->|${escapeMermaidLabel(edgeLabel)}| ${tgt}`);
    } else {
      sysLines.push(`  ${src} -->|${escapeMermaidLabel(edgeLabel)}| ${tgt}`);
    }
  }

  // 2. Module & File Breakdown Flowchart
  const modLines = ['flowchart TD'];
  for (const mod of modules) {
    const sgId = moduleMermaidId.get(mod.id);
    modLines.push(`  subgraph ${sgId}["${escapeMermaidLabel(mod.label)}"]`);
    for (const f of mod.files) {
      const fId = fileMermaidId.get(f.fileId);
      const displayName = f.hasDuplicateBasename ? f.filePath : f.fileName;
      modLines.push(`    ${fId}["${escapeMermaidLabel(displayName)}"]`);
    }
    modLines.push('  end');
  }

  for (const edge of fileEdges) {
    const src = fileMermaidId.get(edge.sourceFileId);
    const tgt = fileMermaidId.get(edge.targetFileId);
    if (!src || !tgt) continue;
    if (edge.isCycleEdge) {
      modLines.push(`  ${src} -.->|cycle| ${tgt}`);
    } else {
      modLines.push(`  ${src} --> ${tgt}`);
    }
  }

  return {
    systemFlowchart: sysLines.join('\n'),
    moduleFlowchart: modLines.join('\n'),
  };
}

/**
 * Analyzes uploaded workspace files into an accurate multi-level software architecture model
 * keyed strictly by file ID and normalized path (never by basename alone).
 *
 * @param {Array<object>} filesList
 * @param {object} [options]
 * @returns {object}
 */
export function analyzeCodebaseArchitecture(filesList = [], { projectName = 'Workspace' } = {}) {
  const resolvedFiles = ensureResolvedFiles(filesList).filter(Boolean);

  if (resolvedFiles.length === 0) {
    const emptyMermaid = buildMermaidDiagrams({
      layers: [],
      modules: [],
      files: [],
      fileEdges: [],
      moduleEdges: [],
      externalDependencies: [],
    });
    return {
      projectName,
      summary: {
        totalFiles: 0,
        totalModules: 0,
        totalLayers: 0,
        totalFileEdges: 0,
        totalModuleEdges: 0,
        totalExternalDeps: 0,
        totalCircularFiles: 0,
        totalCircularModules: 0,
        languages: {},
      },
      layers: [],
      modules: [],
      files: [],
      fileEdges: [],
      moduleEdges: [],
      layerEdges: [],
      externalDependencies: [],
      highlights: {
        entryPoints: [],
        coreHubs: [],
        isolatedModules: [],
        cycles: { fileCycles: [], moduleCycles: [] },
      },
      mermaid: emptyMermaid,
    };
  }

  // Count basename occurrences so duplicate filenames in different folders stay disambiguated
  const basenameCounts = new Map();
  const normalizedBaseNodes = resolvedFiles.map((file, idx) => {
    const filePath = getFilePath(file) || file.name || `file-${idx}`;
    const fileName = file.name || getFileNameFromPath(filePath);
    const fileId = file.id || `file:${filePath}`;
    const extension = (file.extension || getFileExtension(filePath)).toLowerCase();
    basenameCounts.set(fileName, (basenameCounts.get(fileName) || 0) + 1);
    const modInfo = getModuleInfo(filePath, extension);

    return {
      rawFile: file,
      fileId,
      filePath,
      fileName,
      extension,
      lineCount: file.lineCount || 0,
      size: file.size || 0,
      moduleId: modInfo.moduleId,
      modulePath: modInfo.modulePath,
      moduleLabel: modInfo.label,
      isRootGroup: modInfo.isRootGroup,
      symbols: {
        functions: (file.astMetadata?.functions || []).map((fn) => fn.name),
        classes: (file.astMetadata?.classes || []).map((cls) => cls.name),
        exports: (file.astMetadata?.exports || []).map((exp) => exp.name),
      },
    };
  });

  // Sort deterministically by filePath
  normalizedBaseNodes.sort((a, b) => a.filePath.localeCompare(b.filePath));

  const nodeByFileId = new Map();
  const nodeByFilePath = new Map();
  for (const node of normalizedBaseNodes) {
    node.hasDuplicateBasename = (basenameCounts.get(node.fileName) || 0) > 1;
    nodeByFileId.set(node.fileId, node);
    nodeByFilePath.set(node.filePath, node);
  }

  // Build deduplicated file edges keyed by fileId (with path fallback only if target file lacks ID)
  const fileEdgeMap = new Map();
  const externalMap = new Map();

  for (const node of normalizedBaseNodes) {
    const rawDeps = node.rawFile.dependencies?.resolved || [];
    for (const dep of rawDeps) {
      const targetNode =
        (dep.resolvedFileId && nodeByFileId.get(dep.resolvedFileId)) ||
        (dep.resolvedFilePath && nodeByFilePath.get(getFilePath(dep.resolvedFilePath)));
      if (!targetNode || targetNode.fileId === node.fileId) continue;

      const edgeKey = `${node.fileId}->${targetNode.fileId}`;
      if (!fileEdgeMap.has(edgeKey)) {
        fileEdgeMap.set(edgeKey, {
          id: edgeKey,
          source: node.fileId,
          target: targetNode.fileId,
          sourceFileId: node.fileId,
          targetFileId: targetNode.fileId,
          sourcePath: node.filePath,
          targetPath: targetNode.filePath,
          sourceModuleId: node.moduleId,
          targetModuleId: targetNode.moduleId,
          specifiers: [],
          line: dep.line || 1,
          isCycleEdge: false,
        });
      }
      const entry = fileEdgeMap.get(edgeKey);
      for (const spec of dep.specifiers || []) {
        if (spec && !entry.specifiers.includes(spec)) {
          entry.specifiers.push(spec);
        }
      }
    }

    const unresolved = node.rawFile.dependencies?.unresolved || node.rawFile.unresolvedImports || [];
    for (const ext of unresolved) {
      if (!ext || ext.type !== 'external') continue;
      const pkgName = ext.source;
      if (!pkgName) continue;
      if (!externalMap.has(pkgName)) {
        externalMap.set(pkgName, {
          id: `ext:${pkgName}`,
          name: pkgName,
          usedByFileIds: new Set(),
          usedByPaths: new Set(),
          usedByModuleIds: new Set(),
          importCount: 0,
        });
      }
      const extItem = externalMap.get(pkgName);
      extItem.usedByFileIds.add(node.fileId);
      extItem.usedByPaths.add(node.filePath);
      extItem.usedByModuleIds.add(node.moduleId);
      extItem.importCount += 1;
    }
  }

  const fileEdges = Array.from(fileEdgeMap.values()).sort((a, b) => a.id.localeCompare(b.id));

  // File-level degrees & cycle detection
  const fileInDegree = new Map();
  const fileOutDegree = new Map();
  for (const node of normalizedBaseNodes) {
    fileInDegree.set(node.fileId, 0);
    fileOutDegree.set(node.fileId, 0);
  }
  for (const edge of fileEdges) {
    fileOutDegree.set(edge.sourceFileId, (fileOutDegree.get(edge.sourceFileId) || 0) + 1);
    fileInDegree.set(edge.targetFileId, (fileInDegree.get(edge.targetFileId) || 0) + 1);
  }

  const fileCycleAnalysis = detectCycles(
    normalizedBaseNodes.map((n) => n.fileId),
    fileEdges
  );
  for (const edge of fileEdges) {
    edge.isCycleEdge = fileCycleAnalysis.cycleEdgeIds.has(edge.id);
  }

  const analyzedFiles = normalizedBaseNodes.map((node) => {
    const inDeg = fileInDegree.get(node.fileId) || 0;
    const outDeg = fileOutDegree.get(node.fileId) || 0;
    const extCount = (node.rawFile.dependencies?.unresolved || []).filter((u) => u.type === 'external').length;
    const symbolCount =
      node.symbols.functions.length + node.symbols.classes.length + node.symbols.exports.length;
    const isEntryFile =
      /^(main|index|app)\.(js|jsx|ts|tsx|py|java)$/.test(node.fileName.toLowerCase()) ||
      (inDeg === 0 && outDeg > 0);
    const isHub = inDeg >= 2 || inDeg + outDeg >= Math.max(3, Math.floor(normalizedBaseNodes.length / 3));
    const isIsolated = inDeg === 0 && outDeg === 0 && extCount === 0;
    const importanceScore = Number((inDeg * 2.5 + outDeg * 1.1 + symbolCount * 0.25 + extCount * 0.3).toFixed(2));

    return {
      fileId: node.fileId,
      filePath: node.filePath,
      fileName: node.fileName,
      extension: node.extension,
      lineCount: node.lineCount,
      size: node.size,
      moduleId: node.moduleId,
      moduleLabel: node.moduleLabel,
      hasDuplicateBasename: node.hasDuplicateBasename,
      symbols: node.symbols,
      symbolCount,
      inDegree: inDeg,
      outDegree: outDeg,
      externalCount: extCount,
      isEntryPoint: isEntryFile,
      isHub,
      isIsolated,
      inCycle: fileCycleAnalysis.cycleNodeIds.has(node.fileId),
      importanceScore,
    };
  });

  // Group into Modules
  const moduleGroupsMap = new Map();
  for (const f of analyzedFiles) {
    if (!moduleGroupsMap.has(f.moduleId)) {
      const base = normalizedBaseNodes.find((n) => n.moduleId === f.moduleId);
      moduleGroupsMap.set(f.moduleId, {
        id: f.moduleId,
        modulePath: base?.modulePath || f.moduleLabel,
        label: f.moduleLabel,
        isRootGroup: Boolean(base?.isRootGroup),
        files: [],
      });
    }
    moduleGroupsMap.get(f.moduleId).files.push(f);
  }

  // Aggregate Module Edges
  const moduleEdgeMap = new Map();
  for (const fe of fileEdges) {
    if (fe.sourceModuleId === fe.targetModuleId) continue;
    const mKey = `${fe.sourceModuleId}->${fe.targetModuleId}`;
    if (!moduleEdgeMap.has(mKey)) {
      moduleEdgeMap.set(mKey, {
        id: mKey,
        source: fe.sourceModuleId,
        target: fe.targetModuleId,
        sourceModuleId: fe.sourceModuleId,
        targetModuleId: fe.targetModuleId,
        weight: 0,
        fileLinks: [],
        sampleSpecifiers: [],
        isCycleEdge: false,
      });
    }
    const me = moduleEdgeMap.get(mKey);
    me.weight += 1;
    me.fileLinks.push({
      sourcePath: fe.sourcePath,
      targetPath: fe.targetPath,
      specifiers: fe.specifiers,
    });
    for (const s of fe.specifiers) {
      if (me.sampleSpecifiers.length < 6 && !me.sampleSpecifiers.includes(s)) {
        me.sampleSpecifiers.push(s);
      }
    }
  }
  const moduleEdges = Array.from(moduleEdgeMap.values()).sort((a, b) => a.id.localeCompare(b.id));

  const moduleCycleAnalysis = detectCycles(
    Array.from(moduleGroupsMap.keys()),
    moduleEdges
  );
  for (const me of moduleEdges) {
    me.isCycleEdge = moduleCycleAnalysis.cycleEdgeIds.has(me.id);
  }

  const modInDeg = new Map();
  const modOutDeg = new Map();
  for (const id of moduleGroupsMap.keys()) {
    modInDeg.set(id, 0);
    modOutDeg.set(id, 0);
  }
  for (const me of moduleEdges) {
    modOutDeg.set(me.sourceModuleId, (modOutDeg.get(me.sourceModuleId) || 0) + 1);
    modInDeg.set(me.targetModuleId, (modInDeg.get(me.targetModuleId) || 0) + 1);
  }

  const modules = Array.from(moduleGroupsMap.values())
    .map((mod) => {
      const layerId = inferModuleLayer(mod.files, mod.label);
      const layerMeta = LAYER_BY_ID.get(layerId) || LAYER_BY_ID.get('domain_services');
      const inDeg = modInDeg.get(mod.id) || 0;
      const outDeg = modOutDeg.get(mod.id) || 0;
      const totalLoc = mod.files.reduce((sum, f) => sum + (f.lineCount || 0), 0);
      const totalExt = mod.files.reduce((sum, f) => sum + (f.externalCount || 0), 0);
      const topExports = Array.from(
        new Set(mod.files.flatMap((f) => f.symbols.exports || []))
      ).slice(0, 8);
      const isEntryPoint =
        layerId === 'entry' || mod.files.some((f) => f.isEntryPoint) || (inDeg === 0 && outDeg > 0);
      const isHub = inDeg >= 2 || (inDeg + outDeg >= 3 && inDeg >= 1);
      const isIsolated = inDeg === 0 && outDeg === 0 && totalExt === 0;

      return {
        id: mod.id,
        modulePath: mod.modulePath,
        label: mod.label,
        layerId,
        layerLabel: layerMeta.label,
        tier: layerMeta.tier,
        accent: layerMeta.accent,
        files: mod.files,
        fileCount: mod.files.length,
        totalLoc,
        inDegree: inDeg,
        outDegree: outDeg,
        externalCount: totalExt,
        topExports,
        isEntryPoint,
        isHub,
        isIsolated,
        inCycle: moduleCycleAnalysis.cycleNodeIds.has(mod.id),
      };
    })
    .sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label));

  // Build Layers (non-empty only)
  const layers = ARCHITECTURE_LAYERS.map((layer) => {
    const layerModules = modules.filter((m) => m.layerId === layer.id);
    return {
      ...layer,
      moduleIds: layerModules.map((m) => m.id),
      moduleCount: layerModules.length,
      fileCount: layerModules.reduce((sum, m) => sum + m.fileCount, 0),
    };
  }).filter((l) => l.moduleCount > 0);

  // Layer Edges
  const moduleLayerMap = new Map(modules.map((m) => [m.id, m.layerId]));
  const layerEdgeMap = new Map();
  for (const me of moduleEdges) {
    const srcLayer = moduleLayerMap.get(me.sourceModuleId);
    const tgtLayer = moduleLayerMap.get(me.targetModuleId);
    if (!srcLayer || !tgtLayer || srcLayer === tgtLayer) continue;
    const lKey = `${srcLayer}->${tgtLayer}`;
    if (!layerEdgeMap.has(lKey)) {
      layerEdgeMap.set(lKey, {
        id: lKey,
        sourceLayerId: srcLayer,
        targetLayerId: tgtLayer,
        weight: 0,
      });
    }
    layerEdgeMap.get(lKey).weight += me.weight;
  }
  const layerEdges = Array.from(layerEdgeMap.values()).sort((a, b) => a.id.localeCompare(b.id));

  // External Dependencies sorted by usage count
  const externalDependencies = Array.from(externalMap.values())
    .map((ext) => ({
      id: ext.id,
      name: ext.name,
      usedByFileIds: Array.from(ext.usedByFileIds).sort(),
      usedByPaths: Array.from(ext.usedByPaths).sort(),
      usedByModuleIds: Array.from(ext.usedByModuleIds).sort(),
      importCount: ext.importCount,
    }))
    .sort((a, b) => b.importCount - a.importCount || a.name.localeCompare(b.name));

  // Language breakdown
  const languages = {};
  for (const f of analyzedFiles) {
    const ext = f.extension || 'other';
    languages[ext] = (languages[ext] || 0) + 1;
  }

  // Highlights
  const entryPoints = analyzedFiles
    .filter((f) => f.isEntryPoint)
    .sort((a, b) => b.outDegree - a.outDegree || a.filePath.localeCompare(b.filePath))
    .slice(0, 6)
    .map((f) => ({ fileId: f.fileId, filePath: f.filePath, moduleId: f.moduleId, outDegree: f.outDegree }));

  const coreHubs = [...analyzedFiles]
    .filter((f) => f.inDegree > 0 || f.isHub)
    .sort((a, b) => b.importanceScore - a.importanceScore || a.filePath.localeCompare(b.filePath))
    .slice(0, 6)
    .map((f) => ({
      fileId: f.fileId,
      filePath: f.filePath,
      moduleId: f.moduleId,
      inDegree: f.inDegree,
      outDegree: f.outDegree,
      importanceScore: f.importanceScore,
    }));

  const isolatedModules = modules
    .filter((m) => m.isIsolated)
    .map((m) => ({ moduleId: m.id, label: m.label, fileCount: m.fileCount }));

  const fileCycles = fileCycleAnalysis.cycles.map((comp) =>
    comp.map((fId) => ({
      fileId: fId,
      filePath: nodeByFileId.get(fId)?.filePath || fId,
    }))
  );

  const moduleCycles = moduleCycleAnalysis.cycles.map((comp) =>
    comp.map((mId) => ({
      moduleId: mId,
      label: moduleGroupsMap.get(mId)?.label || mId,
    }))
  );

  const mermaid = buildMermaidDiagrams({
    layers,
    modules,
    files: analyzedFiles,
    fileEdges,
    moduleEdges,
    externalDependencies,
  });

  return {
    projectName,
    summary: {
      totalFiles: analyzedFiles.length,
      totalModules: modules.length,
      totalLayers: layers.length,
      totalFileEdges: fileEdges.length,
      totalModuleEdges: moduleEdges.length,
      totalExternalDeps: externalDependencies.length,
      totalCircularFiles: fileCycleAnalysis.cycleNodeIds.size,
      totalCircularModules: moduleCycleAnalysis.cycleNodeIds.size,
      languages,
    },
    layers,
    modules,
    files: analyzedFiles,
    fileEdges,
    moduleEdges,
    layerEdges,
    externalDependencies,
    highlights: {
      entryPoints,
      coreHubs,
      isolatedModules,
      cycles: {
        fileCycles,
        moduleCycles,
      },
    },
    mermaid,
  };
}
