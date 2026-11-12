// Reads a message from a family (or the teacher) and proposes class changes. Gemini interprets
// the message; without a key, or if Gemini fails, a rule-based reader does. Either way the
// proposal is checked and simulated with the app's own rules, so its bill impact is exact.
import { wordsFor } from '../../../shared/words';
import { z } from 'zod';
import type { ActionView, AssistantAction, AssistantProposal, BillImpact } from '../../../shared/assistant';
import { buildDraft, dateOf, suggestBillingMonth, type Session, type Student } from '../../../shared/billing';
import { addDays, localIso, todayIn, wallTimeToIso, weekdayOf, zonedParts } from '../../../shared/time';
import { AiError, generateJson, geminiEnabled, type GeminiSchema } from '../gemini';
import { HttpError } from '../http';
import { applySessionPatch, bookMakeup, findFreeTime } from '../services/classes';
import type { Dataset } from '../store';

const DAY_MS = 86_400_000;
const WINDOW_PAST_DAYS = 2;
const WINDOW_FUTURE_DAYS = 28;

// What the reader (AI or rules) understood. Only ids from the context it was given count.
const interpretationSchema = z.object({
  writer: z.enum(['family', 'teacher', 'unknown']),
  studentIds: z.array(z.string()).max(30),
  summary: z.string().max(400),
  cancelSessionIds: z.array(z.string()).max(30),
  makeups: z.array(z.object({ forSessionId: z.string(), preferredStart: z.string().max(20) })).max(30),
  reply: z.string().max(1200),
});
type Interpretation = z.infer<typeof interpretationSchema>;

const GEMINI_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    writer: { type: 'STRING', enum: ['family', 'teacher', 'unknown'], description: 'Who wrote the message' },
    studentIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Ids of the students the message is about' },
    summary: { type: 'STRING', description: 'One sentence: what the message asks for' },
    cancelSessionIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Ids of the listed classes to cancel' },
    makeups: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          forSessionId: { type: 'STRING', description: 'Id of the cancelled class this makeup replaces' },
          preferredStart: { type: 'STRING', description: 'Requested time as YYYY-MM-DDTHH:MM in the teacher time zone, or empty if none was requested' },
        },
        required: ['forSessionId', 'preferredStart'],
      },
    },
    reply: { type: 'STRING', description: 'A short, warm reply from the teacher to the writer' },
  },
  required: ['writer', 'studentIds', 'summary', 'cancelSessionIds', 'makeups', 'reply'],
};

const SYSTEM = `You are the assistant of an independent professional (called "teacher" below) who runs paid sessions online for people abroad (called "students"; whoever pays is the "family" or "parent").
You read one message (from a parent, or from the teacher about their own schedule) and work out which of the teacher's listed classes it is about.
Rules:
- Only use student ids and class ids from the lists you are given. Never invent ids.
- Cancel only classes the message clearly refers to (by day, date or "next class"). If unsure, cancel nothing and say so in the summary.
- If the teacher writes that they can't teach (unwell, travelling), the writer is "teacher" and every class they name is cancelled.
- A family names days and times in its own time zone ("family time" in the class list); the teacher uses teacher time.
- Unless the message says no makeup is wanted, suggest one makeup per cancelled class; set preferredStart only if a time or day was asked for, converted to teacher time.
- The reply is from the teacher, warm and brief (2-4 sentences), in the language of the message, and mentions the date of the class. Do not mention money.`;

type Context = { now: Date; nowMs: number; classes: Session[]; students: Student[] };

function contextFor(data: Dataset, now: Date): Context {
  const nowMs = now.getTime();
  const classes = data.sessions.filter(
    (s) => Date.parse(s.start) >= nowMs - WINDOW_PAST_DAYS * DAY_MS && Date.parse(s.start) <= nowMs + WINDOW_FUTURE_DAYS * DAY_MS,
  );
  return { now, nowMs, classes, students: data.students };
}

const local = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone });

function prompt(data: Dataset, ctx: Context, message: string): string {
  const tz = data.teacher.timezone;
  const students = ctx.students.map((s) => `${s.id}: ${s.name} (parent ${s.parent.name}, lives in ${s.timezone})`).join('\n');
  const names = new Map(ctx.students.map((s) => [s.id, s]));
  const classes = ctx.classes
    .map((s) => {
      const st = names.get(s.studentId)!;
      return `${s.id}: ${st.name}, ${s.start.slice(0, 16)} teacher time (${local(s.start, st.timezone)} family time), ${s.minutes} min, ${s.status}`;
    })
    .join('\n');
  const w = wordsFor(data.teacher.profession);
  return [
    `Work type: ${w.profession}. In the summary and reply, say "${w.student}" for student, "${w.class}" for class and "${w.makeup}" for makeup.`,
    `Teacher: ${data.teacher.name}, time zone ${tz}. Now: ${localIso(ctx.now, tz).slice(0, 16)} (${local(ctx.now.toISOString(), tz)}).`,
    `Students:\n${students}`,
    `Classes from ${WINDOW_PAST_DAYS} days ago to ${WINDOW_FUTURE_DAYS} days ahead:\n${classes}`,
    `Message:\n"""${message}"""`,
  ].join('\n\n');
}

// --- Rule-based reader: no AI needed. Handles the common short messages. --------------------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const CANCEL_WORDS = /\b(sick|ill|unwell|fever|cold|skip|cancel|can't|cant|cannot|won't|wont|unable|miss|away|travel|travelling|holiday|vacation|exam|exams|not able|reschedul\w*|move|shift|postpone)\b/;
const NO_MAKEUP = /\b(no (need (for )?(a )?)?make ?up|don't need (a )?make ?up|no make ?up)\b/;
const TEACHER_WORDS = /\b(i|i'm|im|i am|my)\b.*\b(unwell|sick|ill|travel|travelling|away|can't teach|cannot teach|cancel)\b/;

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9':/ ]/g, ' ');

// Dates the message names, as teacher-time YYYY-MM-DD, nearest first.
function datesIn(text: string, today: string): string[] {
  const t = words(text);
  const dates: string[] = [];
  if (/\btoday\b|\btonight\b/.test(t)) dates.push(today);
  if (/\bday after tomorrow\b/.test(t)) dates.push(addDays(today, 2));
  else if (/\btomorrow\b/.test(t)) dates.push(addDays(today, 1));
  // "next week" or "next Tuesday" means the one after the coming Monday.
  const nextWeek = /\bnext (week|sun|mon|tue|wed|thu|fri|sat)/.test(t);
  let nextMonday = addDays(today, 1);
  while (weekdayOf(nextMonday) !== 1) nextMonday = addDays(nextMonday, 1);
  const named = WEEKDAYS.map((day, i) => ({ i, at: t.search(new RegExp(`\\b(${day}|${day.slice(0, 3)})\\b`)) })).filter((d) => d.at >= 0);
  for (const { i } of named.sort((a, b) => a.at - b.at)) {
    let d = today;
    while (weekdayOf(d) !== i) d = addDays(d, 1);
    if (nextWeek && d < nextMonday) d = addDays(d, 7);
    dates.push(d);
  }
  return dates;
}

// "at 4pm", "16:30" -> "16:00" / "16:30".
function timeIn(text: string): string | undefined {
  const m = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text) ?? /\b(\d{1,2}):(\d{2})\b/.exec(text);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
  return h < 24 ? `${String(h).padStart(2, '0')}:${min}` : undefined;
}

export function readByRules(data: Dataset, ctx: Context, message: string): Interpretation {
  const w = wordsFor(data.teacher.profession);
  const t = words(message);
  const tz = data.teacher.timezone;
  const mentioned = ctx.students.filter((s) => {
    const names = [s.name, s.name.split(' ')[0], s.parent.name.split(' ')[0]].map((n) => n.toLowerCase());
    return names.some((n) => new RegExp(`\\b${n}\\b`).test(t));
  });
  const teacherWrote = mentioned.length === 0 && TEACHER_WORDS.test(t);
  const writer: Interpretation['writer'] = teacherWrote ? 'teacher' : mentioned.length ? 'family' : 'unknown';
  // Days and times in a family's message are in the family's own time zone.
  const zone = writer === 'family' && mentioned[0] ? mentioned[0].timezone : tz;
  const dayIn = (s: Session) => zonedParts(new Date(s.start), zone).date;
  const dates = datesIn(message, todayIn(zone, ctx.now));
  const upcoming = ctx.classes.filter((s) => Date.parse(s.start) > ctx.nowMs && s.status === 'scheduled');

  let cancel: Session[] = [];
  if (CANCEL_WORDS.test(t)) {
    if (writer === 'teacher') {
      cancel = upcoming.filter((s) => dates.includes(dayIn(s)));
    } else if (writer === 'family') {
      const theirs = upcoming.filter((s) => mentioned.some((m) => m.id === s.studentId));
      // The first date named is the class being missed; a later one is the requested makeup day.
      const onDate = dates.length ? theirs.filter((s) => dayIn(s) === dates[0]) : [];
      cancel = onDate.length ? onDate : theirs.slice(0, 1);
    }
  }

  const wantsMakeup = !NO_MAKEUP.test(t);
  const requestedTime = timeIn(message);
  // A requested makeup day or time, in the writer's zone, converted to teacher time.
  const makeupDate = dates.find((d) => !cancel.some((s) => dayIn(s) === d));
  const preferredFor = (s: Session) => {
    if (!makeupDate && !requestedTime) return '';
    const at = wallTimeToIso(makeupDate ?? dayIn(s), requestedTime ?? zonedParts(new Date(s.start), zone).time, zone);
    return localIso(new Date(at), tz).slice(0, 16);
  };
  const makeups = wantsMakeup ? cancel.map((s) => ({ forSessionId: s.id, preferredStart: preferredFor(s) })) : [];

  const firstOf = (name: string) => name.split(' ')[0];
  const teacherFirst = firstOf(data.teacher.name);
  const student = mentioned[0];
  const sick = /\b(sick|ill|unwell|fever|cold)\b/.test(t);
  const when = cancel[0] ? local(cancel[0].start, student?.timezone ?? tz) : '';
  const reply =
    writer === 'family' && student && cancel.length
      ? `Hi ${firstOf(student.parent.name)}, thank you for letting me know. I've cancelled ${student.parent.name === student.name ? 'your' : `${firstOf(student.name)}'s`} ${w.class} on ${when}${wantsMakeup ? ` and I'll send you a ${w.makeup} time` : ''}.${sick ? ` Wishing ${student.parent.name === student.name ? 'you' : firstOf(student.name)} a quick recovery!` : ''} ${teacherFirst}`
      : writer === 'teacher' && cancel.length
        ? `Hi everyone, I'm sorry, but I can't take ${w.classes} on ${cancel.map((s) => local(s.start, tz).split(',')[0]).filter((v, i, a) => a.indexOf(v) === i).join(' and ')}. I'll share ${w.makeup} times shortly. Thank you for understanding! ${teacherFirst}`
        : `Thank you for your message! I'll get back to you shortly. ${teacherFirst}`;

  return {
    writer,
    studentIds: writer === 'teacher' ? [...new Set(cancel.map((s) => s.studentId))] : mentioned.map((s) => s.id),
    summary: cancel.length
      ? `${writer === 'teacher' ? 'You can' : `${student?.name ?? `The ${w.family}`} can`}'t make ${cancel.length === 1 ? `a ${w.class}` : `${cancel.length} ${w.classes}`}${wantsMakeup ? ` and would like a ${w.makeup}` : ''}.`
      : `No ${w.class} change found in this message.`,
    cancelSessionIds: cancel.map((s) => s.id),
    makeups,
    reply,
  };
}

// --- Proposal: check, simulate, explain -----------------------------------------------------

export async function proposeFromMessage(data: Dataset, message: string, now: Date): Promise<AssistantProposal> {
  const ctx = contextFor(data, now);
  const warnings: string[] = [];
  let source: AssistantProposal['source'] = 'mock';
  let reading: Interpretation;

  if (geminiEnabled()) {
    try {
      reading = await generateJson({ system: SYSTEM, prompt: prompt(data, ctx, message), schema: GEMINI_SCHEMA, validate: (v) => interpretationSchema.parse(v) });
      source = 'ai';
    } catch (e) {
      console.error(e instanceof AiError ? e.message : e);
      warnings.push("The AI couldn't be reached, so Tanpura read the message with its built-in rules.");
      reading = readByRules(data, ctx, message);
    }
  } else {
    reading = readByRules(data, ctx, message);
  }
  return buildProposal(data, ctx, reading, source, warnings);
}

function buildProposal(data: Dataset, ctx: Context, reading: Interpretation, source: AssistantProposal['source'], warnings: string[]): AssistantProposal {
  const w = wordsFor(data.teacher.profession);
  const { teacher } = data;
  const tz = teacher.timezone;
  const studentsById = new Map(data.students.map((s) => [s.id, s]));
  const inContext = new Map(ctx.classes.map((s) => [s.id, s]));
  const sim: Dataset = structuredClone(data);
  const actions: ActionView[] = [];
  const firstName = (id: string) => (studentsById.get(id)?.name ?? 'the student').split(' ')[0];

  // Cancellations: only listed, upcoming, still-scheduled classes, of the students the message is about.
  const cancelled = new Set<string>();
  for (const id of new Set(reading.cancelSessionIds)) {
    const s = inContext.get(id);
    if (!s) {
      warnings.push(`The message mentioned a ${w.class} Tanpura could not find; it was left out.`);
      continue;
    }
    if (reading.writer === 'family' && reading.studentIds.length && !reading.studentIds.includes(s.studentId)) continue;
    if (s.status !== 'scheduled' || Date.parse(s.start) <= ctx.nowMs) {
      warnings.push(`${firstName(s.studentId)}'s ${w.class} on ${local(s.start, tz)} has already happened or changed, so it was left out.`);
      continue;
    }
    const late = Date.parse(s.start) - ctx.nowMs < teacher.policy.noticeHours * 3_600_000;
    const status = reading.writer === 'teacher' ? 'cancelled_teacher' : late ? 'cancelled_late' : 'cancelled_student';
    applySessionPatch(sim, s.id, { status }, ctx.nowMs);
    cancelled.add(s.id);
    const effect =
      status === 'cancelled_teacher'
        ? `Never charged to the ${w.family}. With a ${w.makeup} the bill stays the same; without one it becomes a credit.`
        : status === 'cancelled_late'
          ? `Under ${teacher.policy.noticeHours} hours' notice, so it's charged${teacher.policy.lateCancel === 'free' ? ' (your settings make it free)' : ''}. You can still waive it.`
          : 'Cancelled with enough notice: not charged. With a makeup the bill stays the same; without one it becomes a credit.';
    actions.push({ action: { kind: 'cancel', sessionId: s.id, status }, title: `Cancel ${firstName(s.studentId)}'s ${w.class} on ${local(s.start, tz)}`, effect });
  }

  // Makeups: at the requested time if free, otherwise the nearest free time.
  for (const m of reading.makeups) {
    const original = sim.sessions.find((s) => s.id === m.forSessionId);
    if (!original || !cancelled.has(original.id)) continue;
    const requested = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.preferredStart)
      ? Date.parse(wallTimeToIso(m.preferredStart.slice(0, 10), m.preferredStart.slice(11, 16), tz))
      : Date.parse(original.start) + 2 * DAY_MS;
    const start = findFreeTime(sim, original.minutes, Math.max(requested, ctx.nowMs + 3_600_000), ctx.nowMs);
    if (start === undefined) {
      warnings.push(`No free time was found for ${firstName(original.studentId)}'s ${w.makeup}; you can book one from the ${w.class}.`);
      continue;
    }
    const makeup = bookMakeup(sim, original.id, new Date(start).toISOString(), ctx.nowMs);
    const moved = m.preferredStart && Math.abs(start - requested) > 60_000;
    actions.push({
      action: { kind: 'makeup', forSessionId: original.id, start: makeup.start },
      title: `Book a ${w.makeup} for ${firstName(original.studentId)} on ${local(makeup.start, tz)}`,
      effect: `Replaces the cancelled ${w.class}, so no extra charge.${moved ? ' The time asked for was taken, so this is the nearest free time.' : ''}`,
    });
  }

  // Bill impact: the next bill for each affected family, before and after.
  const impactMonth = suggestBillingMonth(teacher.billingMode, todayIn(tz, ctx.now), data.invoices);
  const affected = [...new Set(actions.map((a) => (a.action.kind === 'cancel' ? a.action.sessionId : a.action.forSessionId)))]
    .map((id) => data.sessions.find((s) => s.id === id)?.studentId)
    .filter((id): id is string => Boolean(id));
  const billFor = (d: Dataset, student: Student) =>
    buildDraft({ student, sessions: d.sessions, invoices: d.invoices, teacher: d.teacher, month: impactMonth, today: todayIn(tz, ctx.now), now: ctx.now.toISOString() }).total;
  const impact: BillImpact[] = [...new Set(affected)].map((id) => {
    const student = studentsById.get(id)!;
    return { studentId: id, studentName: student.name, currency: student.currency, before: billFor(data, student), after: billFor(sim, student) };
  });

  if (!actions.length && reading.cancelSessionIds.length === 0) warnings.push(`No ${w.class} change was found. Nothing will change until you add one by hand.`);

  return {
    source,
    writer: reading.writer,
    summary: reading.summary,
    actions,
    warnings: [...new Set(warnings)],
    reply: reading.reply,
    impactMonth,
    impact,
  };
}

// Applies approved actions all together: if any one fails its checks, nothing changes.
export function applyActions(data: Dataset, actions: AssistantAction[], nowMs: number): { data: Dataset; makeupIds: string[] } {
  const next: Dataset = structuredClone(data);
  const makeupIds: string[] = [];
  for (const a of actions) {
    if (a.kind === 'cancel') {
      const s = next.sessions.find((x) => x.id === a.sessionId);
      if (s && s.status !== 'scheduled') throw new HttpError(409, 'A class in this proposal has changed since. Read the message again.');
      applySessionPatch(next, a.sessionId, { status: a.status, ...(a.note ? { note: a.note } : {}) }, nowMs);
    } else {
      makeupIds.push(bookMakeup(next, a.forSessionId, a.start, nowMs).id);
    }
  }
  return { data: next, makeupIds };
}
