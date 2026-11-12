import { Router } from 'express';
import { dateOf, type Session } from '../../../shared/billing';
import { idSchema, makeupSchema, sessionPatchSchema, sessionsQuerySchema } from '../../../shared/schemas';
import { parse } from '../http';
import { applySessionPatch, bookMakeup, findSession } from '../services/classes';
import { exclusive, loadAll, saveSessions, type Dataset } from '../store';
import { sessionViews } from '../views';

export const sessionsRouter = Router();

const viewOf = (data: Dataset, id: string) => sessionViews(data, new Date(), (s) => s.id === id)[0];

sessionsRouter.get('/', async (req, res) => {
  const { from, to, studentId } = parse(sessionsQuerySchema, req.query);
  const data = await loadAll();
  const inRange = (s: Session) => dateOf(s) >= from && dateOf(s) <= to && (!studentId || s.studentId === studentId);
  res.json(sessionViews(data, new Date(), inRange));
});

sessionsRouter.get('/:id', async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const data = await loadAll();
  findSession(data, id);
  res.json(viewOf(data, id));
});

sessionsRouter.patch('/:id', async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const patch = parse(sessionPatchSchema, req.body);
  const view = await exclusive(async () => {
    const data = await loadAll();
    applySessionPatch(data, id, patch, Date.now());
    await saveSessions(data.sessions);
    return viewOf(data, id);
  });
  res.json(view);
});

sessionsRouter.post('/:id/makeup', async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const { start } = parse(makeupSchema, req.body);
  const view = await exclusive(async () => {
    const data = await loadAll();
    const makeup = bookMakeup(data, id, start, Date.now());
    await saveSessions(data.sessions);
    return viewOf(data, makeup.id);
  });
  res.status(201).json(view);
});
