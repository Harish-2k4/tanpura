// The Express app. Every /api route except health and sign-in requires a signed-in teacher.
import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { authRouter, requireAuth } from './auth';
import { config } from './config';
import { dashboardData } from './dashboard';
import { subscribe } from './events';
import { apiNotFound, errorHandler, requireJson } from './http';
import { assistantRouter } from './routes/assistant';
import { billingRouter } from './routes/billing';
import { demoRouter } from './routes/demo';
import { sessionsRouter } from './routes/sessions';
import { studentsRouter } from './routes/students';
import { teacherRouter } from './routes/teacher';
import { webhookRouter } from './routes/webhook';
import { loadAll } from './store';

const FRONTEND_DIST = path.resolve(import.meta.dirname, '../../frontend/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1); // behind Render's proxy: real client IPs for rate limits

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'worker-src': ["'self'", 'blob:'],
          // Only upgrade to HTTPS where the app is served over HTTPS.
          'upgrade-insecure-requests': config.production ? [] : null,
        },
      },
    }),
  );
  // AI turns carry the dashboard's tool definitions and conversation, so they get more room.
  app.use('/api/assistant/studio', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: config.env === 'test' ? 10_000 : 600, standardHeaders: 'draft-8', legacyHeaders: false }));
  api.use(requireJson);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRouter);
  api.use('/paypal/webhook', webhookRouter); // called by PayPal; checks PayPal's signature instead of a session
  // Everything below needs a signed-in teacher, including unknown paths (404 only after sign-in).
  api.use(requireAuth);
  api.use('/teacher', teacherRouter);
  api.use('/students', studentsRouter);
  api.use('/sessions', sessionsRouter);
  api.use('/billing', billingRouter);
  api.use('/assistant', assistantRouter);
  api.get('/dashboard', async (_req, res) => res.json(dashboardData(await loadAll(), new Date())));
  api.get('/events', (_req, res) => subscribe(res));
  api.use('/demo', demoRouter);
  api.use(apiNotFound);
  app.use('/api', api);

  // Production: serve the built frontend, with client-side routes falling back to index.html.
  if (existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
