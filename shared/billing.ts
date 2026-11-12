// Billing engine. Pure and deterministic: no I/O, no AI, no clock (callers pass `now`).
//
// Model:
// - Every scheduled class (a session with no `makeupFor`) is one *entitlement*.
// - A makeup is a session pointing at the session it replaces; makeups can chain. The last
//   session in the chain decides what happened to the entitlement.
// - A ledger (entries on issued invoices) records what each entitlement has been charged.
// - A bill for month M = for every entitlement up to M: what it should be charged now, minus
//   what the ledger already charged. Late changes (a waiver, a makeup, an extra class, a
//   cancelled invoice) are corrected on the next bill; nothing is charged twice or missed.
import type { AttendanceMode, BillingMode, Policy, Teacher } from './settings';
import { monthOfDate, nextMonth, prevMonth } from './time';
import { cap, wordsFor } from './words';

import type { Country, Currency } from './regions';
export type { Country, Currency } from './regions';
export { COUNTRIES } from './regions';

export type Slot = { weekday: number; time: string; minutes: number }; // weekday 0=Sun, time HH:MM teacher time


export type Student = {
  id: string;
  name: string;
  parent: { name: string; email: string };
  country: Country;
  timezone: string;
  currency: Currency;
  rate: number; // default price per class, in `currency`
  slots: Slot[];
  endedOn?: string; // YYYY-MM-DD of the last class, once the enrolment has ended
};

export const SESSION_STATUSES = [
  'scheduled', // not marked yet (counts as held once over, with automatic attendance)
  'attended',
  'no_show', // student absent, no notice
  'cancelled_student', // cancelled with enough notice
  'cancelled_late', // cancelled with under `noticeHours` notice
  'cancelled_teacher',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type Session = {
  id: string;
  studentId: string;
  start: string; // ISO with the teacher's offset, e.g. 2026-10-06T18:00:00+05:30
  minutes: number;
  status: SessionStatus;
  makeupFor?: string; // id of the session this one replaces
  waived?: boolean; // teacher chose not to charge this missed class
  price?: number; // overrides the student's rate for this class (scheduled classes only)
  note?: string;
};

// Ledger: what an issued invoice charged (+) or credited (-) for one entitlement.
export type LedgerEntry = { sessionId: string; amount: number };

export const INVOICE_STATUSES = ['SENT', 'PAID', 'PARTIALLY_PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type InvoiceRecord = {
  id: string; // PayPal invoice id (or MOCK-...)
  studentId: string;
  month: string; // YYYY-MM it was issued for
  currency: Currency;
  total: number;
  entries: LedgerEntry[];
  status: InvoiceStatus;
  issuedAt: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  paidAt?: string;
  reminders?: string[]; // YYYY-MM-DD of each reminder sent through PayPal
  mock: boolean;
  refund?: boolean; // money paid back outside the app after an enrolment ended (negative total)
};

// How an invoice stands for the teacher, as of `today` (YYYY-MM-DD).
export const INVOICE_STATES = ['awaiting', 'overdue', 'partial', 'paid', 'cancelled'] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export function invoiceState(inv: Pick<InvoiceRecord, 'status' | 'dueDate'>, today: string): InvoiceState {
  if (inv.status === 'PAID') return 'paid';
  if (inv.status === 'CANCELLED') return 'cancelled';
  if (inv.dueDate < today) return 'overdue';
  return inv.status === 'PARTIALLY_PAID' ? 'partial' : 'awaiting';
}

// Filters on the invoices list; "open" means waiting for money and not yet overdue.
export const INVOICE_FILTERS = ['all', 'open', 'overdue', 'paid', 'cancelled'] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export function matchesInvoiceFilter(state: InvoiceState, filter: InvoiceFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return state === 'awaiting' || state === 'partial';
  return state === filter;
}

// What finally happened to an entitlement.
export type Outcome =
  | 'held' // class happened (original or makeup)
  | 'pending' // not happened yet
  | 'missed_charged' // no-show or late cancel, charged under the policy
  | 'missed_free'; // cancelled with notice, by the teacher, waived, or free under the policy

export type Item = { sessionId: string; date: string; outcome: Outcome; finalSessionId: string; amount: number };

export type LineKind = 'classes' | 'unbilled' | 'credit';

export type Line = {
  kind: LineKind;
  description: string;
  quantity: number;
  unitAmount: number; // always positive
  amount: number; // signed: credits are negative
  items: Item[];
};

export type FlagCode =
  | 'many_makeups'
  | 'missed_charged'
  | 'credited_not_made_up'
  | 'still_scheduled'
  | 'unpaid_previous'
  | 'nothing_to_bill'
  | 'credit_carried'
  | 'already_invoiced';

export type FlagClass = { id: string; date: string };

export type Flag = { code: FlagCode; message: string; classes?: FlagClass[]; invoiceIds?: string[] };

export type InvoiceDraft = {
  studentId: string;
  month: string;
  mode: BillingMode;
  currency: Currency;
  lines: Line[];
  total: number;
  entries: LedgerEntry[]; // what gets recorded if this draft is sent
  notCharged: Item[]; // classes in the month that are not charged, shown for transparency
  flags: Flag[];
  sendable: boolean; // false when total <= 0 or already invoiced for this month
};

// --- helpers --------------------------------------------------------------------

export const dateOf = (s: Pick<Session, 'start'>) => s.start.slice(0, 10); // teacher's calendar date
export const monthOf = (s: Pick<Session, 'start'>) => s.start.slice(0, 7);
export const endMs = (s: Pick<Session, 'start' | 'minutes'>) => Date.parse(s.start) + s.minutes * 60_000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

// "27 Oct; 3, 10 Nov": dates grouped by month, in order.
export function formatDates(dates: string[]): string {
  const byMonth = new Map<string, number[]>();
  for (const d of [...dates].sort()) {
    const key = d.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), Number(d.slice(8))]);
  }
  return [...byMonth].map(([m, days]) => `${days.join(', ')} ${MONTHS[Number(m.slice(5)) - 1]}`).join('; ');
}

const plural = (n: number, one: string, many = `${one}es`) => `${n} ${n === 1 ? one : many}`;
const classRef = (s: Session): FlagClass => ({ id: s.id, date: dateOf(s) });

export const isMissed = (status: SessionStatus) => status !== 'scheduled' && status !== 'attended';
export const isWaivable = (status: SessionStatus) => status === 'no_show' || status === 'cancelled_late';

// With automatic attendance, a class that has ended and was never marked counts as attended.
export function effectiveStatus(s: Session, nowMs: number, attendance: AttendanceMode): SessionStatus {
  return s.status === 'scheduled' && attendance === 'auto' && endMs(s) <= nowMs ? 'attended' : s.status;
}

export function makeupIndex(sessions: Session[]): Map<string, Session[]> {
  const index = new Map<string, Session[]>();
  for (const s of sessions) if (s.makeupFor) index.set(s.makeupFor, [...(index.get(s.makeupFor) ?? []), s]);
  for (const list of index.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return index;
}

// Last session in the makeup chain that starts at `root`.
export function finalSession(root: Session, makeupsFor: Map<string, Session[]>): Session {
  let current = root;
  const seen = new Set<string>();
  while (!seen.has(current.id)) {
    seen.add(current.id);
    const next = makeupsFor.get(current.id);
    if (!next?.length) return current;
    current = next[next.length - 1]; // latest booking wins
  }
  return current; // cycle guard
}

export function outcomeOf(status: SessionStatus, waived: boolean | undefined, policy: Policy): Outcome {
  switch (status) {
    case 'attended':
      return 'held';
    case 'scheduled':
      return 'pending';
    case 'no_show':
      return !waived && policy.noShow === 'charge' ? 'missed_charged' : 'missed_free';
    case 'cancelled_late':
      return !waived && policy.lateCancel === 'charge' ? 'missed_charged' : 'missed_free';
    case 'cancelled_student':
    case 'cancelled_teacher':
      return 'missed_free';
  }
}

// What an entitlement should have been charged in total, given what is already charged.
// A class that has not happened is never credited: in advance mode it is prepaid, and in
// after mode anything already charged for it stays until it happens (safe when switching modes).
function targetAmount(outcome: Outcome, mode: BillingMode, already: number, price: number): number {
  if (outcome === 'missed_free') return 0;
  if (outcome === 'pending' && mode === 'after') return Math.max(already, 0);
  return already > 0 ? already : price;
}

// The month a teacher would bill next: in advance mode the current month until it is billed,
// then the next one; in after mode the month that just ended.
export function suggestBillingMonth(mode: BillingMode, today: string, invoices: InvoiceRecord[]): string {
  const current = monthOfDate(today);
  if (mode === 'after') return prevMonth(current);
  return invoices.some((i) => i.month === current && i.status !== 'CANCELLED') ? nextMonth(current) : current;
}

// --- the bill ---------------------------------------------------------------------

export type BillInput = {
  student: Student;
  sessions: Session[]; // may include other students; filtered here
  invoices: InvoiceRecord[]; // may include other students; filtered here
  teacher: Pick<Teacher, 'billingMode' | 'policy' | 'attendance' | 'profession'>;
  month: string; // YYYY-MM being billed
  today: string; // YYYY-MM-DD in the teacher's zone, for overdue checks
  now: string; // ISO instant, for deciding which classes have happened
};

export function buildDraft({ student, sessions, invoices, teacher, month, today, now }: BillInput): InvoiceDraft {
  const { billingMode: mode, policy, attendance } = teacher;
  const w = wordsFor(teacher.profession);
  const nowMs = Date.parse(now);
  const mine = sessions.filter((s) => s.studentId === student.id).sort((a, b) => a.start.localeCompare(b.start));
  const makeupsFor = makeupIndex(mine);
  const outcome = (s: Session) => outcomeOf(effectiveStatus(s, nowMs, attendance), s.waived, policy);

  const live = invoices.filter((i) => i.studentId === student.id && i.status !== 'CANCELLED');
  const net = new Map<string, number>();
  for (const inv of live) for (const e of inv.entries) net.set(e.sessionId, round2((net.get(e.sessionId) ?? 0) + e.amount));

  // Entitlements up to and including the billed month.
  const roots = mine.filter((s) => !s.makeupFor && monthOf(s) <= month);
  const charges: Item[] = [];
  const credits: Item[] = [];
  const notCharged: Item[] = [];
  const entries: LedgerEntry[] = [];
  const pending: Session[] = [];

  for (const root of roots) {
    const last = finalSession(root, makeupsFor);
    const result = outcome(last);
    if (result === 'pending' && mode === 'after') pending.push(root);
    const already = net.get(root.id) ?? 0;
    const delta = round2(targetAmount(result, mode, already, root.price ?? student.rate) - already);
    const item: Item = { sessionId: root.id, date: dateOf(root), outcome: result, finalSessionId: last.id, amount: delta };
    if (delta > 0) charges.push(item);
    else if (delta < 0) credits.push(item);
    else if (already <= 0 && monthOf(root) === month) notCharged.push(item);
    if (delta !== 0) entries.push({ sessionId: root.id, amount: delta });
  }

  const lines: Line[] = [];
  const addLines = (kind: LineKind, items: Item[], label: (dates: string) => string) => {
    // One line per unit amount (a rate change or a special price gives its own line).
    const byAmount = new Map<number, Item[]>();
    for (const it of items) byAmount.set(Math.abs(it.amount), [...(byAmount.get(Math.abs(it.amount)) ?? []), it]);
    for (const [unit, group] of byAmount) {
      const amount = round2(group.reduce((sum, it) => sum + it.amount, 0));
      lines.push({ kind, description: label(formatDates(group.map((g) => g.date))), quantity: group.length, unitAmount: unit, amount, items: group });
    }
  };
  addLines('classes', charges.filter((c) => c.date.startsWith(month)), (d) => `${cap(w.classes)} in ${monthLabel(month)}: ${d}`);
  addLines('unbilled', charges.filter((c) => !c.date.startsWith(month)), (d) => `Earlier ${w.classes} not yet billed: ${d}`);
  addLines('credit', credits, (d) => `Credit for ${w.classes} not held: ${d}`);

  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const first = student.name.split(' ')[0];
  const flags: Flag[] = [];

  // Review what happened since the last invoice was issued.
  const since = live.reduce((latest, i) => (i.issuedAt > latest ? i.issuedAt : latest), '');
  const happened = mine.filter((s) => dateOf(s) >= since && endMs(s) <= nowMs);

  const madeUp = happened.filter((s) => !s.makeupFor && makeupsFor.has(s.id));
  if (madeUp.length > 2) {
    flags.push({
      code: 'many_makeups',
      message: `${first} needed ${plural(madeUp.length, w.makeup, w.makeups)} since the last bill (each replaces a cancelled ${w.class}, no extra charge). Worth a word with the ${w.family}?`,
      classes: madeUp.map(classRef),
    });
  }
  const missed = happened.filter((s) => outcome(s) === 'missed_charged');
  if (missed.length) {
    flags.push({
      code: 'missed_charged',
      message: `${first} missed ${plural(missed.length, w.class, w.classes)} without enough notice (${formatDates(missed.map(dateOf))}). Charged; waive?`,
      classes: missed.map(classRef),
    });
  }
  // After an enrolment ends there is nothing to make up; the refund note below covers it.
  if (credits.length && !student.endedOn) {
    flags.push({
      code: 'credited_not_made_up',
      message: `${first} gets a credit for ${plural(credits.length, w.class, w.classes)} not made up (${formatDates(credits.map((c) => c.date))}). Book a ${w.makeup} instead?`,
      classes: credits.map((c) => ({ id: c.sessionId, date: c.date })),
    });
  }
  if (pending.length) {
    flags.push({
      code: 'still_scheduled',
      message: `${cap(plural(pending.length, w.class, w.classes))} (${formatDates(pending.map(dateOf))}) not held yet; billed once they happen.`,
      classes: pending.map(classRef),
    });
  }
  const unpaid = live.filter((i) => (i.status === 'SENT' || i.status === 'PARTIALLY_PAID') && i.dueDate < today);
  if (unpaid.length) {
    flags.push({
      code: 'unpaid_previous',
      message: `${first}'s ${unpaid.map((i) => monthLabel(i.month)).join(', ')} invoice${unpaid.length > 1 ? 's are' : ' is'} overdue.`,
      invoiceIds: unpaid.map((i) => i.id),
    });
  }

  const alreadyInvoiced = live.some((i) => i.month === month);
  // An ended enrolment has no next bill, so money owed back is shown even if the month was invoiced.
  if (total < 0 && student.endedOn)
    flags.push({ code: 'credit_carried', message: `${first}'s enrolment has ended, so this credit is owed back to the ${w.family}. Refund it from your PayPal account, then mark it refunded here.` });
  else if (alreadyInvoiced) flags.push({ code: 'already_invoiced', message: `${first} already has an invoice for ${monthLabel(month)}. Changes go on the next bill.` });
  else if (total < 0) flags.push({ code: 'credit_carried', message: `${first}'s credits exceed charges; the credit carries to the next bill.` });
  else if (total === 0) flags.push({ code: 'nothing_to_bill', message: `Nothing to bill for ${first} in ${monthLabel(month)}.` });

  return { studentId: student.id, month, mode, currency: student.currency, lines, total, entries, notCharged, flags, sendable: !alreadyInvoiced && total > 0 };
}

export function buildAllDrafts(input: Omit<BillInput, 'student'> & { students: Student[] }): InvoiceDraft[] {
  return input.students.map((student) => buildDraft({ ...input, student }));
}
