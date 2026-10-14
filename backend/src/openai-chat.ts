import OpenAI from 'openai';
import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici';
import { diagnoseOpenAI, diagnosticMessages } from './openai-diagnostics.js';

import { ChatProviderError, guidanceForContext, type ChatResponder } from './ai-types.js';
export { ChatProviderError, guidance, type ChatInput, type ChatResponder } from './ai-types.js';

export function formatOpenAICheckFailure(error: unknown): string {
  const diagnostic = error instanceof ChatProviderError ? error.diagnostic : 'unknown';
  return `OpenAI check failed [${diagnostic}]: ${diagnosticMessages[diagnostic]}`;
}

// Injecting an SDK client allows contract tests to use a fake HTTP transport, not live billing.
export function responderFromClient(client: OpenAI, model: string): ChatResponder {
  return async (messages, context) => {
    try {
      const response = await client.responses.create({ model, instructions: guidanceForContext(context),
        input: messages, max_output_tokens: 900, store: false });
      if (response.status !== 'completed') throw new ChatProviderError(502, 'The reply was incomplete. Please try again.', 'response');
      const text = response.output_text?.trim() || response.output.flatMap(item =>
        item.type === 'message' ? item.content.flatMap(part => part.type === 'refusal' ? [part.refusal] : []) : []).join('\n').trim();
      if (!text || Array.from(text).length > 8000) throw new ChatProviderError(502, 'No complete reply was received. Please try again.', 'response');
      return text;
    } catch (error) {
      if (error instanceof ChatProviderError) throw error;
      // Provider errors may contain request content or credentials; never expose or log them.
      throw new ChatProviderError(503, 'The AI service is unavailable right now. Please try again later.', diagnoseOpenAI(error));
    }
  };
}

export function configuredResponder(): ChatResponder | undefined {
  const apiKey = process.env.LUMORA_OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1',
    timeout: 35000, maxRetries: 0, logLevel: 'off', fetch: proxyFetch as unknown as typeof globalThis.fetch,
    fetchOptions: { dispatcher: new EnvHttpProxyAgent() } });
  return responderFromClient(client, process.env.LUMORA_OPENAI_MODEL || 'gpt-4.1-mini');
}
