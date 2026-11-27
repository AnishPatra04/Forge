import { getFileExtension, getFileNameFromPath, getFilePath } from '../constants/fileTypes.js';
import { analyzeCodebaseArchitecture } from './architectureAnalyzer.js';
import { extractAstMetadata, isAstSupported, resolveFileDependencies } from './astParser.js';
import { chunkFile, splitIdentifierWords } from './codeChunker.js';

export const INTERVIEW_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

export const INTERVIEW_CATEGORIES = [
  'Functions & Logic',
  'Security & Auth',
  'API & Networking',
  'Data & Storage',
  'Error Handling & Edge Cases',
  'Architecture & Design',
  'Configuration & Ops',
];

const DIFFICULTY_RANK = { Easy: 0, Medium: 1, Hard: 2 };

const EMPTY_SUMMARY = {
  totalQuestions: 0,
  byDifficulty: { Easy: 0, Medium: 0, Hard: 0 },
  byCategory: {},
  coveredModules: [],
  coveredFiles: [],
};

/**
 * Ensures standalone callers passing raw file objects (without precomputed astMetadata
 * or dependencies) receive full normalized metadata without mutating original objects.
 */
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
      const id = file.id || `iv-file:${filePath}`;
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
        lineCount: file.lineCount || (typeof file.content === 'string' ? file.content.split('\n').length : 0),
        astMetadata,
      };
    });

  return needsEnrichment ? resolveFileDependencies(normalized) : normalized;
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
    case '.json':
      return 'JSON Config';
    case '.md':
      return 'Markdown';
    default:
      return extension ? extension.replace(/^\./, '').toUpperCase() : 'Source';
  }
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

function extractSignatureParams(chunkContent = '', symbolName = '', extension = '', symbolType = 'function') {
  const empty = { hasSignature: false, params: [], isConstructor: false };
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

  const params = splitTopLevelArgs(rawParams).filter((p) => {
    if (ext === '.py' && (p === 'self' || p === 'cls' || /^self\s*:/.test(p) || /^cls\s*:/.test(p))) {
      return false;
    }
    return true;
  });

  return { hasSignature: true, params, isConstructor };
}

function extractClassFields(chunkContent = '', extension = '') {
  if (!chunkContent) return [];
  const ext = (extension || '').toLowerCase();
  const fields = new Set();

  if (ext === '.py') {
    for (const m of chunkContent.matchAll(/\bself\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
      fields.add(m[1]);
    }
  } else {
    for (const m of chunkContent.matchAll(
      /(?:^|\n)\s*(?:private|public|protected)\s+(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::|=|;)/g
    )) {
      if (m[1] !== 'constructor') fields.add(m[1]);
    }
    for (const m of chunkContent.matchAll(/\bthis\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
      fields.add(m[1]);
    }
  }
  return Array.from(fields).slice(0, 6);
}

function getEnvMatches(text = '') {
  const vars = new Set();
  for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    vars.add(m[1]);
  }
  for (const m of text.matchAll(/os\.(?:getenv|environ\.get)\(\s*['"]([A-Z0-9_]+)['"]/g)) {
    vars.add(m[1]);
  }
  return Array.from(vars);
}

/**
 * Extracts strictly observed code patterns & metadata from a symbol chunk + parent file.
 */
function extractChunkSignals(chunk, file, moduleMeta) {
  const content = chunk.content || '';
  const lowerContent = content.toLowerCase();
  const pathLower = (file.path || '').toLowerCase();
  const symbolLower = (chunk.symbolName || '').toLowerCase();

  const externalImports = Array.from(
    new Set(
      (file.dependencies?.unresolved || [])
        .filter((u) => u && u.type === 'external' && u.source)
        .map((u) => u.source)
    )
  );
  const internalDeps = Array.from(
    new Set((file.dependencies?.resolved || []).map((r) => r.targetPath).filter(Boolean))
  );
  const callers = Array.from(
    new Set((file.importedBy || []).map((imp) => imp.sourcePath).filter(Boolean))
  );
  const exportedNames = (file.astMetadata?.exports || [])
    .map((e) => e.name)
    .filter((n) => n && n !== '*');

  const hasTryCatch = /\btry\s*[:{]|\bcatch\s*\(|\bexcept\b/.test(content);
  const returnsNullOnError =
    hasTryCatch && /\breturn\s+(null|None)\b/.test(content);
  const hasThrowOrRaise = /\bthrow\s+(?:new\s+)?[A-Za-z_]|\braise\b/.test(content);
  const hasValidationGuard =
    /\bif\s*\([^)]*(?:\.length\s*<|===?\s*null|===?\s*undefined)/.test(content) ||
    /\bif\s*\(\s*!(?!response\.ok\b|res\.ok\b)/.test(content) ||
    /\bif\s+not\s+[A-Za-z_]|isinstance\(|Objects\.requireNonNull/.test(content);
  const hasErrorLogging = /\b(?:console\.(?:error|warn)|logger\.(?:error|warn(?:ing)?|exception)|logging\.(?:error|warn(?:ing)?|exception))\b/.test(
    content
  );
  const returnsBooleanLiteral = /\breturn\s+(?:true|false|True|False)\b/.test(content);

  const hasRetryLoop =
    (/\b(?:for|while)\s*\(/.test(content) || /\bfor\s+\w+\s+in\s+range\b/.test(content)) &&
    /\b(?:retr(?:y|ies)|attempt|backoff)\b/i.test(content);
  const hasBackoffDelay =
    (/\b(?:Math\.pow|setTimeout|time\.sleep|Thread\.sleep)\b/.test(content) || /\*\*/.test(content)) &&
    /\b(?:delay|backoff|attempt|retry|wait)\b/i.test(content);
  const hasExponentialBackoff =
    (/\b(?:Math\.pow|<<)\b/.test(content) || /\*\*/.test(content)) && hasBackoffDelay;
  const hasJitter = /\b(?:Math\.random|random\.)\b/.test(content);
  const hasAbortTimeout = /\bAbortController\b|\btimeout\s*[:=]/i.test(content);
  const hasHttpClient = /\b(?:fetch|axios|requests|urllib|HttpClient|RestTemplate)\b/i.test(content);
  const hasStatus500Check = /status\s*>=\s*500|statusCode\s*>=\s*500/.test(content);
  const handlesResponseOk = /\bresponse\.ok\b/.test(content);
  const observedHttpMethods = Array.from(
    new Set(
      [
        ...(content.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\b/g) || []),
        ...((file.content || '').match(/method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/g) || []).map((m) =>
          m.replace(/.*['"](POST|PUT|PATCH|DELETE)['"].*/, '$1')
        ),
      ]
    )
  );
  const hasPostOrMutation = observedHttpMethods.some((m) => m !== 'GET');

  const normalizedContextText = splitIdentifierWords(
    `${chunk.symbolName || ''} ${file.path || ''} ${externalImports.join(' ')} ${content.replace(/\n/g, ' ')}`
  );
  const hasExplicitAuthToken = /\b(?:jwt|jose|sign jwt|jwt verify|bearer|tokens?|oauth|bcrypt|argon)\b/i.test(
    normalizedContextText
  );
  const hasAuthSession =
    /\bsessions?\b/i.test(normalizedContextText) &&
    /\b(?:auth|security|login|logout|credential|password|cookie|csrf|express session)\b/i.test(
      normalizedContextText
    );
  const hasAuthTokens = hasExplicitAuthToken || hasAuthSession;
  const secretLengthMatch = content.match(/secret[A-Za-z_]*\.length\s*<\s*(\d+)/i);
  const checksMissingSecret = /![A-Za-z_]*secret/i.test(content);
  const hasSecretValidation =
    /\b(?:secret|secretKey|signingKey|privateKey)\b/i.test(content) && hasValidationGuard;
  const hasRbacCheck =
    /\b(?:role|roles|permission|permissions|hasPermission|isAdmin|authorize|PreAuthorize)\b/.test(
      content
    ) && /===|==|\.includes\(|\.contains\(|\bin\b/.test(content);
  const checksAdminLiteral = /['"]admin['"]/.test(content);
  const checksRoleEquality = /\brole\s*===?/.test(content);
  const checksCollectionMembership = /\.(?:includes|contains)\(/.test(content);
  const authAlgoMatch = content.match(/\b(HS256|HS384|HS512|RS256|ES256|EdDSA)\b/);
  const hasIssuedAtClaim = /\b(?:iat|setIssuedAt|issuedAt)\b/.test(content);
  const hasExpirationClaim = /\b(?:exp|expiresIn|setExpirationTime|tokenExpiration|ttl)\b/i.test(content);
  const hasProtectedHeader = /\bsetProtectedHeader\b/.test(content);
  const observedTokenClaimFields = Array.from(
    new Set(content.match(/\b(?:sub|email|role|roles|permissions|scope|iss|aud)\b/g) || [])
  );

  const hasTransactionSignals =
    /@contextmanager|\bcommit\s*\(|\brollback\s*\(|\bfinally\s*[:{]|\bSessionLocal\b|\bPreparedStatement\b|@Transactional/.test(
      content
    );
  const hasDbPoolSignals =
    /\b(?:create_engine|pool_size|max_overflow|pool_pre_ping|DataSource|HikariConfig|Pool)\b/.test(
      content
    );
  const hasSelect1Sql = /\bSELECT\s+1\b/i.test(content);
  const hasConnectCall = /\bconnect\s*\(/.test(content);
  const hasHealthCheckSql =
    hasSelect1Sql ||
    (/\b(?:ping|health)\b/i.test(symbolLower) && /\b(?:connect|execute|query|ping)\b/i.test(content));

  const hasAsyncAwait = /\basync\b|\bawait\b|\bPromise\b|\bCompletableFuture\b/.test(content);
  const observedReactHooks = Array.from(
    new Set(content.match(/\b(?:useState|useEffect|useMemo|useCallback|useContext|useReducer)\b/g) || [])
  );
  const hasReactHooks = observedReactHooks.length > 0;
  const envVars = getEnvMatches(content);
  const hasEnvFallback =
    /process\.env\.[A-Z0-9_]+\s*\|\|\s*['"`]/.test(content) ||
    /os\.(?:getenv|environ\.get)\(\s*['"][A-Z0-9_]+['"]\s*,\s*['"]/.test(content);

  const isExported =
    Boolean(chunk.symbolName) &&
    (exportedNames.includes(chunk.symbolName) ||
      exportedNames.includes('default') ||
      file.extension === '.py' ||
      file.extension === '.java');

  const signatureInfo = extractSignatureParams(content, chunk.symbolName, file.extension, chunk.symbolType);
  const classFields = chunk.symbolType === 'class' ? extractClassFields(content, file.extension) : [];

  // Determine primary domain category from strictly observed context
  let domainCategory = 'Functions & Logic';
  if (hasAuthTokens || hasRbacCheck || /\b(auth|security|jwt|oauth)\b/.test(pathLower)) {
    domainCategory = 'Security & Auth';
  } else if (hasTransactionSignals || hasDbPoolSignals || /\b(db|database|storage|repo|store|model|schema)\b/.test(pathLower)) {
    domainCategory = 'Data & Storage';
  } else if (hasHttpClient || hasRetryLoop || /\b(api|client|http|fetch|service|controller|route)\b/.test(pathLower)) {
    domainCategory = 'API & Networking';
  } else if (hasEnvFallback || envVars.length > 0 || file.extension === '.json') {
    domainCategory = 'Configuration & Ops';
  } else if (hasTryCatch || hasThrowOrRaise) {
    domainCategory = 'Error Handling & Edge Cases';
  }

  return {
    language: getLanguageLabel(file.extension),
    lineSpan: Math.max(1, (chunk.endLine || chunk.startLine || 1) - (chunk.startLine || 1) + 1),
    params: signatureInfo.params,
    hasSignature: signatureInfo.hasSignature,
    isConstructor: signatureInfo.isConstructor,
    classFields,
    isExported,
    exportedNames,
    externalImports,
    internalDeps,
    callers,
    moduleLabel: moduleMeta?.label || 'Workspace Module',
    moduleId: moduleMeta?.id || null,
    layerId: moduleMeta?.layerId || 'domain_services',
    layerLabel: moduleMeta?.layerLabel || 'Services & Core Logic',
    hasTryCatch,
    returnsNullOnError,
    hasThrowOrRaise,
    hasValidationGuard,
    hasErrorLogging,
    returnsBooleanLiteral,
    hasRetryLoop,
    hasBackoffDelay,
    hasExponentialBackoff,
    hasJitter,
    hasAbortTimeout,
    hasHttpClient,
    hasStatus500Check,
    handlesResponseOk,
    observedHttpMethods,
    hasPostOrMutation,
    hasAuthTokens,
    secretMinLength: secretLengthMatch ? Number(secretLengthMatch[1]) : null,
    checksMissingSecret,
    hasSecretValidation,
    hasRbacCheck,
    checksAdminLiteral,
    checksRoleEquality,
    checksCollectionMembership,
    authAlgorithm: authAlgoMatch ? authAlgoMatch[1] : null,
    hasIssuedAtClaim,
    hasExpirationClaim,
    hasProtectedHeader,
    observedTokenClaimFields,
    hasTransactionSignals,
    hasDbPoolSignals,
    hasSelect1Sql,
    hasConnectCall,
    hasHealthCheckSql,
    hasAsyncAwait,
    observedReactHooks,
    hasReactHooks,
    envVars,
    hasEnvFallback,
    domainCategory,
    isLowerCaseOnlySnippet: lowerContent.length > 0,
  };
}

function buildExcerpt(content = '', maxLines = 10) {
  const lines = String(content || '').split('\n');
  const sliced = lines.slice(0, maxLines);
  return sliced.join('\n') + (lines.length > maxLines ? '\n// ...' : '');
}

function makeQuestionRecord({
  id,
  question,
  difficulty,
  category,
  scope,
  targetLabel,
  file,
  chunk,
  signals,
  suggestedAnswer,
  keyPoints = [],
  followUp = '',
  evidenceTags = [],
  priority = 50,
}) {
  return {
    id,
    question,
    difficulty,
    category,
    scope,
    targetLabel,
    moduleId: signals?.moduleId || null,
    moduleLabel: signals?.moduleLabel || 'Workspace',
    fileId: file?.id || null,
    filePath: file?.path || null,
    symbolName: chunk?.symbolName || null,
    startLine: chunk?.startLine || 1,
    endLine: chunk?.endLine || (file?.lineCount || 1),
    codeExcerpt: chunk ? buildExcerpt(chunk.content, 8) : null,
    suggestedAnswer,
    keyPoints: keyPoints.filter(Boolean),
    followUp,
    evidenceTags: Array.from(new Set(evidenceTags.filter(Boolean))),
    priority,
  };
}

function buildSignatureDescription(chunk, signals) {
  const { params = [], hasSignature, isConstructor, language } = signals;
  if (chunk.symbolType === 'class') {
    if (isConstructor && params.length > 0) {
      return {
        answerPhrase: `whose constructor accepts (${params.join(', ')})`,
        keyPoint: `Constructor parameters declared: ${params.join(', ')}.`,
      };
    }
    if (isConstructor && hasSignature) {
      return {
        answerPhrase: 'whose constructor declares no parameters',
        keyPoint: 'Constructor declares no parameters.',
      };
    }
    return {
      answerPhrase: `defining a ${language} class structure`,
      keyPoint: null,
    };
  }

  if (params.length > 0) {
    return {
      answerPhrase: `accepting (${params.join(', ')})`,
      keyPoint: `Parameters declared: ${params.join(', ')}.`,
    };
  }
  if (hasSignature) {
    return {
      answerPhrase: 'declaring no parameters',
      keyPoint: 'Declares no formal parameters in its signature.',
    };
  }
  return {
    answerPhrase: `defined in ${language}`,
    keyPoint: null,
  };
}

function buildObservedBehaviorSummary(chunk, signals) {
  const content = chunk.content || '';
  const tryLabel = (chunk.extension || '').toLowerCase() === '.py' ? 'try/except' : 'try/catch';
  const notes = [];

  if (signals.classFields?.length > 0) {
    notes.push(`initializes state field(s) [${signals.classFields.join(', ')}]`);
  }

  if (signals.hasValidationGuard) {
    const guardPieces = [];
    if (signals.checksMissingSecret) guardPieces.push('falsy/missing input check');
    if (signals.secretMinLength !== null) guardPieces.push(`minimum length >= ${signals.secretMinLength}`);
    const guardDetail = guardPieces.length > 0 ? ` (${guardPieces.join(', ')})` : '';
    notes.push(
      `enforces input validation guard(s)${guardDetail}${
        signals.hasThrowOrRaise ? ' and throws/raises an error on invalid input' : ''
      }`
    );
  } else if (signals.hasThrowOrRaise && !signals.hasRetryLoop) {
    notes.push('throws/raises explicit errors on invalid or failed states');
  }

  if (signals.returnsNullOnError) {
    const nullLit = chunk.extension === '.py' ? 'None' : 'null';
    notes.push(
      `wraps execution in \`${tryLabel}\`${signals.hasErrorLogging ? ' with error logging' : ''} and returns \`${nullLit}\` on failure`
    );
  } else if (signals.hasTryCatch && !signals.hasRetryLoop && !signals.hasTransactionSignals) {
    notes.push(`handles exceptions via \`${tryLabel}\`${signals.hasErrorLogging ? ' with warning/error logging' : ''}`);
  }

  if (signals.hasRetryLoop) {
    notes.push(
      `runs a bounded retry loop${signals.hasStatus500Check ? ' (retrying `status >= 500`)' : ''}${
        signals.hasBackoffDelay ? ' with backoff delays' : ''
      }${signals.hasThrowOrRaise ? ' before throwing on exhaustion' : ''}`
    );
  }

  if (signals.hasTransactionSignals) {
    const txOps = [
      /\bcommit\s*\(/.test(content) ? '`commit()`' : null,
      /\brollback\s*\(/.test(content) ? '`rollback()`' : null,
      /\bfinally\b/.test(content) && /\bclose\s*\(/.test(content) ? '`finally` `close()`' : null,
    ].filter(Boolean);
    notes.push(
      txOps.length > 0
        ? `manages database session boundaries (${txOps.join(', ')})`
        : 'manages transactional persistence boundaries'
    );
  }

  if (signals.hasSelect1Sql) {
    notes.push(
      `runs a \`SELECT 1\` connectivity check${
        signals.returnsBooleanLiteral ? ' and returns a boolean status' : ''
      }`
    );
  }

  if (signals.hasAuthTokens && (signals.authAlgorithm || signals.hasExpirationClaim || signals.hasIssuedAtClaim)) {
    const hasSignOrVerifyCall = /\b(?:SignJWT|jwtVerify|jwt\.sign|jwt\.verify)\b/.test(content);
    const authBits = [
      signals.authAlgorithm ? `\`${signals.authAlgorithm}\`` : null,
      signals.hasIssuedAtClaim ? 'issued-at claim' : null,
      signals.hasExpirationClaim ? 'expiration configuration' : null,
    ].filter(Boolean);
    if (hasSignOrVerifyCall || signals.authAlgorithm || signals.hasIssuedAtClaim) {
      notes.push(`configures token signing/verification with ${authBits.join(', ')}`);
    } else if (signals.hasExpirationClaim) {
      notes.push('declares token expiration configuration');
    }
  }

  if (signals.hasRbacCheck) {
    notes.push(
      `evaluates role${signals.checksAdminLiteral ? " (`'admin'` check)" : ''}${
        signals.checksCollectionMembership ? ' and permission membership' : ''
      }`
    );
  }

  return notes;
}

function synthesizeSymbolQuestions({ file, chunk, moduleMeta, fileInfo }) {
  const results = [];
  if (!chunk.symbolName || (chunk.symbolType !== 'function' && chunk.symbolType !== 'class')) {
    return results;
  }

  const signals = extractChunkSignals(chunk, file, moduleMeta);
  const sym = chunk.symbolName;
  const lineRef = `${file.path}:${chunk.startLine}-${chunk.endLine}`;
  const importanceBonus = Math.min(20, Math.round((fileInfo?.importanceScore || 0) * 3));
  const sigDesc = buildSignatureDescription(chunk, signals);
  const behaviorNotes = buildObservedBehaviorSummary(chunk, signals);

  // 1. EASY: Core Symbol Contract & Role (grounded in AST/chunk & imports)
  {
    const extNote =
      signals.externalImports.length > 0
        ? ` It relies on external package(s): ${signals.externalImports.join(', ')}.`
        : '';
    const callerNote =
      signals.callers.length > 0
        ? ` Within this workspace it is imported by ${signals.callers.slice(0, 3).join(', ')}.`
        : '';
    const behaviorSentence =
      behaviorNotes.length > 0 ? ` In this implementation, it ${behaviorNotes.join('; ')}.` : '';

    const keyPoints = [
      `Located at ${lineRef} (${signals.lineSpan} lines).`,
      sigDesc.keyPoint,
      chunk.symbolType === 'function'
        ? signals.hasAsyncAwait
          ? 'Executes asynchronously (async/Promise/await flow).'
          : 'Executes synchronously.'
        : signals.classFields?.length > 0
          ? `Declares/initializes class state: ${signals.classFields.join(', ')}.`
          : null,
      behaviorNotes.length > 0 ? `Observed behavior: ${behaviorNotes.join('; ')}.` : null,
      signals.externalImports.length > 0
        ? `Uses external dependencies: ${signals.externalImports.join(', ')}.`
        : 'Zero external package dependencies.',
    ].filter(Boolean);

    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:easy-role`,
        question: `Explain the role and input/output contract of \`${sym}\` in \`${file.path}\` (lines ${chunk.startLine}–${chunk.endLine}). How does it fit into the "${signals.moduleLabel}" component?`,
        difficulty: 'Easy',
        category: signals.domainCategory,
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `\`${sym}\` is a ${signals.language} ${chunk.symbolType} in \`${file.path}\` (${sigDesc.answerPhrase}) inside the ${signals.layerLabel} layer ("${signals.moduleLabel}").${behaviorSentence}${extNote}${callerNote}`,
        keyPoints,
        followUp:
          signals.callers.length > 0
            ? `If \`${sym}\` changes its return shape or error behavior, which callers (${signals.callers.slice(0, 2).join(', ')}) must be updated?`
            : `How would another module safely import and test \`${sym}\` in isolation?`,
        evidenceTags: [signals.language, chunk.symbolType, ...signals.externalImports.slice(0, 2)],
        priority: 48 + importanceBonus,
      })
    );
  }

  // 2. DOMAIN SPECIFIC: Auth & Security
  if (signals.hasAuthTokens || signals.hasRbacCheck || signals.hasSecretValidation) {
    if (signals.hasSecretValidation) {
      const ruleDetails = [
        signals.checksMissingSecret ? 'checking for missing/falsy secret input' : null,
        signals.secretMinLength !== null ? `enforcing minimum length (>= ${signals.secretMinLength})` : null,
        signals.hasThrowOrRaise ? 'throwing/raising an error on validation failure' : null,
      ].filter(Boolean);

      results.push(
        makeQuestionRecord({
          id: `q:${file.id}:${sym}:${chunk.startLine}:med-auth-secret`,
          question: `In \`${file.path}\` (\`${sym}\`, lines ${chunk.startLine}–${chunk.endLine}), why is secret validation enforced before initializing signing state?`,
          difficulty: 'Medium',
          category: 'Security & Auth',
          scope: 'symbol',
          targetLabel: sym,
          file,
          chunk,
          signals,
          suggestedAnswer: `Current implementation: \`${sym}\` validates the secret via guard condition(s) (${
            ruleDetails.length > 0 ? ruleDetails.join(', ') : 'explicit precondition check'
          }) at ${lineRef}. General best practice: failing fast during initialization catches misconfigured or weak secrets at startup before tokens are issued; in multi-instance setups, supporting versioned key IDs (\`kid\`) allows safer key rotation.`,
          keyPoints: [
            `Observed at ${lineRef}: ${ruleDetails.length > 0 ? ruleDetails.join(', ') : 'explicit secret guard check'}.`,
            'General best practice: fail-fast startup guards prevent silent misconfiguration during runtime auth.',
          ],
          followUp:
            'How would you support zero-downtime key rotation if signing and verification share a single static secret?',
          evidenceTags: ['Security', 'Fail-Fast Validation', ...signals.externalImports],
          priority: 72 + importanceBonus,
        })
      );
    } else if (signals.returnsNullOnError && signals.hasAuthTokens) {
      const returnTokenLabel = (file.extension || '').toLowerCase() === '.py' ? 'None' : 'null';
      results.push(
        makeQuestionRecord({
          id: `q:${file.id}:${sym}:${chunk.startLine}:med-auth-verify`,
          question: `In \`${file.path}\` (\`${sym}\`, lines ${chunk.startLine}–${chunk.endLine}), errors inside token verification are caught and converted into a \`${returnTokenLabel}\` return. What are the trade-offs of this design?`,
          difficulty: 'Medium',
          category: 'Security & Auth',
          scope: 'symbol',
          targetLabel: sym,
          file,
          chunk,
          signals,
          suggestedAnswer: `Current implementation: \`${sym}\` wraps verification in \`try/catch\`${
            signals.hasErrorLogging ? ', logs the error,' : ''
          } and returns \`${returnTokenLabel}\` on failure${
            signals.authAlgorithm ? ` while specifying algorithm \`${signals.authAlgorithm}\`` : ''
          }. General trade-off: returning \`${returnTokenLabel}\` keeps caller branching simple and avoids leaking verification internals to clients, while collapsing different failure reasons unless distinct error states or audit metrics are emitted separately.`,
          keyPoints: [
            `Observed at ${lineRef}: catches verification failures${signals.hasErrorLogging ? ', logs the error,' : ''} and returns ${returnTokenLabel}.`,
            signals.authAlgorithm
              ? `Observed algorithm constraint in code: ${signals.authAlgorithm}.`
              : 'Algorithm behavior depends on token verifier options passed in this scope.',
            'General trade-off: simplifies callers vs distinguishing expired tokens from invalid signatures.',
          ],
          followUp:
            'How would you let HTTP handlers distinguish an expired token from an invalid signature without exposing internal stack traces?',
          evidenceTags: ['JWT / Session', 'Error Handling', signals.authAlgorithm].filter(Boolean),
          priority: 82 + importanceBonus,
        })
      );

      results.push(
        makeQuestionRecord({
          id: `q:${file.id}:${sym}:${chunk.startLine}:hard-auth-design`,
          question: `Looking at authentication handling in \`${sym}\` (\`${file.path}\`), what scaling and security trade-offs arise if multiple services verify tokens issued here${
            signals.authAlgorithm ? ` (currently configured with \`${signals.authAlgorithm}\`)` : ''
          }?`,
          difficulty: 'Hard',
          category: 'Security & Auth',
          scope: 'symbol',
          targetLabel: sym,
          file,
          chunk,
          signals,
          suggestedAnswer: `Current implementation: \`${sym}\` handles token logic locally in \`${file.path}\`${
            signals.authAlgorithm ? ` using \`${signals.authAlgorithm}\`` : ''
          }${signals.externalImports.length > 0 ? ` via ${signals.externalImports.join(', ')}` : ''}. Architecture improvement for multi-service scaling: ${
            signals.authAlgorithm?.startsWith('HS')
              ? `because \`${signals.authAlgorithm}\` shares one symmetric secret across issuers and verifiers, every validating service must hold the signing key; asymmetric keys (e.g., RS256/EdDSA with public JWKS) isolate signing authority. `
              : 'distributing verification-only public keys separately from signing keys limits secret exposure. '
          }Additionally, stateless tokens remain valid until expiration unless paired with revocation checks or short TTL + refresh flows.`,
          keyPoints: [
            signals.authAlgorithm
              ? `Observed signing algorithm in code: ${signals.authAlgorithm}.`
              : 'Uses token verification/auth libraries observed in this module.',
            'Recommended consideration: isolate signing keys from verification-only services where applicable.',
            'Recommended consideration: plan token revocation/TTL handling if sessions must be invalidated immediately.',
          ],
          followUp:
            'How would you implement immediate session revocation upon password reset or compromised token detection?',
          evidenceTags: ['Distributed Auth', 'Key Rotation', signals.authAlgorithm].filter(Boolean),
          priority: 86 + importanceBonus,
        })
      );
    } else if (signals.hasRbacCheck) {
      const observedRbacParts = [
        signals.checksRoleEquality ? 'direct role comparison' : null,
        signals.checksAdminLiteral ? "checks for `'admin'`" : null,
        signals.checksCollectionMembership ? 'collection membership lookup (`includes`/`contains`)' : null,
      ].filter(Boolean);

      results.push(
        makeQuestionRecord({
          id: `q:${file.id}:${sym}:${chunk.startLine}:hard-auth-rbac`,
          question: `In \`${file.path}\` (\`${sym}\`, lines ${chunk.startLine}–${chunk.endLine}), authorization checks roles and/or permissions inline. What maintainability and security trade-offs does this approach have as permissions evolve?`,
          difficulty: 'Hard',
          category: 'Security & Auth',
          scope: 'symbol',
          targetLabel: sym,
          file,
          chunk,
          signals,
          suggestedAnswer: `Current implementation: \`${sym}\` evaluates authorization directly at ${lineRef} using ${
            observedRbacParts.length > 0 ? observedRbacParts.join(', ') : 'inline role/permission checks'
          }. General improvement: keeping authorization rules hardcoded in procedural branches couples policy changes to code deployments; separating roles into explicit policy mappings and pairing global capability checks with resource-level ownership checks improves auditability.`,
          keyPoints: [
            `Observed at ${lineRef}: ${observedRbacParts.length > 0 ? observedRbacParts.join(', ') : 'inline authorization check'}.`,
            'Recommended improvement: decouple policy definitions from procedural conditionals and enforce resource ownership where needed.',
          ],
          followUp:
            'How could you support organization-scoped or resource-specific permissions without rewriting every caller?',
          evidenceTags: ['RBAC', 'Authorization'],
          priority: 78 + importanceBonus,
        })
      );
    } else if (signals.hasAuthTokens) {
      const observedTokenDetails = [
        signals.authAlgorithm ? `algorithm \`${signals.authAlgorithm}\`` : null,
        signals.hasProtectedHeader ? 'protected header setup' : null,
        signals.hasIssuedAtClaim ? 'issued-at (`iat`) setup' : null,
        signals.hasExpirationClaim ? 'expiration config/claim' : null,
        signals.observedTokenClaimFields.length > 0
          ? `claim/field reference(s): ${signals.observedTokenClaimFields.join(', ')}`
          : null,
      ].filter(Boolean);

      results.push(
        makeQuestionRecord({
          id: `q:${file.id}:${sym}:${chunk.startLine}:med-auth-token`,
          question: `How does \`${sym}\` in \`${file.path}\` (lines ${chunk.startLine}–${chunk.endLine}) construct or inspect token/session state, and what security properties depend on those fields?`,
          difficulty: 'Medium',
          category: 'Security & Auth',
          scope: 'symbol',
          targetLabel: sym,
          file,
          chunk,
          signals,
          suggestedAnswer: `Current implementation: \`${sym}\` manages token/session logic${
            signals.externalImports.length > 0 ? ` using ${signals.externalImports.join(', ')}` : ''
          }${observedTokenDetails.length > 0 ? ` with ${observedTokenDetails.join(', ')}` : ''}. General best practice: keep sensitive secrets out of encoded token payloads, enforce explicit expiration windows, and pin expected signing algorithms during verification.`,
          keyPoints: [
            observedTokenDetails.length > 0
              ? `Observed in code at ${lineRef}: ${observedTokenDetails.join(', ')}.`
              : `Observed token/session handling at ${lineRef}.`,
            'General best practice: token payloads are readable by holders unless encrypted (JWE), so avoid sensitive secrets in claims.',
          ],
          followUp:
            'If a user’s role or permissions change before token expiration, how would existing tokens behave?',
          evidenceTags: ['Tokens', ...signals.externalImports],
          priority: 74 + importanceBonus,
        })
      );
    }
  }

  // 3. DOMAIN SPECIFIC: API & Networking (Retries, Backoff, Error Statuses)
  if (signals.hasRetryLoop || (signals.hasHttpClient && (signals.hasStatus500Check || signals.hasBackoffDelay))) {
    const observedRetryDetails = [
      'retry attempt loop',
      signals.hasStatus500Check ? 'status >= 500 check before retrying' : null,
      signals.handlesResponseOk ? '`response.ok` validation' : null,
      signals.hasExponentialBackoff
        ? 'exponential backoff calculation'
        : signals.hasBackoffDelay
          ? 'delay/sleep between attempts'
          : null,
      signals.hasTryCatch ? 'exception catching inside retry flow' : null,
      signals.hasThrowOrRaise ? 'explicit throw/raise on failure' : null,
    ].filter(Boolean);

    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:med-api-retry`,
        question: `In \`${file.path}\` (\`${sym}\`, lines ${chunk.startLine}–${chunk.endLine}), how does the retry implementation handle failures and wait timing across attempts?`,
        difficulty: 'Medium',
        category: 'API & Networking',
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `Current implementation: \`${sym}\` implements ${observedRetryDetails.join(', ')} at ${lineRef}. General engineering consideration: retrying only transient failures (${
          signals.hasStatus500Check ? 'as done with `status >= 500` here' : 'such as 5xx responses or transient transport errors'
        }) avoids repeating deterministic 4xx client errors, while backoff delays reduce load spikes on upstream services.`,
        keyPoints: [
          `Observed at ${lineRef}: ${observedRetryDetails.join(', ')}.`,
          signals.hasStatus500Check
            ? 'Explicitly gates server-status retries on `status >= 500`.'
            : 'Does not explicitly inspect HTTP status >= 500 inside this chunk — retries depend on exception/control flow.',
          'General consideration: separating transient vs permanent errors avoids wasted retries.',
        ],
        followUp:
          signals.hasJitter
            ? 'How does jitter inside retry waits prevent synchronized client retries?'
            : 'Why can deterministic backoff without random jitter still cause synchronized traffic spikes ("thundering herd") during an outage?',
        evidenceTags: ['Retries', 'Backoff', 'HTTP Client'],
        priority: 80 + importanceBonus,
      })
    );

    const mutationNote =
      signals.observedHttpMethods.length > 0 && signals.hasPostOrMutation
        ? ` (${signals.observedHttpMethods.filter((m) => m !== 'GET').join('/')} method usage observed in this file)`
        : '';

    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:hard-api-idempotency`,
        question: `Inspecting the HTTP retry behavior in \`${file.path}\` around \`${sym}\`, what operational risks arise on retries${mutationNote}, and what improvements would harden it for production?`,
        difficulty: 'Hard',
        category: 'API & Networking',
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `Current implementation: \`${sym}\` executes bounded retry attempts${
          signals.hasPostOrMutation ? ` alongside non-idempotent request usage${mutationNote}` : ''
        }${signals.hasJitter ? ' with randomness' : ' without jitter observed in this chunk'}${
          signals.hasAbortTimeout ? ' and timeout configuration' : ' and without an explicit request timeout observed in this chunk'
        }. Recommended improvements: limit automatic retries to idempotent methods or require \`Idempotency-Key\` headers on mutations, add jitter to backoff delays to avoid thundering herds, and enforce per-attempt request timeouts (e.g., \`AbortController\` / HTTP client timeout) so hung connections do not compound latency across retries.`,
        keyPoints: [
          signals.hasPostOrMutation
            ? `Observed non-GET request usage in file (${signals.observedHttpMethods.filter((m) => m !== 'GET').join(', ')}) sharing client retry boundaries.`
            : 'Current code does not restrict which HTTP verbs invoke this retry helper.',
          signals.hasAbortTimeout
            ? 'Timeout configuration is present in the chunk.'
            : 'Recommended addition: explicit per-request timeout bounds are not currently observed here.',
          signals.hasJitter
            ? 'Jitter behavior present in wait calculation.'
            : 'Recommended addition: random jitter is not currently observed in backoff waits.',
        ],
        followUp:
          'How would you coordinate `Idempotency-Key` semantics between client retries and server handlers?',
        evidenceTags: ['Idempotency', 'Resilience', 'Timeouts'],
        priority: 84 + importanceBonus,
      })
    );
  }

  // 4. DOMAIN SPECIFIC: Data & Storage (Transactions, Context Managers, Pools, Health Checks)
  if (signals.hasTransactionSignals) {
    const hasCommit = /\bcommit\s*\(/.test(chunk.content || '');
    const hasRollback = /\brollback\s*\(/.test(chunk.content || '');
    const hasFinallyClose = /\bfinally\b/.test(chunk.content || '') && /\bclose\s*\(/.test(chunk.content || '');
    const hasCtxMgr = /@contextmanager|\bwith\s+/.test(chunk.content || '');
    const observedSteps = [
      hasCtxMgr ? 'context-managed session scoping' : null,
      hasCommit ? '`commit()` on success' : null,
      hasRollback ? '`rollback()` on exception' : null,
      hasFinallyClose ? '`finally` cleanup calling `close()`' : null,
    ].filter(Boolean);

    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:med-db-tx`,
        question: `Trace the execution paths of \`${sym}\` in \`${file.path}\` (lines ${chunk.startLine}–${chunk.endLine}). How does it manage persistence state and cleanup?`,
        difficulty: 'Medium',
        category: 'Data & Storage',
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `Current implementation: \`${sym}\` manages database resources at ${lineRef} using ${
          observedSteps.length > 0 ? observedSteps.join(', ') : 'transactional constructs'
        }${signals.externalImports.length > 0 ? ` (${signals.externalImports.join(', ')})` : ''}. General persistence principle: separating normal commit completion from error rollback and deterministic session closing prevents partial commits and connection leaks when exceptions occur.`,
        keyPoints: [
          `Observed at ${lineRef}: ${observedSteps.length > 0 ? observedSteps.join(', ') : 'transaction construct present'}.`,
          hasRollback
            ? 'Explicitly rolls back on failure.'
            : 'Recommended consideration: ensure callers/wrappers roll back uncommitted writes if exceptions are raised.',
          hasFinallyClose
            ? 'Unconditional `finally` block closes the session.'
            : 'General best practice: ensure session handles are always returned/closed on failure paths.',
        ],
        followUp: hasRollback
          ? 'Why is re-raising exceptions after `rollback()` important when callers depend on transaction outcomes?'
          : `How would exceptions inside \`${sym}\` propagate and affect callers holding the transaction?`,
        evidenceTags: ['Transactions', 'Resource Cleanup', ...signals.externalImports],
        priority: 82 + importanceBonus,
      })
    );
  }

  if (signals.hasHealthCheckSql) {
    const tryLabel = (file.extension || '').toLowerCase() === '.py' ? 'try/except' : 'try/catch';
    const observedHealthDetails = [
      signals.hasConnectCall ? 'opens a database connection' : null,
      signals.hasSelect1Sql ? 'executes `SELECT 1`' : 'executes a lightweight query/ping',
      signals.hasTryCatch ? `wraps execution in \`${tryLabel}\`` : null,
      signals.hasErrorLogging ? 'logs diagnostic warnings/errors on failure' : null,
      signals.returnsBooleanLiteral ? 'returns boolean success/failure status' : null,
    ].filter(Boolean);

    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:hard-db-health`,
        question: `In \`${file.path}\` (\`${sym}\`, lines ${chunk.startLine}–${chunk.endLine}), what does the database check verify today, and how should health checks be designed under heavy pool load?`,
        difficulty: 'Hard',
        category: 'Data & Storage',
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `Current implementation: at ${lineRef}, \`${sym}\` ${
          observedHealthDetails.length > 0 ? observedHealthDetails.join(', ') : 'performs a database connectivity check'
        }. Operational trade-off / improvement: probes that acquire pooled connections and execute queries verify live DB connectivity, but under pool saturation they can wait behind normal traffic unless bounded by strict timeouts and separated from container liveness probes (process alive vs dependency ready).`,
        keyPoints: [
          `Observed at ${lineRef}: ${observedHealthDetails.join(', ')}.`,
          signals.returnsBooleanLiteral && signals.hasTryCatch
            ? 'Converts exceptions into boolean return status.'
            : 'Check behavior depends on how callers handle returned values or raised exceptions.',
          'Operational best practice: bound probe timeouts and separate liveness from DB readiness checks.',
        ],
        followUp: signals.externalImports.includes('sqlalchemy')
          ? 'Why do newer SQLAlchemy versions require `text("SELECT 1")` rather than passing a plain SQL string directly to `execute(...)`?'
          : `What failure conditions should cause \`${sym}\` to fail fast rather than wait on pool acquisition?`,
        evidenceTags: ['Health Checks', 'Connection Pool'],
        priority: 76 + importanceBonus,
      })
    );
  }

  // 5. GENERAL FALLBACK: Error Handling / Edge Cases or UI Hooks when specialized domain rules didn't add Medium/Hard
  const hasDomainMedium = results.some((q) => q.difficulty === 'Medium');
  const hasHealthCheckQuestion = results.some((q) => q.id.endsWith(':hard-db-health'));
  if (!hasDomainMedium && !hasHealthCheckQuestion && (signals.hasTryCatch || signals.hasThrowOrRaise || signals.hasValidationGuard)) {
    const tryLabel = (file.extension || '').toLowerCase() === '.py' ? 'try/except' : 'try/catch';
    const fallbackOutcome = signals.hasThrowOrRaise
      ? 'propagates explicit errors to callers'
      : signals.returnsNullOnError || signals.returnsBooleanLiteral
        ? 'returns a fallback value without throwing'
        : 'handles errors locally';

    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:med-errors`,
        question: `How does \`${sym}\` in \`${file.path}\` (lines ${chunk.startLine}–${chunk.endLine}) handle invalid inputs or exceptions, and what happens for callers on failure?`,
        difficulty: 'Medium',
        category: 'Error Handling & Edge Cases',
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `Current implementation: \`${sym}\` includes ${[
          signals.hasValidationGuard ? 'precondition guard check(s)' : '',
          signals.hasTryCatch ? `local \`${tryLabel}\` error handling` : '',
          signals.hasThrowOrRaise ? 'explicit error throwing/raising' : '',
          signals.hasErrorLogging ? 'diagnostic warning/error logging' : '',
        ]
          .filter(Boolean)
          .join(', ')} at ${lineRef} and ${fallbackOutcome}. Design consideration: ensure upstream callers check for those exact failure signals consistently.`,
        keyPoints: [
          signals.hasValidationGuard ? 'Observed precondition validation before core work.' : null,
          signals.hasTryCatch ? `Observed local ${tryLabel} exception block.` : null,
          signals.hasThrowOrRaise ? 'Observed explicit error throwing/raising.' : null,
          signals.hasErrorLogging ? 'Observed warning/error logging on failure.' : null,
        ],
        followUp:
          `What unit test cases would cover every failure branch inside \`${sym}\`?`,
        evidenceTags: ['Error Handling', signals.language],
        priority: 60 + importanceBonus,
      })
    );
  } else if (!hasDomainMedium && signals.hasReactHooks) {
    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:med-react-hooks`,
        question: `In React component/hook \`${sym}\` (\`${file.path}\`, lines ${chunk.startLine}–${chunk.endLine}), which hooks are used and how do they affect rendering and state consistency?`,
        difficulty: 'Medium',
        category: 'Functions & Logic',
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `Current implementation: \`${sym}\` uses [${signals.observedReactHooks.join(', ')}] at ${lineRef}. General React best practice: keeping hook order unconditional, dependency arrays accurate, and expensive derived calculations isolated avoids stale closures or redundant re-renders.`,
        keyPoints: [
          `Observed hooks in code: ${signals.observedReactHooks.join(', ')}.`,
          'General best practice: verify dependency arrays and cleanup behavior for side effects.',
        ],
        followUp:
          `Which state updates in \`${sym}\` could trigger unnecessary child re-renders if left unmemoized?`,
        evidenceTags: ['React', 'Hooks'],
        priority: 62 + importanceBonus,
      })
    );
  } else if (!hasDomainMedium && signals.lineSpan >= 18) {
    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:${sym}:${chunk.startLine}:med-complexity`,
        question: `Walk through the control flow and potential edge cases of \`${sym}\` in \`${file.path}\` (lines ${chunk.startLine}–${chunk.endLine}, ${signals.lineSpan} lines). How could it be decomposed or tested cleanly?`,
        difficulty: 'Medium',
        category: signals.domainCategory,
        scope: 'symbol',
        targetLabel: sym,
        file,
        chunk,
        signals,
        suggestedAnswer: `Current implementation: \`${sym}\` spans ${signals.lineSpan} lines in \`${file.path}\` (${sigDesc.answerPhrase})${
          behaviorNotes.length > 0 ? ` and ${behaviorNotes.join('; ')}` : ''
        } with ${
          signals.externalImports.length > 0 ? `external package usage (${signals.externalImports.join(', ')})` : 'no external package dependencies'
        }. General testing approach: isolating pure logic from stateful/external boundaries makes unit testing straightforward.`,
        keyPoints: [
          `Observed at ${lineRef}: ${signals.lineSpan} lines in ${signals.language}.`,
          signals.externalImports.length > 0
            ? `External dependencies referenced in file: ${signals.externalImports.join(', ')}.`
            : 'Self-contained logic without external package dependencies.',
        ],
        followUp:
          `Which boundary inputs would be most likely to expose subtle edge-case bugs in \`${sym}\`?`,
        evidenceTags: [signals.language, 'Control Flow'],
        priority: 52 + importanceBonus,
      })
    );
  }

  return results;
}

function synthesizeFileConfigQuestions({ file, moduleMeta, fileInfo }) {
  const results = [];
  const content = file.content || '';
  const envVars = getEnvMatches(content);
  const externalImports = Array.from(
    new Set(
      (file.dependencies?.unresolved || [])
        .filter((u) => u && u.type === 'external' && u.source)
        .map((u) => u.source)
    )
  );
  const baseSignals = {
    moduleId: moduleMeta?.id || null,
    moduleLabel: moduleMeta?.label || 'Configuration',
  };

  // Module-level DB pool / engine config
  const hasPoolAtTop = /\b(?:create_engine|pool_size|max_overflow|pool_pre_ping|DataSource|HikariConfig)\b/.test(content);
  if (hasPoolAtTop) {
    const poolMatch = content.match(/pool_size\s*=\s*(\d+)/);
    const overflowMatch = content.match(/max_overflow\s*=\s*(\d+)/);
    const hasPrePing = /pool_pre_ping\s*=\s*True/.test(content);
    const observedPoolSettings = [
      poolMatch ? `\`pool_size=${poolMatch[1]}\`` : null,
      overflowMatch ? `\`max_overflow=${overflowMatch[1]}\`` : null,
      hasPrePing ? '`pool_pre_ping=True`' : null,
    ].filter(Boolean);

    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:top:db-pool`,
        question: `In \`${file.path}\`, database engine/pool settings are configured at module level${observedPoolSettings.length > 0 ? ` (${observedPoolSettings.join(', ')})` : ''}. Why do these settings matter under concurrent load?`,
        difficulty: 'Hard',
        category: 'Data & Storage',
        scope: 'file',
        targetLabel: file.path,
        file,
        chunk: { startLine: 1, endLine: Math.min(file.lineCount || 30, 35), content },
        signals: baseSignals,
        suggestedAnswer: `Current implementation: \`${file.path}\` initializes the database pool/engine at module scope${
          observedPoolSettings.length > 0 ? ` with ${observedPoolSettings.join(', ')}` : ''
        }. Scaling consideration: each application worker/process maintains its own pool, so total potential connections scale with worker count and must fit within the database server's connection capacity${
          hasPrePing ? '; `pool_pre_ping=True` validates idle/dropped sockets before issuing queries' : ''
        }.`,
        keyPoints: [
          observedPoolSettings.length > 0
            ? `Observed pool configuration: ${observedPoolSettings.join(', ')}.`
            : 'Engine/pool initialized at module scope.',
          hasPrePing ? '`pool_pre_ping=True` tests sockets before query reuse.' : 'Verify stale-connection validation across restarts.',
          'Scaling note: budget total pool connections across all worker processes/instances.',
        ],
        followUp:
          'What happens to incoming requests when all pooled + overflow connections are simultaneously busy?',
        evidenceTags: ['Connection Pool', 'Concurrency', ...externalImports],
        priority: 81,
      })
    );
  }

  // Env var / hardcoded fallback credentials
  const hasEnvFallback =
    /process\.env\.[A-Z0-9_]+\s*\|\|\s*['"`]/.test(content) ||
    /os\.(?:getenv|environ\.get)\(\s*['"][A-Z0-9_]+['"]\s*,\s*['"]/.test(content);
  if (envVars.length > 0 && hasEnvFallback) {
    results.push(
      makeQuestionRecord({
        id: `q:${file.id}:top:env-fallback`,
        question: `\`${file.path}\` reads environment variable(s) (${envVars.map((v) => `\`${v}\``).join(', ')}) with inline fallback string defaults. What risks does that introduce between local dev and production?`,
        difficulty: 'Medium',
        category: 'Configuration & Ops',
        scope: 'file',
        targetLabel: file.path,
        file,
        chunk: { startLine: 1, endLine: Math.min(file.lineCount || 25, 25), content },
        signals: baseSignals,
        suggestedAnswer: `Current implementation: \`${file.path}\` reads ${envVars.join(', ')} with inline default fallback strings. General trade-off / improvement: inline defaults ease local setup, whereas in production they can mask missing env variables or expose non-prod credentials; validating required variables at startup in production avoids silent misconfiguration.`,
        keyPoints: [
          `Observed env var lookup(s) with inline defaults: ${envVars.join(', ')}.`,
          'General best practice: fail fast in production if required environment secrets/URLs are unset.',
        ],
        followUp:
          'How can you keep zero-config ergonomics locally while still guaranteeing production fails fast if an env var is missing?',
        evidenceTags: ['12-Factor Config', 'Environment Variables'],
        priority: 68 + Math.round((fileInfo?.importanceScore || 0) * 2),
      })
    );
  }

  // JSON config inspection (strictly grounded in parsed keys)
  if ((file.extension || '').toLowerCase() === '.json') {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const topKeys = Object.keys(parsed).slice(0, 6);
        if (topKeys.length > 0) {
          const hasDeps = Boolean(parsed.dependencies || parsed.devDependencies);
          results.push(
            makeQuestionRecord({
              id: `q:${file.id}:json:config`,
              question: hasDeps
                ? `Reviewing \`${file.path}\` (keys: ${topKeys.map((k) => `\`${k}\``).join(', ')}), how do its declared dependency groups shape build and runtime boundaries?`
                : `Looking at \`${file.path}\` (top-level keys: ${topKeys.map((k) => `\`${k}\``).join(', ')}), why centralize these settings in configuration rather than hardcoding them inside modules?`,
              difficulty: 'Easy',
              category: 'Configuration & Ops',
              scope: 'file',
              targetLabel: file.path,
              file,
              chunk: { startLine: 1, endLine: Math.min(file.lineCount || 30, 30), content },
              signals: baseSignals,
              suggestedAnswer: hasDeps
                ? `Current implementation: \`${file.path}\` defines manifest keys [${topKeys.join(', ')}]. General practice: separating runtime \`dependencies\` from build-time \`devDependencies\` keeps production installs smaller and clarifies runtime supply-chain scope.`
                : `Current implementation: \`${file.path}\` organizes declarative settings under keys [${topKeys.join(', ')}]. General practice: centralizing configuration keys outside application logic avoids duplicated constants and makes startup schema validation easier.`,
              keyPoints: [
                `Observed top-level keys in ${file.path}: ${topKeys.join(', ')}.`,
                hasDeps
                  ? 'Separates declared package dependencies cleanly in manifest.'
                  : 'Recommended practice: validate required config keys at application startup.',
              ],
              followUp:
                `How should application code validate \`${file.path}\` at startup if an expected key is missing or malformed?`,
              evidenceTags: ['Config', 'JSON'],
              priority: 44,
            })
          );
        }
      }
    } catch {
      // Ignore malformed JSON gracefully
    }
  }

  return results;
}

function synthesizeArchitectureQuestions({ archModel, fileById }) {
  const results = [];
  const { modules = [], externalDependencies = [], highlights = {}, moduleEdges = [] } = archModel || {};
  const cycles = highlights?.cycles || { fileCycles: [], moduleCycles: [] };

  // 1. Core Hubs (high fan-in files)
  for (const hub of (highlights.coreHubs || []).slice(0, 2)) {
    const rawFile = fileById.get(hub.fileId);
    const mod = modules.find((m) => m.id === hub.moduleId);
    const modLabel = mod?.label || 'Core Module';
    results.push(
      makeQuestionRecord({
        id: `q:arch:hub:${hub.fileId}`,
        question: `\`${hub.filePath}\` (in module "${modLabel}") acts as a core hub with ${hub.inDegree} internal dependent(s) and ${hub.outDegree} outgoing import(s). Why must changes to its public interface be managed carefully?`,
        difficulty: 'Medium',
        category: 'Architecture & Design',
        scope: 'module',
        targetLabel: hub.filePath,
        file: rawFile || { id: hub.fileId, path: hub.filePath, lineCount: 1 },
        chunk: null,
        signals: { moduleId: hub.moduleId, moduleLabel: modLabel },
        suggestedAnswer: `Current implementation: ${hub.inDegree} workspace file(s) import \`${hub.filePath}\` (outgoing imports: ${hub.outDegree}, importance score ${hub.importanceScore}). Recommended practice: keep high fan-in interfaces narrow, backward-compatible, and well covered by unit/contract tests so upstream changes do not break dependent files.`,
        keyPoints: [
          `Observed dependents: ${hub.inDegree}; observed outgoing internal imports: ${hub.outDegree}.`,
          'Recommended practice: maintain stable public signatures on high fan-in modules.',
        ],
        followUp:
          `When would you split \`${hub.filePath}\` into smaller cohesive modules vs keeping it unified?`,
        evidenceTags: ['Core Hub', 'Coupling', modLabel],
        priority: 79,
      })
    );
  }

  // 2. Entry Points (orchestration & flow)
  for (const ep of (highlights.entryPoints || []).slice(0, 2)) {
    const rawFile = fileById.get(ep.fileId);
    const mod = modules.find((m) => m.id === ep.moduleId);
    const modLabel = mod?.label || 'Entry Module';
    results.push(
      makeQuestionRecord({
        id: `q:arch:entry:${ep.fileId}`,
        question: `Walk through how control and dependencies flow outward from entry point \`${ep.filePath}\` (module "${modLabel}", ${ep.outDegree} direct internal dependency link(s)).`,
        difficulty: 'Easy',
        category: 'Architecture & Design',
        scope: 'module',
        targetLabel: ep.filePath,
        file: rawFile || { id: ep.fileId, path: ep.filePath, lineCount: 1 },
        chunk: null,
        signals: { moduleId: ep.moduleId, moduleLabel: modLabel },
        suggestedAnswer: `Current implementation: \`${ep.filePath}\` sits in "${modLabel}" (${mod?.layerLabel || 'Entry'} layer) with ${ep.outDegree} outgoing internal import(s). Recommended architecture practice: keep entry points focused on orchestration and delegate business rules and persistence to downstream service/data modules.`,
        keyPoints: [
          `Observed in layer ${mod?.layerLabel || 'Entry'}: ${ep.outDegree} outgoing internal import(s).`,
          'Recommended practice: keep dependency flow unidirectional from entry points into services/data.',
        ],
        followUp:
          `How should initialization or configuration errors be surfaced when \`${ep.filePath}\` boots?`,
        evidenceTags: ['Entry Point', 'Dependency Flow'],
        priority: 64,
      })
    );
  }

  // 3. Circular Dependencies (when actually detected)
  const moduleCycleList = cycles.moduleCycles || [];
  const fileCycleList = cycles.fileCycles || [];
  if (moduleCycleList.length > 0) {
    const comp = moduleCycleList[0];
    const chain = comp.map((c) => c.label).join(' ↔ ');
    const anchorMod = modules.find((m) => m.id === comp[0]?.moduleId);
    const anchorFile = anchorMod?.files?.[0] ? fileById.get(anchorMod.files[0].fileId) : null;
    results.push(
      makeQuestionRecord({
        id: `q:arch:cycle:mod:${comp.map((c) => c.moduleId).join('-')}`,
        question: `Architecture analysis detected a circular module dependency between [${chain}]. Why are cyclic module dependencies problematic, and how would you refactor the code to break this cycle?`,
        difficulty: 'Hard',
        category: 'Architecture & Design',
        scope: 'architecture',
        targetLabel: chain,
        file: anchorFile || { id: null, path: comp[0]?.label || 'Cycle', lineCount: 1 },
        chunk: null,
        signals: { moduleId: comp[0]?.moduleId || null, moduleLabel: comp[0]?.label || 'Architecture' },
        suggestedAnswer: `Current implementation: static import resolution found a bidirectional module cycle across [${chain}]. Refactoring approach: cycles increase coupling and can cause module initialization-order hazards; extract shared types/contracts into an acyclic leaf module or apply Dependency Inversion (callbacks/events) to break the loop.`,
        keyPoints: [
          `Detected module cycle: ${chain}.`,
          'Hazards: initialization-order bugs, harder tree-shaking, coupled test setups.',
          'Fixes: extract shared contracts module, invert control via interfaces/events.',
        ],
        followUp:
          'Which concrete interface or shared data type would you extract first to make dependency direction strictly acyclic?',
        evidenceTags: ['Circular Dependency', 'Refactoring'],
        priority: 92,
      })
    );
  } else if (fileCycleList.length > 0) {
    const comp = fileCycleList[0];
    const chain = comp.map((c) => c.filePath).join(' ↔ ');
    const anchorFile = fileById.get(comp[0]?.fileId);
    results.push(
      makeQuestionRecord({
        id: `q:arch:cycle:file:${comp.map((c) => c.fileId).join('-')}`,
        question: `Static dependency analysis flagged a circular file dependency between [${chain}]. What runtime bugs can file cycles cause, and how do you eliminate them cleanly?`,
        difficulty: 'Hard',
        category: 'Architecture & Design',
        scope: 'architecture',
        targetLabel: chain,
        file: anchorFile || { id: comp[0]?.fileId, path: comp[0]?.filePath, lineCount: 1 },
        chunk: null,
        signals: { moduleId: null, moduleLabel: 'Architecture' },
        suggestedAnswer: `Current implementation: static import resolution flagged a file cycle across [${chain}]. Refactoring approach: mutual file imports can cause partially evaluated exports depending on module evaluation order; extract shared utilities/types into a separate dependency-free module.`,
        keyPoints: [
          `Detected file cycle: ${chain}.`,
          'Can cause partial-export / TDZ initialization failures depending on import order.',
        ],
        followUp:
          'How could automated lint rules (such as import cycle checks in CI) prevent cycles from re-entering?',
        evidenceTags: ['Circular Dependency', 'Module Boundaries'],
        priority: 90,
      })
    );
  }

  // 4. External Package Coupling & Abstraction
  if (externalDependencies.length > 0) {
    const topExts = externalDependencies.slice(0, 3);
    const primaryExt = topExts[0];
    const sampleUserPath = primaryExt.usedByPaths?.[0] || null;
    const rawUserFile = primaryExt.usedByFileIds?.[0] ? fileById.get(primaryExt.usedByFileIds[0]) : null;

    results.push(
      makeQuestionRecord({
        id: `q:arch:external:${primaryExt.id}`,
        question: `The project relies on external package(s) ${topExts.map((e) => `\`${e.name}\``).join(', ')} (for example, \`${primaryExt.name}\` in \`${sampleUserPath || 'workspace modules'}\`). When should third-party libraries be wrapped behind an internal adapter vs used directly?`,
        difficulty: 'Medium',
        category: 'Architecture & Design',
        scope: 'architecture',
        targetLabel: primaryExt.name,
        file: rawUserFile || { id: primaryExt.usedByFileIds?.[0] || null, path: sampleUserPath, lineCount: 1 },
        chunk: null,
        signals: {
          moduleId: primaryExt.usedByModuleIds?.[0] || null,
          moduleLabel: 'External Dependencies',
        },
        suggestedAnswer: `Current implementation: external dependency \`${primaryExt.name}\` is imported ${primaryExt.importCount} time(s)${sampleUserPath ? ` (including \`${sampleUserPath}\`)` : ''}. Design trade-off: direct imports are straightforward inside a single dedicated service/persistence module, while cross-cutting usage across many modules often benefits from a small internal adapter/interface to isolate upgrades and ease mocking.`,
        keyPoints: [
          `Top external packages observed: ${topExts.map((e) => `${e.name} (${e.importCount} import(s))`).join(', ')}.`,
          'Direct usage is pragmatic inside a single adapter/service file; cross-cutting usage benefits from facade interfaces.',
        ],
        followUp:
          `If you had to replace \`${primaryExt.name}\` with an alternative library next quarter, how many files in this project would need edits?`,
        evidenceTags: ['Dependency Management', ...topExts.map((e) => e.name)],
        priority: 70,
      })
    );
  }

  // 5. System Architecture Overview (always useful for multi-module repos, even with 0 internal links!)
  if (modules.length >= 2) {
    const layerSummary = (archModel.layers || []).map((l) => `${l.label} (${l.moduleCount})`).join(', ');
    const leadMod = [...modules].sort(
      (a, b) => b.externalCount + b.inDegree + b.outDegree - (a.externalCount + a.inDegree + a.outDegree) || a.tier - b.tier
    )[0];
    const leadFile = leadMod?.files?.[0] ? fileById.get(leadMod.files[0].fileId) : null;

    results.push(
      makeQuestionRecord({
        id: `q:arch:layers:overview`,
        question: `Describe the high-level architecture of this codebase across its ${modules.length} module(s) and layers (${layerSummary || 'detected components'}). How cleanly are responsibilities separated?`,
        difficulty: 'Easy',
        category: 'Architecture & Design',
        scope: 'architecture',
        targetLabel: `${modules.length} Modules`,
        file: leadFile || { id: null, path: leadMod?.files?.[0]?.filePath || null, lineCount: 1 },
        chunk: null,
        signals: { moduleId: leadMod?.id || null, moduleLabel: leadMod?.label || 'System Architecture' },
        suggestedAnswer: `Current implementation: organizes ${archModel.summary?.totalFiles || 0} file(s) across ${archModel.layers?.length || 1} layer(s) (${layerSummary || modules.map((m) => m.label).join(', ')}), with ${moduleEdges.length} cross-module internal link(s) and ${externalDependencies.length} external package(s). Architectural consideration: separating API/auth, persistence, and configuration modules reduces cross-layer coupling as features scale.`,
        keyPoints: [
          `Modules span layers: ${layerSummary || modules.map((m) => m.label).join(', ')}.`,
          `Cross-module internal edges: ${moduleEdges.length}; external packages: ${externalDependencies.length}.`,
          (highlights.isolatedModules || []).length > 0
            ? `Standalone/config modules (${highlights.isolatedModules.map((m) => m.label).join(', ')}) have zero internal coupling.`
            : 'All modules participate in workspace dependency edges.',
        ],
        followUp:
          moduleEdges.length === 0
            ? 'Currently modules operate independently with zero direct cross-module imports—which modules would connect first as features grow into a unified app?'
            : 'Which boundary between layers has the highest coupling today, and is that coupling justified?',
        evidenceTags: ['System Overview', 'Layering'],
        priority: 66,
      })
    );
  }

  return results;
}

/**
 * Formats an interview prep summary + question list into deterministic Markdown.
 */
export function formatInterviewMarkdown(interviewPrep) {
  if (!interviewPrep || !Array.isArray(interviewPrep.questions) || interviewPrep.questions.length === 0) {
    return '# Technical Interview Questions\n\nNo questions generated — import source files to begin.';
  }

  const { projectName = 'Workspace', summary, questions } = interviewPrep;
  const lines = [
    `# Technical Interview Prep — ${projectName}`,
    '',
    `- **Total Questions:** ${summary.totalQuestions}`,
    `- **By Difficulty:** Easy (${summary.byDifficulty.Easy || 0}) · Medium (${summary.byDifficulty.Medium || 0}) · Hard (${summary.byDifficulty.Hard || 0})`,
    `- **Modules Covered:** ${summary.coveredModules.length}`,
    '',
    '---',
    '',
  ];

  questions.forEach((q, idx) => {
    lines.push(`## ${idx + 1}. [${q.difficulty}] ${q.category}`);
    lines.push('');
    lines.push(`**Question:** ${q.question}`);
    lines.push('');
    if (q.filePath) {
      const range = q.symbolName ? `${q.filePath}:${q.startLine}-${q.endLine} (\`${q.symbolName}\`)` : q.filePath;
      lines.push(`**Source Anchor:** \`${range}\` · Module: _${q.moduleLabel}_`);
      lines.push('');
    }
    lines.push(`**Suggested Answer:** ${q.suggestedAnswer}`);
    lines.push('');
    if (q.keyPoints?.length > 0) {
      lines.push('**Key Talking Points:**');
      for (const kp of q.keyPoints) {
        lines.push(`- ${kp}`);
      }
      lines.push('');
    }
    if (q.followUp) {
      lines.push(`**Follow-Up Probe:** ${q.followUp}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Generates rule-based, codebase-grounded technical interview questions across
 * JavaScript, TypeScript, Python, and Java projects.
 *
 * @param {Array<object>} files
 * @param {object|null} [architectureModel]
 * @param {{ projectName?: string, maxQuestions?: number }} [options]
 */
export function generateInterviewQuestions(files = [], architectureModel = null, options = {}) {
  const projectName = options.projectName || architectureModel?.projectName || 'Workspace';
  const maxQuestions = Math.max(1, Number(options.maxQuestions) || 30);

  if (!Array.isArray(files) || files.length === 0) {
    const emptyResult = {
      projectName,
      summary: { ...EMPTY_SUMMARY, byDifficulty: { ...EMPTY_SUMMARY.byDifficulty } },
      questions: [],
      markdown: '',
    };
    emptyResult.markdown = formatInterviewMarkdown(emptyResult);
    return emptyResult;
  }

  const preparedFiles = prepareWorkspaceFiles(files);
  const archModel =
    architectureModel && Array.isArray(architectureModel.modules)
      ? architectureModel
      : analyzeCodebaseArchitecture(preparedFiles, { projectName });

  const fileById = new Map();
  const analyzedFileById = new Map();
  const moduleByFileId = new Map();

  for (const f of preparedFiles) {
    fileById.set(f.id, f);
  }
  for (const af of archModel.files || []) {
    analyzedFileById.set(af.fileId, af);
  }
  for (const mod of archModel.modules || []) {
    for (const mf of mod.files || []) {
      moduleByFileId.set(mf.fileId, mod);
    }
  }

  const candidates = [];

  for (const file of preparedFiles) {
    const ext = (file.extension || getFileExtension(file.path || '')).toLowerCase();
    const moduleMeta = moduleByFileId.get(file.id) || null;
    const fileInfo = analyzedFileById.get(file.id) || null;

    if (['.js', '.jsx', '.ts', '.tsx', '.py', '.java'].includes(ext)) {
      const chunks = chunkFile(file);
      for (const chunk of chunks) {
        if (chunk.symbolType === 'function' || chunk.symbolType === 'class') {
          candidates.push(...synthesizeSymbolQuestions({ file, chunk, moduleMeta, fileInfo }));
        }
      }
      candidates.push(...synthesizeFileConfigQuestions({ file, moduleMeta, fileInfo }));
    } else if (ext === '.json') {
      candidates.push(...synthesizeFileConfigQuestions({ file, moduleMeta, fileInfo }));
    }
  }

  candidates.push(...synthesizeArchitectureQuestions({ archModel, fileById }));

  // Deduplicate cleanly by ID while keeping highest priority candidate
  const dedupedMap = new Map();
  for (const q of candidates) {
    const existing = dedupedMap.get(q.id);
    if (!existing || q.priority > existing.priority) {
      dedupedMap.set(q.id, q);
    }
  }

  // Sort by priority desc, then deterministic tie-breakers, then cap at maxQuestions
  // Keep balanced coverage across difficulty tiers before capping when pool > maxQuestions
  const sortedPool = Array.from(dedupedMap.values()).sort(
    (a, b) =>
      b.priority - a.priority ||
      (DIFFICULTY_RANK[a.difficulty] ?? 9) - (DIFFICULTY_RANK[b.difficulty] ?? 9) ||
      (a.filePath || '').localeCompare(b.filePath || '') ||
      a.startLine - b.startLine ||
      a.id.localeCompare(b.id)
  );

  let selected = [];
  if (sortedPool.length <= maxQuestions) {
    selected = sortedPool;
  } else {
    // Round-robin across Easy / Medium / Hard starting with top-priority items so no tier is starved
    const buckets = {
      Easy: sortedPool.filter((q) => q.difficulty === 'Easy'),
      Medium: sortedPool.filter((q) => q.difficulty === 'Medium'),
      Hard: sortedPool.filter((q) => q.difficulty === 'Hard'),
    };
    const pickedIds = new Set();
    let idx = 0;
    while (selected.length < maxQuestions) {
      let addedInPass = false;
      for (const diff of INTERVIEW_DIFFICULTIES) {
        const item = buckets[diff][idx];
        if (item && !pickedIds.has(item.id)) {
          pickedIds.add(item.id);
          selected.push(item);
          addedInPass = true;
          if (selected.length >= maxQuestions) break;
        }
      }
      if (!addedInPass) break;
      idx += 1;
    }
  }

  // Final presentation sort: group logically by module/file/line or difficulty/priority
  const questions = selected.sort(
    (a, b) =>
      (DIFFICULTY_RANK[a.difficulty] ?? 9) - (DIFFICULTY_RANK[b.difficulty] ?? 9) ||
      b.priority - a.priority ||
      (a.filePath || '').localeCompare(b.filePath || '') ||
      a.startLine - b.startLine ||
      a.id.localeCompare(b.id)
  );

  const byDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
  const byCategory = {};
  const coveredModulesSet = new Set();
  const coveredFilesSet = new Set();

  for (const q of questions) {
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
    byCategory[q.category] = (byCategory[q.category] || 0) + 1;
    if (q.moduleLabel) coveredModulesSet.add(q.moduleLabel);
    if (q.filePath) coveredFilesSet.add(q.filePath);
  }

  const result = {
    projectName,
    summary: {
      totalQuestions: questions.length,
      byDifficulty,
      byCategory,
      coveredModules: Array.from(coveredModulesSet).sort(),
      coveredFiles: Array.from(coveredFilesSet).sort(),
    },
    questions,
    markdown: '',
  };

  result.markdown = formatInterviewMarkdown(result);
  return result;
}
