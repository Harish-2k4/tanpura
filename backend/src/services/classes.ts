// Rules for changing classes, shared by the class routes and the AI assistant, so a change
// proposed by the AI goes through exactly the same checks as one made by hand.
import { dateOf, endMs, isMissed, isWaivable, makeupIndex, type Session } from '../../../shared/billing';
import type { SessionPatch } from '../../../shared/schemas';
import { localIso } from '../../../shared/time';
import { wordsFor } from '../../../shared/words';
import { HttpError } from '../http';
import { nextSessionId, weeklySlotClash } from '../schedule';
import type { Dataset } from '../store';

const DAY_MS = 86_400_000;
const MAKEUP_PAST_DAYS = 60;
const MAKEUP_FUTURE_DAYS = 180;

export function findSession(data: Dataset, id: string): Session {
  const session = data.sessions.find((s) => s.id === id);
  if (!session) throw new HttpError(404, 'Not found');
  return session;
}

const nameOf = (data: Dataset, studentId: string) => data.students.find((st) => st.id === studentId)?.name ?? `another ${wordsFor(data.teacher.profession).student}`;

// Why a class can't go at [startMs, startMs + minutes), or undefined if the teacher is free.
export function clashReason(data: Dataset, startMs: number, minutes: number, ignoreId?: string): string | undefined {
  const endAt = startMs + minutes * 60_000;
  const clash = data.sessions.find(
    (s) => s.id !== ignoreId && !s.status.startsWith('cancelled') && Date.parse(s.start) < endAt && endMs(s) > startMs,
  );
  if (clash) return `That time clashes with ${nameOf(data, clash.studentId)}'s ${wordsFor(data.teacher.profession).class} at ${clash.start.slice(11, 16)} on ${dateOf(clash)}`;
  // Beyond the generated schedule, regular weekly classes don't exist yet but will.
  const date = localIso(new Date(startMs), data.teacher.timezone).slice(0, 10);
  const weekly = date > data.teacher.scheduledUntil ? weeklySlotClash(data, startMs, minutes) : undefined;
  if (weekly) return `That time is ${nameOf(data, weekly.studentId)}'s regular weekly ${wordsFor(data.teacher.profession).class} (${weekly.slot.time})`;
  return undefined;
}

// The nearest free time to `preferredMs`: the same time, then up to 3 hours either side on the
// same day, then the same time on the following days. Never in the past.
export function findFreeTime(data: Dataset, minutes: number, preferredMs: number, nowMs: number): number | undefined {
  const offsets = [0, 30, -30, 60, -60, 90, -90, 120, -120, 180, -180].map((m) => m * 60_000);
  for (let day = 0; day < 7; day++) {
    for (const offset of day === 0 ? offsets : [0, ...offsets.slice(1)]) {
      const start = preferredMs + day * DAY_MS + offset;
      if (start > nowMs && !clashReason(data, start, minutes)) return start;
    }
  }
  return undefined;
}

// Applies a validated patch to a class. Mutates `data`; throws HttpError if a rule is broken.
export function applySessionPatch(data: Dataset, id: string, patch: SessionPatch, nowMs: number): Session {
  const s = findSession(data, id);

  if (patch.status && patch.status !== s.status) {
    if ((patch.status === 'attended' || patch.status === 'no_show') && Date.parse(s.start) > nowMs) {
      throw new HttpError(400, `This ${wordsFor(data.teacher.profession).class} hasn't started yet`);
    }
    const makeup = makeupIndex(data.sessions).get(s.id)?.at(-1);
    if (makeup && !isMissed(patch.status)) {
      throw new HttpError(409, `A ${wordsFor(data.teacher.profession).makeup} is booked for this ${wordsFor(data.teacher.profession).class} (${dateOf(makeup)}). Cancel it first.`);
    }
    s.status = patch.status;
    if (!isWaivable(s.status)) delete s.waived;
  }
  if (patch.waived !== undefined) {
    if (!isWaivable(s.status)) throw new HttpError(400, 'Only no-shows and late cancellations can be waived');
    if (patch.waived) s.waived = true;
    else delete s.waived;
  }
  if (patch.price !== undefined) {
    if (s.makeupFor) throw new HttpError(400, `A ${wordsFor(data.teacher.profession).makeup} uses the price of the ${wordsFor(data.teacher.profession).class} it replaces`);
    if (patch.price === null) delete s.price;
    else s.price = patch.price;
  }
  if (patch.note !== undefined) {
    if (patch.note) s.note = patch.note;
    else delete s.note;
  }
  return s;
}

// Books a makeup for a missed or cancelled class. Mutates `data`; throws HttpError if not allowed.
export function bookMakeup(data: Dataset, originalId: string, startIso: string, nowMs: number): Session {
  const original = findSession(data, originalId);
  if (!isMissed(original.status)) throw new HttpError(400, `Only a missed or cancelled ${wordsFor(data.teacher.profession).class} can be made up`);
  if (makeupIndex(data.sessions).has(original.id)) throw new HttpError(409, `A ${wordsFor(data.teacher.profession).makeup} is already booked for this ${wordsFor(data.teacher.profession).class}`);

  const startMs = Date.parse(startIso);
  if (startMs < nowMs - MAKEUP_PAST_DAYS * DAY_MS || startMs > nowMs + MAKEUP_FUTURE_DAYS * DAY_MS) {
    throw new HttpError(400, `Pick a time within ${MAKEUP_PAST_DAYS} days before and ${MAKEUP_FUTURE_DAYS} days after today`);
  }
  const endedOn = data.students.find((st) => st.id === original.studentId)?.endedOn;
  if (endedOn && localIso(new Date(startMs), data.teacher.timezone).slice(0, 10) > endedOn) {
    throw new HttpError(400, `This enrolment ended on ${endedOn}. Pick a time on or before that day.`);
  }
  const clash = clashReason(data, startMs, original.minutes);
  if (clash) throw new HttpError(409, clash);

  const makeup: Session = {
    id: nextSessionId(data.sessions),
    studentId: original.studentId,
    start: localIso(new Date(startMs), data.teacher.timezone),
    minutes: original.minutes,
    status: 'scheduled',
    makeupFor: original.id,
  };
  data.sessions.push(makeup);
  data.sessions.sort((a, b) => a.start.localeCompare(b.start));
  return makeup;
}
