import cors from 'cors';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { createAuthRouter } from './auth.js';

export function createApp(databaseCheck?: () => Promise<void>, pool?: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:8081,http://127.0.0.1:8081').split(',').map(value => value.trim());
  app.use(cors({ origin(origin, callback) {
    if (!origin || origins.includes(origin)) callback(null, true);
    else callback(Object.assign(new Error('Origin not allowed'), { status: 403 }));
  } }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'lumora-api' });
  });
  app.get('/ready', async (_request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      if (!databaseCheck) throw new Error('Database is not configured');
      await databaseCheck();
      response.json({ status: 'ok', service: 'lumora-api', database: 'connected' });
    } catch {
      response.status(503).json({ status: 'unavailable', service: 'lumora-api' });
    }
  });
  if (pool) app.use('/auth', createAuthRouter(pool));
  else app.use('/auth', (_request, response) => {
    response.status(503).json({ error: 'Account service is unavailable. Please try again later.' });
  });
  app.use((_request, response) => {
    response.status(404).json({ error: 'Endpoint not found' });
  });
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = [400, 403, 413].includes(error.status) ? error.status : 503;
    const message = status === 400 ? 'Invalid JSON request.' : status === 403 ? 'Origin not allowed.'
      : status === 413 ? 'Request is too large.' : 'Service is unavailable. Please try again later.';
    response.set('Cache-Control', 'no-store').status(status).json({ error: message });
  };
  app.use(handleError);
  return app;
}
