import OpenAI from 'openai';

// Only fixed, reviewed text is printed. Never interpolate an upstream message,
// URL, header, error code, response body, or credential into a diagnostic.
export const diagnosticMessages = {
  authentication: 'Authentication was rejected (HTTP 401). Check that the backend key is correct, active, and belongs to your OpenAI project.',
  permission: 'Access was denied (HTTP 403). Check the key and project permissions for the Responses API and selected model. A network gateway may also deny access.',
  quota: 'OpenAI reported insufficient API quota. Check API billing, credits, and project limits. A ChatGPT subscription does not include API usage.',
  rate_limit: 'The service returned HTTP 429. Check API usage and limits; wait before retrying. This response alone does not establish available credit.',
  model_access: 'The configured model or API resource was not found. Check LUMORA_OPENAI_MODEL and your project model access.',
  invalid_request: 'The service rejected the request (HTTP 400/422). Check that the configured model supports the Responses API and the request options.',
  tls: 'TLS certificate verification failed. On Windows with Node 24, try $env:NODE_USE_SYSTEM_CA = "1" in this PowerShell window, then retry. If it persists, check the system clock and ask your IT team about the trusted network certificate.',
  timeout: 'The request timed out. Check network/proxy connectivity before retrying. A timed-out request may still incur API charges.',
  connection: 'The request could not connect. Check Internet, DNS, firewall, and proxy settings for api.openai.com.',
  provider: 'The service returned a server error (HTTP 5xx). Try again later and check the OpenAI service status.',
  response: 'A complete, usable text reply was not received. Check model compatibility and retry.',
  unknown: 'The failure could not be categorized safely. Check the API key, model access, billing, and network settings.',
} as const;
export type OpenAIDiagnostic = keyof typeof diagnosticMessages;

const tlsCodes = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function diagnoseOpenAI(error: unknown): OpenAIDiagnostic {
  if (error instanceof OpenAI.APIError && error.status !== undefined) {
    if (error.status === 401) return 'authentication';
    if (error.status === 403) return 'permission';
    if (error.status === 429) return error.code === 'insufficient_quota' ? 'quota' : 'rate_limit';
    if (error.status === 404 || error.code === 'model_not_found') return 'model_access';
    if (error.status === 400 || error.status === 422) return 'invalid_request';
    if (error.status >= 500 && error.status <= 599) return 'provider';
  }
  // Node fetch and the SDK wrap TLS errors in causes; some connection failures
  // are AggregateErrors. Bound traversal and handle cycles without serializing.
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  for (let visited = 0; pending.length && visited < 16; visited++) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const detail = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof detail.code === 'string' && tlsCodes.has(detail.code)) return 'tls';
    pending.push(detail.cause);
    if (Array.isArray(detail.errors)) pending.push(...detail.errors.slice(0, 8));
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof OpenAI.APIConnectionError) return 'connection';
  return 'unknown';
}
