import { Router } from 'express';
import type { Pool } from 'pg';
import { faithValues, type Faith } from './ai-types.js';
import { sessionUser } from './session-user.js';

export type UserPreferences = { faith: Faith; faithEnabled: boolean };
const columns = 'faith, faith_enabled AS "faithEnabled"';

export function createPreferencesRouter(pool: Pool) {
  const router = Router();
  router.use(async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    const user = await sessionUser(pool, request);
    if (!user) { response.status(401).json({ error: 'Please sign in again.' }); return; }
    response.locals.userId = user.id;
    next();
  });
  router.get('/', async (_request, response) => {
    const result = await pool.query<UserPreferences>(`SELECT ${columns} FROM users WHERE id = $1`, [response.locals.userId]);
    if (!result.rowCount) { response.status(401).json({ error: 'Please sign in again.' }); return; }
    response.json({ preferences: result.rows[0] });
  });
  router.put('/', async (request, response) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'faith') || !Object.hasOwn(body, 'faithEnabled')
      || !faithValues.includes(body.faith) || typeof body.faithEnabled !== 'boolean'
      || (body.faith === 'prefer_not_to_say' && body.faithEnabled)) {
      response.status(400).json({ error: 'Choose a listed faith or worldview and whether to use it in guidance. Prefer not to say cannot enable personalization.' }); return;
    }
    const result = await pool.query<UserPreferences>(`UPDATE users SET faith = $2, faith_enabled = $3 WHERE id = $1 RETURNING ${columns}`,
      [response.locals.userId, body.faith, body.faithEnabled]);
    if (!result.rowCount) { response.status(401).json({ error: 'Please sign in again.' }); return; }
    response.json({ preferences: result.rows[0] });
  });
  return router;
}
