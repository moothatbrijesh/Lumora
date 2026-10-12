import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { ChatProviderError, guidance, responderFromClient } from '../src/openai-chat.js';
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
