import 'dotenv/config';
import express from 'express';
import { generateGeminiAnswer, getGeminiConfig, GeminiApiError } from './geminiClient.js';
import { buildRagPromptPayload, extractReferencedCitations } from './ragPrompt.js';

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
