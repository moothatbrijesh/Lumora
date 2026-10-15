import 'dotenv/config';
import { createDatabasePool, checkDatabase } from './database.js';
import { migrate, seedDevelopment } from './migrations.js';

async function main() {
  const command = process.argv[2];
  if (!['migrate', 'seed', 'check'].includes(command ?? '')) throw new Error('Expected migrate, seed, or check.');
  if (command === 'seed' && (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true')) {
    throw new Error('Demo seeding requires ALLOW_DEMO_SEED=true in a local development .env; it is forbidden in production.');
  }
  const pool = createDatabasePool(process.env.DATABASE_URL);
  try {
    if (command === 'migrate') {
      const applied = await migrate(pool);
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database migrations are up to date.');
    } else if (command === 'seed') {
      await checkDatabase(pool);
      await seedDevelopment(pool);
      console.log('Development sample data is ready (existing records preserved).');
    } else {
      await checkDatabase(pool);
      console.log('Database connection and required migrations verified.');
    }
  } finally { await pool.end(); }
}

main().catch(error => {
  // Avoid exposing connection URLs or credentials in database driver errors.
  console.error(error instanceof Error && /^(DATABASE_URL|Demo seeding|Expected|Applied migration)/.test(error.message)
    ? error.message : 'Database command failed. Check PostgreSQL, DATABASE_URL, and migration status.');
  process.exitCode = 1;
});
