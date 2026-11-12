import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { assistantApplySchema, assistantMessageSchema, type ApplyResult } from '../../../shared/assistant';
import { applyActions, proposeFromMessage } from '../ai/assistant';
import { runStudioTurn, studioTurnSchema } from '../ai/studio';
import { config } from '../config';
import { AiLimitError, geminiEnabled } from '../gemini';
import { HttpError, parse } from '../http';
import { exclusive, loadAll, saveSessions } from '../store';

export const assistantRouter = Router();

const aiLimiter = rateLimit({ windowMs: 60_000, limit: config.env === 'test' ? 1000 : 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Wait a minute and try again.' } });

// Reads a message and proposes changes. Nothing is saved.
assistantRouter.post('/propose', aiLimiter, async (req, res) => {
  const { message } = parse(assistantMessageSchema, req.body);
  res.json(await proposeFromMessage(await loadAll(), message, new Date()));
});

// Applies the changes the teacher approved, all or nothing, with the app's usual checks.
assistantRouter.post('/apply', async (req, res) => {
  const { actions } = parse(assistantApplySchema, req.body);
  const result = await exclusive(async (): Promise<ApplyResult> => {
    const { data, makeupIds } = applyActions(await loadAll(), actions, Date.now());
    await saveSessions(data.sessions);
    return { applied: actions.length, makeupIds };
  });
  res.json(result);
});

// One turn of AG Studio's dashboard assistant, answered by Gemini.
assistantRouter.post('/studio', aiLimiter, async (req, res) => {
  if (!geminiEnabled()) throw new HttpError(503, 'The dashboard assistant needs a Gemini key');
  const turn = parse(studioTurnSchema, req.body);
  try {
    res.json(await runStudioTurn(turn));
  } catch (e) {
    if (e instanceof AiLimitError) throw new HttpError(429, e.message);
    throw e;
  }
});
