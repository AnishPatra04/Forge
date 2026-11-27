/**
 * Constructs grounded RAG prompts for the FORGE AI Assistant.
 * Enforces strict source grounding, citation discipline, and bounded context size.
 */

export const MAX_CONTEXT_CHUNKS = 10;
export const MAX_CHUNK_CHARS = 3000;
export const MAX_TOTAL_CONTEXT_CHARS = 18000;
export const MAX_HISTORY_TURNS = 6;
export const MAX_HISTORY_MSG_CHARS = 1200;

export const SYSTEM_INSTRUCTION = [
  'You are FORGE AI Assistant, an expert software engineering assistant answering questions about a user-imported codebase.',
  '',
  'STRICT GROUNDING RULES:',
  '1. Answer ONLY using the provided codebase snippets below and the prior conversation.',
  '2. NEVER invent, guess, or assume file names, function names, class names, line numbers, API endpoints, or implementation details that are not present in the provided snippets.',
  '3. Cite your sources inline using the exact source tags provided, e.g. [S1], [S2], whenever you reference a file, symbol, or behavior.',
  '4. If the provided snippets do not contain enough information to answer the question fully, explicitly state what is missing or unknown instead of speculating.',
  '5. Keep answers clear, structured, and concise. Use markdown formatting and reference exact file paths and line ranges when helpful.',
].join('\n');

/**
 * Sanitizes and trims retrieved context chunks to enforce server-side safety bounds.
 *
 * @param {Array<object>} rawChunks
 * @returns {Array<object>}
 */
export function sanitizeContextChunks(rawChunks = []) {
  if (!Array.isArray(rawChunks)) return [];

  const sanitized = [];
  let totalChars = 0;

  for (let i = 0; i < rawChunks.length && sanitized.length < MAX_CONTEXT_CHUNKS; i++) {
    const chunk = rawChunks[i];
    if (!chunk || typeof chunk !== 'object') continue;

    const rawContent = typeof chunk.content === 'string' ? chunk.content : '';
    if (!rawContent.trim()) continue;

    const remainingBudget = MAX_TOTAL_CONTEXT_CHARS - totalChars;
    if (remainingBudget <= 100) break;

    const maxAllowed = Math.min(MAX_CHUNK_CHARS, remainingBudget);
    const content =
      rawContent.length > maxAllowed
        ? `${rawContent.slice(0, maxAllowed)}\n// ... [truncated]`
        : rawContent;

    const id =
      typeof chunk.id === 'string' && /^S\d+$/.test(chunk.id.trim())
        ? chunk.id.trim()
        : `S${sanitized.length + 1}`;

    const filePath =
      typeof chunk.filePath === 'string' && chunk.filePath.trim()
        ? chunk.filePath.trim()
        : typeof chunk.fileName === 'string' && chunk.fileName.trim()
          ? chunk.fileName.trim()
          : 'unknown';

    const startLine = Number.isInteger(chunk.startLine) && chunk.startLine > 0 ? chunk.startLine : 1;
    const endLine =
      Number.isInteger(chunk.endLine) && chunk.endLine >= startLine ? chunk.endLine : startLine;

    sanitized.push({
      id,
      filePath,
      fileName: typeof chunk.fileName === 'string' ? chunk.fileName.trim() : filePath.split('/').pop(),
      startLine,
      endLine,
      symbolName: typeof chunk.symbolName === 'string' ? chunk.symbolName.trim() : null,
      symbolType: typeof chunk.symbolType === 'string' ? chunk.symbolType.trim() : null,
      content,
    });

    totalChars += content.length;
  }

  return sanitized;
}

/**
 * Sanitizes recent conversation history into Gemini's `contents` turn format.
 *
 * @param {Array<{ role: string, content: string }>} history
 * @returns {Array<{ role: 'user' | 'model', parts: Array<{ text: string }> }>}
 */
export function buildConversationContents(history = []) {
  if (!Array.isArray(history) || history.length === 0) return [];

  const recent = history.slice(-MAX_HISTORY_TURNS);
  const turns = [];

  for (const msg of recent) {
    if (!msg || typeof msg.content !== 'string') continue;
    const text = msg.content.trim();
    if (!text) continue;

    const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
    const clipped =
      text.length > MAX_HISTORY_MSG_CHARS ? `${text.slice(0, MAX_HISTORY_MSG_CHARS)}...` : text;

    // Gemini requires alternating user/model turns; merge consecutive same-role entries if any
    if (turns.length > 0 && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].parts[0].text += `\n\n${clipped}`;
    } else {
      turns.push({ role, parts: [{ text: clipped }] });
    }
  }

  // Ensure history starts with a user turn if non-empty
  while (turns.length > 0 && turns[0].role !== 'user') {
    turns.shift();
  }

  // Ensure the last history turn isn't a dangling user turn (since we append the new user prompt)
  if (turns.length > 0 && turns[turns.length - 1].role === 'user') {
    turns.pop();
  }

  return turns;
}

/**
 * Builds the complete Gemini request payload for grounded code QA.
 *
 * @param {object} params
 * @param {string} params.question
 * @param {string} [params.projectName]
 * @param {Array<object>} [params.contextChunks]
 * @param {Array<object>} [params.conversationHistory]
 * @returns {{ systemInstruction: object, contents: Array<object>, sanitizedChunks: Array<object> }}
 */
export function buildRagPromptPayload({
  question,
  projectName = 'Active Workspace',
  contextChunks = [],
  conversationHistory = [],
}) {
  const sanitizedChunks = sanitizeContextChunks(contextChunks);
  const historyTurns = buildConversationContents(conversationHistory);

  const contextSection =
    sanitizedChunks.length > 0
      ? sanitizedChunks
          .map((c) => {
            const symbolLabel =
              c.symbolName && c.symbolName !== 'module'
                ? ` | ${c.symbolType || 'symbol'}: ${c.symbolName}`
                : '';
            return [
              `[${c.id}] ${c.filePath} (L${c.startLine}-L${c.endLine}${symbolLabel})`,
              '```',
              c.content,
              '```',
            ].join('\n');
          })
          .join('\n\n')
      : 'No matching code snippets were retrieved from the workspace for this question.';

  const userPrompt = [
    `Project: ${projectName}`,
    '',
    'RETRIEVED CODEBASE CONTEXT:',
    contextSection,
    '',
    'USER QUESTION:',
    question.trim(),
    '',
    'Remember: Base your answer strictly on the retrieved codebase context above. Cite sources as [S1], [S2], etc. If the context does not answer the question, state clearly that the retrieved code does not contain enough information.',
  ].join('\n');

  const contents = [
    ...historyTurns,
    {
      role: 'user',
      parts: [{ text: userPrompt }],
    },
  ];

  return {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents,
    sanitizedChunks,
  };
}

/**
 * Extracts valid citation IDs (e.g. ['S1', 'S2']) referenced in the model's answer.
 * Only returns IDs that actually existed in the provided context chunks.
 *
 * @param {string} answerText
 * @param {Array<{ id: string }>} sanitizedChunks
 * @returns {string[]}
 */
export function extractReferencedCitations(answerText = '', sanitizedChunks = []) {
  if (!answerText || !Array.isArray(sanitizedChunks) || sanitizedChunks.length === 0) {
    return [];
  }
  const validIds = new Set(sanitizedChunks.map((c) => c.id));
  const found = [];
  const seen = new Set();
  const matches = answerText.matchAll(/\[(S\d+)\]/g);
  for (const match of matches) {
    const id = match[1];
    if (validIds.has(id) && !seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}
