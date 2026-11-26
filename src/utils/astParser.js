import { parse } from '@babel/parser';
import { getFileExtension, getFilePath } from '../constants/fileTypes.js';

const AST_SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

/**
 * Checks if a file is supported for AST parsing.
 * @param {string} filename
 * @returns {boolean}
 */
export function isAstSupported(filename) {
  if (!filename) return false;
  return AST_SUPPORTED_EXTENSIONS.has(getFileExtension(filename));
}

/**
 * Recursively extracts identifiers from variable declarator patterns
 * (supports simple identifiers, object destructuring, and array destructuring).
 */
function extractPatternIdentifiers(pattern, line) {
  const identifiers = [];

  function walk(node) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        identifiers.push({
          name: node.name,
          line: node.loc?.start?.line || line,
        });
        break;
      case 'ObjectPattern':
        for (const prop of node.properties || []) {
          if (prop.type === 'ObjectProperty') {
            walk(prop.value);
          } else if (prop.type === 'RestElement') {
            walk(prop.argument);
          }
        }
        break;
      case 'ArrayPattern':
        for (const elem of node.elements || []) {
          if (elem) walk(elem);
        }
        break;
      case 'AssignmentPattern':
        walk(node.left);
        break;
      case 'RestElement':
        walk(node.argument);
        break;
      default:
        break;
    }
  }

  walk(pattern);
  return identifiers;
}

/**
 * Traverses an AST tree using a visitor pattern.
 */
function traverseAst(node, visitor, parent = null) {
  if (!node || typeof node !== 'object') return;

  if (node.type && visitor[node.type]) {
    visitor[node.type](node, parent);
  }

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'comments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object') {
          traverseAst(item, visitor, node);
        }
      }
    } else if (child && typeof child === 'object') {
      traverseAst(child, visitor, node);
    }
  }
}

/**
 * Extracts lightweight AST metadata (functions, classes, variables, imports, exports)
 * from .js, .jsx, .ts, and .tsx source code.
 *
 * @param {string} content - Raw source code string
 * @param {string} filename - Filename with extension
 * @returns {object|null} - Extracted metadata or null if unsupported
 */
export function extractAstMetadata(content, filename) {
  if (!content || !isAstSupported(filename)) {
    return null;
  }

  const ext = getFileExtension(filename);
  const isTs = ext === '.ts' || ext === '.tsx';

  const functions = [];
  const classes = [];
  const variables = [];
  const imports = [];
  const exports = [];

  const seenFunctions = new Set();
  const seenClasses = new Set();
  const seenVariables = new Set();

  try {
    const ast = parse(content, {
      sourceType: 'module',
      plugins: isTs ? ['typescript', 'jsx'] : ['jsx'],
      errorRecovery: true,
    });

    traverseAst(ast, {
      // 1. Function declarations
      FunctionDeclaration(node) {
        const name = node.id?.name || 'anonymous';
        const line = node.loc?.start?.line || 1;
        const endLine = node.loc?.end?.line || line;
        const key = `${name}:${line}`;
        if (!seenFunctions.has(key)) {
          seenFunctions.add(key);
          functions.push({ name, line, endLine });
        }
      },

      // Function & ArrowFunction expressions assigned to variables or class methods
      VariableDeclarator(node) {
        const line = node.loc?.start?.line || 1;

        // Variables extraction
        const idents = extractPatternIdentifiers(node.id, line);
        for (const ident of idents) {
          const vKey = `${ident.name}:${ident.line}`;
          if (!seenVariables.has(vKey)) {
            seenVariables.add(vKey);
            variables.push({ name: ident.name, line: ident.line });
          }
        }

        // Check if assigned value is a function or class
        if (node.id?.type === 'Identifier') {
          const initType = node.init?.type;
          const endLine = node.init?.loc?.end?.line || node.loc?.end?.line || line;
          if (initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression') {
            const name = node.id.name;
            const fKey = `${name}:${line}`;
            if (!seenFunctions.has(fKey)) {
              seenFunctions.add(fKey);
              functions.push({ name, line, endLine });
            }
          } else if (initType === 'ClassExpression') {
            const name = node.id.name;
            const cKey = `${name}:${line}`;
            if (!seenClasses.has(cKey)) {
              seenClasses.add(cKey);
              classes.push({ name, line, endLine });
            }
          }
        }
      },

      // Class methods
      ClassMethod(node) {
        if (node.key?.type === 'Identifier' && node.key.name !== 'constructor') {
          const name = node.key.name;
          const line = node.loc?.start?.line || 1;
          const endLine = node.loc?.end?.line || line;
          const key = `${name}:${line}`;
          if (!seenFunctions.has(key)) {
            seenFunctions.add(key);
            functions.push({ name, line, endLine });
          }
        }
      },

      // 2. Class declarations
      ClassDeclaration(node) {
        const name = node.id?.name || 'anonymous';
        const line = node.loc?.start?.line || 1;
        const endLine = node.loc?.end?.line || line;
        const key = `${name}:${line}`;
        if (!seenClasses.has(key)) {
          seenClasses.add(key);
          classes.push({ name, line, endLine });
        }
      },

      // 3. Import statements
      ImportDeclaration(node) {
        const source = node.source?.value || '';
        const line = node.loc?.start?.line || 1;
        const specifiers = [];

        for (const spec of node.specifiers || []) {
          const localName = spec.local?.name;
          if (localName) {
            specifiers.push(localName);
            imports.push({
              name: localName,
              source,
              line: spec.loc?.start?.line || line,
            });
          }
        }

        // If default/side-effect import with no specifiers
        if (specifiers.length === 0) {
          imports.push({
            name: source,
            source,
            line,
          });
        }
      },

      // 4. Export statements
      ExportNamedDeclaration(node) {
        const line = node.loc?.start?.line || 1;

        if (node.declaration) {
          const decl = node.declaration;
          if (decl.type === 'FunctionDeclaration' && decl.id?.name) {
            exports.push({ name: decl.id.name, type: 'function', line: decl.loc?.start?.line || line });
          } else if (decl.type === 'ClassDeclaration' && decl.id?.name) {
            exports.push({ name: decl.id.name, type: 'class', line: decl.loc?.start?.line || line });
          } else if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations || []) {
              const idents = extractPatternIdentifiers(d.id, line);
              for (const ident of idents) {
                exports.push({ name: ident.name, type: 'variable', line: ident.line });
              }
            }
          } else if (decl.type === 'TSTypeAliasDeclaration' || decl.type === 'TSInterfaceDeclaration') {
            if (decl.id?.name) {
              exports.push({ name: decl.id.name, type: 'type', line: decl.loc?.start?.line || line });
            }
          }
        }

        if (node.specifiers) {
          for (const spec of node.specifiers) {
            const name = spec.exported?.name || spec.exported?.value || spec.local?.name;
            if (name) {
              exports.push({
                name,
                type: 'named',
                line: spec.loc?.start?.line || line,
              });
            }
          }
        }
      },

      ExportDefaultDeclaration(node) {
        const line = node.loc?.start?.line || 1;
        const name = node.declaration?.id?.name || node.declaration?.name || 'default';
        exports.push({
          name,
          type: 'default',
          line,
        });
      },

      ExportAllDeclaration(node) {
        const line = node.loc?.start?.line || 1;
        exports.push({
          name: '*',
          source: node.source?.value || '',
          type: 'all',
          line,
        });
      },
    });

    return {
      functions,
      classes,
      variables,
      imports,
      exports,
      error: null,
    };
  } catch (err) {
    // Gracefully handle syntax/parse errors per file without crashing
    return {
      functions: [],
      classes: [],
      variables: [],
      imports: [],
      exports: [],
      error: err?.message || 'Unknown parsing error',
    };
  }
}

/**
 * Calculates aggregated structural metrics across an array of files.
 * Excludes files without AST metadata and prevents double-counting within each category.
 *
 * @param {Array} filesList - Array of file objects
 * @returns {{ totalFunctions: number, totalClasses: number, totalVariables: number, totalImports: number, totalExports: number }}
 */
export function calculateStructuralMetrics(filesList = []) {
  let totalFunctions = 0;
  let totalClasses = 0;
  let totalVariables = 0;
  let totalImports = 0;
  let totalExports = 0;

  const seenFunctions = new Set();
  const seenClasses = new Set();
  const seenVariables = new Set();
  const seenImports = new Set();
  const seenExports = new Set();

  filesList.forEach((file) => {
    // Exclude files that have no AST metadata or have parse errors
    if (!file || !file.astMetadata || file.astMetadata.error) return;

    const fileKey = file.id || getFilePath(file) || 'file';
    const {
      functions = [],
      classes = [],
      variables = [],
      imports = [],
      exports = [],
    } = file.astMetadata;

    // 1. Functions
    functions.forEach((fn) => {
      if (!fn || !fn.name) return;
      const key = `${fileKey}:${fn.name}:${fn.line}`;
      if (!seenFunctions.has(key)) {
        seenFunctions.add(key);
        totalFunctions++;
      }
    });

    // 2. Classes
    classes.forEach((cls) => {
      if (!cls || !cls.name) return;
      const key = `${fileKey}:${cls.name}:${cls.line}`;
      if (!seenClasses.has(key)) {
        seenClasses.add(key);
        totalClasses++;
      }
    });

    // 3. Variables
    variables.forEach((v) => {
      if (!v || !v.name) return;
      const key = `${fileKey}:${v.name}:${v.line}`;
      if (!seenVariables.has(key)) {
        seenVariables.add(key);
        totalVariables++;
      }
    });

    // 4. Imports
    imports.forEach((imp) => {
      if (!imp) return;
      const key = `${fileKey}:${imp.source || ''}:${imp.name || ''}:${imp.line}`;
      if (!seenImports.has(key)) {
        seenImports.add(key);
        totalImports++;
      }
    });

    // 5. Exports
    exports.forEach((exp) => {
      if (!exp || !exp.name) return;
      const key = `${fileKey}:${exp.name}:${exp.type || ''}:${exp.line}`;
      if (!seenExports.has(key)) {
        seenExports.add(key);
        totalExports++;
      }
    });
  });

  return {
    totalFunctions,
    totalClasses,
    totalVariables,
    totalImports,
    totalExports,
  };
}

/**
 * Performs AST-aware and keyword search across an array of files.
 * Searches both raw file contents and astMetadata for function, class, variable, import, and export names.
 * Avoids duplicate results for the same declaration while displaying declaration type and line numbers.
 *
 * @param {Array} filesList - List of file objects
 * @param {string} query - User search query
 * @returns {{ results: Array, grandTotalMatches: number }}
 */
export function performAstAwareSearch(filesList = [], query = '') {
  const raw = query.trim();
  if (!raw) {
    return { results: null, grandTotalMatches: 0 };
  }

  // Tokenize query into search terms
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const results = [];
  let grandTotalMatches = 0;

  filesList.forEach((file) => {
    if (!file || !file.content) return;

    const filePath = getFilePath(file) || file.name || '';
    const lines = file.content.split('\n');
    const fileMatches = [];

    // Map AST declarations by line number for this file
    const lineAstMap = new Map();

    if (file.astMetadata && !file.astMetadata.error) {
      const {
        classes = [],
        functions = [],
        variables = [],
        imports = [],
        exports = [],
      } = file.astMetadata;

      const addDecl = (type, item) => {
        if (!item || !item.line) return;
        const lineNum = item.line;
        if (!lineAstMap.has(lineNum)) lineAstMap.set(lineNum, []);
        lineAstMap.get(lineNum).push({
          type,
          name: item.name || item.source || '',
          source: item.source || null,
        });
      };

      // Register declarations in priority order
      classes.forEach((c) => addDecl('class', c));
      functions.forEach((f) => addDecl('function', f));
      variables.forEach((v) => addDecl('variable', v));
      imports.forEach((i) => addDecl('import', i));
      exports.forEach((e) => addDecl('export', e));
    }

    // Process each line in the file
    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;
      const lowerLine = lineText.toLowerCase();

      // 1. Keyword containment match on raw line
      const lineMatchedTokens = tokens.filter((t) => lowerLine.includes(t));

      // 2. AST metadata match on this line
      const astDecls = lineAstMap.get(lineNum) || [];
      const astMatchedDecls = astDecls.filter((d) =>
        tokens.some(
          (t) =>
            (d.name && d.name.toLowerCase().includes(t)) ||
            (d.source && d.source.toLowerCase().includes(t)) ||
            d.type.toLowerCase() === t
        )
      );

      // Match found if line text contains token OR line corresponds to an AST declaration matching the token
      if (lineMatchedTokens.length > 0 || astMatchedDecls.length > 0) {
        let declarationType = null;
        let declarationName = null;

        if (astDecls.length > 0) {
          // Priority order: class > function > variable > import > export
          const priority = { class: 1, function: 2, variable: 3, import: 4, export: 5 };
          const sorted = [...astDecls].sort(
            (a, b) => (priority[a.type] || 99) - (priority[b.type] || 99)
          );
          // Prefer an AST decl that directly matched the query, otherwise highest priority declaration on this line
          const best = astMatchedDecls[0] || sorted[0];
          declarationType = best.type;
          declarationName = best.name;
        }

        const allMatchedWords = Array.from(
          new Set([
            ...lineMatchedTokens,
            ...astMatchedDecls.map((d) => d.name),
          ])
        ).filter(Boolean);

        const formattedLineContent = declarationType
          ? `[${declarationType}] ${lineText.trim() ? lineText.trim() : lineText}`
          : lineText;

        fileMatches.push({
          lineNumber: lineNum,
          fileName: file.name,
          filePath,
          declarationType,
          declarationName,
          lineContent: formattedLineContent,
          rawContent: lineText,
          matchedWords: allMatchedWords.length > 0 ? allMatchedWords : lineMatchedTokens,
        });
      }
    });

    if (fileMatches.length > 0) {
      grandTotalMatches += fileMatches.length;
      results.push({
        fileId: file.id,
        fileName: file.name,
        filePath,
        fileExtension: file.extension,
        fileSize: file.size,
        lineCount: file.lineCount,
        matches: fileMatches,
        totalMatches: fileMatches.length,
      });
    }
  });

  // Rank files by number of matches descending
  results.sort((a, b) => b.totalMatches - a.totalMatches);

  return { results, grandTotalMatches };
}

/**
 * Resolves a relative import path against the importer's directory.
 *
 * @param {string} importerDir - Directory of the importing file (e.g. 'src/components')
 * @param {string} source - Relative import path (e.g. '../context/WorkspaceContext')
 * @returns {string} Normalized target path
 */
export function resolveRelativePath(importerDir = '', source = '') {
  const normalizedSource = source.replace(/\\/g, '/');
  const baseParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
  const sourceParts = normalizedSource.split('/').filter(Boolean);

  for (const part of sourceParts) {
    if (part === '.') {
      continue;
    } else if (part === '..') {
      if (baseParts.length > 0) {
        baseParts.pop();
      }
    } else {
      baseParts.push(part);
    }
  }

  return baseParts.join('/');
}

/**
 * Resolves file-to-file dependencies from import declarations for JS, JSX, TS, and TSX files.
 * Resolves relative imports against uploaded filenames, including common extensions and index files.
 * Stores dependency metadata on each file (resolved and unresolved imports).
 *
 * @param {Array} filesList - Array of file objects
 * @returns {Array} Array of file objects with attached `dependencies` metadata
 */
export function resolveFileDependencies(filesList = []) {
  if (!Array.isArray(filesList) || filesList.length === 0) {
    return filesList || [];
  }

  const COMMON_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.mjs', '.cjs'];
  const INDEX_EXTENSIONS = ['/index.js', '/index.jsx', '/index.ts', '/index.tsx', '/index.json'];

  // Lookup structures for fast path resolution.
  // Phase 3E stores file.path (relative repo path like "src/components/Header.tsx")
  // and file.name (basename like "Header.tsx"). We index by path so relative imports
  // across subdirectories resolve correctly, with basename fallback for flat uploads.
  const fileByExactPath = new Map();
  const fileByBasename = new Map();

  filesList.forEach((f) => {
    if (!f) return;
    // Prefer file.path (relative path) over file.name (basename)
    const filePath = (f.path || f.name || '').replace(/\\/g, '/');
    if (!filePath) return;

    fileByExactPath.set(filePath, f);
    fileByExactPath.set(filePath.toLowerCase(), f);

    const base = filePath.split('/').pop();
    if (base) {
      if (!fileByBasename.has(base)) fileByBasename.set(base, []);
      fileByBasename.get(base).push(f);

      const baseLower = base.toLowerCase();
      if (!fileByBasename.has(baseLower)) fileByBasename.set(baseLower, []);
      fileByBasename.get(baseLower).push(f);
    }
  });

  function findTargetFile(targetPath) {
    if (!targetPath) return null;

    // 1. Exact match
    if (fileByExactPath.has(targetPath)) return fileByExactPath.get(targetPath);
    if (fileByExactPath.has(targetPath.toLowerCase())) return fileByExactPath.get(targetPath.toLowerCase());

    // 2. Try common extensions
    for (const ext of COMMON_EXTENSIONS) {
      const candidate = targetPath + ext;
      if (fileByExactPath.has(candidate)) return fileByExactPath.get(candidate);
      if (fileByExactPath.has(candidate.toLowerCase())) return fileByExactPath.get(candidate.toLowerCase());
    }

    // 3. Try index files
    for (const idxExt of INDEX_EXTENSIONS) {
      const candidate = targetPath + idxExt;
      if (fileByExactPath.has(candidate)) return fileByExactPath.get(candidate);
      if (fileByExactPath.has(candidate.toLowerCase())) return fileByExactPath.get(candidate.toLowerCase());
    }

    // 4. Fallback: match by basename if targetPath has subdirectories but uploaded files are stored flat
    const targetBasename = targetPath.split('/').pop();
    if (targetBasename) {
      if (fileByBasename.has(targetBasename)) return fileByBasename.get(targetBasename)[0];
      if (fileByBasename.has(targetBasename.toLowerCase())) return fileByBasename.get(targetBasename.toLowerCase())[0];

      for (const ext of COMMON_EXTENSIONS) {
        const candidate = targetBasename + ext;
        if (fileByBasename.has(candidate)) return fileByBasename.get(candidate)[0];
        if (fileByBasename.has(candidate.toLowerCase())) return fileByBasename.get(candidate.toLowerCase())[0];
      }
    }

    return null;
  }

  // Reverse dependencies tracking (targetFileId -> array of { fileId, fileName, filePath, line, specifiers })
  const reverseDepsMap = new Map();

  const filesWithDeps = filesList.map((file) => {
    if (!file || !file.astMetadata || file.astMetadata.error) {
      // Plain object (not array) for consistency across all code paths
      const emptyDeps = {
        resolved: [],
        unresolved: [],
        importedBy: [],
        totalResolved: 0,
        totalUnresolved: 0,
      };
      return {
        ...file,
        dependencies: emptyDeps,
        importedBy: [],
        resolvedImports: [],
        unresolvedImports: [],
        astMetadata: file.astMetadata
          ? { ...file.astMetadata, dependencies: emptyDeps, importedBy: [] }
          : null,
      };
    }

    // Group raw imports by source + line to avoid duplicate dependency entries
    const rawImports = file.astMetadata.imports || [];
    const groupedImports = new Map();

    rawImports.forEach((imp) => {
      if (!imp || !imp.source) return;
      const key = `${imp.source}:${imp.line}`;
      if (!groupedImports.has(key)) {
        groupedImports.set(key, {
          source: imp.source,
          line: imp.line,
          specifiers: [],
        });
      }
      if (imp.name && !groupedImports.get(key).specifiers.includes(imp.name)) {
        groupedImports.get(key).specifiers.push(imp.name);
      }
    });

    // Use file.path (relative repo path like "src/components/Header.tsx") for directory
    // resolution so imports across subdirectories work correctly. Fall back to file.name
    // for flat local uploads where path === name.
    const normImporter = (file.path || file.name || '').replace(/\\/g, '/');
    const importerDir = normImporter.includes('/')
      ? normImporter.substring(0, normImporter.lastIndexOf('/'))
      : '';

    const resolved = [];
    const unresolved = [];

    groupedImports.forEach((impDecl) => {
      const source = impDecl.source;
      const isRelative =
        source.startsWith('./') ||
        source.startsWith('../') ||
        source === '.' ||
        source === '..';

      if (!isRelative) {
        unresolved.push({
          source,
          line: impDecl.line,
          specifiers: impDecl.specifiers,
          type: 'external',
          isExternal: true,
          isRelative: false,
          reason: 'External package',
        });
        return;
      }

      const targetPath = resolveRelativePath(importerDir, source);
      const matchedTarget = findTargetFile(targetPath);

      if (matchedTarget) {
        const resolvedEntry = {
          source,
          resolvedFileId: matchedTarget.id,
          resolvedFileName: matchedTarget.name,
          resolvedFilePath: matchedTarget.path || matchedTarget.name,
          line: impDecl.line,
          specifiers: impDecl.specifiers,
          isRelative: true,
        };
        resolved.push(resolvedEntry);

        // Record reverse dependency
        if (matchedTarget.id) {
          if (!reverseDepsMap.has(matchedTarget.id)) {
            reverseDepsMap.set(matchedTarget.id, []);
          }
          reverseDepsMap.get(matchedTarget.id).push({
            fileId: file.id,
            fileName: file.name,
            filePath: file.path || file.name,
            line: impDecl.line,
            specifiers: impDecl.specifiers,
          });
        }
      } else {
        unresolved.push({
          source,
          targetPath,
          line: impDecl.line,
          specifiers: impDecl.specifiers,
          type: 'missing_relative',
          isExternal: false,
          isRelative: true,
          reason: 'Missing relative file',
        });
      }
    });

    return {
      ...file,
      _rawResolved: resolved,
      _rawUnresolved: unresolved,
    };
  });

  // Attach dependencies & reverse dependencies (importedBy) to each file
  return filesWithDeps.map((file) => {
    const importedBy = reverseDepsMap.get(file.id) || [];

    if (!file._rawResolved) {
      // Non-AST or error files: build plain-object deps and attach final importedBy
      const deps = {
        resolved: [],
        unresolved: [],
        importedBy,
        totalResolved: 0,
        totalUnresolved: 0,
      };
      return {
        ...file,
        importedBy,
        dependencies: deps,
        astMetadata: file.astMetadata
          ? { ...file.astMetadata, dependencies: deps, importedBy }
          : null,
      };
    }

    const resolved = file._rawResolved;
    const unresolved = file._rawUnresolved;

    // Plain-object dependencies structure (consistent with emptyDeps above)
    const dependencies = {
      resolved,
      unresolved,
      importedBy,
      totalResolved: resolved.length,
      totalUnresolved: unresolved.length,
    };

    const { _rawResolved, _rawUnresolved, ...cleanFile } = file;

    return {
      ...cleanFile,
      dependencies,
      importedBy,
      resolvedImports: resolved,
      unresolvedImports: unresolved,
      astMetadata: cleanFile.astMetadata
        ? {
            ...cleanFile.astMetadata,
            dependencies,
            importedBy,
            resolvedImports: resolved,
            unresolvedImports: unresolved,
          }
        : null,
    };
  });
}

