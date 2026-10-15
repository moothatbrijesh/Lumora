import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { Pool } from 'pg';

export async function sessionUser(pool: Pool, request: Request) {
  const token = request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (!token) return null;
  const result = await pool.query<{ id: string; email: string; display_name: string }>(`
    SELECT u.id, u.email, u.display_name FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [createHash('sha256').update(token).digest('hex')]);
  return result.rows[0] ?? null;
}
