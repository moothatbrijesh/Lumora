import { createHash } from 'node:crypto';
import { Router, type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool, PoolClient } from 'pg';
import { sessionUser } from './session-user.js';
import { ChatProviderError, type AIProvider, type ChatInput, type ChatResponder } from './ai-types.js';
import type { UserPreferences } from './preferences.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messageColumns = 'id, role, content, created_at AS "createdAt"';
const publicError = (status: number, message: string) => new ChatProviderError(status, message);
async function owned(client: PoolClient, conversationId: string, userId: string, lock = false) {
  const result = await client.query(`SELECT id FROM conversations WHERE id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE NOWAIT' : ''}`, [conversationId, userId]);
  if (!result.rowCount) throw publicError(404, 'Conversation not found.');
}

export function createChatRouter(pool: Pool, respond?: ChatResponder, provider: AIProvider = 'gemini') {
  const router = Router();
  let activeRequests = 0;
  router.use(async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    const user = await sessionUser(pool, request);
    if (!user) { response.status(401).json({ error: 'Please sign in again.' }); return; }
    response.locals.userId = user.id;
    next();
  });
  const writeLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30,
    keyGenerator: (_request, response) => response.locals.userId,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'You have reached the chat request limit. Please try again in ten minutes.' } });
  router.get('/status', (_request, response) => {
    response.json({ configured: Boolean(respond), maxMessageLength: 4000, provider });
  });
  router.get('/conversations', async (_request, response) => {
    const rows = await pool.query(`SELECT id, title, updated_at AS "updatedAt" FROM conversations
      WHERE user_id = $1 ORDER BY updated_at DESC, id LIMIT 50`, [response.locals.userId]);
    response.json({ conversations: rows.rows });
  });
  router.post('/conversations', writeLimit, async (_request, response) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [response.locals.userId]);
      const count = await client.query('SELECT count(*)::int AS n FROM conversations WHERE user_id = $1', [response.locals.userId]);
      if (count.rows[0].n >= 50) throw publicError(409, 'You have 50 conversations. Delete one before starting another.');
      const result = await client.query(`INSERT INTO conversations(user_id) VALUES ($1) RETURNING id, title, updated_at AS "updatedAt"`, [response.locals.userId]);
      await client.query('COMMIT');
      response.status(201).json({ conversation: result.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  router.param('id', (request, response, next, id: string) => {
    if (!uuid.test(id)) { response.status(400).json({ error: 'Invalid conversation ID.' }); return; }
    next();
  });
  router.get('/conversations/:id/messages', async (request, response) => {
    // Check existence, then repeat ownership in the history query to prevent cross-account access.
    const exists = await pool.query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [request.params.id, response.locals.userId]);
    if (!exists.rowCount) { response.status(404).json({ error: 'Conversation not found.' }); return; }
    const messages = await pool.query(`SELECT m.id, m.role, m.content, m.created_at AS "createdAt"
      FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.id = $1 AND c.user_id = $2 ORDER BY m.sequence LIMIT 200`, [request.params.id, response.locals.userId]);
    response.json({ messages: messages.rows });
  });
  router.delete('/conversations/:id', async (request, response) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await owned(client, request.params.id as string, response.locals.userId, true);
      await client.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [request.params.id, response.locals.userId]);
      await client.query('COMMIT'); response.status(204).end();
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  router.post('/conversations/:id/messages', writeLimit, async (request, response) => {
    const content = typeof request.body?.content === 'string' ? request.body.content.trim() : '';
    const requestId = request.body?.requestId;
    if (!content || Array.from(content).length > 4000 || typeof requestId !== 'string' || !uuid.test(requestId)) {
      response.status(400).json({ error: 'Enter 1–4000 characters and a valid request ID.' }); return;
    }
    // Bound provider work and leave pool capacity for login and health checks.
    if (activeRequests >= 2) throw publicError(503, 'Lumora is busy. Please try again in a moment.');
    activeRequests++;
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await owned(client, request.params.id as string, response.locals.userId, true);
      const hash = createHash('sha256').update(content).digest('hex');
      const previous = await client.query('SELECT * FROM chat_requests WHERE conversation_id = $1 AND request_id = $2', [request.params.id, requestId]);
      if (previous.rowCount) {
        if (previous.rows[0].content_hash !== hash) throw publicError(409, 'This request ID was already used for another message.');
        const messages = await client.query(`SELECT ${messageColumns} FROM chat_messages WHERE id = ANY($1::uuid[]) ORDER BY sequence`, [[previous.rows[0].user_message_id, previous.rows[0].assistant_message_id]]);
        await client.query('COMMIT'); response.json({ messages: messages.rows }); return;
      }
      if (!respond) throw publicError(503, 'AI chat is not configured yet. You can still view your conversations.');
      const count = await client.query('SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1', [request.params.id]);
      if (count.rows[0].n >= 200) throw publicError(409, 'This conversation has reached its limit. Please start a new conversation.');
      const history = await client.query<ChatInput>('SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY sequence DESC LIMIT 12', [request.params.id]);
      // Most recent messages first when choosing a bounded context; restore chronological order.
      const context: ChatInput[] = []; let characters = 0;
      for (const row of history.rows) {
        if (characters + row.content.length > 24000) break;
        context.unshift(row); characters += row.content.length;
      }
      // Re-read for every new turn, including existing conversations. No preference from the
      // request body is trusted, and a saved selection is never sent while its opt-in is off.
      const preferences = (await client.query<UserPreferences>('SELECT faith, faith_enabled AS "faithEnabled" FROM users WHERE id = $1', [response.locals.userId])).rows[0];
      if (!preferences) throw publicError(401, 'Please sign in again.');
      const answer = await respond([...context, { role: 'user', content }], preferences.faithEnabled ? { faith: preferences.faith } : {});
      if (!answer.trim() || Array.from(answer).length > 8000) throw publicError(502, 'No complete reply was received. Please try again.');
      const userMessage = await client.query(`INSERT INTO chat_messages(conversation_id, role, content) VALUES ($1, 'user', $2) RETURNING ${messageColumns}`, [request.params.id, content]);
      const assistantMessage = await client.query(`INSERT INTO chat_messages(conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING ${messageColumns}`, [request.params.id, answer]);
      await client.query('INSERT INTO chat_requests(conversation_id, request_id, content_hash, user_message_id, assistant_message_id) VALUES ($1, $2, $3, $4, $5)', [request.params.id, requestId, hash, userMessage.rows[0].id, assistantMessage.rows[0].id]);
      await client.query(`UPDATE conversations SET title = CASE WHEN title = 'A new conversation' THEN $2 ELSE title END, updated_at = now() WHERE id = $1`, [request.params.id, Array.from(content).slice(0, 60).join('')]);
      await client.query('COMMIT');
      response.status(201).json({ messages: [userMessage.rows[0], assistantMessage.rows[0]] });
    } catch (error) { if (client) await client.query('ROLLBACK'); throw error; }
    finally { client?.release(); activeRequests--; }
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ChatProviderError) { response.status(error.status).json({ error: error.message }); return; }
    if (error.code === '55P03') { response.status(409).json({ error: 'A reply is already in progress. Please wait, then retry.' }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
