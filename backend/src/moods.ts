import { Router } from 'express';
import type { Pool } from 'pg';
import { sessionUser } from './session-user.js';

const entryColumns = `id, score, note, to_char(recorded_on, 'YYYY-MM-DD') AS "recordedOn", created_at AS "createdAt"`;

/** A device's named timezone decides its calendar day; the server supplies the time. */
export function moodDay(timeZone: unknown, at: Date = new Date()): string | null {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 100 || /^[+-]/.test(timeZone)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(at);
    const value = (type: string) => parts.find(part => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  } catch { return null; }
}

export function createMoodsRouter(pool: Pool, now: () => Date = () => new Date()) {
  const router = Router();
  router.use(async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    const user = await sessionUser(pool, request);
    if (!user) { response.status(401).json({ error: 'Please sign in again.' }); return; }
    response.locals.userId = user.id;
    next();
  });
  router.get('/', async (request, response) => {
    const today = moodDay(request.query.timeZone, now());
    if (!today) { response.status(400).json({ error: 'Choose a valid named timezone for your mood check-in.' }); return; }
    const [current, history] = await Promise.all([
      pool.query(`SELECT ${entryColumns} FROM mood_entries WHERE user_id = $1 AND recorded_on = $2::date`, [response.locals.userId, today]),
      pool.query(`SELECT ${entryColumns} FROM mood_entries WHERE user_id = $1 ORDER BY recorded_on DESC LIMIT 30`, [response.locals.userId]),
    ]);
    response.json({ today, entry: current.rows[0] ?? null, entries: history.rows });
  });
  router.put('/today', async (request, response) => {
    const today = moodDay(request.body?.timeZone, now());
    if (!today) { response.status(400).json({ error: 'Choose a valid named timezone for your mood check-in.' }); return; }
    const { score, recordedOn } = request.body;
    const rawNote = request.body.note === undefined ? '' : request.body.note;
    if (!Number.isInteger(score) || score < 1 || score > 5 || typeof rawNote !== 'string' || Array.from(rawNote.trim()).length > 2000) {
      response.status(400).json({ error: 'Choose a mood from 1 to 5 and use at most 2000 characters for your optional note.' }); return;
    }
    if (typeof recordedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(recordedOn)) {
      response.status(400).json({ error: 'Include the date shown on your mood check-in.' }); return;
    }
    if (recordedOn !== today) {
      response.status(409).json({ error: 'The day has changed. Refresh your check-in, then save it for today.' }); return;
    }
    // The unique (user_id, recorded_on) constraint makes retries and concurrent saves one daily entry.
    const result = await pool.query(`INSERT INTO mood_entries(user_id, score, note, recorded_on) VALUES ($1, $2, $3, $4::date)
      ON CONFLICT (user_id, recorded_on) DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note
      RETURNING ${entryColumns}`, [response.locals.userId, score, rawNote.trim(), today]);
    response.json({ entry: result.rows[0] });
  });
  return router;
}
