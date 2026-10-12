import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { hashPassword, verifyPassword } from './passwords.js';

const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const publicUser = (row: Record<string, unknown>) => ({
  id: row.id, email: row.email, displayName: row.display_name,
});
function bearer(request: Request) {
  const match = request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/);
  return match?.[1];
}
function credentials(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (typeof value.email !== 'string' || typeof value.password !== 'string') return null;
  const email = value.email.trim().toLowerCase();
  const password = value.password; // Never trim or silently truncate a password.
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (Array.from(password).length < 12 || Array.from(password).length > 128) return null;
  return { email, password };
}

export function createAuthRouter(pool: Pool) {
  const router = Router();
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  // Per-process protection for this single-server development milestone.
  // Configure trusted proxies and a shared rate-limit store before scaling deployment.
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' } });

  router.post('/register', limit, async (request, response) => {
    const values = credentials(request.body);
    const name = typeof request.body?.displayName === 'string' ? request.body.displayName.trim() : '';
    if (!values || Array.from(name).length < 1 || Array.from(name).length > 100) {
      response.status(400).json({ error: 'Enter a name (1–100 characters), valid email, and password (12–128 characters).' });
      return;
    }
    const passwordHash = await hashPassword(values.password);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO users(email, display_name, password_hash)
        VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, email, display_name`,
      [values.email, name, passwordHash]);
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        response.status(409).json({ error: 'Unable to create an account with these details. Try signing in.' });
        return;
      }
      await client.query('INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [inserted.rows[0].id, digest(token), expiresAt]);
      await client.query('COMMIT');
      response.status(201).json({ user: publicUser(inserted.rows[0]), token, expiresAt });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  router.post('/login', limit, async (request, response) => {
    const values = credentials(request.body);
    if (!values) {
      response.status(400).json({ error: 'Enter a valid email and a password of 12–128 characters.' });
      return;
    }
    const result = await pool.query('SELECT id, email, display_name, password_hash FROM users WHERE email = $1', [values.email]);
    const row = result.rows[0];
    if (!await verifyPassword(values.password, row?.password_hash ?? null)) {
      response.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1 AND expires_at <= now()', [row.id]);
    await pool.query('INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [row.id, digest(token), expiresAt]);
    response.json({ user: publicUser(row), token, expiresAt });
  });

  router.get('/me', async (request, response) => {
    const token = bearer(request);
    const result = token ? await pool.query(`SELECT u.id, u.email, u.display_name FROM auth_sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [digest(token)]) : null;
    if (!result?.rowCount) {
      response.status(401).json({ error: 'Please sign in again.' });
      return;
    }
    response.json({ user: publicUser(result.rows[0]) });
  });

  router.post('/logout', async (request, response) => {
    const token = bearer(request);
    if (!token) { response.status(401).json({ error: 'Please sign in again.' }); return; }
    // Idempotent: retrying an already-revoked or expired session still succeeds.
    await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest(token)]);
    response.status(204).end();
  });
  return router;
}
