// Keeps every student's weekly classes generated ahead, up to the end of next month, so the
// calendar and the bills never run out of classes.
import { dateOf, type Session, type Slot, type Student } from '../../shared/billing';
import { addDays, eachDay, lastDayOfMonth, monthOfDate, nextMonth, todayIn, wallTimeToIso, weekdayOf, zonedParts } from '../../shared/time';
import type { Dataset } from './store';

export const scheduleHorizon = (timeZone: string, now: Date) => lastDayOfMonth(nextMonth(monthOfDate(todayIn(timeZone, now))));

export function nextSessionId(sessions: Session[]): string {
  const max = sessions.reduce((m, s) => Math.max(m, Number(s.id.slice(1)) || 0), 0);
  return `c${String(max + 1).padStart(4, '0')}`;
}

// Adds the weekly classes between the last generated day and the horizon. Returns how many.
export function extendSchedule(data: Dataset, now: Date): number {
  const { timezone } = data.teacher;
  const until = scheduleHorizon(timezone, now);
  // Data saved before `scheduledUntil` existed: continue after the latest weekly class.
  const generatedUntil =
    data.teacher.scheduledUntil ||
    data.sessions.reduce((latest, s) => (!s.makeupFor && dateOf(s) > latest ? dateOf(s) : latest), addDays(todayIn(timezone, now), -1));
  const from = addDays(generatedUntil, 1);
  if (from > until) return 0;

  const added = addWeeklyClasses(data, data.students, from, until);
  data.teacher.scheduledUntil = until;
  return added;
}

// Adds `students`' weekly classes from `from` to `until` (inclusive), skipping ones that exist
// and days after an enrolment ended. Returns how many.
export function addWeeklyClasses(data: Dataset, students: Student[], from: string, until: string): number {
  const { timezone } = data.teacher;
  const existing = new Set(data.sessions.map((s) => `${s.studentId}|${s.start}`));
  let next = Number(nextSessionId(data.sessions).slice(1));
  let added = 0;
  for (const date of from > until ? [] : eachDay(from, until)) {
    for (const st of students) {
      if (st.endedOn && date > st.endedOn) continue;
      for (const slot of st.slots.filter((s) => s.weekday === weekdayOf(date))) {
        const start = wallTimeToIso(date, slot.time, timezone);
        if (existing.has(`${st.id}|${start}`)) continue;
        data.sessions.push({ id: `c${String(next++).padStart(4, '0')}`, studentId: st.id, start, minutes: slot.minutes, status: 'scheduled' });
        added++;
      }
    }
  }
  data.sessions.sort((a, b) => a.start.localeCompare(b.start) || a.studentId.localeCompare(b.studentId));
  return added;
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// The student whose regular weekly class overlaps [start, start + minutes) in the teacher's zone.
// Used for dates beyond the generated schedule, where those classes don't exist yet.
export function weeklySlotClash(data: Dataset, startMs: number, minutes: number): { studentId: string; slot: Slot } | undefined {
  const p = zonedParts(new Date(startMs), data.teacher.timezone);
  const weekday = weekdayOf(p.date);
  const a = minutesOf(p.time);
  const b = a + minutes;
  for (const st of data.students) {
    if (st.endedOn && p.date > st.endedOn) continue;
    for (const slot of st.slots) {
      const s = minutesOf(slot.time);
      if (slot.weekday === weekday && s < b && s + slot.minutes > a) return { studentId: st.id, slot };
    }
  }
  return undefined;
}
