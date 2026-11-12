import { Router } from 'express';
import { config } from '../config';
import { HttpError } from '../http';
import { generateDemoData } from '../seed';
import { exclusive, loadAll, saveAll } from '../store';

export const demoRouter = Router();

// Rebuilds the demo data around today's date. Only in demo mode.
demoRouter.post('/reset', async (_req, res) => {
  if (!config.demoMode) throw new HttpError(404, 'Not found');
  // Keeps the work type chosen at first sign-in.
  await exclusive(async () => {
    const { profession } = (await loadAll()).teacher;
    await saveAll(generateDemoData(new Date(), { buyerEmail: config.demoBuyerEmail, profession }));
  });
  res.status(204).end();
});
