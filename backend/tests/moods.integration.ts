import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { Pool } from 'pg';
import { createDatabasePool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { createMoodsRouter } from '../src/moods.js';

test('Private daily mood check-ins with PostgreSQL', async t => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url); assert.match(new URL(url).pathname, /_test$/);
  const admin = createDatabasePool(url);
  const schema = `moods_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  let clock = new Date('2027-01-01T00:30:00Z');
  const server = express().use(express.json({ limit: '16kb' })).use('/moods', createMoodsRouter(pool, () => clock)).listen(0, '127.0.0.1');
  const tokenA = randomBytes(32).toString('hex'), tokenB = randomBytes(32).toString('hex');
  let userA = '', userB = '';
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool);
    for (const [email, token] of [['mood-a@example.invalid', tokenA], ['mood-b@example.invalid', tokenB]]) {
      const id = (await pool.query("INSERT INTO users(email, display_name) VALUES ($1, 'Mood test') RETURNING id", [email])).rows[0].id;
      if (token === tokenA) userA = id; else userB = id;
      await pool.query("INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [id, createHash('sha256').update(token).digest('hex')]);
    }
    if (!server.listening) await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/moods`;
    const request = (route: string, method = 'GET', body?: unknown, token = tokenA) => fetch(`${base}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const valid = { timeZone: 'UTC', recordedOn: '2027-01-01', score: 4, note: 'A fictional fresh start.' };
    const save = (body: unknown = valid, token = tokenA) => request('/today', 'PUT', body, token);
    const read = (token = tokenA, timeZone = 'UTC') => request(`?timeZone=${encodeURIComponent(timeZone)}`, 'GET', undefined, token);
    let first: { id: string; score: number; note: string; recordedOn: string; createdAt: string };
    await t.test('authentication precedes validation and private responses are not cached', async () => {
      const absent = await fetch(base);
      assert.equal(absent.status, 401); assert.equal(absent.headers.get('Cache-Control'), 'no-store');
      assert.equal((await request('', 'GET', undefined, 'f'.repeat(64))).status, 401);
      assert.equal((await save({}, 'f'.repeat(64))).status, 401);
      const response = await read(); assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { today: '2027-01-01', entry: null, entries: [] });
    });
    await t.test('first save belongs to the signed-in user and trims its optional note', async () => {
      const response = await save({ ...valid, note: `  ${valid.note}\n`, userId: userB });
      assert.equal(response.status, 200); first = (await response.json()).entry;
      assert.equal(first.note, valid.note); assert.equal(first.score, 4); assert.equal(first.recordedOn, valid.recordedOn);
      assert.equal(typeof first.id, 'string'); assert.ok(Number.isFinite(Date.parse(first.createdAt)));
      assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'id', 'note', 'recordedOn', 'score']);
      const row = (await pool.query('SELECT user_id FROM mood_entries WHERE id = $1', [first.id])).rows[0];
      assert.equal(row.user_id, userA);
      assert.deepEqual(await (await read()).json(), { today: valid.recordedOn, entry: first, entries: [first] });
    });
    await t.test('identical retries and later edits keep one entry and its original identity', async () => {
      assert.deepEqual(await (await save()).json(), { entry: first });
      const updated = (await (await save({ ...valid, score: 2, note: 'A different feeling.' })).json()).entry;
      assert.equal(updated.id, first.id); assert.equal(updated.createdAt, first.createdAt);
      assert.equal(updated.score, 2); assert.equal(updated.note, 'A different feeling.');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM mood_entries WHERE user_id = $1', [userA])).rows[0].n, 1);
    });
    await t.test('concurrent retries cannot create duplicate daily entries', async () => {
      const responses = await Promise.all(Array.from({ length: 5 }, () => save()));
      for (const response of responses) {
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { entry: first });
      }
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM mood_entries WHERE user_id = $1', [userA])).rows[0].n, 1);
    });
    await t.test('different users cannot read or overwrite one another’s mood check-ins', async () => {
      assert.deepEqual(await (await read(tokenB)).json(), { today: valid.recordedOn, entry: null, entries: [] });
      const response = await save({ ...valid, score: 1, note: 'Private user B note.', userId: userA, id: first.id }, tokenB);
      assert.equal(response.status, 200); const other = (await response.json()).entry;
      assert.notEqual(other.id, first.id);
      assert.deepEqual((await (await read()).json()).entry, first);
      assert.deepEqual((await (await read(tokenB)).json()).entries, [other]);
    });
    await t.test('invalid values and missing timezone cannot change a saved entry', async () => {
      for (const score of [0, 6, 2.5, '3', null, true]) assert.equal((await save({ ...valid, score })).status, 400);
      for (const note of [null, false, {}, [], 'x'.repeat(2001)]) assert.equal((await save({ ...valid, note })).status, 400);
      for (const timeZone of [null, '', [], {}, 'not/a_timezone', '+05:30']) assert.equal((await save({ ...valid, timeZone })).status, 400);
      for (const recordedOn of [undefined, null, '', 20270101, 'January 1, 2027']) assert.equal((await save({ ...valid, recordedOn })).status, 400);
      assert.equal((await request('')).status, 400);
      assert.equal((await request('?timeZone=UTC&timeZone=Asia%2FKolkata')).status, 400);
      assert.equal((await save({ score: 3, recordedOn: valid.recordedOn })).status, 400);
      assert.deepEqual((await (await read()).json()).entry, first);
    });
    await t.test('note limit counts Unicode characters and an omitted note clears it', async () => {
      assert.equal((await save({ ...valid, note: '🌱'.repeat(2000) })).status, 200);
      assert.equal((await save({ ...valid, note: '🌱'.repeat(2001) })).status, 400);
      const response = await save({ timeZone: 'UTC', recordedOn: valid.recordedOn, score: 3 });
      assert.equal(response.status, 200); assert.equal((await response.json()).entry.note, '');
    });
    await t.test('the local date can differ from UTC and must match the server clock', async () => {
      const local = await read(tokenA, 'America/Los_Angeles');
      assert.equal((await local.json()).today, '2026-12-31');
      assert.equal((await save({ ...valid, timeZone: 'America/Los_Angeles' })).status, 409);
      const response = await save({ ...valid, timeZone: 'America/Los_Angeles', recordedOn: '2026-12-31' });
      assert.equal(response.status, 200); assert.equal((await response.json()).entry.recordedOn, '2026-12-31');
    });
    await t.test('a stale draft after midnight does not overwrite yesterday', async () => {
      const before = (await (await read()).json()).entry;
      clock = new Date('2027-01-02T00:01:00Z');
      const stale = await save(); assert.equal(stale.status, 409);
      assert.match((await stale.json()).error, /day has changed.*Refresh/i);
      const refreshed = await (await read()).json(); assert.equal(refreshed.today, '2027-01-02'); assert.equal(refreshed.entry, null);
      assert.deepEqual(refreshed.entries.find((entry: { id: string }) => entry.id === before.id), before);
      assert.equal((await save({ ...valid, recordedOn: refreshed.today })).status, 200);
    });
    await t.test('history contains only the thirty most recent dates for this account', async () => {
      await pool.query(`INSERT INTO mood_entries(user_id, score, note, recorded_on)
        SELECT $1, 3, 'Fictional past entry', '2026-12-29'::date - n FROM generate_series(0, 39) n`, [userA]);
      const result = await (await read()).json();
      assert.equal(result.entries.length, 30); assert.equal(result.entries[0].recordedOn, '2027-01-02');
      assert.deepEqual(result.entries.map((entry: { recordedOn: string }) => entry.recordedOn),
        result.entries.map((entry: { recordedOn: string }) => entry.recordedOn).sort().reverse());
      assert.equal(result.entry.id, result.entries[0].id);
      assert.equal(JSON.stringify(result).includes('Private user B note'), false);
    });
    await t.test('expired sessions cannot read or save mood data', async () => {
      await pool.query("UPDATE auth_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE user_id = $1", [userA]);
      assert.equal((await read()).status, 401); assert.equal((await save()).status, 401);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
