import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createDatabasePool, checkDatabase } from '../src/database.js';
import { migrate, seedDevelopment } from '../src/migrations.js';
import { verifyPassword } from '../src/passwords.js';

test('Authentication against real PostgreSQL', async t => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Set TEST_DATABASE_URL and start db-test.');
  assert.match(new URL(url).pathname, /_test$/);
  const admin = createDatabasePool(url);
  const schema = `auth_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`,
    max: 4, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  const server = createApp(() => checkDatabase(pool), pool).listen(0, '127.0.0.1');
  const password = 'A calm morning with tea 42';
  let tokenA: string, tokenB: string, userA: string, loginToken: string;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await migrate(pool);
    await seedDevelopment(pool);
    if (!server.listening) await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown, token?: string) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const me = (token?: string, suffix = '') => fetch(`${base}/auth/me${suffix}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    await t.test('registration validates input without creating records', async () => {
      for (const body of [{}, { email: 'bad', password, displayName: 'Name' }, { email: 'short@example.invalid', password: 'short', displayName: 'Name' }]) {
        assert.equal((await post('/auth/register', body)).status, 400);
      }
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 1);
    });
    await t.test('registration normalizes email, salts passwords, and stores only a session digest', async () => {
      const response = await post('/auth/register', { email: ' Alice@Example.invalid ', password, displayName: ' Alice ' });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json();
      assert.deepEqual(Object.keys(data.user).sort(), ['displayName', 'email', 'id']);
      assert.equal(data.user.email, 'alice@example.invalid');
      assert.equal(data.user.displayName, 'Alice');
      assert.match(data.token, /^[0-9a-f]{64}$/);
      assert.ok(Date.parse(data.expiresAt) > Date.now());
      tokenA = data.token; userA = data.user.id;
      const stored = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [userA])).rows[0].password_hash;
      assert.notEqual(stored, password);
      assert.match(stored, /^scrypt-v1\$/);
      assert.equal(await verifyPassword(password, stored), true);
      assert.equal(await verifyPassword('not the same password', stored), false);
      const session = (await pool.query('SELECT token_hash FROM auth_sessions WHERE user_id = $1', [userA])).rows[0];
      assert.equal(session.token_hash, createHash('sha256').update(tokenA).digest('hex'));
      assert.notEqual(session.token_hash, tokenA);
      const second = await post('/auth/register', { email: 'bob@example.invalid', password, displayName: 'Bob' });
      assert.equal(second.status, 201);
      const bob = await second.json(); tokenB = bob.token;
      const secondHash = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [bob.user.id])).rows[0].password_hash;
      assert.notEqual(stored, secondHash);
    });
    await t.test('duplicate normalized email cannot replace an existing account', async () => {
      const response = await post('/auth/register', { email: 'ALICE@example.invalid', password, displayName: 'Imposter' });
      assert.equal(response.status, 409);
      assert.equal((await pool.query('SELECT display_name FROM users WHERE id = $1', [userA])).rows[0].display_name, 'Alice');
    });
    await t.test('login fails identically for wrong passwords, unknown users, and password-less demo accounts', async () => {
      for (const [email, input] of [['alice@example.invalid', 'This is not the password'], ['missing@example.invalid', password], ['demo@example.invalid', password]]) {
        const response = await post('/auth/login', { email, password: input });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: 'Email or password is incorrect.' });
      }
    });
    await t.test('valid login issues an independent session', async () => {
      const response = await post('/auth/login', { email: 'ALICE@example.invalid', password });
      assert.equal(response.status, 200);
      const data = await response.json(); loginToken = data.token;
      assert.equal(data.user.id, userA);
      assert.notEqual(loginToken, tokenA);
    });
    await t.test('protected profile rejects missing or forged tokens and uses only the session owner', async () => {
      assert.equal((await me()).status, 401);
      assert.equal((await me('f'.repeat(64))).status, 401);
      const alice = await me(tokenA);
      assert.equal(alice.status, 200);
      assert.equal((await alice.json()).user.id, userA);
      const bob = await me(tokenB, `?userId=${userA}`);
      assert.equal((await bob.json()).user.email, 'bob@example.invalid');
    });
    await t.test('expired sessions cannot access the profile', async () => {
      await pool.query("UPDATE auth_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE token_hash = $1", [createHash('sha256').update(tokenA).digest('hex')]);
      assert.equal((await me(tokenA)).status, 401);
      assert.equal((await me(loginToken)).status, 200);
    });
    await t.test('logout revokes the session and is safe to retry without affecting other users', async () => {
      assert.equal((await post('/auth/logout', {}, loginToken)).status, 204);
      assert.equal((await me(loginToken)).status, 401);
      assert.equal((await post('/auth/logout', {}, loginToken)).status, 204);
      assert.equal((await me(tokenB)).status, 200);
    });
    await t.test('registration rolls back the account if session creation fails', async () => {
      await pool.query(`CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'sensitive internal detail'; END; $$;
        CREATE TRIGGER reject_session BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION reject_session();`);
      try {
        const response = await post('/auth/register', { email: 'rollback@example.invalid', password, displayName: 'Rollback' });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'Service is unavailable. Please try again later.' });
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE email = 'rollback@example.invalid'")).rows[0].n, 0);
      } finally { await pool.query('DROP TRIGGER reject_session ON auth_sessions; DROP FUNCTION reject_session();'); }
    });
    await t.test('malformed JSON, oversized bodies and unapproved browser origins are rejected', async () => {
      const invalid = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(invalid.status, 400);
      assert.equal((await post('/auth/register', { junk: 'x'.repeat(20000) })).status, 413);
      const denied = await fetch(`${base}/auth/me`, { headers: { Origin: 'https://unapproved.example' } });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
    });
    await t.test('account deletion cascades to sessions', async () => {
      await pool.query("DELETE FROM users WHERE email = 'bob@example.invalid'");
      assert.equal((await me(tokenB)).status, 401);
    });
    await t.test('repeated login attempts receive HTTP 429 and a retry header', async () => {
      const limitedServer = createApp(undefined, pool).listen(0, '127.0.0.1');
      try {
        if (!limitedServer.listening) await once(limitedServer, 'listening');
        const target = `http://127.0.0.1:${(limitedServer.address() as AddressInfo).port}/auth/login`;
        for (let i = 0; i < 20; i++) {
          assert.equal((await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
        }
        const blocked = await fetch(target, { method: 'POST' });
        assert.equal(blocked.status, 429);
        assert.ok(blocked.headers.get('retry-after'));
      } finally { await new Promise<void>((resolve, reject) => limitedServer.close(error => error ? reject(error) : resolve())); }
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
