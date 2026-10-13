import { ChatProviderError, type AIProvider, type ChatResponder } from './ai-types.js';
import { configuredGeminiResponder } from './gemini-chat.js';
import { configuredResponder as configuredOpenAIResponder, formatOpenAICheckFailure } from './openai-chat.js';
import { diagnoseTransport } from './openai-diagnostics.js';

export function selectedProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  const provider = env.LUMORA_AI_PROVIDER?.trim().toLowerCase() || 'gemini';
  if (provider === 'gemini' || provider === 'openai') return provider;
  throw new ChatProviderError(503, 'Choose gemini or openai for LUMORA_AI_PROVIDER.', 'configuration');
}
export const providerName = (provider: AIProvider) => provider === 'gemini' ? 'Gemini' : 'OpenAI';
export const providerKeyName = (provider: AIProvider) => provider === 'gemini' ? 'LUMORA_GEMINI_API_KEY' : 'LUMORA_OPENAI_API_KEY';

export function configuredResponder(provider: AIProvider = selectedProvider()): ChatResponder | undefined {
  // Never try a different provider when a key is missing or a request fails.
  try { return provider === 'gemini' ? configuredGeminiResponder() : configuredOpenAIResponder(); }
  catch (error) {
    if (error instanceof ChatProviderError) throw error;
    throw new ChatProviderError(503, 'AI configuration could not be loaded.', diagnoseTransport(error) ?? 'configuration');
  }
}

const geminiDiagnostics = {
  authentication: 'Gemini rejected the API key. Check the active key in Google AI Studio and backend/.env.',
  permission: 'Gemini access was denied. Check key restrictions, API access, project, and supported region; a network gateway can also deny access.',
  quota: 'Gemini quota is unavailable. Check the project Free Tier and selected model limits in AI Studio.',
  rate_limit: 'Gemini returned HTTP 429. Check available free quota and model limits in AI Studio, then wait for a reset before retrying. Do not enable paid billing just to retry.',
  model_access: 'The Gemini model was not found. Choose a currently available free-tier model in AI Studio and set LUMORA_GEMINI_MODEL.',
  invalid_request: 'Gemini rejected the request. Check model compatibility and regional/free-tier availability in AI Studio.',
  tls: 'TLS certificate verification failed. On Windows with Node 24, try $env:NODE_USE_SYSTEM_CA = "1" in this PowerShell window. Check the system clock and trusted network certificates if it persists.',
  timeout: 'The Gemini request timed out. Check connectivity before retrying; the request may still consume quota.',
  connection: 'Could not connect to generativelanguage.googleapis.com. Check Internet, DNS, firewall, and proxy settings.',
  provider: 'Gemini returned a server error. Check service status and retry later.',
  response: 'Gemini did not return a complete usable reply, or blocked the request. Try a different prompt or check model compatibility.',
  configuration: 'AI configuration is invalid. Check LUMORA_AI_PROVIDER, the Gemini model name, and proxy settings.',
  unknown: 'The failure could not be categorized safely. Check the Gemini key, model access, project quota, and network settings.',
} as const;

export function formatAICheckFailure(error: unknown, provider?: AIProvider): string {
  if (provider === 'openai') return formatOpenAICheckFailure(error);
  const diagnostic = error instanceof ChatProviderError ? error.diagnostic : 'unknown';
  return `${provider ? 'Gemini' : 'AI'} check failed [${diagnostic}]: ${geminiDiagnostics[diagnostic]}`;
}
