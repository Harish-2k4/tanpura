// JSON file storage in DATA_DIR (default backend/data). Server-side only.
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { InvoiceRecord, Session, Student } from '../../shared/billing';
import type { Teacher } from '../../shared/settings';
import { config } from './config';

export type Dataset = { teacher: Teacher; students: Student[]; sessions: Session[]; invoices: InvoiceRecord[] };

const NAMES = ['teacher', 'students', 'sessions', 'invoices'] as const;
const file = (name: (typeof NAMES)[number]) => path.resolve(config.dataDir, `${name}.json`);

async function read<T>(name: (typeof NAMES)[number]): Promise<T> {
  return JSON.parse(await readFile(file(name), 'utf8')) as T;
}

// Write to a temp file, then rename, so a crash never leaves half a file.
async function write(name: (typeof NAMES)[number], value: unknown) {
  const tmp = `${file(name)}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await rename(tmp, file(name));
}

export const getTeacher = () => read<Teacher>('teacher');
export const getStudents = () => read<Student[]>('students');
export const getSessions = () => read<Session[]>('sessions');
export const getInvoices = () => read<InvoiceRecord[]>('invoices');

export const saveTeacher = (teacher: Teacher) => write('teacher', teacher);
export const saveStudents = (students: Student[]) => write('students', students);
export const saveSessions = (sessions: Session[]) => write('sessions', sessions);
export const saveInvoices = (invoices: InvoiceRecord[]) => write('invoices', invoices);

export async function loadAll(): Promise<Dataset> {
  const [teacher, students, sessions, invoices] = await Promise.all([getTeacher(), getStudents(), getSessions(), getInvoices()]);
  return { teacher, students, sessions, invoices };
}

export async function saveAll(data: Dataset) {
  await mkdir(path.resolve(config.dataDir), { recursive: true });
  await Promise.all([saveTeacher(data.teacher), saveStudents(data.students), saveSessions(data.sessions), saveInvoices(data.invoices)]);
}

export async function hasData(): Promise<boolean> {
  try {
    await Promise.all(NAMES.map((n) => access(file(n))));
    return true;
  } catch {
    return false;
  }
}

// Runs one write at a time, so two requests can't interleave read-modify-write.
let queue: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
