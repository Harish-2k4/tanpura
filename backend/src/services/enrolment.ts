// Ending and restarting a student's enrolment. Ending keeps the student and their history but
// takes their classes after the last date off the calendar; classes already paid for (billed in
// advance) are cancelled rather than removed, so the next bill credits them back.
import { dateOf, makeupIndex, type Student } from '../../../shared/billing';
import { addDays, todayIn } from '../../../shared/time';
import { wordsFor } from '../../../shared/words';
import { HttpError } from '../http';
import { addWeeklyClasses, scheduleHorizon } from '../schedule';
import type { Dataset } from '../store';

const MAX_PAST_DAYS = 90;
const ENDED_NOTE = 'Enrolment ended';

export function findStudent(data: Dataset, id: string): Student {
  const st = data.students.find((s) => s.id === id);
  if (!st) throw new HttpError(404, 'Not found');
  return st;
}

export function endEnrolment(data: Dataset, studentId: string, lastDate: string, now: Date): { removed: number; credited: number } {
  const st = findStudent(data, studentId);
  if (st.endedOn) throw new HttpError(409, `${st.name}'s enrolment already ended`);
  const today = todayIn(data.teacher.timezone, now);
  if (lastDate < addDays(today, -MAX_PAST_DAYS)) throw new HttpError(400, `Pick a last date within ${MAX_PAST_DAYS} days before today`);
  if (lastDate > scheduleHorizon(data.teacher.timezone, now)) throw new HttpError(400, 'Pick a last date within what is already on the calendar');

  const after = data.sessions.filter((s) => s.studentId === st.id && dateOf(s) > lastDate);
  const attended = after.find((s) => s.status === 'attended');
  if (attended) throw new HttpError(409, `${st.name} has a ${wordsFor(data.teacher.profession).class} marked attended on ${dateOf(attended)}. Pick that date or later.`);

  // What each class is charged on invoices still standing.
  const charged = new Map<string, number>();
  for (const inv of data.invoices) {
    if (inv.studentId !== st.id || inv.status === 'CANCELLED') continue;
    for (const e of inv.entries) charged.set(e.sessionId, (charged.get(e.sessionId) ?? 0) + e.amount);
  }
  const makeups = makeupIndex(data.sessions);

  const remove = new Set<string>();
  let credited = 0;
  for (const s of after) {
    // A makeup after the end replaces nothing any more: its original class decides the bill.
    if (s.makeupFor) remove.add(s.id);
    else if (s.status !== 'scheduled') continue; // already missed or cancelled: billed as before
    else if ((charged.get(s.id) ?? 0) > 0 || makeups.get(s.id)?.some((m) => dateOf(m) <= lastDate)) {
      s.status = 'cancelled_student';
      s.note = ENDED_NOTE;
      credited++;
    } else remove.add(s.id);
  }
  data.sessions = data.sessions.filter((s) => !remove.has(s.id));
  st.endedOn = lastDate;
  return { removed: remove.size, credited };
}

// Puts the weekly classes back from today (or the day after the old last class) onwards.
export function reEnrol(data: Dataset, studentId: string, now: Date): number {
  const st = findStudent(data, studentId);
  if (!st.endedOn) throw new HttpError(409, `${st.name} is already enrolled`);
  const today = todayIn(data.teacher.timezone, now);
  const from = st.endedOn >= today ? addDays(st.endedOn, 1) : today;
  // Paid classes cancelled by the ending are still paid for: they simply go ahead again.
  let restored = 0;
  for (const s of data.sessions) {
    if (s.studentId === st.id && s.note === ENDED_NOTE && dateOf(s) >= from) {
      s.status = 'scheduled';
      delete s.note;
      restored++;
    }
  }
  delete st.endedOn;
  const until = data.teacher.scheduledUntil || scheduleHorizon(data.teacher.timezone, now);
  return restored + addWeeklyClasses(data, [st], from, until);
}
