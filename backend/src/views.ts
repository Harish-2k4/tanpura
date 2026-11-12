// Builds API responses from stored data. Everything time-dependent takes `now`.
import type { DraftView, SessionView, TeacherView } from '../../shared/api';
import { buildAllDrafts, effectiveStatus, isMissed, isWaivable, makeupIndex, suggestBillingMonth, type Session } from '../../shared/billing';
import { paypalFeatures } from '../../shared/paypal-features';
import { todayIn } from '../../shared/time';
import { config } from './config';
import { geminiEnabled } from './gemini';
import { paypalConfigured } from './paypal';
import type { Dataset } from './store';

export const teacherToday = (data: Pick<Dataset, 'teacher'>, now: Date) => todayIn(data.teacher.timezone, now);

export function teacherView(data: Pick<Dataset, 'teacher' | 'invoices'>, now: Date): TeacherView {
  const today = teacherToday(data, now);
  return {
    ...data.teacher,
    paypalFeatures: paypalFeatures(data.teacher.country),
    today,
    suggestedMonth: suggestBillingMonth(data.teacher.billingMode, today, data.invoices),
    integrations: { paypal: paypalConfigured() ? 'sandbox' : 'mock', ai: geminiEnabled() ? 'live' : 'mock' },
    demoMode: config.demoMode,
  };
}

// What each class (entitlement) is charged on invoices still standing, and in which months.
function billedIndex(data: Dataset) {
  const billed = new Map<string, { amount: number; months: string[] }>();
  for (const inv of data.invoices) {
    if (inv.status === 'CANCELLED') continue;
    for (const e of inv.entries) {
      const b = billed.get(e.sessionId) ?? { amount: 0, months: [] };
      b.amount = Math.round((b.amount + e.amount) * 100) / 100;
      if (!b.months.includes(inv.month)) b.months.push(inv.month);
      billed.set(e.sessionId, b);
    }
  }
  return billed;
}

export function sessionViews(data: Dataset, now: Date, include: (s: Session) => boolean = () => true): SessionView[] {
  const nowMs = now.getTime();
  const names = new Map(data.students.map((s) => [s.id, s.name]));
  const makeups = makeupIndex(data.sessions);
  const byId = new Map(data.sessions.map((s) => [s.id, s]));
  const billed = billedIndex(data);
  // A makeup is billed through the class it replaces.
  const rootOf = (s: Session) => {
    let root = s;
    for (let i = 0; root.makeupFor && byId.has(root.makeupFor) && i < 50; i++) root = byId.get(root.makeupFor)!;
    return root;
  };
  return data.sessions.filter(include).map((s) => {
    const effective = effectiveStatus(s, nowMs, data.teacher.attendance);
    return {
      ...s,
      studentName: names.get(s.studentId) ?? s.studentId,
      effectiveStatus: effective,
      auto: effective !== s.status,
      makeupId: makeups.get(s.id)?.at(-1)?.id,
      canWaive: isWaivable(s.status),
      canBookMakeup: isMissed(s.status) && !makeups.has(s.id),
      billed: billedOrNull(billed.get(rootOf(s).id)),
    };
  });
}

const billedOrNull = (b: { amount: number; months: string[] } | undefined) => (b && b.amount > 0 ? b : null);

export function draftViews(data: Dataset, month: string, now: Date): DraftView[] {
  const drafts = buildAllDrafts({ ...data, month, today: teacherToday(data, now), now: now.toISOString() });
  return drafts
    .map((d) => ({ ...d, student: data.students.find((s) => s.id === d.studentId)! }))
    .filter((d) => !d.student.endedOn || d.lines.length > 0); // an ended enrolment with nothing left to settle
}
