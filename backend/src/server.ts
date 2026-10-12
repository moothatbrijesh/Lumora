import 'dotenv/config';
import { configuredResponder } from './openai-chat.js';
import { createApp } from './app.js';
import { createDatabasePool, checkDatabase } from './database.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a whole number between 1 and 65535.');
}

const pool = process.env.DATABASE_URL ? createDatabasePool(process.env.DATABASE_URL) : undefined;
pool?.on('error', () => console.error('An idle database connection failed. PostgreSQL may be restarting.'));
const server = createApp(pool ? () => checkDatabase(pool) : undefined, pool, configuredResponder()).listen(port, '0.0.0.0');
server.on('listening', () => {
  console.log(`Lumora API listening on port ${port}`);
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is in use. Stop the other server or set a different PORT.`
    : `API startup failed: ${error.message}`);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await pool?.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
