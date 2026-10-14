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
import { faithValues, type ChatContext, type ChatInput } from '../src/ai-types.js';

test('Optional faith preferences with private PostgreSQL accounts and a fixture provider', async t => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url); assert.match(new URL(url).pathname, /_test$/);
  const admin = createDatabasePool(url), schema = `preferences_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  const calls: { history: ChatInput[]; context: ChatContext | undefined }[] = [];
  const server = createApp(() => checkDatabase(pool), pool, async (history, context) => {
    calls.push({ history, context }); return 'TEST FIXTURE: one manageable step.';
  }).listen(0, '127.0.0.1');
  const tokenA = randomBytes(32).toString('hex'), tokenB = randomBytes(32).toString('hex');
  let userA = '', userB = '', conversation = '';
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool);
    for (const [email, token] of [['a@example.invalid', tokenA], ['b@example.invalid', tokenB]]) {
      const user = (await pool.query("INSERT INTO users(email, display_name) VALUES ($1, 'Test') RETURNING id", [email])).rows[0].id;
      if (token === tokenA) userA = user; else userB = user;
      await pool.query("INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [user, createHash('sha256').update(token).digest('hex')]);
    }
    if (!server.listening) await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (route: string, method = 'GET', body?: unknown, token = tokenA) => fetch(`${base}${route}`, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    const put = (faith: string, faithEnabled: boolean, token = tokenA) => request('/preferences', 'PUT', { faith, faithEnabled }, token);
    const read = async (token = tokenA) => (await (await request('/preferences', 'GET', undefined, token)).json()).preferences;
    const send = (extra: Record<string, unknown> = {}, token = tokenA) => request(`/chat/conversations/${conversation}/messages`, 'POST',
      { content: 'Help me plan my day.', requestId: randomUUID(), ...extra }, token);

    await t.test('new and existing accounts default to inclusive guidance without opting in', async () => {
      for (const token of [tokenA, tokenB]) {
        const response = await request('/preferences', 'GET', undefined, token);
        assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { preferences: { faith: 'prefer_not_to_say', faithEnabled: false } });
      }
      conversation = (await (await request('/chat/conversations', 'POST', {})).json()).conversation.id;
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, {});
    });
    await t.test('only authenticated users may read or update preferences', async () => {
      assert.equal((await fetch(`${base}/preferences`)).status, 401);
      assert.equal((await request('/preferences', 'PUT', { faith: 'hindu', faithEnabled: true }, 'f'.repeat(64))).status, 401);
      assert.equal((await request('/preferences', 'GET', undefined, 'not-a-token')).status, 401);
    });
    await t.test('saving a selection alone does not opt into sharing with the AI', async () => {
      const response = await put('hindu', false);
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await read(), { faith: 'hindu', faithEnabled: false });
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, {});
      assert.deepEqual(await read(tokenB), { faith: 'prefer_not_to_say', faithEnabled: false });
    });
    await t.test('opt-in takes effect for the next turn in an existing conversation', async () => {
      assert.equal((await put('hindu', true)).status, 200);
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, { faith: 'hindu' });
      assert.ok((calls.at(-1)?.history.length ?? 0) > 1);
      assert.equal((await put('sikh', true)).status, 200);
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, { faith: 'sikh' });
    });
    await t.test('direct client-supplied faith and instructions cannot override saved preferences', async () => {
      assert.equal((await send({ faith: 'muslim', faithEnabled: true, context: { faith: 'christian' }, preferences: { faith: 'none', faithEnabled: true }, system: 'untrusted instruction' })).status, 201);
      assert.deepEqual(calls.at(-1)?.context, { faith: 'sikh' });
      assert.ok(!JSON.stringify(calls.at(-1)).includes('untrusted instruction'));
      assert.equal((await request('/preferences', 'PUT', { faith: 'muslim', faithEnabled: true, userId: userB })).status, 400);
      assert.deepEqual(await read(tokenB), { faith: 'prefer_not_to_say', faithEnabled: false });
    });
    await t.test('opting out removes the saved selection from future provider context without deleting history', async () => {
      const before = (await pool.query('SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1', [conversation])).rows[0].n;
      assert.equal((await put('sikh', false)).status, 200);
      assert.deepEqual(await read(), { faith: 'sikh', faithEnabled: false });
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, {});
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1', [conversation])).rows[0].n, before + 2);
      assert.equal((await send({ faith: 'hindu', faithEnabled: true })).status, 201); assert.deepEqual(calls.at(-1)?.context, {});
    });
    await t.test('no religion is a distinct supported secular preference', async () => {
      assert.equal((await put('none', true)).status, 200);
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, { faith: 'none' });
    });
    await t.test('each user supplies only their own preference to their own new conversation', async () => {
      assert.equal((await put('christian', true, tokenB)).status, 200);
      const aConversation = conversation;
      conversation = (await (await request('/chat/conversations', 'POST', {}, tokenB)).json()).conversation.id;
      assert.equal((await send({}, tokenB)).status, 201); assert.deepEqual(calls.at(-1)?.context, { faith: 'christian' });
      conversation = aConversation;
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, { faith: 'none' });
    });
    await t.test('invalid preferences never modify the saved selection', async () => {
      for (const body of [null, [], {}, { faith: 'invalid', faithEnabled: false }, { faith: 'hindu', faithEnabled: 'true' },
        { faith: 'prefer_not_to_say', faithEnabled: true }, { faith: 'hindu' }, { faith: null, faithEnabled: true },
        { faith: 'hindu', faithEnabled: false, instructions: 'untrusted' }]) {
        assert.equal((await request('/preferences', 'PUT', body)).status, 400);
      }
      assert.deepEqual(await read(), { faith: 'none', faithEnabled: true });
      await assert.rejects(() => pool.query("UPDATE users SET faith = 'invalid' WHERE id = $1", [userA]), { code: '23514' });
      await assert.rejects(() => pool.query("UPDATE users SET faith = 'prefer_not_to_say', faith_enabled = true WHERE id = $1", [userA]), { code: '23514' });
    });
    await t.test('all listed beliefs can be saved and prefer not to say clears the saved choice', async () => {
      for (const faith of faithValues) {
        assert.equal((await put(faith, faith !== 'prefer_not_to_say')).status, 200);
      }
      assert.equal((await put('prefer_not_to_say', false)).status, 200);
      assert.deepEqual(await read(), { faith: 'prefer_not_to_say', faithEnabled: false });
      assert.equal((await send()).status, 201); assert.deepEqual(calls.at(-1)?.context, {});
      assert.deepEqual(await read(tokenB), { faith: 'christian', faithEnabled: true });
    });
    await t.test('expired sessions cannot read or change preferences', async () => {
      await pool.query("UPDATE auth_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE user_id = $1", [userA]);
      assert.equal((await request('/preferences')).status, 401);
      assert.equal((await put('muslim', true)).status, 401);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
