// Adding and editing students. New weekly times apply to classes not billed yet; classes already
// on a sent invoice stay as they are, and the new times start after the last of them.
import { dateOf, type Student } from '../../../shared/billing';
import { REGIONS } from '../../../shared/regions';
import type { StudentInput } from '../../../shared/schemas';
import { addDays, todayIn } from '../../../shared/time';
import { wordsFor } from '../../../shared/words';
import { HttpError } from '../http';
import { addWeeklyClasses, scheduleHorizon } from '../schedule';
import type { Dataset } from '../store';
import { findStudent } from './enrolment';

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Weekly times may not overlap anyone else's weekly times.
function checkSlots(data: Dataset, input: StudentInput, selfId?: string) {
  const w = wordsFor(data.teacher.profession);
  for (const slot of input.slots) {
    if (minutesOf(slot.time) + slot.minutes > 24 * 60) throw new HttpError(400, `A ${w.class} can't run past midnight (${DAYS[slot.weekday]} ${slot.time})`);
    for (const other of data.students) {
      if (other.id === selfId || other.endedOn) continue;
      const clash = other.slots.find(
        (o) => o.weekday === slot.weekday && minutesOf(o.time) < minutesOf(slot.time) + slot.minutes && minutesOf(o.time) + o.minutes > minutesOf(slot.time),
      );
      if (clash) throw new HttpError(409, `${DAYS[slot.weekday]} ${slot.time} overlaps ${other.name}'s weekly ${w.class} at ${clash.time}`);
    }
  }
}

function nextStudentId(students: Student[]): string {
  const max = students.reduce((m, s) => Math.max(m, Number(s.id.slice(1)) || 0), 0);
  return `s${String(max + 1).padStart(2, '0')}`;
}

export function addStudent(data: Dataset, input: StudentInput, now: Date): Student {
  checkSlots(data, input);
  const email = input.parent.email.toLowerCase();
  if (data.students.some((s) => s.parent.email.toLowerCase() === email && s.name.toLowerCase() === input.name.toLowerCase())) {
    throw new HttpError(409, `${input.name} is already on the list`);
  }
  const student: Student = { id: nextStudentId(data.students), ...input, parent: { ...input.parent, email }, currency: REGIONS[input.country].currency };
  data.students.push(student);
  const today = todayIn(data.teacher.timezone, now);
  addWeeklyClasses(data, [student], addDays(today, 1), data.teacher.scheduledUntil || scheduleHorizon(data.teacher.timezone, now));
  return student;
}

export function updateStudent(data: Dataset, id: string, input: StudentInput, now: Date): { student: Student; moved: number } {
  const st = findStudent(data, id);
  const invoiced = data.invoices.some((i) => i.studentId === id);
  if (input.country !== st.country && REGIONS[input.country].currency !== st.currency && invoiced) {
    throw new HttpError(409, `${st.name} already has invoices in ${st.currency}, so the country can't change to one with another currency`);
  }
  checkSlots(data, input, id);

  const slotsChanged = JSON.stringify(input.slots) !== JSON.stringify(st.slots);
  Object.assign(st, { ...input, parent: { ...input.parent, email: input.parent.email.toLowerCase() }, currency: REGIONS[input.country].currency });

  let moved = 0;
  if (slotsChanged && !st.endedOn) {
    // Plain weekly classes from tomorrow that are not on a sent invoice are replaced by the new
    // times. Billed ones stay, and the new times start after the last of them, so none double up.
    const today = todayIn(data.teacher.timezone, now);
    const billed = new Set(data.invoices.filter((i) => i.status !== 'CANCELLED').flatMap((i) => i.entries.map((e) => e.sessionId)));
    const madeUp = new Set(data.sessions.filter((s) => s.makeupFor).map((s) => s.makeupFor));
    const future = data.sessions.filter((s) => s.studentId === id && dateOf(s) > today && !s.makeupFor);
    const keep = future.filter((s) => s.status !== 'scheduled' || s.price || billed.has(s.id) || madeUp.has(s.id));
    const drop = new Set(future.filter((s) => !keep.includes(s)).map((s) => s.id));
    data.sessions = data.sessions.filter((s) => !drop.has(s.id));
    const lastKept = keep.reduce((latest, s) => (dateOf(s) > latest ? dateOf(s) : latest), today);
    const until = data.teacher.scheduledUntil || scheduleHorizon(data.teacher.timezone, now);
    moved = addWeeklyClasses(data, [st], addDays(lastKept, 1), until);
  }
  return { student: st, moved };
}
