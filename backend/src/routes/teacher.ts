import { Router } from 'express';
import { professionSchema, teacherPatchSchema } from '../../../shared/schemas';
import { config } from '../config';
import { HttpError, parse } from '../http';
import { generateDemoData } from '../seed';
import { exclusive, loadAll, saveAll, saveTeacher } from '../store';
import { teacherView } from '../views';

export const teacherRouter = Router();

teacherRouter.get('/', async (_req, res) => {
  res.json(teacherView(await loadAll(), new Date()));
});

teacherRouter.patch('/', async (req, res) => {
  const patch = parse(teacherPatchSchema, req.body);
  const view = await exclusive(async () => {
    const data = await loadAll();
    data.teacher = { ...data.teacher, ...patch };
    await saveTeacher(data.teacher);
    return teacherView(data, new Date());
  });
  res.json(view);
});

// The kind of work, chosen once at first sign-in. In the demo, the sample data is rebuilt to match
// (students and families for teaching, clients for client sessions).
teacherRouter.post('/profession', async (req, res) => {
  const { profession } = parse(professionSchema, req.body);
  const view = await exclusive(async () => {
    const current = await loadAll();
    if (current.teacher.profession) throw new HttpError(409, 'The kind of work is already chosen');
    const data = config.demoMode ? generateDemoData(new Date(), { buyerEmail: config.demoBuyerEmail, profession }) : current;
    data.teacher.profession = profession;
    await saveAll(data);
    return teacherView(data, new Date());
  });
  res.json(view);
});
