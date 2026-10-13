import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { responderFromGemini } from '../src/gemini-chat.js';
import { ChatProviderError, guidance, type AIDiagnostic } from '../src/ai-types.js';
import { formatAICheckFailure, selectedProvider } from '../src/ai-provider.js';

type Fetcher = Parameters<typeof responderFromGemini>[2];
const response = (text = 'Try one manageable step.') => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
const fake = (body: unknown, status = 200): Fetcher => async () => new Response(JSON.stringify(body), { status });

test('Gemini REST uses server-only header, fixed origin, system guidance, and mapped history', async () => {
  let calls = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
    assert.ok(!url.includes('test-secret'));
    assert.equal(init.headers['x-goog-api-key'], 'test-secret');
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.systemInstruction, { parts: [{ text: guidance }] });
    assert.deepEqual(body.contents, [
      { role: 'user', parts: [{ text: 'First question' }] },
      { role: 'model', parts: [{ text: 'Previous answer' }] },
      { role: 'user', parts: [{ text: 'Follow-up' }] },
    ]);
    assert.deepEqual(body.generationConfig, { candidateCount: 1, maxOutputTokens: 4096 });
    assert.equal(body.tools, undefined);
    assert.equal(body.safetySettings, undefined);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [
      { text: 'private thought', thought: true }, { text: 'A small ' }, { text: 'step.' }, { inlineData: {} },
    ] } }] }));
  };
  const respond = responderFromGemini('test-secret', 'gemini-flash-latest', fetcher);
  assert.equal(await respond([{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'Previous answer' }, { role: 'user', content: 'Follow-up' }]), 'A small step.');
  assert.equal(calls, 1);
});

test('Gemini refuses incomplete, blocked, malformed, empty, and oversized replies', async () => {
  const cases = [null, {}, { candidates: [] }, response(''), response('x'.repeat(8001)),
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] },
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'unsafe output' }] } }] },
    { promptFeedback: { blockReason: 'SAFETY' }, ...response('unsafe output') },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'private thought', thought: true }] } }] },
  ];
  for (const body of cases) {
    await assert.rejects(() => responderFromGemini('test-secret', 'gemini-flash-latest', fake(body))([]), (error: unknown) => {
      assert.ok(error instanceof ChatProviderError);
      assert.equal(error.diagnostic, 'response');
      assert.doesNotMatch(error.message + formatAICheckFailure(error, 'gemini'), /unsafe output|private thought/);
      return true;
    });
  }
  await assert.rejects(() => responderFromGemini('test-secret', 'gemini-flash-latest', async () => new Response('invalid JSON'))([]), (error: unknown) => error instanceof ChatProviderError && error.diagnostic === 'response');
});

test('Gemini HTTP errors are categorized without leaking bodies or retrying', async () => {
  const cases: [number, AIDiagnostic, string?][] = [[401, 'authentication'], [400, 'authentication', 'API_KEY_INVALID'],
    [403, 'permission'], [404, 'model_access'], [429, 'rate_limit'], [400, 'invalid_request'], [500, 'provider'], [418, 'unknown']];
  for (const [status, diagnostic, reason] of cases) {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'fake-secret-private-provider-message', details: [{ reason }] } }), { status });
    };
    await assert.rejects(() => responderFromGemini('test-secret', 'gemini-flash-latest', fetcher)([]), (error: unknown) => {
      assert.ok(error instanceof ChatProviderError);
      assert.equal(error.diagnostic, diagnostic);
      assert.equal(error.status, 503);
      assert.doesNotMatch(formatAICheckFailure(error, 'gemini') + JSON.stringify(error), /fake-secret|test-secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(() => responderFromGemini('test-secret', 'gemini-flash-latest', async () => new Response('private gateway HTML', { status: 403 }))([]), (error: unknown) => error instanceof ChatProviderError && error.diagnostic === 'permission');
});

test('Gemini transport errors preserve TLS and timeout categories without sensitive causes', async () => {
  const certificate = Object.assign(new Error('private certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' });
  await assert.rejects(() => responderFromGemini('test-secret', 'gemini-flash-latest', async () => { throw new TypeError('fetch failed', { cause: certificate }); })([]), (error: unknown) => error instanceof ChatProviderError && error.diagnostic === 'tls' && !JSON.stringify(error).includes('private certificate'));
  await assert.rejects(() => responderFromGemini('test-secret', 'gemini-flash-latest', async () => { throw new Error('private URL'); })([]), (error: unknown) => error instanceof ChatProviderError && error.diagnostic === 'connection');
  let calls = 0;
  const fetcher: Fetcher = async (_url, init) => {
    calls++; await delay(20); assert.equal(init.signal.aborted, true); throw init.signal.reason;
  };
  await assert.rejects(() => responderFromGemini('test-secret', 'gemini-flash-latest', fetcher, 1)([]), (error: unknown) => error instanceof ChatProviderError && error.diagnostic === 'timeout');
  assert.equal(calls, 1);
});

test('model configuration cannot send the key to another URL or inject query parameters', () => {
  for (const model of ['https://example.invalid', '../gemini-flash-latest', 'gemini-x?key=bad', 'gemini-x/other', '']) {
    assert.throws(() => responderFromGemini('test-secret', model, async () => { throw new Error('must not fetch'); }), (error: unknown) => error instanceof ChatProviderError && error.diagnostic === 'configuration');
  }
});

test('provider selection defaults to Gemini and requires explicit OpenAI selection', () => {
  assert.equal(selectedProvider({ LUMORA_OPENAI_API_KEY: 'test-only-existing-openai-key' }), 'gemini');
  assert.equal(selectedProvider({ LUMORA_AI_PROVIDER: 'openai' }), 'openai');
  assert.equal(selectedProvider({ LUMORA_AI_PROVIDER: ' GEMINI ' }), 'gemini');
  assert.throws(() => selectedProvider({ LUMORA_AI_PROVIDER: 'fake-secret-unsupported-provider' }), (error: unknown) => error instanceof ChatProviderError && error.diagnostic === 'configuration' && !error.message.includes('fake-secret'));
});

test('CLI with missing Gemini key never falls back to an existing OpenAI key', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/check-ai.ts'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, LUMORA_AI_PROVIDER: '', LUMORA_GEMINI_API_KEY: '', LUMORA_OPENAI_API_KEY: 'test-only-existing-openai-key' },
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 1);
  assert.match(result.stderr, /Gemini check not run: configure LUMORA_GEMINI_API_KEY/);
  assert.doesNotMatch(result.stdout + result.stderr, /test-only-existing-openai-key|OpenAI check/);
});
