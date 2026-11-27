/**
 * Secure server-side Google Gemini REST API client.
 * Reads credentials strictly from process.env on the backend.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_TIMEOUT_MS = 30000;

export class GeminiApiError extends Error {
  constructor(message, { status = 500, code = 'GEMINI_ERROR', retryable = false } = {}) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function getGeminiConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const model = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const parsedTimeout = Number.parseInt(process.env.GEMINI_TIMEOUT_MS || '', 10);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout >= 5000 && parsedTimeout <= 120000
      ? parsedTimeout
      : DEFAULT_TIMEOUT_MS;

  const isPlaceholder =
    !apiKey ||
    apiKey === 'your_gemini_api_key_here' ||
    apiKey.toLowerCase().startsWith('your_');

  return {
    apiKey: isPlaceholder ? '' : apiKey,
    isConfigured: !isPlaceholder,
    model,
    timeoutMs,
  };
}

/**
 * Calls Google Gemini's generateContent endpoint.
 *
 * @param {object} params
 * @param {object} params.systemInstruction
 * @param {Array<object>} params.contents
 * @param {number} [params.temperature]
 * @param {number} [params.maxOutputTokens]
 * @returns {Promise<{ text: string, model: string, finishReason: string|null, usage: object|null }>}
 */
export async function generateGeminiAnswer({
  systemInstruction,
  contents,
  temperature = 0.2,
  maxOutputTokens = 2048,
  responseMimeType = undefined,
}) {
  const { apiKey, isConfigured, model, timeoutMs } = getGeminiConfig();

  if (!isConfigured) {
    throw new GeminiApiError(
      'GEMINI_API_KEY is not configured on the backend server. Add a valid key to your .env file and restart the backend server.',
      { status: 503, code: 'MISSING_API_KEY', retryable: false }
    );
  }

  const endpoint = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const generationConfig = {
    temperature,
    maxOutputTokens,
    ...(responseMimeType ? { responseMimeType } : {}),
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction,
        contents,
        generationConfig,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new GeminiApiError(
        `Gemini API request timed out after ${Math.round(timeoutMs / 1000)}s. Please try again.`,
        { status: 504, code: 'TIMEOUT', retryable: true }
      );
    }
    throw new GeminiApiError(
      `Failed to reach Gemini API: ${err?.message || 'Network error'}`,
      { status: 502, code: 'NETWORK_ERROR', retryable: true }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message || `Gemini API returned HTTP ${response.status}.`;

    if (response.status === 401 || response.status === 403) {
      throw new GeminiApiError(
        `Gemini API authentication failed (${response.status}): ${apiMessage}`,
        { status: response.status, code: 'INVALID_API_KEY', retryable: false }
      );
    }

    if (response.status === 429) {
      throw new GeminiApiError(
        `Gemini API rate limit or quota exceeded: ${apiMessage}`,
        { status: 429, code: 'RATE_LIMITED', retryable: true }
      );
    }

    if (response.status === 404) {
      throw new GeminiApiError(
        `Configured Gemini model "${model}" was not found or is unavailable: ${apiMessage}`,
        { status: 502, code: 'MODEL_UNAVAILABLE', retryable: false }
      );
    }

    throw new GeminiApiError(apiMessage, {
      status: response.status >= 500 ? 502 : response.status,
      code: 'UPSTREAM_ERROR',
      retryable: response.status >= 500,
    });
  }

  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();

  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason || candidate?.finishReason;
    throw new GeminiApiError(
      blockReason
        ? `Gemini did not return an answer (reason: ${blockReason}).`
        : 'Gemini returned an empty response.',
      { status: 502, code: 'EMPTY_RESPONSE', retryable: true }
    );
  }

  const usageMetadata = data?.usageMetadata || null;
  const usage = usageMetadata
    ? {
        promptTokens: usageMetadata.promptTokenCount ?? null,
        outputTokens: usageMetadata.candidatesTokenCount ?? null,
        totalTokens: usageMetadata.totalTokenCount ?? null,
      }
    : null;

  return {
    text,
    model,
    finishReason: candidate?.finishReason || null,
    usage,
  };
}
