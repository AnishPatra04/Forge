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
        const key = `${name}:${line}`;
        if (!seenFunctions.has(key)) {
          seenFunctions.add(key);
          functions.push({ name, line });
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
          if (initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression') {
            const name = node.id.name;
            const fKey = `${name}:${line}`;
            if (!seenFunctions.has(fKey)) {
              seenFunctions.add(fKey);
              functions.push({ name, line });
            }
          } else if (initType === 'ClassExpression') {
            const name = node.id.name;
            const cKey = `${name}:${line}`;
            if (!seenClasses.has(cKey)) {
              seenClasses.add(cKey);
              classes.push({ name, line });
            }
          }
        }
      },

      // Class methods
      ClassMethod(node) {
        if (node.key?.type === 'Identifier' && node.key.name !== 'constructor') {
          const name = node.key.name;
          const line = node.loc?.start?.line || 1;
          const key = `${name}:${line}`;
          if (!seenFunctions.has(key)) {
            seenFunctions.add(key);
            functions.push({ name, line });
          }
        }
      },

      // 2. Class declarations
      ClassDeclaration(node) {
        const name = node.id?.name || 'anonymous';
        const line = node.loc?.start?.line || 1;
        const key = `${name}:${line}`;
        if (!seenClasses.has(key)) {
          seenClasses.add(key);
          classes.push({ name, line });
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

