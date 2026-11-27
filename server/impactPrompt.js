/**
 * Grounded Change Impact Simulator prompt builder and strict response validator.
 * Keeps Severity independent from Confidence, rejects fabricated paths/tests,
 * clamps line ranges, and attaches deterministic dependency paths.
 */

export const IMPACT_SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational'];
export const IMPACT_CONFIDENCES = ['High', 'Medium', 'Low'];
export const EVIDENCE_TYPES = [
  'verified_dependency',
  'evidence_backed_impact',
  'ai_inferred_risk',
  'insufficient_evidence',
];

export const MAX_IMPACT_SNIPPETS = 12;
export const MAX_SNIPPET_CHARS = 2800;
export const MAX_TOTAL_SNIPPET_CHARS = 20000;

const SEVERITY_MAP = new Map(IMPACT_SEVERITIES.map((s) => [s.toLowerCase(), s]));
const CONFIDENCE_MAP = new Map(IMPACT_CONFIDENCES.map((c) => [c.toLowerCase(), c]));
const EVIDENCE_SET = new Set(EVIDENCE_TYPES);

export const IMPACT_SYSTEM_INSTRUCTION = [
  'You are FORGE Change Impact Analyst, a senior software architect interpreting deterministic dependency and source-code evidence for a proposed code change.',
  '',
  'STRICT GROUNDING RULES:',
  '1. Base every conclusion strictly on the provided RESOLVED TARGETS, VERIFIED DEPENDENCY PATHS, SOURCE SNIPPETS, and EXISTING TEST FILES.',
  '2. NEVER invent files, functions, classes, line numbers, API endpoints, database models, dependencies, or existing test files that are not in the prompt.',
  '3. A dependency edge establishes a relationship, NOT automatic breakage — inspect the actual code snippet to judge whether behavior will break.',
  '4. Keep SEVERITY and CONFIDENCE completely independent:',
  '   - Severity ("Critical" | "High" | "Medium" | "Low" | "Informational") measures potential impact magnitude.',
  '   - Confidence ("High" | "Medium" | "Low") measures strength of supporting code evidence.',
  '5. Classify each finding\'s evidenceType honestly as one of: "verified_dependency", "evidence_backed_impact", "ai_inferred_risk", or "insufficient_evidence".',
  '6. If the proposed change has no identifiable impact on other components, return an empty or minimal findings list and explain why honestly. Never manufacture findings.',
  '7. Clearly distinguish existing tests (ONLY from the EXISTING TESTS list) from recommended new tests.',
  '8. Keep explanation, potentialConsequence, and recommendedModification concise (1-2 sentences each), and include at most 10 highest-signal findings so the JSON stays complete and well-formed.',
  '',
  'OUTPUT FORMAT (STRICT JSON ONLY):',
  '{',
  '  "overallAssessment": "High Impact | Moderate Impact | Low Impact | Minimal / Isolated Impact | Insufficient Evidence",',
  '  "executiveSummary": "2-4 sentence grounded summary of what would be affected and why.",',
  '  "findings": [',
  '    {',
  '      "title": "Concise finding title",',
  '      "filePath": "exact filePath from provided snippets",',
  '      "symbol": "function or class name if identifiable, else null",',
  '      "startLine": 10,',
  '      "endLine": 20,',
  '      "dependencyType": "target | direct_dependent | indirect_dependent | shared_dependency | related_context",',
  '      "severity": "Critical | High | Medium | Low | Informational",',
  '      "confidence": "High | Medium | Low",',
  '      "evidenceType": "verified_dependency | evidence_backed_impact | ai_inferred_risk | insufficient_evidence",',
  '      "explanation": "Why this component is affected based on the code.",',
  '      "potentialConsequence": "What could break or change at runtime/compile time.",',
  '      "recommendedModification": "Specific adaptation needed to handle the proposed change safely."',
  '    }',
  '  ],',
  '  "changeSequence": [',
  '    "Step 1: Ordered suggested migration step grounded in the actual files"',
  '  ],',
  '  "additionalTestRecommendations": [',
  '    {',
  '      "title": "Recommended new test case title",',
  '      "targetFile": "exact filePath from workspace",',
  '      "targetSymbol": "symbol or null",',
  '      "scenario": "What to assert to catch regressions from this change",',
  '      "priority": "High | Medium | Low"',
  '    }',
  '  ],',
  '  "additionalUncertainties": [',
  '    "Specific unknown, dynamic behavior, or missing context noticed in the snippets"',
  '  ]',
  '}',
].join('\n');

export function sanitizeImpactSnippets(rawSnippets = []) {
  if (!Array.isArray(rawSnippets)) return [];
  const sanitized = [];
  let totalChars = 0;

  for (const s of rawSnippets) {
    if (sanitized.length >= MAX_IMPACT_SNIPPETS) break;
    if (!s || typeof s !== 'object' || typeof s.content !== 'string' || !s.content.trim()) continue;
    const remaining = MAX_TOTAL_SNIPPET_CHARS - totalChars;
    if (remaining < 150) break;

    const filePath = (s.filePath || s.fileName || '').trim().replace(/\\/g, '/');
    if (!filePath) continue;

    const startLine = Number.isInteger(s.startLine) && s.startLine > 0 ? s.startLine : 1;
    const lines = s.content.split('\n');
    const endLine =
      Number.isInteger(s.endLine) && s.endLine >= startLine
        ? s.endLine
        : startLine + lines.length - 1;

    const maxAllowed = Math.min(MAX_SNIPPET_CHARS, remaining);
    const clippedContent =
      s.content.length > maxAllowed
        ? `${s.content.slice(0, maxAllowed)}\n// ... [truncated]`
        : s.content;

    const numberedLines = clippedContent
      .split('\n')
      .map((line, idx) => `L${startLine + idx}: ${line}`)
      .join('\n');

    totalChars += clippedContent.length;
    sanitized.push({
      fileId: s.fileId || filePath,
      fileName: s.fileName || filePath.split('/').pop(),
      filePath,
      startLine,
      endLine,
      totalLines: Number.isInteger(s.totalLines) && s.totalLines >= endLine ? s.totalLines : endLine,
      role: typeof s.role === 'string' ? s.role : 'context',
      reason: typeof s.reason === 'string' ? s.reason : '',
      content: clippedContent,
      numberedLines,
    });
  }

  return sanitized;
}

export function buildImpactPromptPayload({
  proposedChange,
  projectName = 'Active Workspace',
  parsedChange = null,
  resolvedTargets = [],
  impactedComponents = [],
  dependencyPaths = [],
  snippets = [],
  existingTests = [],
}) {
  const sanitizedSnippets = sanitizeImpactSnippets(snippets);

  const targetsText =
    resolvedTargets.length > 0
      ? resolvedTargets
          .map(
            (t) =>
              `- ${t.filePath}${t.symbolName ? ` :: ${t.targetType} ${t.symbolName}` : ''} (L${t.startLine}-L${t.endLine}) — ${t.matchReason}`
          )
          .join('\n')
      : '- No explicit targets resolved.';

  const pathsText =
    dependencyPaths.length > 0
      ? dependencyPaths
          .slice(0, 20)
          .map((p) => `- [${p.relationship}, depth ${p.depth}] ${p.path.join(' -> ')}`)
          .join('\n')
      : '- No verified reverse dependency paths found in the workspace.';

  const testsText =
    existingTests.length > 0
      ? existingTests
          .map((t) => `- ${t.filePath} [${t.relation}] — ${t.reason}`)
          .join('\n')
      : '- None detected in workspace.';

  const snippetsText =
    sanitizedSnippets.length > 0
      ? sanitizedSnippets
          .map(
            (s) =>
              `=== [${s.role.toUpperCase()}] ${s.filePath} (L${s.startLine}-L${s.endLine})${s.reason ? ` | ${s.reason}` : ''} ===\n\`\`\`\n${s.numberedLines}\n\`\`\``
          )
          .join('\n\n')
      : 'No source snippets available.';

  const userPrompt = [
    `Project: ${projectName}`,
    `PROPOSED CHANGE: ${proposedChange.trim()}`,
    parsedChange?.operation ? `Detected Operation: ${parsedChange.operation}` : '',
    '',
    'RESOLVED TARGETS:',
    targetsText,
    '',
    'VERIFIED DEPENDENCY PATHS (direction: target -> dependent):',
    pathsText,
    '',
    'EXISTING TEST FILES DISCOVERED IN WORKSPACE:',
    testsText,
    '',
    'GROUNDED SOURCE SNIPPETS:',
    snippetsText,
    '',
    'Analyze the actual consequences of the proposed change using ONLY the files and line numbers shown above. Return strict JSON.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return {
    systemInstruction: { parts: [{ text: IMPACT_SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    sanitizedSnippets,
    impactedComponents,
  };
}

function extractJsonObject(rawText = '') {
  const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
  if (!trimmed) return null;
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function buildImpactSeverityBreakdown(findings = []) {
  const breakdown = { Critical: 0, High: 0, Medium: 0, Low: 0, Informational: 0 };
  for (const f of findings) {
    if (f?.severity && breakdown[f.severity] !== undefined) {
      breakdown[f.severity]++;
    }
  }
  return breakdown;
}

export function parseAndValidateImpactResponse(
  rawText,
  sanitizedSnippets = [],
  impactedComponents = []
) {
  const parsed = extractJsonObject(rawText);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) {
    return {
      ok: false,
      error: 'Gemini returned a malformed Change Impact response that did not match the expected JSON schema.',
    };
  }

  const snippetByPath = new Map();
  for (const s of sanitizedSnippets) {
    if (!snippetByPath.has(s.filePath)) snippetByPath.set(s.filePath, s);
    snippetByPath.set(s.filePath.toLowerCase(), s);
    if (s.fileName && !snippetByPath.has(s.fileName.toLowerCase())) {
      snippetByPath.set(s.fileName.toLowerCase(), s);
    }
  }

  const componentByPath = new Map();
  for (const c of impactedComponents || []) {
    if (!c?.filePath) continue;
    componentByPath.set(c.filePath, c);
    componentByPath.set(c.filePath.toLowerCase(), c);
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
    const snippet = snippetByPath.get(rawPath) || snippetByPath.get(rawPath.toLowerCase());
    if (!snippet) {
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
      ? Math.max(snippet.startLine, Math.min(snippet.endLine, rawStart))
      : snippet.startLine;
    const endLine = Number.isFinite(rawEnd)
      ? Math.max(startLine, Math.min(snippet.endLine, rawEnd))
      : startLine;

    const comp = componentByPath.get(snippet.filePath) || componentByPath.get(snippet.filePath.toLowerCase());
    const dependencyType =
      comp?.dependencyType ||
      (['target', 'direct_dependent', 'indirect_dependent', 'shared_dependency', 'related_context'].includes(
        item.dependencyType
      )
        ? item.dependencyType
        : 'related_context');
    const dependencyPath = Array.isArray(comp?.dependencyPath)
      ? comp.dependencyPath
      : [snippet.filePath];

    const severity = SEVERITY_MAP.get((item.severity || '').toLowerCase()) || 'Medium';
    let confidence = CONFIDENCE_MAP.get((item.confidence || '').toLowerCase()) || 'Medium';
    const evidenceType = EVIDENCE_SET.has(item.evidenceType)
      ? item.evidenceType
      : comp && (dependencyType === 'target' || dependencyType === 'direct_dependent')
        ? 'verified_dependency'
        : 'evidence_backed_impact';

    if (evidenceType === 'insufficient_evidence') {
      confidence = 'Low';
    } else if (evidenceType === 'ai_inferred_risk' && confidence === 'High') {
      confidence = 'Medium';
    }

    const dedupeKey = `${snippet.filePath}:${startLine}-${endLine}:${title.toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const snippetLines = snippet.content.split('\n');
    const relStart = Math.max(0, startLine - snippet.startLine);
    const relEnd = Math.min(snippetLines.length, Math.max(relStart + 1, endLine - snippet.startLine + 1));
    const evidenceSnippet = snippetLines.slice(relStart, Math.min(relEnd, relStart + 12)).join('\n');

    findings.push({
      id: `imp-${findings.length + 1}-${snippet.fileId}-${startLine}`,
      title,
      fileId: snippet.fileId,
      fileName: snippet.fileName,
      filePath: snippet.filePath,
      symbol: typeof item.symbol === 'string' && item.symbol.trim() ? item.symbol.trim() : null,
      startLine,
      endLine,
      dependencyType,
      dependencyPath,
      severity,
      confidence,
      evidenceType,
      evidenceSnippet,
      explanation,
      potentialConsequence:
        typeof item.potentialConsequence === 'string' && item.potentialConsequence.trim()
          ? item.potentialConsequence.trim()
          : 'Behavior in this component may require verification or adaptation.',
      recommendedModification:
        typeof item.recommendedModification === 'string' && item.recommendedModification.trim()
          ? item.recommendedModification.trim()
          : 'Inspect the referenced lines and update interfaces or callers to stay compatible.',
    });
  }

  const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3, Informational: 4 };
  findings.sort((a, b) => {
    const diff = (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9);
    if (diff !== 0) return diff;
    return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine;
  });

  const additionalTestRecommendations = [];
  if (Array.isArray(parsed.additionalTestRecommendations)) {
    for (const rec of parsed.additionalTestRecommendations.slice(0, 6)) {
      if (!rec || typeof rec !== 'object' || typeof rec.title !== 'string' || !rec.title.trim()) continue;
      const rawTf = typeof rec.targetFile === 'string' ? rec.targetFile.trim().replace(/\\/g, '/') : '';
      const matchedSnippet = snippetByPath.get(rawTf) || snippetByPath.get(rawTf.toLowerCase());
      if (rawTf && !matchedSnippet) continue;
      additionalTestRecommendations.push({
        title: rec.title.trim(),
        targetFile: matchedSnippet ? matchedSnippet.filePath : null,
        targetSymbol: typeof rec.targetSymbol === 'string' && rec.targetSymbol.trim() ? rec.targetSymbol.trim() : null,
        scenario: typeof rec.scenario === 'string' ? rec.scenario.trim() : '',
        priority: CONFIDENCE_MAP.get((rec.priority || '').toLowerCase()) || 'Medium',
        existsInWorkspace: false,
      });
    }
  }

  const changeSequence = Array.isArray(parsed.changeSequence)
    ? parsed.changeSequence
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim())
        .slice(0, 8)
    : [];

  const additionalUncertainties = Array.isArray(parsed.additionalUncertainties)
    ? parsed.additionalUncertainties
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim())
        .slice(0, 6)
    : [];

  const overallAssessment =
    typeof parsed.overallAssessment === 'string' && parsed.overallAssessment.trim()
      ? parsed.overallAssessment.trim()
      : findings.length === 0
        ? 'Minimal / Isolated Impact'
        : 'Moderate Impact';

  const executiveSummary =
    typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
      ? parsed.executiveSummary.trim()
      : findings.length === 0
        ? 'No cross-file breaking impacts were established from the provided codebase evidence.'
        : `Identified ${findings.length} evidence-backed impact finding${findings.length === 1 ? '' : 's'} across the affected components.`;

  return {
    ok: true,
    overallAssessment,
    executiveSummary,
    findings,
    totalFindings: findings.length,
    severityBreakdown: buildImpactSeverityBreakdown(findings),
    changeSequence,
    additionalTestRecommendations,
    additionalUncertainties,
    rejectedCount,
  };
}
