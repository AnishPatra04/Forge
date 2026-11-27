import 'dotenv/config';
import express from 'express';
import { generateGeminiAnswer, getGeminiConfig, GeminiApiError } from './geminiClient.js';
import { buildRagPromptPayload, extractReferencedCitations } from './ragPrompt.js';
import {
  buildFileReviewPrompt,
  buildBatchReviewPrompt,
  parseAndValidateReviewResponse,
  MAX_BATCH_FILES,
} from './reviewPrompt.js';
import {
  buildImpactPromptPayload,
  parseAndValidateImpactResponse,
} from './impactPrompt.js';

const MAX_QUESTION_CHARS = 2000;

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '512kb' }));

  // Allow local frontend access if called directly without Vite proxy
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  app.get('/api/health', (_req, res) => {
    const { isConfigured, model } = getGeminiConfig();
    res.json({
      ok: true,
      status: 'running',
      provider: 'google-gemini',
      model,
      geminiConfigured: isConfigured,
      endpoints: [
        '/api/health',
        '/api/assistant/ask',
        '/api/review/file',
        '/api/review/project-batch',
        '/api/impact/analyze',
      ],
    });
  });

  app.post('/api/assistant/ask', async (req, res) => {
    const {
      question,
      projectName = 'Active Workspace',
      contextChunks = [],
      conversationHistory = [],
    } = req.body || {};

    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'A non-empty "question" string is required.',
      });
    }

    if (question.trim().length > MAX_QUESTION_CHARS) {
      return res.status(400).json({
        ok: false,
        code: 'QUESTION_TOO_LONG',
        error: `Question exceeds maximum length of ${MAX_QUESTION_CHARS} characters.`,
      });
    }

    if (!Array.isArray(contextChunks)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: '"contextChunks" must be an array.',
      });
    }

    if (!Array.isArray(conversationHistory)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: '"conversationHistory" must be an array.',
      });
    }

    try {
      const { systemInstruction, contents, sanitizedChunks } = buildRagPromptPayload({
        question,
        projectName: typeof projectName === 'string' ? projectName.slice(0, 120) : 'Active Workspace',
        contextChunks,
        conversationHistory,
      });

      const result = await generateGeminiAnswer({
        systemInstruction,
        contents,
      });

      const citationsUsed = extractReferencedCitations(result.text, sanitizedChunks);

      return res.json({
        ok: true,
        answer: result.text,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        citationsUsed,
        contextChunkCount: sanitizedChunks.length,
      });
    } catch (err) {
      if (err instanceof GeminiApiError) {
        return res.status(err.status).json({
          ok: false,
          code: err.code,
          error: err.message,
          retryable: err.retryable,
        });
      }

      console.error('[FORGE Assistant] Unexpected error:', err);
      return res.status(500).json({
        ok: false,
        code: 'INTERNAL_ERROR',
        error: 'Unexpected server error while generating an answer.',
      });
    }
  });

  app.post('/api/review/file', async (req, res) => {
    const {
      file,
      scope = null,
      supportingChunks = [],
      projectName = 'Active Workspace',
    } = req.body || {};

    if (!file || typeof file !== 'object') {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'A valid "file" object with path/name and content is required.',
      });
    }

    const filePath = typeof file.path === 'string' && file.path.trim()
      ? file.path.trim()
      : typeof file.name === 'string' && file.name.trim()
        ? file.name.trim()
        : '';

    if (!filePath) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'File must include a non-empty "path" or "name".',
      });
    }

    if (typeof file.content !== 'string' || !file.content.trim()) {
      return res.status(400).json({
        ok: false,
        code: 'EMPTY_FILE',
        error: `Cannot review "${filePath}" because the file is empty.`,
      });
    }

    if (!Array.isArray(supportingChunks)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: '"supportingChunks" must be an array.',
      });
    }

    try {
      const { systemInstruction, contents, allowedFiles, truncated, reviewedRange } =
        buildFileReviewPrompt({
          file,
          scope,
          supportingChunks,
          projectName: typeof projectName === 'string' ? projectName.slice(0, 120) : 'Active Workspace',
        });

      const result = await generateGeminiAnswer({
        systemInstruction,
        contents,
        temperature: 0.15,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      });

      const validated = parseAndValidateReviewResponse(result.text, allowedFiles);
      if (!validated.ok) {
        return res.status(502).json({
          ok: false,
          code: 'INVALID_MODEL_RESPONSE',
          error: validated.error,
        });
      }

      return res.json({
        ok: true,
        mode: 'file',
        targetFile: filePath,
        scope: scope?.symbolName ? scope : null,
        reviewedRange,
        truncated,
        summary: validated.summary,
        findings: validated.findings,
        totalFindings: validated.totalFindings,
        severityBreakdown: validated.severityBreakdown,
        rejectedFindingsCount: validated.rejectedCount,
        model: result.model,
        usage: result.usage,
      });
    } catch (err) {
      if (err instanceof GeminiApiError) {
        return res.status(err.status).json({
          ok: false,
          code: err.code,
          error: err.message,
          retryable: err.retryable,
        });
      }

      console.error('[FORGE Code Review] Unexpected error:', err);
      return res.status(500).json({
        ok: false,
        code: 'INTERNAL_ERROR',
        error: 'Unexpected server error while reviewing file.',
      });
    }
  });

  app.post('/api/review/project-batch', async (req, res) => {
    const { files = [], projectName = 'Active Workspace' } = req.body || {};

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'A non-empty "files" array is required for batch review.',
      });
    }

    if (files.length > MAX_BATCH_FILES) {
      return res.status(400).json({
        ok: false,
        code: 'BATCH_TOO_LARGE',
        error: `A single review batch can contain at most ${MAX_BATCH_FILES} files.`,
      });
    }

    const nonEmptyFiles = files.filter(
      (f) => f && typeof f === 'object' && typeof f.content === 'string' && f.content.trim()
    );
    if (nonEmptyFiles.length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'EMPTY_BATCH',
        error: 'None of the files in this batch contain reviewable source code.',
      });
    }

    try {
      const { systemInstruction, contents, allowedFiles } = buildBatchReviewPrompt({
        files: nonEmptyFiles,
        projectName: typeof projectName === 'string' ? projectName.slice(0, 120) : 'Active Workspace',
      });

      const result = await generateGeminiAnswer({
        systemInstruction,
        contents,
        temperature: 0.15,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      });

      const validated = parseAndValidateReviewResponse(result.text, allowedFiles);
      if (!validated.ok) {
        return res.status(502).json({
          ok: false,
          code: 'INVALID_MODEL_RESPONSE',
          error: validated.error,
        });
      }

      return res.json({
        ok: true,
        mode: 'project-batch',
        reviewedFiles: allowedFiles.map((f) => f.filePath),
        summary: validated.summary,
        findings: validated.findings,
        totalFindings: validated.totalFindings,
        severityBreakdown: validated.severityBreakdown,
        rejectedFindingsCount: validated.rejectedCount,
        model: result.model,
        usage: result.usage,
      });
    } catch (err) {
      if (err instanceof GeminiApiError) {
        return res.status(err.status).json({
          ok: false,
          code: err.code,
          error: err.message,
          retryable: err.retryable,
        });
      }

      console.error('[FORGE Batch Review] Unexpected error:', err);
      return res.status(500).json({
        ok: false,
        code: 'INTERNAL_ERROR',
        error: 'Unexpected server error while reviewing project batch.',
      });
    }
  });

  app.post('/api/impact/analyze', async (req, res) => {
    const {
      proposedChange,
      projectName = 'Active Workspace',
      parsedChange = null,
      resolvedTargets = [],
      impactedComponents = [],
      dependencyPaths = [],
      snippets = [],
      existingTests = [],
    } = req.body || {};

    if (typeof proposedChange !== 'string' || !proposedChange.trim()) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'A non-empty "proposedChange" description is required.',
      });
    }

    if (proposedChange.trim().length > MAX_QUESTION_CHARS) {
      return res.status(400).json({
        ok: false,
        code: 'CHANGE_TOO_LONG',
        error: `Proposed change description exceeds maximum length of ${MAX_QUESTION_CHARS} characters.`,
      });
    }

    if (!Array.isArray(snippets)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: '"snippets" must be an array.',
      });
    }

    try {
      const { systemInstruction, contents, sanitizedSnippets } = buildImpactPromptPayload({
        proposedChange,
        projectName: typeof projectName === 'string' ? projectName.slice(0, 120) : 'Active Workspace',
        parsedChange,
        resolvedTargets: Array.isArray(resolvedTargets) ? resolvedTargets : [],
        impactedComponents: Array.isArray(impactedComponents) ? impactedComponents : [],
        dependencyPaths: Array.isArray(dependencyPaths) ? dependencyPaths : [],
        snippets,
        existingTests: Array.isArray(existingTests) ? existingTests : [],
      });

      const result = await generateGeminiAnswer({
        systemInstruction,
        contents,
        temperature: 0.15,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      });

      const validated = parseAndValidateImpactResponse(
        result.text,
        sanitizedSnippets,
        Array.isArray(impactedComponents) ? impactedComponents : []
      );

      if (!validated.ok) {
        const isTruncated = result.finishReason === 'MAX_TOKENS';
        return res.status(502).json({
          ok: false,
          code: isTruncated ? 'MODEL_OUTPUT_TRUNCATED' : 'INVALID_MODEL_RESPONSE',
          error: isTruncated
            ? 'Gemini output exceeded the response token limit before completing the JSON payload.'
            : validated.error,
        });
      }

      return res.json({
        ok: true,
        overallAssessment: validated.overallAssessment,
        executiveSummary: validated.executiveSummary,
        findings: validated.findings,
        totalFindings: validated.totalFindings,
        severityBreakdown: validated.severityBreakdown,
        changeSequence: validated.changeSequence,
        additionalTestRecommendations: validated.additionalTestRecommendations,
        additionalUncertainties: validated.additionalUncertainties,
        rejectedFindingsCount: validated.rejectedCount,
        model: result.model,
        usage: result.usage,
      });
    } catch (err) {
      if (err instanceof GeminiApiError) {
        return res.status(err.status).json({
          ok: false,
          code: err.code,
          error: err.message,
          retryable: err.retryable,
        });
      }

      console.error('[FORGE Change Impact] Unexpected error:', err);
      return res.status(500).json({
        ok: false,
        code: 'INTERNAL_ERROR',
        error: 'Unexpected server error while analyzing change impact.',
      });
    }
  });

  // Handle malformed JSON bodies cleanly
  app.use((err, _req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_JSON',
        error: 'Request body contains invalid JSON.',
      });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Request context is too large.',
      });
    }
    return next(err);
  });

  // Always return structured JSON 404 for unknown /api routes
  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      code: 'ROUTE_NOT_FOUND',
      error: `API route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  return app;
}

// Start server only when executed directly
const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isDirectRun) {
  const port = Number.parseInt(process.env.PORT || '3001', 10) || 3001;
  const app = createApp();
  const { isConfigured, model } = getGeminiConfig();

  app.listen(port, () => {
    console.log(`[FORGE API] Listening on http://localhost:${port}`);
    console.log(
      `[FORGE API] Gemini model: ${model} | API key configured: ${isConfigured ? 'yes' : 'NO (set GEMINI_API_KEY in .env)'}`
    );
  });
}
