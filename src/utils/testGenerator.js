import { parse } from '@babel/parser';
import { getFileExtension, getFileNameFromPath, getFilePath } from '../constants/fileTypes.js';
import { analyzeCodebaseArchitecture } from './architectureAnalyzer.js';
import { extractAstMetadata, isAstSupported, resolveFileDependencies } from './astParser.js';
import { chunkFile, splitIdentifierWords } from './codeChunker.js';

export const TESTABLE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.java']);

export const FRAMEWORK_LABELS = {
  vitest: 'Vitest',
  jest: 'Jest',
  pytest: 'pytest',
  unittest: 'unittest',
  junit5: 'JUnit 5',
};

const EMPTY_SUMMARY = {
  totalTargets: 0,
  totalScenarios: 0,
  byCategory: { normal: 0, edge: 0, failure: 0 },
  byTier: { High: 0, Medium: 0, Standard: 0 },
  byKind: {},
  coveredModules: [],
  coveredFiles: [],
  skippedTestFiles: 0,
  unverifiedAssertionsCount: 0,
};

/**
 * Checks whether a workspace file path looks like an existing test suite file
 * so FORGE does not generate recursive tests for test files themselves.
 */
export function isExistingTestFile(filePath = '') {
  const norm = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  if (!norm) return false;
  const base = norm.split('/').pop() || norm;
  return (
    /(?:^|\/)__tests__(?:\/|$)/.test(norm) ||
    /\.(?:test|spec)\.[jt]sx?$/.test(base) ||
    /^test_.*\.py$/.test(base) ||
    /_test\.py$/.test(base) ||
    /test\.java$/.test(base)
  );
}

/**
 * Returns supported test frameworks for a given file extension.
 */
export function getSupportedFrameworksForExtension(extension = '') {
  const ext = (extension || '').toLowerCase();
  if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') {
    return ['vitest', 'jest'];
  }
  if (ext === '.py') {
    return ['pytest', 'unittest'];
  }
  if (ext === '.java') {
    return ['junit5'];
  }
  return [];
}

/**
 * Returns the default framework ID for a given file extension.
 */
export function getDefaultFrameworkForExtension(extension = '') {
  const frameworks = getSupportedFrameworksForExtension(extension);
  return frameworks[0] || 'vitest';
}

/**
 * Computes a clean suggested draft test file path for a source file and framework.
 */
export function generateSuggestedTestFilePath(filePath = '', framework = 'vitest') {
  const norm = getFilePath(filePath) || 'module.js';
  const ext = getFileExtension(norm);
  const slashIdx = norm.lastIndexOf('/');
  const dir = slashIdx >= 0 ? norm.slice(0, slashIdx) : '';
  const base = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;
  const stem = ext ? base.slice(0, -ext.length) : base;

  if (ext === '.py') {
    const fileName = framework === 'unittest' ? `test_${stem}_unittest.py` : `test_${stem}.py`;
    return dir ? `${dir}/${fileName}` : fileName;
  }

  if (ext === '.java') {
    const classStem = stem.replace(/[^A-Za-z0-9_$]/g, '') || 'Module';
    const testName = classStem.endsWith('Test') ? `${classStem}.java` : `${classStem}Test.java`;
    if (norm.includes('src/main/java/')) {
      return norm.replace('src/main/java/', 'src/test/java/').replace(base, testName);
    }
    return dir ? `${dir}/${testName}` : testName;
  }

  const testExt = ext || '.js';
  const testName = `${stem}.test${testExt}`;
  return dir ? `${dir}/${testName}` : testName;
}

function getLanguageLabel(extension = '') {
  switch ((extension || '').toLowerCase()) {
    case '.ts':
    case '.tsx':
      return 'TypeScript';
    case '.js':
    case '.jsx':
      return 'JavaScript';
    case '.py':
      return 'Python';
    case '.java':
      return 'Java';
    default:
      return extension ? extension.replace(/^\./, '').toUpperCase() : 'Source';
  }
}

function prepareWorkspaceFiles(filesList = []) {
  if (!Array.isArray(filesList) || filesList.length === 0) return [];

  const needsEnrichment = filesList.some(
    (f) =>
      f &&
      ((isAstSupported(getFilePath(f) || f.name || '') && f.astMetadata === undefined) ||
        !f.dependencies ||
        !Array.isArray(f.dependencies.resolved))
  );

  const normalized = filesList
    .filter(Boolean)
    .map((file, idx) => {
      const filePath = getFilePath(file) || file.name || `file-${idx}`;
      const id = file.id || `tg-file:${filePath}`;
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
        extension: (file.extension || getFileExtension(filePath)).toLowerCase(),
        lineCount: file.lineCount || (typeof file.content === 'string' ? file.content.split('\n').length : 0),
        astMetadata,
      };
    });

  return needsEnrichment ? resolveFileDependencies(normalized) : normalized;
}

function extractBalancedParens(text = '', openIdx = -1) {
  if (openIdx < 0 || text[openIdx] !== '(') return null;
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openIdx + 1, i);
      }
    }
  }
  return null;
}

function splitTopLevelArgs(raw = '') {
  const args = [];
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let angleDepth = 0;
  let quote = null;
  let start = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')' && parenDepth > 0) parenDepth -= 1;
    else if (ch === '{') braceDepth += 1;
    else if (ch === '}' && braceDepth > 0) braceDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']' && bracketDepth > 0) bracketDepth -= 1;
    else if (ch === '<') angleDepth += 1;
    else if (ch === '>' && angleDepth > 0 && raw[i - 1] !== '=') angleDepth -= 1;
    else if (
      ch === ',' &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      angleDepth === 0
    ) {
      const piece = raw.slice(start, i).trim().replace(/\s+/g, ' ');
      if (piece) args.push(piece);
      start = i + 1;
    }
  }
  const tail = raw.slice(start).trim().replace(/\s+/g, ' ');
  if (tail) args.push(tail);
  return args;
}

function findTopLevelAssignmentIndex(raw = '') {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let angleDepth = 0;
  let quote = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')' && parenDepth > 0) parenDepth -= 1;
    else if (ch === '{') braceDepth += 1;
    else if (ch === '}' && braceDepth > 0) braceDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']' && bracketDepth > 0) bracketDepth -= 1;
    else if (ch === '<') angleDepth += 1;
    else if (ch === '>' && angleDepth > 0 && raw[i - 1] !== '=') angleDepth -= 1;
    else if (
      ch === '=' &&
      raw[i + 1] !== '>' &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      angleDepth === 0
    ) {
      return i;
    }
  }
  return -1;
}

function parseParameterList(rawParams = '', extension = '') {
  const ext = (extension || '').toLowerCase();
  return splitTopLevelArgs(rawParams)
    .filter((p) => !(ext === '.py' && /^(?:self|cls)(?:\s*:|$)/.test(p)))
    .map((rawParam) => {
      const eqIdx = findTopLevelAssignmentIndex(rawParam);
      const hasDefault = eqIdx >= 0;
      const lhs = (hasDefault ? rawParam.slice(0, eqIdx) : rawParam).trim();
      const defaultValue = hasDefault ? rawParam.slice(eqIdx + 1).trim() : null;
      const isRest = lhs.startsWith('...') || lhs.startsWith('*');

      let name = lhs;
      let typeHint = null;
      let isOptional = hasDefault || isRest;

      if (ext === '.java') {
        const parts = lhs.replace(/^final\s+/, '').trim().split(/\s+/);
        if (parts.length >= 2) {
          name = parts[parts.length - 1];
          typeHint = parts.slice(0, -1).join(' ');
        }
      } else {
        const colonIdx = lhs.indexOf(':');
        const isDestructured = lhs.startsWith('{') || lhs.startsWith('[');
        if (!isDestructured && colonIdx > 0) {
          const leftName = lhs.slice(0, colonIdx).trim();
          typeHint = lhs.slice(colonIdx + 1).trim();
          if (leftName.endsWith('?')) {
            isOptional = true;
            name = leftName.slice(0, -1).trim();
          } else {
            name = leftName;
          }
        } else if (isDestructured && colonIdx > 0) {
          // Handle React/TS `{ prop = 1 }: Props`
          const closeBrace = Math.max(lhs.lastIndexOf('}'), lhs.lastIndexOf(']'));
          if (closeBrace >= 0 && colonIdx > closeBrace) {
            name = lhs.slice(0, closeBrace + 1).trim();
            typeHint = lhs.slice(colonIdx + 1).trim();
          }
        }
      }

      const cleanIdentifier = name
        .replace(/^[*.]+/, '')
        .replace(/\?$/, '')
        .trim();

      return {
        raw: rawParam,
        name: cleanIdentifier || rawParam,
        typeHint,
        hasDefault,
        defaultValue,
        isOptional,
        isRest,
        isDestructured: name.startsWith('{') || name.startsWith('['),
      };
    });
}

function extractTargetSignature(chunkContent = '', symbolName = '', extension = '', symbolType = 'function') {
  const empty = { hasSignature: false, params: [], isConstructor: false, returnTypeHint: null };
  if (!chunkContent || !symbolName) return empty;

  const ext = (extension || '').toLowerCase();
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let openParenIdx = -1;
  let isConstructor = false;

  if (symbolType === 'class') {
    isConstructor = true;
    if (ext === '.py') {
      const m = /\bdef\s+__init__\s*\(/.exec(chunkContent);
      if (m) openParenIdx = m.index + m[0].length - 1;
    } else if (ext === '.java') {
      const m = new RegExp(`(?:^|[\\n;{}])\\s*(?:public|protected|private)?\\s*${escaped}\\s*\\(`).exec(
        chunkContent
      );
      if (m) openParenIdx = m.index + m[0].length - 1;
    } else {
      const m = /\bconstructor\s*\(/.exec(chunkContent);
      if (m) openParenIdx = m.index + m[0].length - 1;
    }
  } else if (ext === '.py') {
    const m = new RegExp(`\\b(?:async\\s+)?def\\s+${escaped}\\s*\\(`).exec(chunkContent);
    if (m) openParenIdx = m.index + m[0].length - 1;
  } else if (ext === '.java') {
    const m = new RegExp(
      `(?:^|[\\n;{}])\\s*(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\\([^)]*\\))?\\s*)*(?:(?:public|private|protected|static|final|abstract|synchronized|native|strictfp|default)\\s+)*(?:<[^>]+>\\s+)?(?:[A-Za-z_][A-Za-z0-9_.<>\\[\\]?]*\\s+)${escaped}\\s*\\(`
    ).exec(chunkContent);
    if (m) openParenIdx = m.index + m[0].length - 1;
  } else {
    const patterns = [
      new RegExp(`\\b(?:async\\s+)?function\\s*\\*?\\s*${escaped}\\s*(?:<[^>]*>\\s*)?\\(`),
      new RegExp(`\\b(?:const|let|var)\\s+${escaped}(?:\\s*:\\s*[^=]+)?\\s*=\\s*(?:async\\s+)?\\(`),
      new RegExp(`(?:^|[\\n;{}])\\s*(?:public|private|protected|static|async|readonly|override|\\s)*${escaped}\\s*(?:<[^>]*>\\s*)?\\(`),
      new RegExp(`\\b${escaped}\\s*=\\s*(?:async\\s+)?\\(`),
    ];
    for (const pat of patterns) {
      const m = pat.exec(chunkContent);
      if (m) {
        openParenIdx = m.index + m[0].length - 1;
        break;
      }
    }
  }

  if (openParenIdx < 0) return empty;
  const rawParams = extractBalancedParens(chunkContent, openParenIdx);
  if (rawParams === null) return empty;

  const afterParenIdx = openParenIdx + rawParams.length + 2;
  const afterParen = chunkContent.slice(afterParenIdx, afterParenIdx + 80);
  let returnTypeHint = null;
  if (ext === '.py') {
    const retMatch = afterParen.match(/^\s*->\s*([^\n:]+)/);
    if (retMatch) returnTypeHint = retMatch[1].trim();
  } else if (ext === '.ts' || ext === '.tsx') {
    const retMatch = afterParen.match(/^\s*:\s*([A-Za-z0-9_<>[\]\s|&.'"]+)(?=\s*\{)/);
    if (retMatch) returnTypeHint = retMatch[1].trim();
  }

  return {
    hasSignature: true,
    params: parseParameterList(rawParams, ext),
    isConstructor,
    returnTypeHint,
  };
}

/**
 * Extracts JS/TS JSX prop names when a component accepts destructured props `{ a, b = 1 }`.
 */
function extractDestructuredPropNames(paramName = '') {
  if (!paramName || !paramName.startsWith('{')) return [];
  const inner = paramName.slice(1, -1);
  return splitTopLevelArgs(inner)
    .map((item) => item.split(':')[0].split('=')[0].replace(/^\.\.\./, '').trim())
    .filter((n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
}

/**
 * Extracts concrete guard conditions and error messages observed in the symbol chunk.
 */
function extractObservedGuards(content = '', extension = '') {
  const ext = (extension || '').toLowerCase();
  const guards = [];
  const lines = String(content || '').split('\n');
  let braceDepth = 0;
  const tryBraceStack = [];
  const tryIndentStack = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const nextLine = (lines[i + 1] || '').trim();
    const twoLine = `${line} ${nextLine}`;

    if (ext === '.py') {
      const indent = rawLine.match(/^\s*/)?.[0].length || 0;
      while (tryIndentStack.length > 0 && line && !line.startsWith('#') && indent <= tryIndentStack[tryIndentStack.length - 1]) {
        tryIndentStack.pop();
      }
      if (/^try\s*:/.test(line)) {
        tryIndentStack.push(indent);
      }
      const inPyTry = tryIndentStack.length > 0;
      const pyIf = line.match(/^if\s+(.+):$/);
      if (pyIf) {
        const throws = /\braise\s+([A-Za-z0-9_]+)?\s*(?:\(([^)]*)\))?/.exec(nextLine);
        const returnsEarly = /\breturn\s+(None|False|\[\]|\{\}|""|''|-1|0)\b/.exec(nextLine);
        if (throws || returnsEarly) {
          guards.push({
            condition: pyIf[1].trim(),
            action: throws ? 'raise' : 'early_return',
            detail: throws ? throws[0].trim() : returnsEarly[0].trim(),
            lineOffset: i + 1,
            insideTryBlock: inPyTry,
          });
        }
      }
      continue;
    }

    if (/\btry\s*\{/.test(line)) {
      tryBraceStack.push(braceDepth);
    }
    const inTryBlock = tryBraceStack.length > 0;

    const jsIf = line.match(/^if\s*\((.+)\)\s*(?:\{|$|return\b|throw\b)/);
    if (jsIf) {
      const cond = jsIf[1].trim();
      // Skip loop/retry counters and HTTP response status branches (not parameter input guards)
      if (!/\b(?:attempt|retries|retry|response\.ok|res\.ok|statusCode|response\.status)\b/.test(cond)) {
        const throwMatch = twoLine.match(/throw\s+new\s+([A-Za-z0-9_]+)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/);
        const genericThrow = twoLine.match(/\bthrow\s+(?:new\s+)?[A-Za-z0-9_]+[^;\n]*/);
        const earlyReturn =
          line.match(/\breturn\s*(?:null|undefined|false|\[\]|\{\}|''|""|``|-1|0)?\s*;/) ||
          nextLine.match(/^return\s*(?:null|undefined|false|\[\]|\{\}|''|""|``|-1|0)?\s*;/);

        if (throwMatch) {
          const msg = throwMatch[3];
          const hasTemplateInterp = throwMatch[2] === '`' && /\$\{/.test(msg);
          guards.push({
            condition: cond,
            action: 'throw',
            errorType: throwMatch[1],
            errorMessage: hasTemplateInterp ? null : msg,
            detail: `${throwMatch[1]}('${msg}')`,
            lineOffset: i + 1,
            insideTryBlock: inTryBlock,
          });
        } else if (genericThrow) {
          guards.push({
            condition: cond,
            action: 'throw',
            errorType: 'Error',
            errorMessage: null,
            detail: genericThrow[0].trim(),
            lineOffset: i + 1,
            insideTryBlock: inTryBlock,
          });
        } else if (earlyReturn) {
          const retDetail = earlyReturn[0].replace(/;$/, '').trim();
          guards.push({
            condition: cond,
            action: 'early_return',
            detail: retDetail,
            lineOffset: i + 1,
            insideTryBlock: inTryBlock,
          });
        }
      }
    }

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    braceDepth += opens - closes;
    while (tryBraceStack.length > 0 && braceDepth <= tryBraceStack[tryBraceStack.length - 1]) {
      tryBraceStack.pop();
    }
  }

  return guards;
}

/**
 * Parses AST hints selectively (branch count & React JSX return presence) for JS/TS/JSX/TSX chunks.
 */
function inspectAstChunkDetails(content = '', extension = '') {
  const ext = (extension || '').toLowerCase();
  if (!AST_SUPPORTED_EXTENSIONS_LIST.has(ext) || !content.trim()) {
    return { returnsJsx: false, branchCount: 0, thrownMessages: [] };
  }

  let returnsJsx = false;
  let branchCount = 0;
  const thrownMessages = [];

  try {
    const isTs = ext === '.ts' || ext === '.tsx';
    const ast = parse(content, {
      sourceType: 'module',
      plugins: isTs ? ['typescript', 'jsx'] : ['jsx'],
      errorRecovery: true,
      allowReturnOutsideFunction: true,
    });

    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        returnsJsx = true;
      }
      if (
        node.type === 'IfStatement' ||
        node.type === 'SwitchCase' ||
        node.type === 'ConditionalExpression' ||
        node.type === 'ForStatement' ||
        node.type === 'WhileStatement' ||
        node.type === 'CatchClause'
      ) {
        branchCount += 1;
      }
      if (node.type === 'ThrowStatement' && node.argument?.type === 'NewExpression') {
        const msgArg = node.argument.arguments?.[0];
        if (msgArg?.type === 'StringLiteral' && msgArg.value) {
          thrownMessages.push(msgArg.value);
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range' || key === 'comments') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(walk);
        } else if (child && typeof child === 'object') {
          walk(child);
        }
      }
    };

    walk(ast);
  } catch {
    // Fall back silently to regex heuristics
    returnsJsx = /<[A-Za-z][A-Za-z0-9.]*[\s/>]/.test(content) && /\breturn\s*\(?/.test(content);
  }

  return { returnsJsx, branchCount, thrownMessages };
}

const AST_SUPPORTED_EXTENSIONS_LIST = new Set(['.js', '.jsx', '.ts', '.tsx']);

function analyzeChunkBehaviour(file, chunk, moduleMeta, parentClassName = null, parentConstructorParams = []) {
  const content = chunk.content || '';
  const ext = (file.extension || '').toLowerCase();
  const pathLower = (file.path || '').toLowerCase();
  const symbolName = chunk.symbolName || '';
  const symbolLower = symbolName.toLowerCase();

  const signature = extractTargetSignature(content, symbolName, ext, chunk.symbolType);
  const guards = extractObservedGuards(content, ext);
  const astDetails = inspectAstChunkDetails(content, ext);

  const externalImports = Array.from(
    new Set(
      (file.dependencies?.unresolved || [])
        .filter((u) => u && u.type === 'external' && u.source)
        .map((u) => u.source)
    )
  );
  const internalDeps = Array.from(
    new Set((file.dependencies?.resolved || []).map((r) => r.resolvedFilePath || r.source).filter(Boolean))
  );
  const callers = Array.from(
    new Set((file.importedBy || []).map((imp) => imp.filePath || imp.sourcePath).filter(Boolean))
  );
  const exportedNames = (file.astMetadata?.exports || [])
    .map((e) => e.name)
    .filter((n) => n && n !== '*');

  const isExported =
    Boolean(symbolName) &&
    (exportedNames.includes(symbolName) ||
      exportedNames.includes('default') ||
      (parentClassName && exportedNames.includes(parentClassName)) ||
      ext === '.py' ||
      ext === '.java');

  const isHook = /^use[A-Z0-9]/.test(symbolName) && (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx');
  const isReactComponent =
    chunk.symbolType !== 'class' &&
    !parentClassName &&
    /^[A-Z]/.test(symbolName) &&
    (ext === '.jsx' || ext === '.tsx') &&
    (astDetails.returnsJsx || /<[A-Za-z]/.test(content));

  let targetKind = chunk.symbolType === 'class' ? 'class' : 'function';
  if (isReactComponent) targetKind = 'component';
  else if (isHook) targetKind = 'hook';
  else if (parentClassName && chunk.symbolType === 'function') targetKind = 'method';

  const hasTryCatch = /\btry\s*[:{]|\bcatch\s*\(|\bexcept\b/.test(content);
  const returnsNullOnError = hasTryCatch && /\breturn\s+(?:null|None)\b/.test(content);
  const returnsFalseOnError = hasTryCatch && /\breturn\s+(?:false|False)\b/.test(content);
  const hasThrowOrRaise = /\bthrow\s+(?:new\s+)?[A-Za-z_]|\braise\b/.test(content);
  const hasValidationGuard = guards.length > 0 || /\bif\s*\(\s*!(?!response\.ok\b|res\.ok\b)/.test(content);
  const isAsync = /\basync\b|\bawait\b|\bPromise\s*</.test(content);
  const returnsBoolean = /\breturn\s+(?:true|false|True|False)\b/.test(content) || /\bboolean\b|\bbool\b/i.test(signature.returnTypeHint || '');

  const hasHttpClient = /\b(?:fetch|axios|requests|urllib|HttpClient|RestTemplate)\b/i.test(content);
  const hasResponseJson = /\.json\s*\(\s*\)/.test(content);
  const hasRetryLoop =
    (/\b(?:for|while)\s*\(/.test(content) || /\bfor\s+\w+\s+in\s+range\b/.test(content)) &&
    /\b(?:retr(?:y|ies)|attempt|backoff)\b/i.test(content);
  const hasStatus500Check = /status\s*>=\s*500|statusCode\s*>=\s*500/.test(content);
  const handlesResponseOk = /\bresponse\.ok\b/.test(content);
  const hasAuthSignals =
    /\b(?:jwt|SignJWT|jwtVerify|bearer|token|secret|password|bcrypt|argon|rbac|permission|role)\b/i.test(
      `${symbolName} ${file.path} ${content}`
    );
  const secretMinLengthMatch = content.match(/secret[A-Za-z_]*\.length\s*<\s*(\d+)/i);
  const hasRoleEqualityCheck = /\brole\s*===?\s*['"]([A-Za-z0-9_-]+)['"]/.exec(content);
  const checksCollectionMembership = /\.(?:includes|contains)\(/.test(content);
  const checksPermissionsIncludes = /\bpermissions\s*\.\s*(?:includes|contains)\s*\(/.test(content);
  const hasDbTransaction =
    /\b(?:commit|rollback|SessionLocal|create_engine|sessionmaker|db_session)\b/.test(content) ||
    /\b(?:engine|connection|conn|cursor|db)\s*\.\s*(?:connect|execute|query|commit|rollback|close)\s*\(/i.test(content) ||
    /\bsession\s*\.\s*(?:commit|rollback|query|execute|add|delete|flush)\s*\(/i.test(content);
  const usesTimersOrFetch = /\b(?:fetch|setTimeout|AbortController)\b/.test(content);
  const isContextManager =
    ext === '.py' &&
    (/^\s*@contextmanager\b/m.test(content) || (/\byield\b/.test(content) && /\bclose\s*\(\s*\)/.test(content)));
  const isStatic =
    ext === '.py'
      ? /^\s*@(?:staticmethod|classmethod)\b/m.test(content)
      : /^\s*(?:public|private|protected)?\s*static\b/m.test(content.split('\n')[0] || '');
  const javaPackageMatch =
    ext === '.java' ? String(file.content || '').match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m) : null;
  const packageName = javaPackageMatch ? javaPackageMatch[1] : null;
  const observedEnvVars = Array.from(
    new Set([
      ...[...content.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
      ...[...content.matchAll(/os\.(?:getenv|environ\.get)\(\s*['"]([A-Z0-9_]+)['"]/g)].map((m) => m[1]),
    ])
  );

  // Build observed behaviour summary sentences
  const behaviourPoints = [];
  if (signature.params.length > 0) {
    behaviourPoints.push(
      `${signature.isConstructor ? 'Constructor accepts' : 'Accepts'} ${signature.params.length} parameter(s): ${signature.params.map((p) => `\`${p.raw}\``).join(', ')}.`
    );
  } else if (signature.hasSignature) {
    behaviourPoints.push(`${signature.isConstructor ? 'Constructor' : 'Signature'} takes no formal parameters.`);
  }

  if (guards.length > 0) {
    guards.slice(0, 3).forEach((g) => {
      behaviourPoints.push(`Guards \`${g.condition}\` -> triggers \`${g.detail}\`.`);
    });
  } else if (hasThrowOrRaise) {
    behaviourPoints.push('Throws/raises an explicit error when failure conditions occur.');
  }

  if (returnsNullOnError) {
    behaviourPoints.push(`Catches errors and returns \`${ext === '.py' ? 'None' : 'null'}\` fallback.`);
  } else if (returnsFalseOnError) {
    behaviourPoints.push(`Catches errors and returns \`${ext === '.py' ? 'False' : 'false'}\`.`);
  } else if (hasTryCatch) {
    behaviourPoints.push('Uses try/catch (or try/except) error handling.');
  }

  if (hasRetryLoop) {
    behaviourPoints.push(
      `Retries transient failures${hasStatus500Check ? ' on HTTP >= 500' : ''} up to configured attempts.`
    );
  }
  if (hasDbTransaction) {
    behaviourPoints.push('Interacts with database/session lifecycle operations.');
  }
  if (isReactComponent) {
    behaviourPoints.push('Renders React JSX UI elements.');
  }

  const dependenciesToMock = [];
  externalImports.forEach((pkg) => dependenciesToMock.push({ name: pkg, kind: 'external_package' }));
  internalDeps.forEach((dep) => dependenciesToMock.push({ name: dep, kind: 'internal_module' }));
  if (hasHttpClient && !externalImports.includes('fetch')) {
    dependenciesToMock.push({ name: 'globalThis.fetch', kind: 'runtime_api' });
  }
  if (/\bsetTimeout\b/.test(content)) {
    dependenciesToMock.push({ name: 'timers / setTimeout', kind: 'runtime_api' });
  }

  // Domain category tag
  let domainCategory = 'Core Logic';
  if (hasAuthSignals || /\b(auth|security|jwt|login)\b/.test(pathLower)) domainCategory = 'Security & Auth';
  else if (hasHttpClient || hasRetryLoop || /\b(api|client|http|fetch|route|controller)\b/.test(pathLower)) {
    domainCategory = 'API & Networking';
  } else if (hasDbTransaction || /\b(db|database|storage|store|repo|model)\b/.test(pathLower)) {
    domainCategory = 'Data & Storage';
  } else if (isReactComponent || isHook) {
    domainCategory = 'UI & Components';
  }

  // Fallback heuristic line-based branch density for Python/Java
  const regexBranchCount = (content.match(/\b(?:if|elif|else|catch|except|for|while|case)\b/g) || []).length;
  const branchCount = Math.max(astDetails.branchCount, regexBranchCount);

  return {
    language: getLanguageLabel(ext),
    targetKind,
    parentClassName,
    parentConstructorParams,
    lineSpan: Math.max(1, (chunk.endLine || chunk.startLine || 1) - (chunk.startLine || 1) + 1),
    params: signature.params,
    hasSignature: signature.hasSignature,
    isConstructor: signature.isConstructor,
    returnTypeHint: signature.returnTypeHint,
    isExported,
    isAsync,
    isReactComponent,
    isHook,
    returnsBoolean,
    returnsNullOnError,
    returnsFalseOnError,
    hasTryCatch,
    hasThrowOrRaise,
    hasValidationGuard,
    guards,
    hasHttpClient,
    hasResponseJson,
    hasRetryLoop,
    hasStatus500Check,
    handlesResponseOk,
    hasAuthSignals,
    secretMinLength: secretMinLengthMatch ? Number(secretMinLengthMatch[1]) : null,
    adminRoleLiteral: hasRoleEqualityCheck ? hasRoleEqualityCheck[1] : null,
    checksCollectionMembership,
    checksPermissionsIncludes,
    hasDbTransaction,
    isContextManager,
    isStatic,
    packageName,
    usesTimersOrFetch,
    observedEnvVars,
    externalImports,
    internalDeps,
    callers,
    dependenciesToMock,
    branchCount,
    domainCategory,
    moduleId: moduleMeta?.id || null,
    moduleLabel: moduleMeta?.label || 'Workspace Module',
    layerId: moduleMeta?.layerId || 'domain_services',
    layerLabel: moduleMeta?.layerLabel || 'Services & Core Logic',
    summary:
      behaviourPoints.length > 0
        ? behaviourPoints.join(' ')
        : `${getLanguageLabel(ext)} ${targetKind} in ${moduleMeta?.label || file.path}.`,
    behaviourPoints,
    isSimpleHealthOrPredicate: /\b(?:is|has|can|check|ping|health)\b/i.test(symbolLower) && returnsBoolean,
  };
}

function scoreTargetImportance(behaviour, archFileInfo) {
  let score = 20;
  const reasons = [];

  if (behaviour.isExported) {
    score += 20;
    reasons.push('Exported public symbol');
  }
  if (behaviour.callers.length > 0) {
    score += Math.min(20, behaviour.callers.length * 8);
    reasons.push(`Imported by ${behaviour.callers.length} workspace file(s)`);
  }
  if (archFileInfo?.isHub) {
    score += 12;
    reasons.push('Architectural hub file');
  } else if (archFileInfo?.isEntryPoint) {
    score += 8;
    reasons.push('Application entry module');
  }
  if (behaviour.hasValidationGuard || behaviour.hasThrowOrRaise) {
    score += 14;
    reasons.push('Enforces validation/error guards');
  }
  if (behaviour.hasTryCatch) {
    score += 10;
    reasons.push('Contains exception handling paths');
  }
  if (behaviour.hasAuthSignals || behaviour.hasHttpClient || behaviour.hasDbTransaction) {
    score += 14;
    reasons.push(`${behaviour.domainCategory} boundary`);
  }
  if (behaviour.branchCount >= 2) {
    score += Math.min(14, behaviour.branchCount * 3);
    reasons.push(`${behaviour.branchCount} conditional/loop branches`);
  }
  if (behaviour.isReactComponent || behaviour.isHook) {
    score += 10;
    reasons.push(behaviour.isReactComponent ? 'Interactive React component' : 'Custom React hook');
  }
  if (behaviour.lineSpan <= 3 && !behaviour.hasValidationGuard && !behaviour.isExported) {
    score -= 10;
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  const tier = boundedScore >= 68 ? 'High' : boundedScore >= 45 ? 'Medium' : 'Standard';

  return {
    importanceScore: boundedScore,
    importanceTier: tier,
    importanceReasons: reasons.length > 0 ? reasons : ['Workspace symbol candidate'],
  };
}

function escapeJsSingleQuote(text = '') {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

function escapePyDocstring(text = '') {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, "'''")
    .replace(/\r?\n/g, ' ');
}

function escapeJavaString(text = '') {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function formatQuotedString(text = '', ext = '.js') {
  if (ext === '.java') {
    return `"${escapeJavaString(text)}"`;
  }
  return `'${escapeJsSingleQuote(text)}'`;
}

/**
 * Produces a language-valid sample argument and indicates whether manual fixture setup is needed.
 */
function sampleArgumentForParam(param, variant = 'valid', ext = '.js') {
  const normExt = (ext || '.js').toLowerCase();
  const isPy = normExt === '.py';
  const isJava = normExt === '.java';
  const nameLower = (param?.name || 'input').toLowerCase();
  const typeRaw = (param?.typeHint || '').trim();
  const typeLower = typeRaw.toLowerCase();

  if (variant === 'missing') {
    if (isPy) return { code: 'None', isPlaceholder: false };
    if (isJava) return { code: 'null', isPlaceholder: false };
    return { code: 'undefined', isPlaceholder: false };
  }

  const isInvalid = variant === 'invalid_empty';

  // 1. Respect explicit declared parameter types before parameter-name heuristics
  if (typeLower) {
    if (/\b(?:long)\b/.test(typeLower)) {
      return { code: isJava ? (isInvalid ? '0L' : '1L') : isInvalid ? '0' : '1', isPlaceholder: false };
    }
    if (/\b(?:float|double|decimal)\b/.test(typeLower)) {
      return { code: isInvalid ? '0.0' : '1.0', isPlaceholder: false };
    }
    if (/\b(?:number|int|integer|short|byte)\b/.test(typeLower)) {
      return { code: isInvalid ? '0' : '1', isPlaceholder: false };
    }
    if (/\b(?:boolean|bool)\b/.test(typeLower)) {
      if (isPy) return { code: isInvalid ? 'False' : 'True', isPlaceholder: false };
      return { code: isInvalid ? 'false' : 'true', isPlaceholder: false };
    }
    if (/\[\]|^\s*(?:list|array|set|sequence|iterable|collection)\b/i.test(typeRaw)) {
      if (isJava) return { code: 'Collections.emptyList()', isPlaceholder: isInvalid ? false : true };
      return { code: '[]', isPlaceholder: !isInvalid };
    }
    if (/^\s*(?:dict|mapping|map|record|hashMap|hashmap)\b/i.test(typeRaw) || /\bdict\[/i.test(typeRaw)) {
      if (isJava) return { code: 'Collections.emptyMap()', isPlaceholder: true };
      return { code: '{}', isPlaceholder: true };
    }
    if (/^\s*(?:string|str|charsequence)\b/i.test(typeRaw)) {
      if (isInvalid) return { code: isJava ? '""' : "''", isPlaceholder: false };
      if (/secret|key/.test(nameLower) && !/token/.test(nameLower)) {
        if (isPy) return { code: "'a' * 32", isPlaceholder: false };
        if (isJava) return { code: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', isPlaceholder: false };
        return { code: "'a'.repeat(32)", isPlaceholder: false };
      }
      if (/email/.test(nameLower)) return { code: formatQuotedString('dev@example.com', normExt), isPlaceholder: false };
      if (/token/.test(nameLower)) return { code: formatQuotedString('sample-jwt-token', normExt), isPlaceholder: false };
      if (/endpoint|path|url/.test(nameLower)) return { code: formatQuotedString('/projects/123', normExt), isPlaceholder: false };
      if (/perm/.test(nameLower)) return { code: formatQuotedString('read:code', normExt), isPlaceholder: false };
      return { code: formatQuotedString(`sample-${param?.name || 'value'}`, normExt), isPlaceholder: false };
    }
  }

  // 2. Destructured JS/TS parameters
  if (param?.isDestructured && !isPy && !isJava) {
    if (isInvalid) return { code: '{}', isPlaceholder: true };
    const props = extractDestructuredPropNames(param.name);
    if (props.length > 0) {
      return { code: `{ ${props.map((p) => `${p}: 'sample-${p}'`).join(', ')} }`, isPlaceholder: false };
    }
    return { code: '{}', isPlaceholder: true };
  }

  // 3. Language-specific custom class/interface types (e.g. UserSession, Request, Optional)
  if (/^[A-Z]/.test(typeRaw) && !/^(?:String|Integer|Long|Double|Float|Boolean|Object|List|Map|Set)$/.test(typeRaw)) {
    if (isPy) {
      if (/user|session|payload|config|options|ctx|context/.test(nameLower)) {
        return { code: isInvalid ? '{}' : '{"id": "user-1", "role": "developer"}', isPlaceholder: true };
      }
      return { code: 'None', isPlaceholder: true };
    }
    if (isJava) {
      return { code: 'null', isPlaceholder: true };
    }
    if (/user|session/.test(nameLower)) {
      return {
        code: isInvalid
          ? '{}'
          : "{ id: 'user-1', email: 'dev@example.com', role: 'developer', permissions: ['read:code'] }",
        isPlaceholder: isInvalid,
      };
    }
    return { code: '{}', isPlaceholder: true };
  }

  // 4. Untyped parameter heuristics (strictly valid syntax per language)
  if (isInvalid) {
    if (/retries|attempt|count|limit|max|id$|port|age|size|index/.test(nameLower)) {
      return { code: '0', isPlaceholder: false };
    }
    if (/items|list|perms|permissions|tags|ids|rows/.test(nameLower)) {
      if (isJava) return { code: 'Collections.emptyList()', isPlaceholder: false };
      return { code: '[]', isPlaceholder: false };
    }
    if (/options|config|opts|headers|params|payload|data|user|session/.test(nameLower)) {
      if (isJava) return { code: 'null', isPlaceholder: true };
      return { code: '{}', isPlaceholder: false };
    }
    return { code: isJava ? '""' : "''", isPlaceholder: false };
  }

  if (/secret|key|token/.test(nameLower)) {
    if (/token/.test(nameLower)) return { code: formatQuotedString('sample-jwt-token', normExt), isPlaceholder: false };
    if (isPy) return { code: "'a' * 32", isPlaceholder: false };
    if (isJava) return { code: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', isPlaceholder: false };
    return { code: "'a'.repeat(32)", isPlaceholder: false };
  }
  if (/email/.test(nameLower)) return { code: formatQuotedString('dev@example.com', normExt), isPlaceholder: false };
  if (/endpoint|path|url/.test(nameLower)) return { code: formatQuotedString('/projects/123', normExt), isPlaceholder: false };
  if (/retries|attempt|count|limit|max/.test(nameLower)) return { code: '3', isPlaceholder: false };
  if (/perm|role/.test(nameLower)) return { code: formatQuotedString('read:code', normExt), isPlaceholder: false };
  if (/options|config|opts|headers/.test(nameLower)) {
    if (isJava) return { code: 'Collections.emptyMap()', isPlaceholder: true };
    return { code: '{}', isPlaceholder: false };
  }
  if (/user|session/.test(nameLower)) {
    if (isPy) {
      return {
        code: '{"id": "user-1", "email": "dev@example.com", "role": "developer", "permissions": ["read:code"]}',
        isPlaceholder: true,
      };
    }
    if (isJava) {
      return { code: 'null', isPlaceholder: true };
    }
    return {
      code: "{ id: 'user-1', email: 'dev@example.com', role: 'developer', permissions: ['read:code'] }",
      isPlaceholder: false,
    };
  }

  return { code: formatQuotedString(`sample-${param?.name || 'value'}`, normExt), isPlaceholder: false };
}

function sampleLiteralForParam(param, variant = 'valid', ext = '.js') {
  return sampleArgumentForParam(param, variant, ext).code;
}

/**
 * Builds Normal, Edge, and Failure test scenarios strictly from observed behaviour signals.
 */
function buildTestScenarios(file, chunk, behaviour) {
  const scenarios = [];
  const ext = file.extension || '.js';
  const sym = chunk.symbolName || 'target';
  const baseLineRef = `${file.path}:${chunk.startLine}-${chunk.endLine}`;
  const requiredParams = behaviour.params.filter((p) => !p.isOptional);
  const optionalParams = behaviour.params.filter((p) => p.isOptional);

  const validArgsPreview = behaviour.params
    .map((p) => `${p.name} = ${p.defaultValue || sampleLiteralForParam(p, 'valid', ext)}`)
    .join(', ');

  // ---------------- NORMAL SCENARIOS ----------------
  if (behaviour.isReactComponent) {
    const propNames = behaviour.params.flatMap((p) =>
      p.isDestructured ? extractDestructuredPropNames(p.name) : [p.name]
    );
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:normal-render`,
      category: 'normal',
      title: `Renders ${sym} cleanly with standard workspace/props state`,
      description: `Mount ${sym} with valid props (${propNames.length > 0 ? propNames.join(', ') : 'default context'}) and verify UI renders without throwing.`,
      preconditions:
        behaviour.dependenciesToMock.length > 0
          ? `Provide mock/provider stubs for: ${behaviour.dependenciesToMock.map((d) => d.name).join(', ')}.`
          : 'No external module mocks required.',
      inputs: propNames.length > 0 ? `Valid props: ${propNames.join(', ')}` : 'Default props / context',
      expectedOutcome: 'Expected: Component mounts without error and renders expected UI elements (inferred — verify against component JSX).',
      verificationStatus: 'needs_manual_verification',
      verificationNote: 'Specify exact visible text, role, or element assertions from component JSX.',
      sourceEvidence: `${baseLineRef} (React component)`,
    });
  } else if (behaviour.isConstructor) {
    const hasCustomFixtures = behaviour.params.some((p) => sampleArgumentForParam(p, 'valid', ext).isPlaceholder);
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:normal-construct`,
      category: 'normal',
      title: `Instantiates ${sym} successfully with valid configuration`,
      description: `Verify constructor initializes cleanly when preconditions hold.`,
      preconditions:
        behaviour.secretMinLength !== null
          ? `Provide a secret with length >= ${behaviour.secretMinLength}.`
          : 'Provide valid constructor arguments.',
      inputs: validArgsPreview || 'No constructor arguments',
      expectedOutcome: `Returns an initialized ${sym} instance without throwing.`,
      verificationStatus: hasCustomFixtures ? 'needs_manual_verification' : 'observed_from_code',
      verificationNote: hasCustomFixtures
        ? 'Provide concrete constructor fixture values matching declared types before running.'
        : null,
      sourceEvidence: `${baseLineRef} (constructor)`,
    });
  } else {
    let expectedOutcome = `Expected: Executes ${sym} without throwing (inferred — verify exact return value or side effect).`;
    let status = 'needs_manual_verification';
    let note = 'Verify the exact return structure or side effects against the implementation.';

    if (
      behaviour.returnsBoolean &&
      behaviour.adminRoleLiteral &&
      behaviour.checksPermissionsIncludes &&
      !behaviour.hasTryCatch
    ) {
      expectedOutcome = `Returns true when \`role === '${behaviour.adminRoleLiteral}'\` or required permission is included in \`permissions\`.`;
      status = 'observed_from_code';
      note = null;
    } else if (behaviour.hasDbTransaction && /\bSELECT\s+1\b/i.test(chunk.content || '') && behaviour.returnsBoolean) {
      expectedOutcome = `Inferred: Executes \`SELECT 1\` on active connection and returns ${ext === '.py' ? 'True' : 'true'} when DB connection succeeds (requires mocked/live engine verification).`;
      status = 'needs_manual_verification';
      note = 'Confirm database connection/engine mocking returns expected boolean status.';
    } else if (behaviour.hasHttpClient) {
      expectedOutcome = behaviour.hasResponseJson
        ? `Inferred: ${behaviour.isAsync ? 'Resolves with' : 'Returns'} response.json() payload when HTTP response \`ok === true\`; verify expected response schema.`
        : `Inferred: Performs HTTP client call when request succeeds; verify response parsing and returned shape.`;
      status = 'needs_manual_verification';
      note = 'Stub fetch/HTTP client response shape and verify exact parsed output.';
    } else if (behaviour.isContextManager && /\bcommit\s*\(/.test(chunk.content || '')) {
      expectedOutcome = 'Inferred: Yields resource within context block, calls `commit()` on clean exit, and closes in `finally`; verify session mock expectations.';
      status = 'needs_manual_verification';
      note = 'Mock SessionLocal/transaction factory and assert commit() and close() call counts.';
    }

    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:normal-happy`,
      category: 'normal',
      title: `Happy path execution of ${sym} with valid inputs`,
      description: `Invoke ${sym}${behaviour.isAsync ? ' (awaited)' : ''} under normal operating conditions.`,
      preconditions:
        behaviour.dependenciesToMock.length > 0
          ? `Stub dependencies (${behaviour.dependenciesToMock.map((d) => d.name).join(', ')}) to return nominal values.`
          : 'Standard unit execution.',
      inputs: validArgsPreview || 'No arguments required',
      expectedOutcome,
      verificationStatus: status,
      verificationNote: note,
      sourceEvidence: baseLineRef,
    });
  }

  // ---------------- EDGE SCENARIOS ----------------
  if (behaviour.secretMinLength !== null) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:edge-min-length`,
      category: 'edge',
      title: `Exact boundary length (${behaviour.secretMinLength} vs ${behaviour.secretMinLength - 1} chars)`,
      description: `Verify strict lower bound check \`length < ${behaviour.secretMinLength}\`: exact length ${behaviour.secretMinLength} succeeds while ${behaviour.secretMinLength - 1} rejects.`,
      preconditions: 'Test both boundary lengths independently.',
      inputs: `secret length === ${behaviour.secretMinLength} (pass) and ${behaviour.secretMinLength - 1} (fail)`,
      expectedOutcome: `${behaviour.secretMinLength} chars initializes cleanly; ${behaviour.secretMinLength - 1} chars throws guard error.`,
      verificationStatus: 'observed_from_code',
      verificationNote: null,
      sourceEvidence: `${baseLineRef} (secret.length < ${behaviour.secretMinLength})`,
    });
  }

  if (optionalParams.length > 0) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:edge-defaults`,
      category: 'edge',
      title: `Uses default values when optional parameter(s) are omitted`,
      description: `Omit ${optionalParams.map((p) => `\`${p.name}\` (default: ${p.defaultValue || 'optional'})`).join(', ')} and confirm default behaviour applies cleanly.`,
      preconditions: 'Call with required parameters only.',
      inputs:
        requiredParams.length > 0
          ? requiredParams.map((p) => `${p.name} = ${sampleLiteralForParam(p, 'valid', ext)}`).join(', ')
          : 'Omit all optional parameters',
      expectedOutcome: `Defaults apply (${optionalParams.map((p) => `${p.name}=${p.defaultValue || (ext === '.py' ? 'None' : 'undefined')}`).join(', ')}); verify resulting execution outcome.`,
      verificationStatus: 'needs_manual_verification',
      verificationNote: 'Verify exact outcome when optional parameters use declared defaults.',
      sourceEvidence: baseLineRef,
    });
  }

  if (behaviour.hasRetryLoop && behaviour.hasStatus500Check) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:edge-retry-recovery`,
      category: 'edge',
      title: 'Recovers when transient HTTP 5xx succeeds before retry limit',
      description: 'Simulate HTTP 500 on initial attempt(s) followed by HTTP 200 before `attempt === retries`.',
      preconditions: 'Stub `fetch` sequence: [500, 200] (consider fake timers to avoid real backoff delay).',
      inputs: `${validArgsPreview || 'valid endpoint & retry budget'}`,
      expectedOutcome: 'Inferred: Retries HTTP >= 500 response and completes when subsequent attempt returns ok; verify call count and payload.',
      verificationStatus: 'needs_manual_verification',
      verificationNote: 'Use fake timers if applicable and assert exact retry count and resolved JSON.',
      sourceEvidence: `${baseLineRef} (status >= 500 && attempt < retries)`,
    });
  } else if (behaviour.checksPermissionsIncludes && behaviour.adminRoleLiteral) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:edge-non-admin-empty-perms`,
      category: 'edge',
      title: `Non-${behaviour.adminRoleLiteral} user with empty permissions list`,
      description: `Verify permission check when role !== '${behaviour.adminRoleLiteral}' and permissions list is empty.`,
      preconditions: 'Pass non-admin session object with empty permissions.',
      inputs: ext === '.py'
        ? 'session = {"role": "viewer", "permissions": []}, requiredPerm = "read:code"'
        : "session = { role: 'viewer', permissions: [] }, requiredPerm = 'read:code'",
      expectedOutcome: `Returns ${ext === '.py' ? 'False' : 'false'} without throwing.`,
      verificationStatus: 'observed_from_code',
      verificationNote: null,
      sourceEvidence: `${baseLineRef} (permissions.includes)`,
    });
  } else if ((requiredParams.length > 0 || behaviour.isReactComponent) && behaviour.secretMinLength === null) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:edge-empty-boundary`,
      category: 'edge',
      title: `Handles empty or minimal valid inputs cleanly in ${sym}`,
      description: `Exercise empty collections, empty strings, or minimal optional fields in ${sym}.`,
      preconditions: 'Provide boundary/empty shapes allowed by parameter types.',
      inputs:
        requiredParams.length > 0
          ? requiredParams.map((p) => `${p.name} = ${sampleLiteralForParam(p, 'invalid_empty', ext)}`).join(', ')
          : 'Minimal / empty props',
      expectedOutcome: 'Inferred: Either triggers a validation guard or handles empty input gracefully (verify intended contract).',
      verificationStatus: 'needs_manual_verification',
      verificationNote: 'Confirm whether empty input should return a fallback or throw an error.',
      sourceEvidence: baseLineRef,
    });
  }

  // ---------------- FAILURE SCENARIOS ----------------
  const propagatingGuards = behaviour.guards.filter(
    (g) => !(g.insideTryBlock && (behaviour.returnsNullOnError || behaviour.returnsFalseOnError))
  );
  if (propagatingGuards.length > 0) {
    const primaryGuard = propagatingGuards[0];
    const hasExactThrowMessage = primaryGuard.action === 'throw' && Boolean(primaryGuard.errorMessage);
    const guardTriggersOnEmptyOrZero =
      /!\s*[A-Za-z_]|===\s*0\b|==\s*null\b|==\s*undefined\b|\bis\s+None\b|\bnot\s+[A-Za-z_]|\.length\s*(?:===?\s*0|<\s*[1-9]\d*)|\.isEmpty\(\)|<=\s*0\b|<\s*1\b/.test(
        primaryGuard.condition || ''
      );
    const isGuardObserved =
      guardTriggersOnEmptyOrZero && (hasExactThrowMessage || primaryGuard.action === 'early_return');
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:failure-guard`,
      category: 'failure',
      title: `Rejects invalid input when guard \`${primaryGuard.condition}\` triggers`,
      description: `Verify explicit error/early-return guard when invalid or missing inputs violate precondition.`,
      preconditions: 'Trigger the observed guard branch.',
      inputs:
        requiredParams.length > 0
          ? requiredParams.map((p) => `${p.name} = ${sampleLiteralForParam(p, 'invalid_empty', ext)}`).join(', ')
          : 'Input satisfying guard condition',
      expectedOutcome: !guardTriggersOnEmptyOrZero
        ? `Inferred: Triggers \`${primaryGuard.detail}\` when \`${primaryGuard.condition}\` holds (arrange inputs matching this condition).`
        : hasExactThrowMessage
          ? `Throws ${primaryGuard.errorType || 'Error'} matching "${primaryGuard.errorMessage}".`
          : `Executes \`${primaryGuard.detail}\`.`,
      verificationStatus: isGuardObserved ? 'observed_from_code' : 'needs_manual_verification',
      verificationNote: isGuardObserved
        ? null
        : !guardTriggersOnEmptyOrZero
          ? `Arrange inputs that satisfy \`${primaryGuard.condition}\` and verify exact guard behavior.`
          : 'Verify the exact exception class and message raised by the guard.',
      sourceEvidence: `${file.path}:${chunk.startLine + (primaryGuard.lineOffset || 1) - 1} (${primaryGuard.condition})`,
    });
  }

  if (behaviour.returnsNullOnError) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:failure-null-fallback`,
      category: 'failure',
      title: `Returns ${ext === '.py' ? 'None' : 'null'} cleanly when underlying operation throws`,
      description: `Simulate failure inside try block and confirm catch/except handles it without uncaught rejection.`,
      preconditions:
        behaviour.dependenciesToMock.length > 0
          ? `Force ${behaviour.dependenciesToMock[0].name} to reject/throw.`
          : 'Pass malformed input to force exception.',
      inputs: validArgsPreview || 'Malformed / rejecting call',
      expectedOutcome: `Catches exception and returns \`${ext === '.py' ? 'None' : 'null'}\` without re-throwing.`,
      verificationStatus: 'observed_from_code',
      verificationNote: null,
      sourceEvidence: `${baseLineRef} (try/catch -> null fallback)`,
    });
  } else if (behaviour.returnsFalseOnError) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:failure-false-fallback`,
      category: 'failure',
      title: `Returns ${ext === '.py' ? 'False' : 'false'} when connection/operation raises`,
      description: 'Force underlying dependency to raise an exception and assert safe boolean failure return.',
      preconditions: 'Mock dependency failure inside try block.',
      inputs: validArgsPreview || 'No arguments',
      expectedOutcome: `Catches exception and returns \`${ext === '.py' ? 'False' : 'false'}\`.`,
      verificationStatus: 'observed_from_code',
      verificationNote: null,
      sourceEvidence: `${baseLineRef} (except -> False)`,
    });
  } else if (behaviour.hasRetryLoop) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:failure-exhausted`,
      category: 'failure',
      title: 'Throws error when retry attempts are exhausted',
      description: 'Simulate persistent HTTP error or network rejection across all configured retry attempts.',
      preconditions: 'Stub `fetch` to reject consistently or return error status for all attempts.',
      inputs: validArgsPreview || 'endpoint, retries = 3',
      expectedOutcome: 'Inferred: Throws an error once retry attempts are exhausted; verify whether non-5xx responses retry via catch or fail immediately.',
      verificationStatus: 'needs_manual_verification',
      verificationNote: 'Inspect catch/status branches to confirm retry behavior for 4xx vs 5xx and exact error message.',
      sourceEvidence: baseLineRef,
    });
  } else if (behaviour.hasDbTransaction && /\brollback\s*\(/.test(chunk.content || '')) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:failure-rollback`,
      category: 'failure',
      title: 'Rolls back and closes database session when exception occurs',
      description: 'Raise an error inside the transaction block and verify rollback + cleanup still run.',
      preconditions: 'Mock `SessionLocal` to return a spy session.',
      inputs: 'Simulated exception inside `with` / transaction block',
      expectedOutcome: 'Inferred: Calls `rollback()`, re-raises exception, and runs cleanup (`close()`); verify spy call counts.',
      verificationStatus: 'needs_manual_verification',
      verificationNote: 'Wire SessionLocal mock/patch and verify rollback() and close() assertions.',
      sourceEvidence: baseLineRef,
    });
  } else if (requiredParams.length > 0 && propagatingGuards.length === 0) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:failure-missing-required`,
      category: 'failure',
      title: `Handles missing or ${ext === '.py' ? 'None' : ext === '.java' ? 'null' : 'null/undefined'} required argument(s)`,
      description: `Verify behavior when missing/${ext === '.py' ? 'None' : 'null'} required inputs are supplied without compile-time checks.`,
      preconditions:
        ext === '.py'
          ? 'Verify whether missing argument raises TypeError/AttributeError/validation error or returns a safe fallback.'
          : ext === '.java'
            ? 'Verify whether null argument throws NullPointerException/IllegalArgumentException or returns a safe fallback.'
            : 'Verify whether missing argument throws TypeError on unguarded access or returns a safe fallback.',
      inputs: requiredParams.map((p) => `${p.name} = ${sampleLiteralForParam(p, 'missing', ext)}`).join(', '),
      expectedOutcome:
        ext === '.py'
          ? 'Inferred: May raise TypeError/AttributeError on unguarded access or raise validation error (confirm intended contract).'
          : ext === '.java'
            ? 'Inferred: May throw NullPointerException/IllegalArgumentException or fail validation (confirm intended contract).'
            : 'Inferred: May throw TypeError on unguarded property access or reject invalid input (confirm intended contract).',
      verificationStatus: 'needs_manual_verification',
      verificationNote:
        ext === '.py'
          ? 'Confirm expected failure behavior (TypeError/AttributeError vs graceful error return) when callers pass None.'
          : ext === '.java'
            ? 'Confirm expected failure behavior (NullPointerException/IllegalArgumentException vs error return) when callers pass null.'
            : 'Confirm expected failure behavior (TypeError on unguarded access vs validation guard) when callers pass null/undefined.',
      sourceEvidence: baseLineRef,
    });
  } else if (scenarios.filter((s) => s.category === 'failure').length === 0) {
    scenarios.push({
      id: `${file.id}:${sym}:${chunk.startLine}:failure-dependency`,
      category: 'failure',
      title: `Handles unexpected runtime or dependency failure in ${sym}`,
      description: `Verify ${sym} behavior when downstream dependencies throw or return invalid state.`,
      preconditions: 'Simulate downstream error or invalid environment state.',
      inputs: validArgsPreview || 'Fault-injected state',
      expectedOutcome: 'Inferred: Propagates or handles dependency error cleanly (verify exact error behaviour).',
      verificationStatus: 'needs_manual_verification',
      verificationNote: 'Verify exact failure propagation or UI error fallback.',
      sourceEvidence: baseLineRef,
    });
  }

  return scenarios;
}

function buildImportRelativePath(filePath = '') {
  const clean = getFilePath(filePath) || 'module.js';
  const base = getFileNameFromPath(clean);
  const ext = getFileExtension(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return `./${stem}`;
}

function resolveScenarioArgItems(params = [], sc = {}, ext = '.js') {
  const scId = sc?.id || '';
  const isDefaultsCase = scId.endsWith(':edge-defaults');
  const isMissingCase = scId.endsWith(':failure-missing-required');
  const isInvalidEmptyCase = scId.endsWith(':failure-guard') || scId.endsWith(':edge-empty-boundary');

  return params
    .filter((p) => !p.isRest)
    .map((p) => {
      if (isDefaultsCase && p.isOptional) {
        return null;
      }
      if (isMissingCase && !p.isOptional) {
        return sampleArgumentForParam(p, 'missing', ext);
      }
      if (isInvalidEmptyCase && !p.isOptional) {
        return sampleArgumentForParam(p, 'invalid_empty', ext);
      }
      return sampleArgumentForParam(p, 'valid', ext);
    })
    .filter(Boolean);
}

function detectTryFallbackMockTarget(file, chunkContent = '', extension = '') {
  const ext = (extension || '').toLowerCase();
  const content = String(chunkContent || '');

  if (ext === '.py') {
    const modName = getFileNameFromPath(file?.path || '').replace(/\.py$/i, '') || 'module';
    const tryMatch = content.match(/\btry\s*:([\s\S]*?)\bexcept\b/);
    const tryBody = tryMatch ? tryMatch[1] : '';
    if (!tryBody.trim()) return { canMock: false, targetName: 'underlying dependency' };

    const fileText = String(file?.content || '');
    const moduleBindings = new Set();
    for (const m of fileText.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
      moduleBindings.add(m[1]);
    }
    const importedNames = new Set();
    for (const m of fileText.matchAll(/^from\s+[^\s]+\s+import\s+([^\n#]+)/gm)) {
      m[1].split(',').forEach((part) => {
        const aliasSplit = part.trim().split(/\s+as\s+/);
        const sym = (aliasSplit[aliasSplit.length - 1] || '').trim();
        if (sym && sym !== '*') importedNames.add(sym);
      });
    }
    for (const m of fileText.matchAll(/^import\s+([^\n#]+)/gm)) {
      m[1].split(',').forEach((part) => {
        const aliasSplit = part.trim().split(/\s+as\s+/);
        const sym = (aliasSplit[aliasSplit.length - 1] || '').split('.')[0].trim();
        if (sym) moduleBindings.add(sym);
      });
    }

    const attrCall = tryBody.match(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (attrCall && (moduleBindings.has(attrCall[1]) || importedNames.has(attrCall[1]))) {
      return {
        canMock: true,
        patchTarget: `${modName}.${attrCall[1]}.${attrCall[2]}`,
        label: `${attrCall[1]}.${attrCall[2]}`,
      };
    }

    for (const fnMatch of tryBody.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      if (importedNames.has(fnMatch[1])) {
        return {
          canMock: true,
          patchTarget: `${modName}.${fnMatch[1]}`,
          label: fnMatch[1],
        };
      }
    }

    const firstCall = tryBody.match(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/);
    return { canMock: false, targetName: firstCall ? firstCall[1] : 'underlying dependency' };
  }

  const tryMatch = content.match(/\btry\s*\{([\s\S]*?)\}\s*catch\b/);
  const tryBody = tryMatch ? tryMatch[1] : '';
  if (!tryBody.trim()) return { canMock: false, targetName: 'underlying dependency' };

  if (/\bfetch\s*\(/.test(tryBody)) {
    return { canMock: true, kind: 'fetch', targetName: 'fetch', label: 'globalThis.fetch' };
  }

  if (/\bJSON\.parse\s*\(/.test(tryBody)) {
    return { canMock: true, kind: 'json_parse', targetName: 'JSON.parse', label: 'JSON.parse' };
  }

  const astImports = file?.astMetadata?.imports || [];
  for (const imp of astImports) {
    if (!imp?.name || !imp?.source || imp.name === imp.source || imp.name === '*') continue;
    const escaped = imp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\s*\\(`).test(tryBody)) {
      return {
        canMock: true,
        kind: 'named_import',
        targetName: imp.name,
        source: imp.source,
        label: `${imp.name} (${imp.source})`,
      };
    }
  }

  const callMatch = tryBody.match(
    /\b(?!if|for|while|switch|catch|return|throw|await|new|typeof|Error|TypeError|RangeError|SyntaxError|Promise|Object|Array|String|Number|Boolean|console\b)([A-Za-z_$][A-Za-z0-9_$.]*)\s*\(/
  );
  return { canMock: false, targetName: callMatch ? callMatch[1] : 'underlying dependency' };
}

function formatJsDraftTestCode(file, chunk, behaviour, scenarios, framework = 'vitest') {
  const sym = chunk.symbolName || 'target';
  const ext = file.extension || '.js';
  const importPath = buildImportRelativePath(file.path);
  const mockFn = framework === 'jest' ? 'jest.fn' : 'vi.fn';
  const mockHelper = framework === 'jest' ? 'jest.mock' : 'vi.mock';
  const spyHelper = framework === 'jest' ? 'jest.spyOn' : 'vi.spyOn';
  const tryMockTarget = detectTryFallbackMockTarget(file, chunk.content, ext);
  const hasMockedNamedImport =
    tryMockTarget.canMock &&
    tryMockTarget.kind === 'named_import' &&
    scenarios.some(
      (sc) =>
        sc.id.endsWith(':failure-null-fallback') ||
        sc.id.endsWith(':failure-false-fallback') ||
        (sc.category === 'failure' && (behaviour.returnsNullOnError || behaviour.returnsFalseOnError))
    );

  const lines = [
    `// DRAFT TEST SUITE — Generated by FORGE (${FRAMEWORK_LABELS[framework] || framework})`,
    `// Source: ${file.path}:${chunk.startLine}-${chunk.endLine}`,
    '// IMPORTANT: Review mocks, fixture values, and // TODO assertions before running or integrating.',
    '',
  ];

  if (framework === 'vitest') {
    lines.push("import { describe, it, expect, vi, beforeEach } from 'vitest';");
  } else {
    lines.push("import { describe, it, expect, jest, beforeEach } from '@jest/globals';");
  }

  if (behaviour.isReactComponent) {
    lines.push("import { render, screen } from '@testing-library/react';");
  }

  const importTarget = behaviour.parentClassName || sym;
  const exportDecls = file.astMetadata?.exports || [];
  const isDefaultExport = exportDecls.some(
    (e) => e.type === 'default' && (e.name === importTarget || e.name === 'default')
  );
  const isNamedExport = exportDecls.some((e) => e.type !== 'default' && e.name === importTarget);
  const importStatement =
    isDefaultExport && !isNamedExport
      ? `import ${importTarget} from '${importPath}'; // Verify export style`
      : `import { ${importTarget} } from '${importPath}'; // Verify named vs default import`;
  lines.push(importStatement);

  if (hasMockedNamedImport) {
    lines.push(`import { ${tryMockTarget.targetName} } from '${tryMockTarget.source}';`);
    lines.push(`${mockHelper}('${tryMockTarget.source}', () => ({ ${tryMockTarget.targetName}: ${mockFn}() }));`);
  }

  const remainingExternalImports = behaviour.externalImports
    .filter((pkg) => !(hasMockedNamedImport && pkg === tryMockTarget.source))
    .slice(0, 3);

  if (remainingExternalImports.length > 0) {
    lines.push('');
    remainingExternalImports.forEach((pkg) => {
      lines.push(`// ${mockHelper}('${pkg}', () => ({ /* TODO: stub external dependency ${pkg} */ }));`);
    });
  }

  lines.push('');
  const suiteTitle = escapeJsSingleQuote(behaviour.parentClassName ? `${behaviour.parentClassName}.${sym}` : sym);
  lines.push(`describe('${suiteTitle}', () => {`);
  lines.push('  beforeEach(() => {');
  lines.push(`    ${framework === 'jest' ? 'jest.clearAllMocks()' : 'vi.clearAllMocks()'};`);
  lines.push('  });');

  scenarios.forEach((sc) => {
    lines.push('');
    const isNullFallbackCase =
      sc.id.endsWith(':failure-null-fallback') ||
      (sc.category === 'failure' &&
        !sc.id.endsWith(':failure-guard') &&
        !sc.id.endsWith(':failure-exhausted') &&
        behaviour.returnsNullOnError);
    const isFalseFallbackCase =
      sc.id.endsWith(':failure-false-fallback') ||
      (sc.category === 'failure' &&
        !sc.id.endsWith(':failure-guard') &&
        !sc.id.endsWith(':failure-exhausted') &&
        behaviour.returnsFalseOnError);
    const isFallbackCase = isNullFallbackCase || isFalseFallbackCase;
    const isGuardThrowCase = sc.id.endsWith(':failure-guard') && behaviour.guards.some((g) => g.action === 'throw');
    const isMissingUnprovenCase =
      sc.id.endsWith(':failure-missing-required') && !behaviour.hasThrowOrRaise && !isGuardThrowCase;
    const isIncompleteFallback = isFallbackCase && !tryMockTarget.canMock;
    const shouldSkipJsCase = isIncompleteFallback || isMissingUnprovenCase;

    const statusBadge = isIncompleteFallback
      ? 'INCOMPLETE - MANUAL MOCK REQUIRED'
      : sc.verificationStatus === 'observed_from_code'
        ? 'OBSERVED'
        : 'NEEDS VERIFICATION';
    lines.push(`  // [${sc.category.toUpperCase()}] [${statusBadge}] ${sc.sourceEvidence}`);
    const isAsyncCase = behaviour.isAsync && !behaviour.isConstructor && !behaviour.isReactComponent;
    const itCall = shouldSkipJsCase ? 'it.skip' : 'it';
    lines.push(`  ${itCall}('${escapeJsSingleQuote(sc.title)}', ${isAsyncCase ? 'async ' : ''}() => {`);

    if (sc.verificationNote) {
      lines.push(`    // TODO (Manual Verification Required): ${sc.verificationNote}`);
    }

    if (behaviour.hasHttpClient && !(isFallbackCase && tryMockTarget.kind === 'fetch')) {
      if (sc.id.endsWith(':failure-exhausted')) {
        lines.push(`    globalThis.fetch = ${mockFn}().mockRejectedValue(new Error('Simulated network failure')); // TODO: optionally configure HTTP 5xx responses / fake timers`);
      } else {
        lines.push(`    globalThis.fetch = ${mockFn}(); // TODO: configure mock HTTP response for this scenario`);
      }
    }

    const argList = resolveScenarioArgItems(behaviour.params, sc, ext);
    const argsCall = argList.map((i) => i.code).join(', ');

    if (behaviour.isReactComponent) {
      const propNames = behaviour.params.flatMap((p) =>
        p.isDestructured ? extractDestructuredPropNames(p.name) : [p.name]
      );
      const jsxProps = propNames.map((p) => `${p}={${sampleLiteralForParam({ name: p }, 'valid', ext)}}`).join(' ');
      lines.push(`    render(<${sym}${jsxProps ? ` ${jsxProps}` : ''} />);`);
      lines.push('    // TODO: replace with concrete UI assertions, e.g. expect(screen.getByText(/.../i)).toBeInTheDocument();');
    } else if (behaviour.isConstructor) {
      if (sc.category === 'failure' && behaviour.guards.length > 0 && behaviour.guards[0].action === 'throw') {
        const invalidArg = behaviour.secretMinLength ? "'short-key'" : argsCall;
        const errPart = behaviour.guards[0].errorMessage
          ? `'${escapeJsSingleQuote(behaviour.guards[0].errorMessage)}'`
          : 'Error';
        lines.push(`    expect(() => new ${sym}(${invalidArg})).toThrow(${errPart});`);
      } else if (sc.id.endsWith('edge-min-length') && behaviour.secretMinLength) {
        lines.push(`    expect(new ${sym}('a'.repeat(${behaviour.secretMinLength}))).toBeDefined();`);
        lines.push(`    expect(() => new ${sym}('a'.repeat(${behaviour.secretMinLength - 1}))).toThrow();`);
      } else {
        const validConstructorArg = behaviour.secretMinLength ? `'a'.repeat(${behaviour.secretMinLength})` : argsCall;
        lines.push(`    const instance = new ${sym}(${validConstructorArg});`);
        lines.push('    expect(instance).toBeDefined();');
      }
    } else {
      const targetCall = behaviour.parentClassName
        ? behaviour.isStatic
          ? `${behaviour.parentClassName}.${sym}(${argsCall})`
          : `instance.${sym}(${argsCall})`
        : `${sym}(${argsCall})`;

      if (behaviour.parentClassName && !behaviour.isStatic && !shouldSkipJsCase) {
        const ctorArgs = (behaviour.parentConstructorParams || [])
          .filter((p) => !p.isRest)
          .map((p) => sampleLiteralForParam(p, 'valid', ext))
          .join(', ');
        lines.push(`    const instance = new ${behaviour.parentClassName}(${ctorArgs});`);
      }

      const isThrowingCase =
        isGuardThrowCase ||
        sc.id.endsWith(':failure-exhausted') ||
        (sc.category === 'failure' &&
          !isFallbackCase &&
          !isMissingUnprovenCase &&
          behaviour.hasThrowOrRaise);
      const isGuardEarlyReturnCase =
        sc.id.endsWith(':failure-guard') &&
        !isThrowingCase &&
        behaviour.guards.some((g) => g.action === 'early_return');

      if (isMissingUnprovenCase) {
        lines.push('    // TODO (Manual Verification Required): Confirm whether null/undefined should throw TypeError or return a safe fallback.');
        lines.push(`    // const result = ${isAsyncCase ? 'await ' : ''}${targetCall};`);
      } else if (isFallbackCase) {
        const expectedVal = isNullFallbackCase ? 'toBeNull()' : 'toBe(false)';
        if (tryMockTarget.canMock) {
          if (tryMockTarget.kind === 'fetch') {
            lines.push(`    globalThis.fetch = ${mockFn}().mockRejectedValueOnce(new Error('Simulated network failure'));`);
          } else if (tryMockTarget.kind === 'json_parse') {
            lines.push(`    ${spyHelper}(JSON, 'parse').mockImplementationOnce(() => { throw new Error('Simulated parse failure'); });`);
          } else if (tryMockTarget.kind === 'named_import') {
            if (isAsyncCase) {
              lines.push(`    ${tryMockTarget.targetName}.mockRejectedValueOnce(new Error('Simulated ${tryMockTarget.targetName} failure'));`);
            } else {
              lines.push(`    ${tryMockTarget.targetName}.mockImplementationOnce(() => { throw new Error('Simulated ${tryMockTarget.targetName} failure'); });`);
            }
          }
          lines.push(`    const result = ${isAsyncCase ? 'await ' : ''}${targetCall};`);
          lines.push(`    expect(result).${expectedVal};`);
        } else {
          lines.push(`    // INCOMPLETE (Manual Mock Required): Mock \`${tryMockTarget.targetName}\` to reject/throw before asserting fallback.`);
          lines.push(`    // const result = ${isAsyncCase ? 'await ' : ''}${targetCall};`);
          lines.push(`    // expect(result).${expectedVal};`);
        }
      } else if (isThrowingCase) {
        if (isAsyncCase) {
          lines.push(`    await expect(${targetCall}).rejects.toThrow();`);
        } else {
          lines.push(`    expect(() => ${targetCall}).toThrow();`);
        }
      } else if (sc.id.endsWith('edge-non-admin-empty-perms') && behaviour.adminRoleLiteral) {
        const emptyPermsCall = behaviour.parentClassName && !behaviour.isStatic
          ? `instance.${sym}({ id: 'u2', email: 'viewer@example.com', role: 'viewer', permissions: [] }, 'read:code')`
          : `${sym}({ id: 'u2', email: 'viewer@example.com', role: 'viewer', permissions: [] }, 'read:code')`;
        lines.push(`    const result = ${isAsyncCase ? 'await ' : ''}${emptyPermsCall};`);
        lines.push('    expect(result).toBe(false);');
      } else if (isGuardEarlyReturnCase) {
        lines.push(`    const result = ${isAsyncCase ? 'await ' : ''}${targetCall};`);
        const detail = behaviour.guards.find((g) => g.action === 'early_return')?.detail || '';
        if (sc.verificationStatus !== 'observed_from_code') {
          lines.push('    // TODO (Manual Verification Required): arrange guard condition and assert expected early-return value');
        } else if (/^return\s+null\b/.test(detail)) {
          lines.push('    expect(result).toBeNull();');
        } else if (/^return\s+false\b/.test(detail)) {
          lines.push('    expect(result).toBe(false);');
        } else if (/^return\s*(?:undefined)?$/.test(detail)) {
          lines.push('    expect(result).toBeUndefined();');
        } else {
          lines.push('    expect(result).toBeDefined(); // Verify exact expected early-return value');
        }
      } else {
        lines.push(`    const result = ${isAsyncCase ? 'await ' : ''}${targetCall};`);
        if (sc.verificationStatus === 'observed_from_code' && behaviour.returnsBoolean && behaviour.checksPermissionsIncludes) {
          lines.push('    expect(result).toBe(true);');
        } else {
          lines.push(
            sc.verificationStatus === 'observed_from_code'
              ? '    expect(result).toBeDefined(); // Verify exact expected return value'
              : '    // TODO (Manual Verification Required): assert exact expected outcome for `result`'
          );
        }
      }
    }

    lines.push('  });');
  });

  lines.push('});');
  return lines.join('\n');
}

function formatPythonDraftTestCode(file, chunk, behaviour, scenarios, framework = 'pytest') {
  const sym = chunk.symbolName || 'target';
  const modName = getFileNameFromPath(file.path).replace(/\.py$/i, '') || 'module';
  const importTarget = behaviour.parentClassName || sym;
  const usesAsyncRunner = behaviour.isAsync && !behaviour.isConstructor && !behaviour.isContextManager;
  const tryMockTarget = detectTryFallbackMockTarget(file, chunk.content, '.py');
  const lines = [
    `# DRAFT TEST SUITE — Generated by FORGE (${FRAMEWORK_LABELS[framework] || framework})`,
    `# Source: ${file.path}:${chunk.startLine}-${chunk.endLine}`,
    '# IMPORTANT: Review mocks, fixtures, and TODO assertions before running or integrating.',
    '',
  ];

  const emitInvocationParts = (sc) => {
    const argItems = resolveScenarioArgItems(behaviour.params, sc, '.py');
    const callArgs = argItems.map((i) => i.code).join(', ');
    const callPrefix = behaviour.parentClassName
      ? behaviour.isStatic
        ? `${behaviour.parentClassName}.${sym}`
        : `instance.${sym}`
      : sym;
    const rawCall = behaviour.isConstructor ? `${sym}(${callArgs})` : `${callPrefix}(${callArgs})`;
    const callExpr = usesAsyncRunner ? `asyncio.run(${rawCall})` : rawCall;
    return { callArgs, callExpr };
  };

  if (framework === 'unittest') {
    if (usesAsyncRunner) lines.push('import asyncio');
    lines.push('import unittest');
    lines.push('from unittest.mock import MagicMock, patch');
    lines.push(`from ${modName} import ${importTarget}`);
    lines.push('');
    lines.push(`class Test${sym.charAt(0).toUpperCase() + sym.slice(1)}(unittest.TestCase):`);
    scenarios.forEach((sc, idx) => {
      const fnSlug = `${sc.category}_${idx + 1}`;
      const { callExpr } = emitInvocationParts(sc);
      const isGuardRaiseCase =
        sc.id.endsWith(':failure-guard') && behaviour.guards.some((g) => g.action === 'raise');
      const isGuardEarlyReturnCase =
        sc.id.endsWith(':failure-guard') &&
        !isGuardRaiseCase &&
        !behaviour.hasThrowOrRaise &&
        behaviour.guards.some((g) => g.action === 'early_return');
      const isMissingUnprovenCase =
        sc.id.endsWith(':failure-missing-required') && !behaviour.hasThrowOrRaise && !isGuardRaiseCase;
      const isFalseFallbackCase =
        sc.id.endsWith(':failure-false-fallback') ||
        (sc.category === 'failure' && !isGuardRaiseCase && !isMissingUnprovenCase && behaviour.returnsFalseOnError);
      const isNullFallbackCase =
        sc.id.endsWith(':failure-null-fallback') ||
        (sc.category === 'failure' && !isGuardRaiseCase && !isMissingUnprovenCase && behaviour.returnsNullOnError);
      const isFallbackCase = isFalseFallbackCase || isNullFallbackCase;
      const isIncompleteCase = (isFallbackCase && !tryMockTarget.canMock) || isMissingUnprovenCase;

      lines.push(`    # [${sc.category.toUpperCase()}] [${isIncompleteCase ? 'INCOMPLETE - MANUAL VERIFICATION REQUIRED' : sc.verificationStatus === 'observed_from_code' ? 'USABLE - OBSERVED' : 'PLACEHOLDER - NEEDS VERIFICATION'}] ${sc.sourceEvidence}`);
      lines.push(`    def test_${fnSlug}(self):`);
      lines.push(`        """${escapePyDocstring(sc.title)}"""`);
      if (sc.verificationNote) {
        lines.push(`        # TODO (Manual Verification Required): ${sc.verificationNote}`);
      }
      if (behaviour.parentClassName && !behaviour.isStatic && !behaviour.isConstructor && !isIncompleteCase) {
        const pyCtorArgs = (behaviour.parentConstructorParams || [])
          .filter((p) => !p.isRest)
          .map((p) => sampleLiteralForParam(p, 'valid', '.py'))
          .join(', ');
        lines.push(`        instance = ${behaviour.parentClassName}(${pyCtorArgs})`);
      }

      if (behaviour.isContextManager) {
        if (sc.category === 'failure') {
          lines.push('        # TODO: patch underlying session factory to raise Exception');
          lines.push('        with self.assertRaises(Exception):');
          lines.push(`            with ${callExpr} as resource:`);
          lines.push('                raise RuntimeError("Simulated transaction failure")');
        } else {
          lines.push('        # TODO: patch underlying session factory and verify commit()/close() calls');
          lines.push(`        with ${callExpr} as resource:`);
          lines.push('            self.assertIsNotNone(resource)');
        }
      } else if (isMissingUnprovenCase) {
        lines.push('        # TODO (Manual Verification Required): Confirm whether None input raises an error or returns a fallback before adding assertRaises/assert.');
        lines.push(`        # result = ${callExpr}`);
        lines.push('        self.skipTest("TODO (Manual Verification Required): verify None-input contract")');
      } else if (isFallbackCase) {
        const assertStmt = isFalseFallbackCase ? 'self.assertFalse(result)' : 'self.assertIsNone(result)';
        if (tryMockTarget.canMock) {
          lines.push(`        with patch("${tryMockTarget.patchTarget}", side_effect=RuntimeError("Simulated dependency failure")):`);
          lines.push(`            result = ${callExpr}`);
          lines.push(`            ${assertStmt}`);
        } else {
          lines.push(`        # INCOMPLETE (Manual Mock Required): Patch \`${tryMockTarget.targetName}\` to raise an exception before asserting fallback.`);
          lines.push(`        # result = ${callExpr}`);
          lines.push(`        # ${assertStmt}`);
          lines.push(`        self.skipTest("INCOMPLETE: mock ${tryMockTarget.targetName} failure before enabling fallback assertion")`);
        }
      } else if (isGuardRaiseCase || (sc.category === 'failure' && behaviour.hasThrowOrRaise)) {
        lines.push('        with self.assertRaises(Exception):');
        lines.push(`            ${callExpr}  # TODO: configure failing inputs/mocks`);
      } else if (isGuardEarlyReturnCase) {
        const detail = behaviour.guards.find((g) => g.action === 'early_return')?.detail || '';
        lines.push(`        result = ${callExpr}`);
        if (sc.verificationStatus !== 'observed_from_code') {
          lines.push('        # PLACEHOLDER (Manual Verification Required): arrange guard condition and assert expected early return');
        } else if (/^return\s+None\b/.test(detail)) {
          lines.push('        self.assertIsNone(result)');
        } else if (/^return\s+False\b/.test(detail)) {
          lines.push('        self.assertFalse(result)');
        } else {
          lines.push('        # PLACEHOLDER (Manual Verification Required): replace with exact assertion for early return');
          lines.push('        self.assertIsNotNone(result)');
        }
      } else {
        lines.push(`        result = ${callExpr}`);
        lines.push('        # PLACEHOLDER (Manual Verification Required): replace with exact assertion for expected output');
        lines.push('        self.assertIsNotNone(result)');
      }
      lines.push('');
    });
    return lines.join('\n').trimEnd();
  }

  if (usesAsyncRunner) lines.push('import asyncio');
  lines.push('import pytest');
  lines.push('from unittest.mock import MagicMock, patch');
  lines.push(`from ${modName} import ${importTarget}`);
  lines.push('');

  scenarios.forEach((sc, idx) => {
    const fnSlug = `${sym}_${sc.category}_${idx + 1}`.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
    const { callExpr } = emitInvocationParts(sc);
    const isGuardRaiseCase =
      sc.id.endsWith(':failure-guard') && behaviour.guards.some((g) => g.action === 'raise');
    const isGuardEarlyReturnCase =
      sc.id.endsWith(':failure-guard') &&
      !isGuardRaiseCase &&
      !behaviour.hasThrowOrRaise &&
      behaviour.guards.some((g) => g.action === 'early_return');
    const isMissingUnprovenCase =
      sc.id.endsWith(':failure-missing-required') && !behaviour.hasThrowOrRaise && !isGuardRaiseCase;
    const isFalseFallbackCase =
      sc.id.endsWith(':failure-false-fallback') ||
      (sc.category === 'failure' && !isGuardRaiseCase && !isMissingUnprovenCase && behaviour.returnsFalseOnError);
    const isNullFallbackCase =
      sc.id.endsWith(':failure-null-fallback') ||
      (sc.category === 'failure' && !isGuardRaiseCase && !isMissingUnprovenCase && behaviour.returnsNullOnError);
    const isFallbackCase = isFalseFallbackCase || isNullFallbackCase;
    const isIncompleteCase = (isFallbackCase && !tryMockTarget.canMock) || isMissingUnprovenCase;

    lines.push(`# [${sc.category.toUpperCase()}] [${isIncompleteCase ? 'INCOMPLETE - MANUAL VERIFICATION REQUIRED' : sc.verificationStatus === 'observed_from_code' ? 'USABLE - OBSERVED' : 'PLACEHOLDER - NEEDS VERIFICATION'}] ${sc.sourceEvidence}`);
    lines.push(`def test_${fnSlug}():`);
    lines.push(`    """${escapePyDocstring(sc.title)}"""`);
    if (sc.verificationNote) {
      lines.push(`    # TODO (Manual Verification Required): ${sc.verificationNote}`);
    }
    if (behaviour.parentClassName && !behaviour.isStatic && !behaviour.isConstructor && !isIncompleteCase) {
      const pyCtorArgs = (behaviour.parentConstructorParams || [])
        .filter((p) => !p.isRest)
        .map((p) => sampleLiteralForParam(p, 'valid', '.py'))
        .join(', ');
      lines.push(`    instance = ${behaviour.parentClassName}(${pyCtorArgs})`);
    }

    if (behaviour.isContextManager) {
      if (sc.category === 'failure') {
        lines.push('    # TODO: patch underlying session factory to assert rollback() and close()');
        lines.push('    with pytest.raises(RuntimeError):');
        lines.push(`        with ${callExpr} as resource:`);
        lines.push('            raise RuntimeError("Simulated transaction failure")');
      } else {
        lines.push('    # TODO: patch underlying session factory and verify commit() / close()');
        lines.push(`    with ${callExpr} as resource:`);
        lines.push('        assert resource is not None');
      }
    } else if (isMissingUnprovenCase) {
      lines.push('    # TODO (Manual Verification Required): Confirm whether None input raises an error or returns a fallback before adding pytest.raises/assert.');
      lines.push(`    # result = ${callExpr}`);
      lines.push('    pytest.skip("TODO (Manual Verification Required): verify None-input contract")');
    } else if (isFallbackCase) {
      const expectedPyVal = isFalseFallbackCase ? 'False' : 'None';
      if (tryMockTarget.canMock) {
        lines.push(`    with patch("${tryMockTarget.patchTarget}", side_effect=RuntimeError("Simulated dependency failure")):`);
        lines.push(`        assert ${callExpr} is ${expectedPyVal}`);
      } else {
        lines.push(`    # INCOMPLETE (Manual Mock Required): Patch \`${tryMockTarget.targetName}\` to raise an exception before asserting ${expectedPyVal}.`);
        lines.push(`    # assert ${callExpr} is ${expectedPyVal}`);
        lines.push(`    pytest.skip("INCOMPLETE: mock ${tryMockTarget.targetName} failure before enabling fallback assertion")`);
      }
    } else if (isGuardRaiseCase || (sc.category === 'failure' && behaviour.hasThrowOrRaise)) {
      lines.push('    with pytest.raises(Exception):');
      lines.push(`        ${callExpr}  # TODO: configure failing precondition or mock`);
    } else if (isGuardEarlyReturnCase) {
      const detail = behaviour.guards.find((g) => g.action === 'early_return')?.detail || '';
      lines.push(`    result = ${callExpr}`);
      if (sc.verificationStatus !== 'observed_from_code') {
        lines.push('    # PLACEHOLDER (Manual Verification Required): arrange guard condition and assert expected early return');
      } else if (/^return\s+None\b/.test(detail)) {
        lines.push('    assert result is None');
      } else if (/^return\s+False\b/.test(detail)) {
        lines.push('    assert result is False');
      } else {
        lines.push('    # PLACEHOLDER (Manual Verification Required): replace with exact assertion for early return');
        lines.push('    assert result is not None');
      }
    } else {
      lines.push(`    result = ${callExpr}`);
      lines.push('    # PLACEHOLDER (Manual Verification Required): replace with exact assertion for expected output');
      lines.push('    assert result is not None');
    }
    lines.push('');
  });

  return lines.join('\n').trimEnd();
}

function formatJavaDraftTestCode(file, chunk, behaviour, scenarios) {
  const sym = chunk.symbolName || 'Target';
  const className = getFileNameFromPath(file.path).replace(/\.java$/i, '') || 'Module';
  const testClassName = className.endsWith('Test') ? className : `${className}Test`;
  const lines = [
    '// DRAFT TEST SUITE — Generated by FORGE (JUnit 5)',
    `// Source: ${file.path}:${chunk.startLine}-${chunk.endLine}`,
    '// IMPORTANT: Review package/imports and distinguish [USABLE] assertions from [PLACEHOLDER - INCOMPLETE] tests.',
    '',
  ];

  if (behaviour.packageName) {
    lines.push(`package ${behaviour.packageName};`);
    lines.push('');
  }

  lines.push('import org.junit.jupiter.api.Test;');
  lines.push('import static org.junit.jupiter.api.Assertions.*;');

  const needsCollectionsImport = behaviour.params.some((p) => {
    const lit = sampleLiteralForParam(p, 'valid', '.java');
    return lit.includes('Collections.');
  });
  if (needsCollectionsImport) {
    lines.push('import java.util.Collections;');
  }

  lines.push('');
  lines.push(`class ${testClassName} {`);

  scenarios.forEach((sc, idx) => {
    const methodName = `${sym}_${sc.category}_${idx + 1}`.replace(/[^A-Za-z0-9_]/g, '_');
    const variant = sc.category === 'failure' && behaviour.guards.length > 0 ? 'invalid_empty' : 'valid';
    const argItems = behaviour.params
      .filter((p) => !p.isRest)
      .map((p) => {
        if (sc.category === 'failure' && behaviour.guards.length === 0 && !p.isOptional) {
          return sampleArgumentForParam(p, 'missing', '.java');
        }
        return sampleArgumentForParam(p, variant, '.java');
      });
    const argsCall = argItems.map((i) => i.code).join(', ');
    const hasPlaceholderArg = argItems.some((i) => i.isPlaceholder);

    const guardErrorType = behaviour.guards[0]?.errorType || 'IllegalArgumentException';
    const isUsableObservedThrow =
      sc.category === 'failure' &&
      sc.verificationStatus === 'observed_from_code' &&
      behaviour.guards.some((g) => g.action === 'throw') &&
      !hasPlaceholderArg;
    const isUsableObservedConstructor =
      behaviour.isConstructor &&
      sc.category === 'normal' &&
      sc.verificationStatus === 'observed_from_code' &&
      !hasPlaceholderArg;
    const isCompleteUsable = isUsableObservedThrow || isUsableObservedConstructor;

    const statusTag = isCompleteUsable ? 'USABLE - OBSERVED' : 'PLACEHOLDER - INCOMPLETE';
    lines.push('');
    lines.push(`    // [${sc.category.toUpperCase()}] [${statusTag}] ${sc.sourceEvidence}`);
    lines.push('    @Test');
    lines.push(`    void ${methodName}() {`);

    const targetOwner = behaviour.parentClassName || className;
    const invocationExpr = behaviour.isConstructor
      ? `new ${sym}(${argsCall})`
      : behaviour.isStatic
        ? `${targetOwner}.${sym}(${argsCall})`
        : `instance.${sym}(${argsCall})`;

    if (!behaviour.isConstructor && !behaviour.isStatic) {
      const javaCtorArgs = (behaviour.parentConstructorParams || [])
        .filter((p) => !p.isRest)
        .map((p) => sampleLiteralForParam(p, 'valid', '.java'))
        .join(', ');
      lines.push(`        ${targetOwner} instance = new ${targetOwner}(${javaCtorArgs});`);
    }

    if (isUsableObservedThrow) {
      lines.push(`        assertThrows(${guardErrorType}.class, () -> ${invocationExpr});`);
    } else if (isUsableObservedConstructor) {
      lines.push(`        ${sym} instance = new ${sym}(${argsCall});`);
      lines.push('        assertNotNull(instance);');
    } else {
      lines.push(`        // PLACEHOLDER: ${escapeJavaString(sc.verificationNote || sc.expectedOutcome)}`);
      if (!hasPlaceholderArg) {
        lines.push(`        // Example invocation: ${invocationExpr};`);
      } else {
        lines.push(`        // Requires domain fixture(s) for: ${behaviour.params.map((p) => p.raw).join(', ')}`);
      }
      lines.push(`        fail("PLACEHOLDER: Complete test arrangement & assertion for: ${escapeJavaString(sc.title)}");`);
    }
    lines.push('    }');
  });

  lines.push('}');
  return lines.join('\n');
}

function generateDraftCodeMap(file, chunk, behaviour, scenarios) {
  const ext = (file.extension || '').toLowerCase();
  const frameworks = getSupportedFrameworksForExtension(ext);
  const draftsByFramework = {};

  for (const fw of frameworks) {
    if (fw === 'vitest' || fw === 'jest') {
      draftsByFramework[fw] = formatJsDraftTestCode(file, chunk, behaviour, scenarios, fw);
    } else if (fw === 'pytest' || fw === 'unittest') {
      draftsByFramework[fw] = formatPythonDraftTestCode(file, chunk, behaviour, scenarios, fw);
    } else if (fw === 'junit5') {
      draftsByFramework[fw] = formatJavaDraftTestCode(file, chunk, behaviour, scenarios);
    }
  }

  return draftsByFramework;
}

/**
 * Formats a generated test plan + scenarios + draft suites as reviewable Markdown.
 */
export function formatTestPlanMarkdown(testPlan) {
  if (!testPlan || !Array.isArray(testPlan.targets) || testPlan.targets.length === 0) {
    return '# Test Case Generation Plan\n\nNo testable functions, classes, or components found — import source files to begin.\n';
  }

  const { projectName = 'Workspace', summary, targets } = testPlan;
  const lines = [
    `# Draft Test Cases — ${projectName}`,
    '',
    '> **Status:** Drafts requiring manual developer review before execution or integration.',
    '',
    `- **Testable Targets Identified:** ${summary.totalTargets}`,
    `- **Total Scenarios:** ${summary.totalScenarios} (Normal: ${summary.byCategory.normal}, Edge: ${summary.byCategory.edge}, Failure: ${summary.byCategory.failure})`,
    `- **Assertions Flagged for Manual Verification:** ${summary.unverifiedAssertionsCount}`,
    '',
    '---',
    '',
  ];

  targets.forEach((target, idx) => {
    lines.push(
      `## ${idx + 1}. \`${target.displayName}\` [${target.importanceTier} Priority · ${target.targetKind}]`
    );
    lines.push('');
    lines.push(`- **Source:** \`${target.filePath}:${target.startLine}-${target.endLine}\` (${target.language})`);
    lines.push(`- **Module:** ${target.moduleLabel} · Suggested File: \`${target.suggestedFilePath}\``);
    lines.push(`- **Observed Behaviour:** ${target.behaviour.summary}`);
    lines.push('');
    lines.push('### Scenarios');
    target.scenarios.forEach((sc) => {
      const reviewFlag = sc.verificationStatus === 'needs_manual_verification' ? ' *(Needs verification)*' : '';
      lines.push(`- **[${sc.category.toUpperCase()}]** ${sc.title}${reviewFlag} — Expected: ${sc.expectedOutcome}`);
    });
    lines.push('');
    lines.push('```' + (target.extension === '.py' ? 'python' : target.extension === '.java' ? 'java' : 'javascript'));
    lines.push(target.draftsByFramework[target.defaultFramework] || '');
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Builds a bounded, Gemini-ready context payload for a single selected test target.
 * Used later (optional Step 5) to refine drafts without changing core test generation.
 */
export function buildAiRefinementContext(target, framework = null) {
  if (!target) return null;
  const activeFramework = framework || target.defaultFramework || 'vitest';
  return {
    targetId: target.id,
    displayName: target.displayName,
    filePath: target.filePath,
    language: target.language,
    framework: activeFramework,
    startLine: target.startLine,
    endLine: target.endLine,
    sourceCode: target.sourceSnippet || '',
    behaviourSummary: target.behaviour?.summary || '',
    parameters: target.behaviour?.params?.map((p) => p.raw) || [],
    guards: target.behaviour?.guards || [],
    dependenciesToMock: target.behaviour?.dependenciesToMock || [],
    scenarios: (target.scenarios || []).map((s) => ({
      category: s.category,
      title: s.title,
      inputs: s.inputs,
      expectedOutcome: s.expectedOutcome,
    })),
    currentDraftCode: target.draftsByFramework?.[activeFramework] || '',
  };
}

/**
 * Analyses workspace files and generates review-gated Normal/Edge/Failure test scenarios
 * and framework-aware draft test code across JS, TS, React, Python, and Java.
 *
 * @param {Array<object>} files
 * @param {object|null} [architectureModel]
 * @param {{ projectName?: string, maxTargets?: number }} [options]
 */
export function generateTestSuitePlan(files = [], architectureModel = null, options = {}) {
  const projectName = options.projectName || architectureModel?.projectName || 'Workspace';
  const maxTargets = Math.max(1, Number(options.maxTargets) || 35);

  if (!Array.isArray(files) || files.length === 0) {
    const emptyPlan = {
      projectName,
      summary: {
        ...EMPTY_SUMMARY,
        byCategory: { ...EMPTY_SUMMARY.byCategory },
        byTier: { ...EMPTY_SUMMARY.byTier },
        byKind: {},
      },
      targets: [],
      markdown: '',
    };
    emptyPlan.markdown = formatTestPlanMarkdown(emptyPlan);
    return emptyPlan;
  }

  const preparedFiles = prepareWorkspaceFiles(files);
  const archModel =
    architectureModel && Array.isArray(architectureModel.modules)
      ? architectureModel
      : analyzeCodebaseArchitecture(preparedFiles, { projectName });

  const archFileById = new Map();
  const moduleByFileId = new Map();

  for (const af of archModel.files || []) {
    archFileById.set(af.fileId, af);
  }
  for (const mod of archModel.modules || []) {
    for (const mf of mod.files || []) {
      moduleByFileId.set(mf.fileId, mod);
    }
  }

  let skippedTestFiles = 0;
  const candidateTargets = [];

  for (const file of preparedFiles) {
    const ext = (file.extension || getFileExtension(file.path || '')).toLowerCase();
    if (!TESTABLE_EXTENSIONS.has(ext)) continue;

    if (isExistingTestFile(file.path)) {
      skippedTestFiles += 1;
      continue;
    }

    const moduleMeta = moduleByFileId.get(file.id) || null;
    const archFileInfo = archFileById.get(file.id) || null;
    const chunks = chunkFile(file);

    // Track class line ranges across JS/TS (AST), Python (indentation), and Java (brace depth)
    const fileLines = typeof file.content === 'string' ? file.content.split('\n') : [];
    const classRanges = chunks
      .filter((c) => c.symbolType === 'class' && c.symbolName)
      .map((c) => {
        const astClass = (file.astMetadata?.classes || []).find(
          (ac) => ac.name === c.symbolName && ac.line === c.startLine
        );
        let computedEnd = astClass?.endLine || c.endLine;

        if (!astClass && ext === '.py' && fileLines.length > 0) {
          const classLineText = fileLines[c.startLine - 1] || '';
          const classIndent = classLineText.match(/^\s*/)?.[0].length || 0;
          computedEnd = c.startLine;
          for (let li = c.startLine; li < fileLines.length; li++) {
            const raw = fileLines[li];
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('#')) {
              computedEnd = li + 1;
              continue;
            }
            const indent = raw.match(/^\s*/)?.[0].length || 0;
            if (indent <= classIndent) break;
            computedEnd = li + 1;
          }
        } else if (!astClass && ext === '.java' && fileLines.length > 0) {
          let depth = 0;
          let opened = false;
          computedEnd = fileLines.length;
          for (let li = c.startLine - 1; li < fileLines.length; li++) {
            const lineText = fileLines[li];
            for (const ch of lineText) {
              if (ch === '{') {
                depth += 1;
                opened = true;
              } else if (ch === '}' && opened) {
                depth -= 1;
                if (depth === 0) {
                  computedEnd = li + 1;
                  break;
                }
              }
            }
            if (opened && depth === 0) break;
          }
        }

        return {
          name: c.symbolName,
          startLine: c.startLine,
          endLine: computedEnd,
        };
      });

    // Deduplicate overlapping window splits of large symbols by merging spans per symbol
    const groupedSymbolChunks = new Map();

    for (const chunk of chunks) {
      if (!chunk.symbolName || (chunk.symbolType !== 'function' && chunk.symbolType !== 'class')) {
        continue;
      }

      const symbolKey = `${file.id}:${chunk.symbolType}:${chunk.symbolName}`;
      if (!groupedSymbolChunks.has(symbolKey)) {
        groupedSymbolChunks.set(symbolKey, {
          ...chunk,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        });
      } else {
        const existing = groupedSymbolChunks.get(symbolKey);
        existing.startLine = Math.min(existing.startLine, chunk.startLine);
        existing.endLine = Math.max(existing.endLine, chunk.endLine);
      }
    }

    // Merge Java constructor chunks emitted as functions by chunkPythonOrJava into their enclosing class
    for (const [key, chunk] of Array.from(groupedSymbolChunks.entries())) {
      if (chunk.symbolType === 'function') {
        const enclosing = classRanges.find(
          (cr) => chunk.startLine > cr.startLine && chunk.endLine <= cr.endLine
        );
        if (enclosing && chunk.symbolName === enclosing.name) {
          const classKey = `${file.id}:class:${enclosing.name}`;
          const clsChunk = groupedSymbolChunks.get(classKey);
          if (clsChunk) {
            clsChunk.endLine = Math.max(clsChunk.endLine, chunk.endLine);
          }
          groupedSymbolChunks.delete(key);
        }
      }
    }

    for (const chunk of groupedSymbolChunks.values()) {
      if (fileLines.length > 0 && chunk.endLine >= chunk.startLine) {
        const cappedEnd = Math.min(fileLines.length, chunk.startLine + 149, chunk.endLine);
        let decoratorStart = chunk.startLine;
        for (let offset = 1; offset <= 2 && chunk.startLine - offset >= 2; offset++) {
          const prevLine = (fileLines[chunk.startLine - 1 - offset] || '').trim();
          if (prevLine.startsWith('@')) {
            decoratorStart = chunk.startLine - offset;
          } else {
            break;
          }
        }
        chunk.content = fileLines.slice(decoratorStart - 1, cappedEnd).join('\n');
      }
    }

    const classConstructorParamsMap = new Map();
    for (const chunk of groupedSymbolChunks.values()) {
      if (chunk.symbolType === 'class' && chunk.symbolName) {
        const clsSig = extractTargetSignature(chunk.content || '', chunk.symbolName, ext, 'class');
        classConstructorParamsMap.set(chunk.symbolName, clsSig.params || []);
      }
    }

    for (const chunk of groupedSymbolChunks.values()) {

      const enclosingClass =
        chunk.symbolType === 'function'
          ? classRanges.find(
              (cr) => chunk.startLine > cr.startLine && chunk.endLine <= cr.endLine
            )
          : null;

      const parentClassName = enclosingClass ? enclosingClass.name : null;
      const parentConstructorParams = parentClassName
        ? classConstructorParamsMap.get(parentClassName) || []
        : [];

      const behaviour = analyzeChunkBehaviour(
        file,
        chunk,
        moduleMeta,
        parentClassName,
        parentConstructorParams
      );

      // Keep constructors/classes only when they declare constructor params, guards, or standalone logic;
      // otherwise prioritize concrete methods & functions
      const importance = scoreTargetImportance(behaviour, archFileInfo);
      const scenarios = buildTestScenarios(file, chunk, behaviour);
      const supportedFrameworks = getSupportedFrameworksForExtension(ext);
      const defaultFramework = getDefaultFrameworkForExtension(ext);
      const draftsByFramework = generateDraftCodeMap(file, chunk, behaviour, scenarios);
      const unverifiedAssertionCount = scenarios.filter(
        (s) => s.verificationStatus === 'needs_manual_verification'
      ).length;

      const displayName = behaviour.parentClassName
        ? `${behaviour.parentClassName}.${chunk.symbolName}`
        : chunk.symbolName;

      const searchTags = splitIdentifierWords(`${displayName} ${file.path} ${behaviour.domainCategory}`).split(' ');

      candidateTargets.push({
        id: `test-target:${file.id}:${chunk.symbolType}:${chunk.symbolName}:${chunk.startLine}`,
        fileId: file.id,
        fileName: file.name,
        filePath: file.path,
        extension: ext,
        language: behaviour.language,
        symbolName: chunk.symbolName,
        symbolType: chunk.symbolType,
        displayName,
        targetKind: behaviour.targetKind,
        parentClassName: behaviour.parentClassName,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        lineSpan: behaviour.lineSpan,
        sourceSnippet: chunk.content,
        moduleId: behaviour.moduleId,
        moduleLabel: behaviour.moduleLabel,
        layerId: behaviour.layerId,
        layerLabel: behaviour.layerLabel,
        domainCategory: behaviour.domainCategory,
        importanceScore: importance.importanceScore,
        importanceTier: importance.importanceTier,
        importanceReasons: importance.importanceReasons,
        defaultFramework,
        supportedFrameworks,
        suggestedFilePath: generateSuggestedTestFilePath(file.path, defaultFramework),
        behaviour,
        scenarios,
        draftsByFramework,
        reviewMetadata: {
          initialStatus: 'pending_review',
          autoExecuted: false,
          requiresUserApproval: true,
          unverifiedAssertionCount,
        },
        searchTags: Array.from(new Set(searchTags.filter(Boolean))),
      });
    }
  }

  // Sort deterministically by importance desc, then filePath & line asc
  candidateTargets.sort(
    (a, b) =>
      b.importanceScore - a.importanceScore ||
      a.filePath.localeCompare(b.filePath) ||
      a.startLine - b.startLine ||
      a.id.localeCompare(b.id)
  );

  const targets = candidateTargets.slice(0, maxTargets);

  const byCategory = { normal: 0, edge: 0, failure: 0 };
  const byTier = { High: 0, Medium: 0, Standard: 0 };
  const byKind = {};
  const coveredModulesSet = new Set();
  const coveredFilesSet = new Set();
  let totalScenarios = 0;
  let unverifiedAssertionsCount = 0;

  for (const t of targets) {
    byTier[t.importanceTier] = (byTier[t.importanceTier] || 0) + 1;
    byKind[t.targetKind] = (byKind[t.targetKind] || 0) + 1;
    if (t.moduleLabel) coveredModulesSet.add(t.moduleLabel);
    if (t.filePath) coveredFilesSet.add(t.filePath);
    for (const sc of t.scenarios) {
      totalScenarios += 1;
      byCategory[sc.category] = (byCategory[sc.category] || 0) + 1;
      if (sc.verificationStatus === 'needs_manual_verification') {
        unverifiedAssertionsCount += 1;
      }
    }
  }

  const plan = {
    projectName,
    summary: {
      totalTargets: targets.length,
      totalScenarios,
      byCategory,
      byTier,
      byKind,
      coveredModules: Array.from(coveredModulesSet).sort(),
      coveredFiles: Array.from(coveredFilesSet).sort(),
      skippedTestFiles,
      unverifiedAssertionsCount,
    },
    targets,
    markdown: '',
  };

  plan.markdown = formatTestPlanMarkdown(plan);
  return plan;
}
