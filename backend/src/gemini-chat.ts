import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici';
import { ChatProviderError, guidanceForContext, type AIDiagnostic, type ChatResponder } from './ai-types.js';
import { diagnoseTransport } from './openai-diagnostics.js';

const unavailable = (diagnostic: AIDiagnostic) => new ChatProviderError(503, 'The AI service is unavailable right now. Please try again later.', diagnostic);
type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
};
type GeminiFetch = (url: string, init: {
  method: 'POST'; redirect: 'error'; signal: AbortSignal;
  headers: Record<string, string>; body: string;
}) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export function responderFromGemini(apiKey: string, model: string, fetcher: GeminiFetch, timeoutMs = 35000): ChatResponder {
  // A model name can never redirect the key to another destination or add URL parameters.
  if (!/^gemini-[a-zA-Z0-9._-]+$/.test(model)) throw unavailable('configuration');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return async (messages, context) => {
    try {
      const response = await fetcher(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: guidanceForContext(context) }] },
          contents: messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
          generationConfig: { candidateCount: 1, maxOutputTokens: 4096 },
        }),
      });
      if (!response.ok) {
        // Only known status/reason values affect classification. Never retain the raw body.
        let invalidKey = false;
        try {
          const body = await response.json() as { error?: { details?: { reason?: string }[] } };
          invalidKey = Array.isArray(body?.error?.details) && body.error.details.some(detail => detail?.reason === 'API_KEY_INVALID');
        } catch { /* A proxy may return HTML; HTTP status still gives a safe category. */ }
        const status = response.status;
        throw unavailable(invalidKey || status === 401 ? 'authentication'
          : status === 403 ? 'permission' : status === 429 ? 'rate_limit'
          : status === 404 ? 'model_access' : status === 400 || status === 422 ? 'invalid_request'
          : status >= 500 && status <= 599 ? 'provider' : 'unknown');
      }
      let body: GeminiResponse;
      try { body = await response.json() as GeminiResponse; }
      catch { throw new ChatProviderError(502, 'No complete reply was received. Please try again.', 'response'); }
      const candidate = body?.candidates?.[0];
      if (body?.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(candidate?.finishReason ?? '')) {
        throw new ChatProviderError(422, 'The AI provider could not answer this request. Please rephrase it or try a different topic.', 'response');
      }
      if (candidate?.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts)) {
        throw new ChatProviderError(502, 'The reply was incomplete. Please try again.', 'response');
      }
      const text = candidate.content.parts.filter(part => part && part.thought !== true && typeof part.text === 'string').map(part => part.text).join('').trim();
      if (!text || Array.from(text).length > 8000) throw new ChatProviderError(502, 'No complete reply was received. Please try again.', 'response');
      return text;
    } catch (error) {
      if (error instanceof ChatProviderError) throw error;
      throw unavailable(diagnoseTransport(error) ?? 'connection');
    }
  };
}

export function configuredGeminiResponder(): ChatResponder | undefined {
  const apiKey = process.env.LUMORA_GEMINI_API_KEY?.trim();
  if (!apiKey) return undefined;
  const dispatcher = new EnvHttpProxyAgent();
  const fetcher: GeminiFetch = (url, init) => proxyFetch(url, { ...init, dispatcher });
  return responderFromGemini(apiKey, process.env.LUMORA_GEMINI_MODEL?.trim() || 'gemini-flash-latest', fetcher);
}
