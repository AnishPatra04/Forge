/**
 * Grounded AI Code Review prompt construction and strict response validation.
 * Guarantees every returned finding maps to real target files and valid line numbers.
 */

export const REVIEW_CATEGORIES = [
  'Bug Detection',
  'Security Analysis',
  'Performance Analysis',
  'Code Quality',
  'Maintainability',
];

export const REVIEW_SEVERITIES = [
  'Critical',
  'High',
  'Medium',
  'Low',
  'Informational',
];

export const MAX_REVIEW_FILE_CHARS = 24000;
export const MAX_REVIEW_LINES = 600;
export const MAX_SUPPORTING_CHUNKS = 4;
export const MAX_SUPPORTING_CHUNK_CHARS = 1800;
export const MAX_BATCH_FILES = 4;
export const MAX_BATCH_TOTAL_CHARS = 24000;

const CATEGORY_LOOKUP = new Map(REVIEW_CATEGORIES.map((c) => [c.toLowerCase(), c]));
const SEVERITY_LOOKUP = new Map(REVIEW_SEVERITIES.map((s) => [s.toLowerCase(), s]));

export const REVIEW_SYSTEM_INSTRUCTION = [
  'You are FORGE AI Code Reviewer, a senior software and security engineer performing grounded static code reviews.',
  '',
  'ANALYZE THE TARGET CODE ACROSS THESE FIVE CATEGORIES:',
  '1. "Bug Detection": logical errors, runtime exceptions, incorrect conditions, null/undefined dereferences, missing error handling, race conditions.',
  '2. "Security Analysis": SQL injection, XSS, hardcoded secrets/credentials, insecure auth/JWT handling, unsafe input handling.',
  '3. "Performance Analysis": inefficient loops, unnecessary recomputations, repeated expensive operations, potential memory leaks.',
  '4. "Code Quality": duplication, poor practices, unnecessary complexity, unclear naming or readability issues.',
  '5. "Maintainability": tight coupling, overly complex functions, fragile or hard-to-maintain structures.',
  '',
  'STRICT GROUNDING & HONESTY RULES:',
  '- ONLY report findings that are directly supported by the provided TARGET CODE.',
  '- NEVER invent file paths, line numbers, symbols, or vulnerabilities not present in the provided lines.',
  '- Distinguish definite problems from speculative risks using the "confidence" field: "confirmed" for definite bugs/issues visible in the code, or "potential" for contextual risks that depend on callers or runtime inputs.',
  '- Do NOT report findings on READ-ONLY SUPPORTING CONTEXT files; use supporting context only to understand how the target code interacts with dependencies.',
  '- Use the exact line numbers prefixed with "L<num>:" on each source line.',
  '- If the code is clean and has no meaningful issues, return an empty "findings" array and a concise positive summary.',
  '',
  'OUTPUT FORMAT (STRICT JSON ONLY):',
  'Return a single valid JSON object with this exact shape:',
  '{',
  '  "summary": "2-3 sentence overall assessment of the reviewed code.",',
  '  "findings": [',
  '    {',
  '      "title": "Short specific issue title",',
  '      "category": "Bug Detection | Security Analysis | Performance Analysis | Code Quality | Maintainability",',
  '      "severity": "Critical | High | Medium | Low | Informational",',
  '      "confidence": "confirmed | potential",',
  '      "filePath": "exact target file path from the prompt",',
  '      "startLine": 10,',
  '      "endLine": 15,',
  '      "explanation": "Clear explanation grounded in the exact code.",',
  '      "whyItMatters": "Concrete impact on correctness, security, performance, or maintainability.",',
  '      "recommendedFix": "Actionable steps to fix the issue.",',
  '      "suggestedCode": "Optional corrected replacement snippet for the affected lines, or null if conceptual."',
  '    }',
  '  ]',
  '}',
].join('\n');

/**
 * Formats source lines with explicit `L<num>:` prefixes so the LLM cites exact line numbers.
 *
 * @param {string} content
 * @param {object} [options]
 * @returns {{ numberedText: string, totalLines: number, reviewedStartLine: number, reviewedEndLine: number, truncated: boolean }}
 */
export function formatNumberedSource(
  content = '',
  { startLine = 1, endLine = null, maxChars = MAX_REVIEW_FILE_CHARS, maxLines = MAX_REVIEW_LINES } = {}
) {
  const allLines = typeof content === 'string' ? content.split('\n') : [];
  const totalLines = allLines.length;
  const safeStart = Math.max(1, Math.min(totalLines || 1, Number.isInteger(startLine) ? startLine : 1));
  const requestedEnd =
    Number.isInteger(endLine) && endLine >= safeStart ? Math.min(totalLines, endLine) : totalLines;

  const out = [];
  let charCount = 0;
  let lastLineIncluded = safeStart - 1;
  let truncated = false;

  for (let ln = safeStart; ln <= requestedEnd; ln++) {
    if (out.length >= maxLines) {
      truncated = true;
      break;
    }
    const formatted = `L${ln}: ${allLines[ln - 1] ?? ''}`;
    if (charCount + formatted.length + 1 > maxChars && out.length > 0) {
      truncated = true;
      break;
    }
    out.push(formatted);
    charCount += formatted.length + 1;
    lastLineIncluded = ln;
  }

  return {
    numberedText: out.join('\n'),
    totalLines,
    reviewedStartLine: safeStart,
    reviewedEndLine: Math.max(safeStart, lastLineIncluded),
    truncated,
  };
}

function sanitizeSupportingChunks(chunks = []) {
  if (!Array.isArray(chunks)) return [];
  const result = [];
  for (const chunk of chunks) {
    if (result.length >= MAX_SUPPORTING_CHUNKS) break;
    if (!chunk || typeof chunk.content !== 'string' || !chunk.content.trim()) continue;
    const filePath = (chunk.filePath || chunk.fileName || 'unknown').trim();
    const startLine = Number.isInteger(chunk.startLine) && chunk.startLine > 0 ? chunk.startLine : 1;
    const endLine =
      Number.isInteger(chunk.endLine) && chunk.endLine >= startLine ? chunk.endLine : startLine;
    const content =
      chunk.content.length > MAX_SUPPORTING_CHUNK_CHARS
        ? `${chunk.content.slice(0, MAX_SUPPORTING_CHUNK_CHARS)}\n// ... [truncated]`
        : chunk.content;
    result.push({ filePath, startLine, endLine, content });
  }
  return result;
}

/**
 * Builds the Gemini prompt payload for reviewing a single file (or scoped function/class).
 */
export function buildFileReviewPrompt({
  file,
  scope = null,
  supportingChunks = [],
  projectName = 'Active Workspace',
}) {
  const filePath = (file.path || file.name || 'unknown').trim();
  const formatted = formatNumberedSource(file.content, {
    startLine: scope?.startLine || 1,
    endLine: scope?.endLine || null,
  });

  const cleanSupport = sanitizeSupportingChunks(supportingChunks);
  const scopeDescription = scope?.symbolName
    ? `Focused scope: ${scope.symbolType || 'symbol'} "${scope.symbolName}" (L${formatted.reviewedStartLine}-L${formatted.reviewedEndLine})`
    : `Full file review (L${formatted.reviewedStartLine}-L${formatted.reviewedEndLine} of ${formatted.totalLines} total lines)`;

  const sections = [
    `Project: ${projectName}`,
    `TARGET FILE TO REVIEW: ${filePath}`,
    scopeDescription,
    formatted.truncated
      ? `Note: File was truncated at L${formatted.reviewedEndLine} due to size limits. Only review lines L${formatted.reviewedStartLine}-L${formatted.reviewedEndLine}.`
      : '',
    '',
    '=== TARGET CODE ===',
    '```',
    formatted.numberedText,
    '```',
  ];

  if (cleanSupport.length > 0) {
    sections.push('', '=== READ-ONLY SUPPORTING CONTEXT (DO NOT REPORT FINDINGS ON THESE FILES) ===');
    for (const s of cleanSupport) {
      sections.push(`[Context] ${s.filePath} (L${s.startLine}-L${s.endLine})`, '```', s.content, '```');
    }
  }

  sections.push(
    '',
    `Return strict JSON with findings ONLY for "${filePath}" within lines L${formatted.reviewedStartLine}-L${formatted.reviewedEndLine}.`
  );

  return {
    systemInstruction: { parts: [{ text: REVIEW_SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: sections.filter((l) => l !== '').join('\n') }] }],
    allowedFiles: [
      {
        id: file.id || filePath,
        fileName: file.name || filePath.split('/').pop(),
        filePath,
        content: file.content,
        totalLines: formatted.totalLines,
        minLine: formatted.reviewedStartLine,
        maxLine: formatted.reviewedEndLine,
      },
    ],
    truncated: formatted.truncated,
    reviewedRange: {
      startLine: formatted.reviewedStartLine,
      endLine: formatted.reviewedEndLine,
      totalLines: formatted.totalLines,
    },
  };
}

/**
 * Builds the Gemini prompt payload for reviewing a batch of files in a full-project review.
 */
export function buildBatchReviewPrompt({ files = [], projectName = 'Active Workspace' }) {
  const allowedFiles = [];
  const fileBlocks = [];
  let totalChars = 0;

  for (const file of files.slice(0, MAX_BATCH_FILES)) {
    if (!file || typeof file.content !== 'string' || !file.content.trim()) continue;
    const remaining = MAX_BATCH_TOTAL_CHARS - totalChars;
    if (remaining < 400) break;

    const filePath = (file.path || file.name || 'unknown').trim();
    const formatted = formatNumberedSource(file.content, {
      maxChars: Math.min(10000, remaining),
      maxLines: 300,
    });

    totalChars += formatted.numberedText.length;
    allowedFiles.push({
      id: file.id || filePath,
      fileName: file.name || filePath.split('/').pop(),
      filePath,
      content: file.content,
      totalLines: formatted.totalLines,
      minLine: formatted.reviewedStartLine,
      maxLine: formatted.reviewedEndLine,
    });

    fileBlocks.push(
      [
        `=== TARGET FILE: ${filePath} (L${formatted.reviewedStartLine}-L${formatted.reviewedEndLine}${formatted.truncated ? ' truncated' : ''}) ===`,
        '```',
        formatted.numberedText,
        '```',
      ].join('\n')
    );
  }

  const allowedList = allowedFiles.map((f) => f.filePath).join(', ');
  const promptText = [
    `Project: ${projectName}`,
    `Review the following batch of ${allowedFiles.length} file(s): ${allowedList}`,
    '',
    ...fileBlocks,
    '',
    'Return strict JSON with findings ONLY for the target files above and their exact line ranges.',
  ].join('\n\n');

  return {
    systemInstruction: { parts: [{ text: REVIEW_SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    allowedFiles,
  };
}

function normalizeCategory(raw) {
  if (typeof raw !== 'string') return 'Code Quality';
  const exact = CATEGORY_LOOKUP.get(raw.trim().toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.includes('bug') || lower.includes('error') || lower.includes('logic')) return 'Bug Detection';
  if (lower.includes('sec') || lower.includes('vuln') || lower.includes('auth') || lower.includes('xss')) {
    return 'Security Analysis';
  }
  if (lower.includes('perf') || lower.includes('memory') || lower.includes('speed')) {
    return 'Performance Analysis';
  }
  if (lower.includes('maint') || lower.includes('coupl') || lower.includes('arch')) {
    return 'Maintainability';
  }
  return 'Code Quality';
}

function normalizeSeverity(raw) {
  if (typeof raw !== 'string') return 'Medium';
  const exact = SEVERITY_LOOKUP.get(raw.trim().toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.includes('crit')) return 'Critical';
  if (lower.includes('high')) return 'High';
  if (lower.includes('med')) return 'Medium';
  if (lower.includes('low')) return 'Low';
  if (lower.includes('info')) return 'Informational';
  return 'Medium';
}

function extractJsonObject(rawText = '') {
  const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
  if (!trimmed) return null;

  // Strip optional markdown JSON fences
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Attempt to locate outermost JSON object
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function buildSeverityBreakdown(findings = []) {
  const breakdown = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
  };
  for (const f of findings) {
    if (f?.severity && breakdown[f.severity] !== undefined) {
      breakdown[f.severity]++;
    }
  }
  return breakdown;
}

/**
 * Parses and strictly validates Gemini's review JSON against the actual allowed target files.
 * Rejects fabricated file paths, clamps line numbers to real bounds, extracts authentic
 * currentCode snippets directly from the source, and deduplicates findings.
 *
 * @param {string} rawText
 * @param {Array<object>} allowedFiles
 * @returns {{ ok: boolean, summary: string, findings: Array<object>, totalFindings: number, severityBreakdown: object, rejectedCount: number, error?: string }}
 */
export function parseAndValidateReviewResponse(rawText, allowedFiles = []) {
  const parsed = extractJsonObject(rawText);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) {
    return {
      ok: false,
      summary: '',
      findings: [],
      totalFindings: 0,
      severityBreakdown: buildSeverityBreakdown([]),
      rejectedCount: 0,
      error: 'Gemini returned a malformed review response that did not match the required JSON schema.',
    };
  }

  const fileLookup = new Map();
  for (const af of allowedFiles) {
    fileLookup.set(af.filePath, af);
    fileLookup.set(af.filePath.toLowerCase(), af);
    if (af.fileName && allowedFiles.length === 1) {
      fileLookup.set(af.fileName, af);
      fileLookup.set(af.fileName.toLowerCase(), af);
    }
  }

  const findings = [];
  const seenKeys = new Set();
  let rejectedCount = 0;

  for (const item of parsed.findings) {
    if (!item || typeof item !== 'object') {
      rejectedCount++;
      continue;
    }

    const rawPath = typeof item.filePath === 'string' ? item.filePath.trim().replace(/\\/g, '/') : '';
    let matchedFile = fileLookup.get(rawPath) || fileLookup.get(rawPath.toLowerCase());
    if (!matchedFile && allowedFiles.length === 1 && !rawPath) {
      matchedFile = allowedFiles[0];
    }

    // Drop findings pointing to fabricated or non-target files
    if (!matchedFile) {
      rejectedCount++;
      continue;
    }

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    if (!title || !explanation) {
      rejectedCount++;
      continue;
    }

    const rawStart = Number.parseInt(item.startLine, 10);
    const rawEnd = Number.parseInt(item.endLine, 10);
    const startLine = Number.isFinite(rawStart)
      ? Math.max(matchedFile.minLine, Math.min(matchedFile.maxLine, rawStart))
      : matchedFile.minLine;
    const endLine = Number.isFinite(rawEnd)
      ? Math.max(startLine, Math.min(matchedFile.maxLine, rawEnd))
      : startLine;

    const category = normalizeCategory(item.category);
    const severity = normalizeSeverity(item.severity);
    const confidence =
      typeof item.confidence === 'string' && item.confidence.toLowerCase().includes('pot')
        ? 'potential'
        : 'confirmed';

    const dedupeKey = `${matchedFile.filePath}:${startLine}-${endLine}:${category}:${title.toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) {
      continue;
    }
    seenKeys.add(dedupeKey);

    // Extract authentic source snippet directly from the real file (capped at 25 lines)
    const fileLines = matchedFile.content.split('\n');
    const snippetEnd = Math.min(endLine, startLine + 24);
    const currentCode = fileLines.slice(startLine - 1, snippetEnd).join('\n');

    const suggestedCode =
      typeof item.suggestedCode === 'string' && item.suggestedCode.trim()
        ? item.suggestedCode.trim()
        : null;

    findings.push({
      id: `rev-${findings.length + 1}-${matchedFile.id}-${startLine}`,
      title,
      category,
      severity,
      confidence,
      fileId: matchedFile.id,
      fileName: matchedFile.fileName,
      filePath: matchedFile.filePath,
      startLine,
      endLine,
      explanation,
      whyItMatters:
        typeof item.whyItMatters === 'string' && item.whyItMatters.trim()
          ? item.whyItMatters.trim()
          : 'Can negatively impact code reliability, security, or maintainability.',
      recommendedFix:
        typeof item.recommendedFix === 'string' && item.recommendedFix.trim()
          ? item.recommendedFix.trim()
          : 'Refactor the affected lines to address the issue described above.',
      currentCode,
      suggestedCode,
    });
  }

  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3, Informational: 4 };
  findings.sort((a, b) => {
    const sevDiff = (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.startLine - b.startLine;
  });

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : findings.length === 0
        ? 'No significant issues were detected in the reviewed code.'
        : `Identified ${findings.length} finding${findings.length === 1 ? '' : 's'} across the reviewed code.`;

  return {
    ok: true,
    summary,
    findings,
    totalFindings: findings.length,
    severityBreakdown: buildSeverityBreakdown(findings),
    rejectedCount,
  };
}
