import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createDatabasePool, checkDatabase } from '../src/database.js';
import { migrate, seedDevelopment } from '../src/migrations.js';
import { createApp } from '../src/app.js';

test('PostgreSQL integration in an isolated test schema', async t => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Set TEST_DATABASE_URL and start the Compose db-test service.');
  assert.match(new URL(url).pathname, /_test$/, 'TEST_DATABASE_URL must point to a database ending in _test.');
  const admin = createDatabasePool(url);
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`,
    max: 2, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await t.test('readiness fails before migrations and passes afterwards', async () => {
      await assert.rejects(() => checkDatabase(pool));
      assert.deepEqual(await migrate(pool), ['001_initial.sql', '002_auth_sessions.sql', '003_chat_requests.sql', '004_user_preferences.sql']);
      await checkDatabase(pool);
    });
    await t.test('migration reruns are safe and changed checksums are rejected', async () => {
      assert.deepEqual(await migrate(pool), []);
      const original = await pool.query("SELECT checksum FROM schema_migrations WHERE name = '001_initial.sql'");
      await pool.query("UPDATE schema_migrations SET checksum = 'changed' WHERE name = '001_initial.sql'");
      await assert.rejects(() => migrate(pool), /Create a new migration/);
      await pool.query("UPDATE schema_migrations SET checksum = $1 WHERE name = '001_initial.sql'", [original.rows[0].checksum]);
    });
    await t.test('sample data can be read and seeded twice without duplication or overwriting edits', async () => {
      await seedDevelopment(pool);
      await pool.query("UPDATE journal_entries SET title = 'My edited reflection'");
      await seedDevelopment(pool);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM motivation_quotes')).rows[0].n, 3);
      assert.equal((await pool.query('SELECT title FROM journal_entries')).rows[0].title, 'My edited reflection');
      assert.equal((await pool.query('SELECT password_hash FROM users')).rows[0].password_hash, null);
    });
    await t.test('invalid moods, duplicate daily moods, and orphaned records are rejected', async () => {
      const user = '10000000-0000-4000-8000-000000000001';
      await assert.rejects(() => pool.query('INSERT INTO mood_entries(user_id, score, recorded_on) VALUES ($1, 6, $2)', [user, '2026-01-02']), { code: '23514' });
      await assert.rejects(() => pool.query('INSERT INTO mood_entries(user_id, score, recorded_on) VALUES ($1, 3, $2)', [user, '2026-01-01']), { code: '23505' });
      await assert.rejects(() => pool.query('INSERT INTO goals(user_id, title) VALUES ($1, $2)', [randomUUID(), 'Orphan']), { code: '23503' });
    });
    await t.test('committed records survive a new database connection', async () => {
      const client = await pool.connect();
      const inserted = await client.query("INSERT INTO users(email, display_name) VALUES ('persistence@example.invalid', 'Persistence Check') RETURNING id");
      client.release(true);
      const result = await pool.query('SELECT display_name FROM users WHERE id = $1', [inserted.rows[0].id]);
      assert.equal(result.rows[0].display_name, 'Persistence Check');
    });
    await t.test('API readiness uses the live database and safely reports outages', async () => {
      let unavailable = false;
      const server = createApp(async () => {
        if (unavailable) throw new Error('sensitive database error');
        await checkDatabase(pool);
      }).listen(0, '127.0.0.1');
      try {
        if (!server.listening) await once(server, 'listening');
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const response = await fetch(`${base}/ready`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok', service: 'lumora-api', database: 'connected' });
        unavailable = true;
        const failed = await fetch(`${base}/ready`);
        assert.equal(failed.status, 503);
        assert.deepEqual(await failed.json(), { status: 'unavailable', service: 'lumora-api' });
        assert.equal((await fetch(`${base}/health`)).status, 200);
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
    await t.test('deleting a user removes their journal, goals, moods and chat messages', async () => {
      const user = '10000000-0000-4000-8000-000000000001';
      const conversation = (await pool.query('INSERT INTO conversations(user_id) VALUES ($1) RETURNING id', [user])).rows[0].id;
      await pool.query("INSERT INTO chat_messages(conversation_id, role, content) VALUES ($1, 'user', 'Hello')", [conversation]);
      await pool.query('DELETE FROM users WHERE id = $1', [user]);
      for (const table of ['journal_entries', 'goals', 'mood_entries', 'conversations', 'chat_messages']) {
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
      }
    });
  } finally {
    await pool.end();
    // Only the random schema created above is removed, never the development database.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
