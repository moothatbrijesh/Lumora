import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import OpenAI from 'openai';
import { ChatProviderError, formatOpenAICheckFailure, guidance, responderFromClient } from '../src/openai-chat.js';
import { diagnoseOpenAI, type OpenAIDiagnostic } from '../src/openai-diagnostics.js';
function sdk(body: unknown, status = 200, capture?: (body: Record<string, unknown>) => void) {
  return new OpenAI({ apiKey: 'test-only-not-a-real-key', maxRetries: 0,
    fetch: async (_url, init) => {
      capture?.(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    } });
}
const completed = (content: unknown[]) => ({ id: 'resp_test', object: 'response', status: 'completed',
  output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content }] });

test('Responses request carries bounded history, guidance, and store:false', async () => {
  let captured: Record<string, unknown> = {};
  const respond = responderFromClient(sdk(completed([{ type: 'output_text', text: 'Try one manageable step.', annotations: [] }]), 200, body => { captured = body; }), 'gpt-4.1-mini');
  const history = [{ role: 'user' as const, content: 'Help me set a goal.' }];
  assert.equal(await respond(history), 'Try one manageable step.');
  assert.equal(captured.model, 'gpt-4.1-mini'); assert.equal(captured.instructions, guidance);
  assert.equal(captured.store, false); assert.equal(captured.max_output_tokens, 900);
  assert.deepEqual(captured.input, history); assert.equal(captured.tools, undefined);
});
test('provider refusals are displayed as safe text', async () => {
  const respond = responderFromClient(sdk(completed([{ type: 'refusal', refusal: 'I cannot help with harm. We can discuss a safer next step.' }])), 'gpt-4.1-mini');
  assert.match(await respond([{ role: 'user', content: 'test input' }]), /safer next step/);
});
test('incomplete and empty provider outputs fail instead of being saved', async () => {
  for (const body of [{ ...completed([]), status: 'incomplete' }, completed([])]) {
    await assert.rejects(() => responderFromClient(sdk(body), 'gpt-4.1-mini')([]), (error: unknown) => error instanceof ChatProviderError && error.status === 502);
  }
});
test('credential, quota, and provider failures are sanitized with no automatic retries', async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const respond = responderFromClient(sdk({ error: { message: 'sensitive upstream content', type: 'api_error' } }, status, () => calls++), 'gpt-4.1-mini');
    await assert.rejects(() => respond([]), (error: unknown) => error instanceof ChatProviderError && error.status === 503 && !error.message.includes('sensitive'));
    assert.equal(calls, 1);
  }
});

test('CLI distinguishes actionable HTTP failures without exposing upstream details', async () => {
  const cases: [number, string, OpenAIDiagnostic][] = [
    [401, 'invalid_api_key', 'authentication'], [403, 'permission_denied', 'permission'],
    [429, 'insufficient_quota', 'quota'], [429, 'rate_limit_exceeded', 'rate_limit'],
    [404, 'model_not_found', 'model_access'], [400, 'model_not_found', 'model_access'],
    [400, 'invalid_parameter', 'invalid_request'], [422, 'invalid_parameter', 'invalid_request'],
    [503, 'server_error', 'provider'], [418, 'fake-secret-in-unknown-code', 'unknown'],
  ];
  for (const [status, code, diagnostic] of cases) {
    let calls = 0;
    const respond = responderFromClient(sdk({ error: {
      message: 'fake-secret-in-message https://example.invalid/private-prompt', code, type: 'api_error',
    } }, status, () => calls++), 'gpt-4.1-mini');
    await assert.rejects(() => respond([]), (error: unknown) => {
      assert.ok(error instanceof ChatProviderError);
      assert.equal(error.status, 503);
      assert.equal(error.diagnostic, diagnostic);
      assert.equal(error.message, 'The AI service is unavailable right now. Please try again later.');
      assert.match(formatOpenAICheckFailure(error), new RegExp(`\\[${diagnostic}\\]`));
      assert.doesNotMatch(formatOpenAICheckFailure(error) + JSON.stringify(error), /fake-secret|example\.invalid|private-prompt/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('nested TLS transport failures survive SDK wrapping as a safe certificate diagnostic', async () => {
  let calls = 0;
  const certificate = Object.assign(new Error('fake-secret-in-certificate-message'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' });
  const client = new OpenAI({ apiKey: 'test-only-not-a-real-key', maxRetries: 0, logLevel: 'off',
    fetch: async () => { calls++; throw new TypeError('fetch failed', { cause: certificate }); } });
  await assert.rejects(() => responderFromClient(client, 'gpt-4.1-mini')([]), (error: unknown) => {
    assert.ok(error instanceof ChatProviderError);
    assert.equal(error.diagnostic, 'tls');
    assert.match(formatOpenAICheckFailure(error), /NODE_USE_SYSTEM_CA/);
    assert.doesNotMatch(formatOpenAICheckFailure(error) + JSON.stringify(error), /fake-secret/);
    return true;
  });
  assert.equal(calls, 1);
});

test('timeout, connection, aggregate, cyclic, and unknown errors are bounded and safely categorized', () => {
  assert.equal(diagnoseOpenAI(new OpenAI.APIConnectionTimeoutError()), 'timeout');
  assert.equal(diagnoseOpenAI(new OpenAI.APIConnectionError({ message: 'fake-secret-in-proxy-error' })), 'connection');
  const certificate = Object.assign(new Error('private certificate details'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  assert.equal(diagnoseOpenAI(new AggregateError([certificate], 'private aggregate')), 'tls');
  const cycle: { cause?: unknown; code: string } = { code: 'fake-secret-unknown-code' }; cycle.cause = cycle;
  assert.equal(diagnoseOpenAI(cycle), 'unknown');
  let deep: unknown = certificate;
  for (let i = 0; i < 100; i++) deep = { cause: deep };
  assert.equal(diagnoseOpenAI(deep), 'unknown');
  assert.match(formatOpenAICheckFailure(cycle), /\[unknown\]/);
  assert.doesNotMatch(formatOpenAICheckFailure(cycle), /fake-secret/);
  assert.match(formatOpenAICheckFailure(new ChatProviderError(502, 'private details', 'response')), /\[response\]/);
});

test('CLI catches startup configuration errors without printing proxy credentials', () => {
  // This malformed URL throws while building the proxy agent, before any request.
  const proxy = 'http://test-user:fake-proxy-secret@[invalid';
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/check-ai.ts'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, LUMORA_AI_PROVIDER: 'openai', LUMORA_OPENAI_API_KEY: 'test-only-not-a-real-key',
      HTTPS_PROXY: proxy, https_proxy: proxy, HTTP_PROXY: proxy, http_proxy: proxy, OPENAI_LOG: 'debug' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OpenAI check failed \[configuration\]/);
  assert.doesNotMatch(result.stdout + result.stderr, /fake-proxy-secret|test-user|test-only-not-a-real-key|ERR_INVALID_URL/);
});
