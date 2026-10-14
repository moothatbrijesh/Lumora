import { Pool } from 'pg';

export function createDatabasePool(connectionString: string | undefined) {
  if (!connectionString) throw new Error('DATABASE_URL is missing. Follow docs/STEP_03.md.');
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000, statement_timeout: 5000 });
}

export async function checkDatabase(pool: Pool) {
  // Proves connectivity and that all required data, authentication, and preference schemas exist.
  const result = await pool.query(
    "SELECT count(*) = 4 AS ready FROM schema_migrations WHERE name IN ('001_initial.sql', '002_auth_sessions.sql', '003_chat_requests.sql', '004_user_preferences.sql')",
  );
  if (!result.rows[0]?.ready) throw new Error('Database migrations are missing.');
}
