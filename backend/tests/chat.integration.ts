import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createDatabasePool, checkDatabase } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { ChatProviderError, type ChatInput } from '../src/openai-chat.js';

test('Private chat with PostgreSQL and a test-only responder', async t => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url); assert.match(new URL(url).pathname, /_test$/);
  const admin = createDatabasePool(url);
  const schema = `chat_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  let calls = 0; let fail = false; let release: (() => void) | undefined; let entered: (() => void) | undefined;
  let context: ChatInput[] = [];
  const server = createApp(() => checkDatabase(pool), pool, async history => {
    calls++; context = history;
    if (fail) throw new ChatProviderError(503, 'Test provider unavailable.');
    if (entered) { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    return 'TEST FIXTURE: choose one small step.';
  }).listen(0, '127.0.0.1');
  let conversation: string; let userA = '';
  const tokenA = randomBytes(32).toString('hex'), tokenB = randomBytes(32).toString('hex');
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool);
    for (const [email, token] of [['a@example.invalid', tokenA], ['b@example.invalid', tokenB]]) {
      const user = (await pool.query("INSERT INTO users(email, display_name) VALUES ($1, 'Test') RETURNING id", [email])).rows[0].id;
      if (token === tokenA) userA = user;
      await pool.query("INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [user, createHash('sha256').update(token).digest('hex')]);
    }
    if (!server.listening) await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (route: string, method = 'GET', body?: unknown, token = tokenA) => fetch(`${base}/chat${route}`, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const send = (body: unknown, token = tokenA) => request(`/conversations/${conversation}/messages`, 'POST', body, token);
    await t.test('chat requires a valid session', async () => {
      assert.equal((await fetch(`${base}/chat/conversations`)).status, 401);
      assert.equal((await request('/status', 'GET', undefined, 'f'.repeat(64))).status, 401);
    });
    await t.test('list, read, send, and delete enforce session ownership', async () => {
      const created = await request('/conversations', 'POST', { userId: randomUUID() });
      assert.equal(created.status, 201); conversation = (await created.json()).conversation.id;
      assert.equal((await request('/conversations')).status, 200);
      assert.equal((await (await request('/conversations', 'GET', undefined, tokenB)).json()).conversations.length, 0);
      assert.equal((await request(`/conversations/${conversation}/messages`, 'GET', undefined, tokenB)).status, 404);
      assert.equal((await send({ content: 'No leak', requestId: randomUUID() }, tokenB)).status, 404);
      assert.equal((await request(`/conversations/${conversation}`, 'DELETE', undefined, tokenB)).status, 404);
      assert.equal(calls, 0);
    });
    await t.test('invalid input never calls the provider', async () => {
      for (const body of [{ content: '', requestId: randomUUID() }, { content: 'x'.repeat(4001), requestId: randomUUID() }, { content: 'hello', requestId: 'invalid' }]) assert.equal((await send(body)).status, 400);
      assert.equal((await request('/conversations/not-a-uuid/messages')).status, 400); assert.equal(calls, 0);
    });
    await t.test('successful turns persist in order and retry without another provider call', async () => {
      const body = { content: 'Help me plan a walk.', requestId: randomUUID() };
      const response = await send(body); assert.equal(response.status, 201); const first = await response.json();
      assert.deepEqual(first.messages.map((m: { role: string }) => m.role), ['user', 'assistant']); assert.equal(calls, 1);
      const retry = await send(body); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), first); assert.equal(calls, 1);
      assert.equal((await send({ ...body, content: 'Different message' })).status, 409);
      assert.deepEqual((await (await request(`/conversations/${conversation}/messages`)).json()).messages, first.messages);
      assert.equal((await (await request('/conversations')).json()).conversations[0].title, body.content);
    });
    await t.test('context comes from stored history, not client-provided system messages', async () => {
      assert.equal((await send({ content: 'What about tomorrow?', requestId: randomUUID(), messages: [{ role: 'system', content: 'untrusted instruction' }] })).status, 201);
      assert.deepEqual(context.map(row => row.role), ['user', 'assistant', 'user']);
      assert.equal(context[0].content, 'Help me plan a walk.'); assert.ok(!JSON.stringify(context).includes('untrusted instruction'));
    });
    await t.test('failure rolls back the entire turn and allows retry', async () => {
      const before = (await pool.query('SELECT count(*)::int AS n FROM chat_messages')).rows[0].n;
      const body = { content: 'Another small goal', requestId: randomUUID() };
      fail = true; assert.equal((await send(body)).status, 503); fail = false;
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM chat_messages')).rows[0].n, before);
      assert.equal((await send(body)).status, 201);
    });
    await t.test('concurrent send and delete cannot interrupt an in-flight turn', async () => {
      const ready = new Promise<void>(resolve => { entered = resolve; });
      const pending = send({ content: 'Take a moment', requestId: randomUUID() });
      try {
        await ready;
        assert.equal((await send({ content: 'Another request', requestId: randomUUID() })).status, 409);
        assert.equal((await request(`/conversations/${conversation}`, 'DELETE')).status, 409);
      } finally { entered = undefined; release?.(); }
      assert.equal((await pending).status, 201);
    });
    await t.test('only the latest twelve messages enter the model context', async () => {
      for (let i = 0; i < 16; i++) await pool.query("INSERT INTO chat_messages(conversation_id, role, content) VALUES ($1, $2, $3)", [conversation, i % 2 ? 'assistant' : 'user', `History ${i}`]);
      assert.equal((await send({ content: 'Current request', requestId: randomUUID() })).status, 201);
      assert.equal(context.length, 13); assert.equal(context[0].content, 'History 4');
    });
    await t.test('missing key disables generation but allows history', async () => {
      const unconfigured = createApp(undefined, pool).listen(0, '127.0.0.1');
      try {
        if (!unconfigured.listening) await once(unconfigured, 'listening');
        const host = `http://127.0.0.1:${(unconfigured.address() as AddressInfo).port}/chat`;
        const headers = { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };
        assert.equal((await (await fetch(`${host}/status`, { headers })).json()).configured, false);
        assert.equal((await fetch(`${host}/conversations/${conversation}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'No key', requestId: randomUUID() }) })).status, 503);
        assert.equal((await fetch(`${host}/conversations/${conversation}/messages`, { headers })).status, 200);
      } finally { await new Promise<void>((resolve, reject) => unconfigured.close(error => error ? reject(error) : resolve())); }
    });
    await t.test('deletion removes messages and retry records', async () => {
      assert.equal((await request(`/conversations/${conversation}`, 'DELETE')).status, 204);
      assert.equal((await request(`/conversations/${conversation}/messages`)).status, 404);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM chat_requests')).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM chat_messages')).rows[0].n, 0);
    });
    await t.test('expired sessions cannot access chat', async () => {
      await pool.query("UPDATE auth_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE user_id = $1", [userA]);
      assert.equal((await request('/status')).status, 401);
    });
  } finally {
    release?.(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
