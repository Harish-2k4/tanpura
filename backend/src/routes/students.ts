import { Router } from 'express';
import { endEnrolmentSchema, idSchema, studentInputSchema, studentPatchSchema } from '../../../shared/schemas';
import { HttpError, parse } from '../http';
import { endEnrolment, reEnrol } from '../services/enrolment';
import { addStudent, updateStudent } from '../services/students';
import { exclusive, getStudents, loadAll, saveAll, saveStudents } from '../store';

export const studentsRouter = Router();

studentsRouter.get('/', async (_req, res) => {
  res.json(await getStudents());
});

// A new rate applies to every class not billed yet; billed classes keep their amount.
studentsRouter.patch('/:id', async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const { rate } = parse(studentPatchSchema, req.body);
  const student = await exclusive(async () => {
    const students = await getStudents();
    const st = students.find((s) => s.id === id);
    if (!st) throw new HttpError(404, 'Not found');
    st.rate = rate;
    await saveStudents(students);
    return st;
  });
  res.json(student);
});

// Ends the enrolment after `lastDate`: later classes leave the calendar, paid ones are credited.
studentsRouter.post('/:id/end', async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const { lastDate } = parse(endEnrolmentSchema, req.body);
  const result = await exclusive(async () => {
    const data = await loadAll();
    const r = endEnrolment(data, id, lastDate, new Date());
    await saveAll(data);
    return r;
  });
  res.json(result);
});

studentsRouter.post('/:id/reenrol', async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const added = await exclusive(async () => {
    const data = await loadAll();
    const n = reEnrol(data, id, new Date());
    await saveAll(data);
    return n;
  });
  res.json({ added });
});

studentsRouter.post('/', async (req, res) => {
  const input = parse(studentInputSchema, req.body);
  const student = await exclusive(async () => {
    const data = await loadAll();
    const st = addStudent(data, input, new Date());
    await saveAll(data);
    return st;
  });
  res.status(201).json(student);
});

// Name, family, country, rate and weekly times.
studentsRouter.put('/:id', async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const input = parse(studentInputSchema, req.body);
  const result = await exclusive(async () => {
    const data = await loadAll();
    const r = updateStudent(data, id, input, new Date());
    await saveAll(data);
    return r;
  });
  res.json(result);
});
