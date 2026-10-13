// Test-only process. Never imported by the application server or production build.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createDatabasePool, checkDatabase } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { createApp } from '../src/app.js';
import { ChatProviderError } from '../src/ai-types.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test') || process.env.NODE_ENV === 'production') throw new Error('A disposable TEST_DATABASE_URL is required.');
const schema = `browser_${randomUUID().replaceAll('-', '')}`;
const admin = createDatabasePool(url);
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 5 });
await admin.query(`CREATE SCHEMA "${schema}"`);
await migrate(pool);
let calls = 0;
let failedOnce = false;
const app = createApp(() => checkDatabase(pool), pool, async history => {
  calls++;
  if (history.at(-1)?.content === 'Test a recoverable provider failure.' && !failedOnce) {
    failedOnce = true;
    throw new ChatProviderError(503, 'Test provider is temporarily unavailable.');
  }
  return 'TEST FIXTURE: Choose one manageable step. This is not a live AI reply.';
});
// Added before the application's fallback via a separate server handler is unnecessary:
// expose metrics over IPC only, never as a production HTTP route.
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') process.send?.({ ready: true, port: address.port });
});
process.on('message', message => { if (message === 'calls') process.send?.({ calls }); });
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
