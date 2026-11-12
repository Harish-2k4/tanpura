// The assistant's rule-based reader and proposal checks (no AI key in tests).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantAction } from '../../shared/assistant';
import { addDays, todayIn, weekdayOf } from '../../shared/time';
import { applyActions, proposeFromMessage } from '../src/ai/assistant';
import { generateDemoData } from '../src/seed';

const NOW = new Date('2026-11-12T06:00:00Z'); // Thu 12 Nov, 11:30 am in Kolkata
const data = () => generateDemoData(NOW);

const nextClassOn = (d: ReturnType<typeof data>, studentId: string, weekday: number) => {
  const today = todayIn('Asia/Kolkata', NOW);
  return d.sessions.find((s) => s.studentId === studentId && !s.makeupFor && s.status === 'scheduled' && Date.parse(s.start) > NOW.getTime() && weekdayOf(s.start.slice(0, 10)) === weekday && s.start.slice(0, 10) <= addDays(today, 7));
};

test('a parent says the child is sick: cancel that class, propose a makeup, explain the bill', async () => {
  const d = data();
  const meera = d.students.find((s) => s.id === 's02')!;
  const weekday = meera.slots[0].weekday;
  const target = nextClassOn(d, 's02', weekday)!;
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday];

  const p = await proposeFromMessage(d, `Hi Lakshmi, Meera has a fever, she can't make ${day}'s class. Sorry!`, NOW);
  assert.equal(p.source, 'mock');
  assert.equal(p.writer, 'family');
  const cancel = p.actions.find((a) => a.action.kind === 'cancel');
  assert.ok(cancel && cancel.action.kind === 'cancel' && cancel.action.sessionId === target.id, 'cancels the class on that day');
  assert.ok(p.actions.some((a) => a.action.kind === 'makeup'), 'proposes a makeup');
  assert.match(p.reply, /Sangeetha/);
  assert.equal(p.impact.length, 1);
  assert.equal(p.impact[0].studentId, 's02');
  // Proposing changes nothing.
  assert.equal(d.sessions.find((s) => s.id === target.id)!.status, 'scheduled');
});

test("a family's days are read in the family's time zone", async () => {
  const d = data();
  // Aarav (New York) has class on Sunday 5:30 am in India, which is Saturday evening for the family.
  const p = await proposeFromMessage(d, 'Aarav has a fever and will miss Saturday. Could we do a makeup on Monday instead? Priya', NOW);
  const cancel = p.actions.map((a) => a.action).find((a) => a.kind === 'cancel');
  const s = cancel?.kind === 'cancel' ? d.sessions.find((x) => x.id === cancel.sessionId) : undefined;
  assert.ok(s && weekdayOf(s.start.slice(0, 10)) === 0, 'cancels the Sunday-in-India class');
  const makeup = p.actions.find((a) => a.action.kind === 'makeup');
  assert.ok(makeup && makeup.action.kind === 'makeup');
  const ny = new Date(makeup.action.start).toLocaleString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  assert.equal(ny, 'Monday', 'the makeup is on Monday for the family');
});

test('"no makeup needed" is respected', async () => {
  const d = data();
  const p = await proposeFromMessage(d, 'Aarav will skip his next class, no makeup needed. Priya', NOW);
  assert.ok(p.actions.some((a) => a.action.kind === 'cancel'));
  assert.ok(!p.actions.some((a) => a.action.kind === 'makeup'));
});

test('the teacher cancelling their own day cancels every class that day as "by teacher"', async () => {
  const d = data();
  const p = await proposeFromMessage(d, "I'm unwell tomorrow, please cancel my classes.", NOW);
  assert.equal(p.writer, 'teacher');
  const cancels = p.actions.filter((a) => a.action.kind === 'cancel');
  const tomorrow = addDays(todayIn('Asia/Kolkata', NOW), 1);
  const expected = d.sessions.filter((s) => s.start.startsWith(tomorrow) && s.status === 'scheduled').length;
  assert.equal(cancels.length, expected);
  assert.ok(cancels.every((a) => a.action.kind === 'cancel' && a.action.status === 'cancelled_teacher'));
});

test('a message about no class proposes nothing, with a warning', async () => {
  const p = await proposeFromMessage(data(), 'Thank you for the lovely recital last week!', NOW);
  assert.equal(p.actions.length, 0);
  assert.ok(p.warnings.length > 0);
});

test('a cancellation under the notice period is marked late', async () => {
  const d = data();
  const soon = d.sessions.find((s) => s.status === 'scheduled' && !s.makeupFor && Date.parse(s.start) > NOW.getTime() && Date.parse(s.start) - NOW.getTime() < 12 * 3_600_000)!;
  const st = d.students.find((s) => s.id === soon.studentId)!;
  const p = await proposeFromMessage(d, `${st.name.split(' ')[0]} can't come today, sorry`, NOW);
  const cancel = p.actions.find((a) => a.action.kind === 'cancel' && a.action.sessionId === soon.id);
  assert.ok(cancel && cancel.action.kind === 'cancel' && cancel.action.status === 'cancelled_late');
});

test('approved actions apply all together, or not at all', async () => {
  const d = data();
  const p = await proposeFromMessage(d, 'Aarav is sick, please skip his next class', NOW);
  const actions = p.actions.map((a) => a.action);
  const { data: next, makeupIds } = applyActions(d, actions, NOW.getTime());
  const cancelled = actions.find((a): a is Extract<AssistantAction, { kind: 'cancel' }> => a.kind === 'cancel')!;
  assert.equal(next.sessions.find((s) => s.id === cancelled.sessionId)!.status, cancelled.status);
  assert.equal(makeupIds.length, actions.filter((a) => a.kind === 'makeup').length);

  // Applying the same proposal again fails as a whole: the class is no longer scheduled.
  assert.throws(() => applyActions(next, actions, NOW.getTime()), /changed since/);
  // A makeup that clashes stops everything, including the cancellation before it.
  const busy = d.sessions.find((s) => s.status === 'scheduled' && Date.parse(s.start) > NOW.getTime() + 86_400_000)!;
  assert.throws(() => applyActions(d, [cancelled, { kind: 'makeup', forSessionId: cancelled.sessionId, start: busy.start }], NOW.getTime()), /clashes/);
  assert.equal(d.sessions.find((s) => s.id === cancelled.sessionId)!.status, 'scheduled');
});
