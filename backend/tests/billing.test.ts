import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDraft,
  effectiveStatus,
  formatDates,
  suggestBillingMonth,
  type InvoiceRecord,
  type Session,
  type Student,
} from '../../shared/billing';
import { paypalFeatures } from '../../shared/paypal-features';
import { DEFAULT_POLICY, type AttendanceMode, type BillingMode, type Policy } from '../../shared/settings';
import { addMonths, lastDayOfMonth, localIso, prevMonth, todayIn, wallTimeToIso } from '../../shared/time';
import { extendSchedule } from '../src/schedule';
import { generateDemoData } from '../src/seed';

const student: Student = {
  id: 's1',
  name: 'Meera Krishnan',
  parent: { name: 'Sangeetha Krishnan', email: 'p@example.com' },
  country: 'UK',
  timezone: 'Europe/London',
  currency: 'GBP',
  rate: 25,
  slots: [],
};

let n = 0;
const s = (date: string, status: Session['status'], extra: Partial<Session> = {}): Session => ({
  id: `c${++n}`,
  studentId: 's1',
  start: `${date}T18:00:00+05:30`,
  minutes: 45,
  status,
  ...extra,
});

const invoice = (month: string, entries: { sessionId: string; amount: number }[], extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: `INV-${month}`,
  studentId: 's1',
  month,
  currency: 'GBP',
  total: entries.reduce((a, e) => a + e.amount, 0),
  entries,
  status: 'PAID',
  issuedAt: `${month}-01`,
  dueDate: `${month}-11`,
  mock: true,
  ...extra,
});

type Opts = { mode?: BillingMode; attendance?: AttendanceMode; invoices?: InvoiceRecord[]; policy?: Policy; today?: string; now?: string; st?: Student };

// Defaults: billed on the 1st of the month, before any class of that month has started.
const bill = (sessions: Session[], month: string, o: Opts = {}) =>
  buildDraft({
    student: o.st ?? student,
    sessions,
    invoices: o.invoices ?? [],
    teacher: { billingMode: o.mode ?? 'advance', attendance: o.attendance ?? 'manual', policy: o.policy ?? DEFAULT_POLICY },
    month,
    today: o.today ?? `${month}-01`,
    now: o.now ?? `${month}-01T00:00:00+05:30`,
  });

const codes = (d: ReturnType<typeof bill>) => d.flags.map((f) => f.code);
const lines = (d: ReturnType<typeof bill>) => d.lines.map((l) => [l.kind, l.amount]);

// --- advance mode ------------------------------------------------------------------

test('advance: first bill charges every scheduled class in the month, listing the dates', () => {
  const d = bill([s('2026-11-03', 'scheduled'), s('2026-11-10', 'scheduled'), s('2026-11-17', 'scheduled')], '2026-11');
  assert.equal(d.total, 75);
  assert.deepEqual(lines(d), [['classes', 75]]);
  assert.match(d.lines[0].description, /3, 10, 17 Nov/);
  assert.ok(d.sendable);
});

test('advance: a class cancelled ahead of time is not charged and is listed as not charged', () => {
  const d = bill([s('2026-11-03', 'scheduled'), s('2026-11-10', 'cancelled_student')], '2026-11');
  assert.equal(d.total, 25);
  assert.equal(d.notCharged.length, 1);
});

test('advance: a prepaid class cancelled with notice and not made up becomes a credit', () => {
  const oct = s('2026-10-20', 'cancelled_student');
  const d = bill([oct, s('2026-11-03', 'scheduled')], '2026-11', { invoices: [invoice('2026-10', [{ sessionId: oct.id, amount: 25 }])] });
  assert.equal(d.total, 0);
  assert.deepEqual(lines(d), [['classes', 25], ['credit', -25]]);
  assert.ok(codes(d).includes('credited_not_made_up'));
  assert.ok(codes(d).includes('nothing_to_bill'));
  assert.ok(!d.sendable);
});

test('advance: a cancelled class with a makeup held or booked gives no credit', () => {
  const a = s('2026-10-20', 'cancelled_student');
  const b = s('2026-10-27', 'cancelled_teacher');
  const sessions = [a, s('2026-10-22', 'attended', { makeupFor: a.id }), b, s('2026-11-05', 'scheduled', { makeupFor: b.id })];
  const inv = invoice('2026-10', [{ sessionId: a.id, amount: 25 }, { sessionId: b.id, amount: 25 }]);
  const d = bill(sessions, '2026-11', { invoices: [inv] });
  assert.equal(d.total, 0);
  assert.equal(d.lines.length, 0);
});

test('a makeup chain follows to the last session', () => {
  const a = s('2026-10-20', 'cancelled_student');
  const m1 = s('2026-10-22', 'cancelled_teacher', { makeupFor: a.id });
  const m2 = s('2026-10-24', 'attended', { makeupFor: m1.id });
  const d = bill([a, m1, m2], '2026-11', { invoices: [invoice('2026-10', [{ sessionId: a.id, amount: 25 }])] });
  assert.equal(d.total, 0); // held in the end, already paid
});

test('a no-show stays charged; waiving it later gives a credit', () => {
  const ns = s('2026-10-20', 'no_show');
  const inv = [invoice('2026-10', [{ sessionId: ns.id, amount: 25 }])];
  const charged = bill([ns], '2026-11', { invoices: inv, now: '2026-10-31T12:00:00+05:30' });
  assert.equal(charged.total, 0);
  assert.ok(codes(charged).includes('missed_charged'));

  const waived = bill([{ ...ns, waived: true }], '2026-11', { invoices: inv });
  assert.equal(waived.total, -25);
  assert.ok(codes(waived).includes('credit_carried'));
  assert.ok(!waived.sendable);
});

test('policy: free no-shows give a credit without waiving', () => {
  const ns = s('2026-10-20', 'no_show');
  const d = bill([ns, s('2026-11-03', 'scheduled')], '2026-11', {
    invoices: [invoice('2026-10', [{ sessionId: ns.id, amount: 25 }])],
    policy: { ...DEFAULT_POLICY, noShow: 'free' },
  });
  assert.equal(d.total, 0);
});

test('an extra class added after the bill is charged next time', () => {
  const billed = s('2026-10-06', 'attended');
  const extra = s('2026-10-14', 'attended');
  const d = bill([billed, extra], '2026-11', { invoices: [invoice('2026-10', [{ sessionId: billed.id, amount: 25 }])] });
  assert.deepEqual(lines(d), [['unbilled', 25]]);
});

test('a credited class that is later made up is charged again', () => {
  const a = s('2026-10-20', 'cancelled_student');
  const inv = [invoice('2026-10', [{ sessionId: a.id, amount: 25 }]), invoice('2026-11', [{ sessionId: a.id, amount: -25 }])];
  const d = bill([a, s('2026-11-20', 'attended', { makeupFor: a.id })], '2026-12', { invoices: inv });
  assert.deepEqual(lines(d), [['unbilled', 25]]);
});

test('a credit uses the amount charged, not the new rate', () => {
  const a = s('2026-10-20', 'cancelled_teacher');
  const d = bill([a], '2026-11', { invoices: [invoice('2026-10', [{ sessionId: a.id, amount: 20 }])], st: { ...student, rate: 30 } });
  assert.equal(d.total, -20);
});

test('a class with its own price is charged that price, on its own line', () => {
  const d = bill([s('2026-11-03', 'scheduled'), s('2026-11-10', 'scheduled', { price: 55 })], '2026-11');
  assert.equal(d.total, 80);
  assert.deepEqual(lines(d), [['classes', 25], ['classes', 55]]);
});

test('a makeup uses the price of the class it replaces', () => {
  const a = s('2026-10-20', 'cancelled_student', { price: 40 });
  const d = bill([a, s('2026-10-22', 'attended', { makeupFor: a.id })], '2026-10', { mode: 'after', now: '2026-11-01T00:00:00+05:30' });
  assert.equal(d.total, 40);
});

test('cancelled invoices are ignored, so their classes are billed again', () => {
  const a = s('2026-10-06', 'attended');
  const d = bill([a], '2026-11', { invoices: [invoice('2026-10', [{ sessionId: a.id, amount: 25 }], { status: 'CANCELLED' })] });
  assert.equal(d.total, 25);
});

test('already invoiced for the month: not sendable', () => {
  const a = s('2026-11-03', 'scheduled');
  const d = bill([a], '2026-11', { invoices: [invoice('2026-11', [{ sessionId: a.id, amount: 25 }])] });
  assert.ok(codes(d).includes('already_invoiced'));
  assert.ok(!d.sendable);
});

test('an overdue earlier invoice is flagged', () => {
  const inv = invoice('2026-10', [], { status: 'SENT', dueDate: '2026-10-11' });
  assert.ok(codes(bill([s('2026-11-03', 'scheduled')], '2026-11', { invoices: [inv], today: '2026-11-01' })).includes('unpaid_previous'));
});

test('ignores other students and later months', () => {
  const sessions = [s('2026-11-03', 'scheduled'), s('2026-11-04', 'scheduled', { studentId: 's2' }), s('2026-12-01', 'scheduled')];
  assert.equal(bill(sessions, '2026-11').total, 25);
});

test('flags more than two makeups since the last bill', () => {
  const roots = [1, 2, 3].map((i) => s(`2026-10-0${i}`, 'cancelled_student'));
  const mks = roots.map((r, i) => s(`2026-10-1${i}`, 'attended', { makeupFor: r.id }));
  assert.ok(codes(bill([...roots, ...mks], '2026-11')).includes('many_makeups'));
});

// --- after mode and attendance -------------------------------------------------------

test('after: charges what happened; notice cancellations and future makeups wait', () => {
  const a = s('2026-10-01', 'cancelled_student');
  const sessions = [
    s('2026-10-06', 'attended'),
    s('2026-10-13', 'no_show'),
    s('2026-10-20', 'cancelled_late'),
    s('2026-10-27', 'cancelled_teacher'),
    a,
    s('2026-11-02', 'scheduled', { makeupFor: a.id }),
  ];
  const d = bill(sessions, '2026-10', { mode: 'after', today: '2026-11-01', now: '2026-11-01T00:00:00+05:30' });
  assert.equal(d.total, 75);
  assert.ok(codes(d).includes('still_scheduled'));
  assert.ok(codes(d).includes('missed_charged'));
});

test('after: a makeup held next month is charged on the next bill', () => {
  const a = s('2026-10-30', 'cancelled_student');
  const d = bill([a, s('2026-11-02', 'attended', { makeupFor: a.id })], '2026-11', { mode: 'after', now: '2026-12-01T00:00:00+05:30' });
  assert.deepEqual(lines(d), [['unbilled', 25]]);
});

test('automatic attendance: an ended, unmarked class counts as held; manual waits', () => {
  const sessions = [s('2026-10-06', 'scheduled'), s('2026-10-13', 'scheduled')];
  const now = '2026-11-01T00:00:00+05:30';
  assert.equal(bill(sessions, '2026-10', { mode: 'after', attendance: 'auto', now }).total, 50);
  const manual = bill(sessions, '2026-10', { mode: 'after', attendance: 'manual', now });
  assert.equal(manual.total, 0);
  assert.ok(codes(manual).includes('still_scheduled'));
  assert.equal(effectiveStatus(sessions[0], Date.parse(now), 'auto'), 'attended');
  assert.equal(effectiveStatus(s('2026-12-01', 'scheduled'), Date.parse(now), 'auto'), 'scheduled');
});

test('switching advance -> after never credits classes that are still to come', () => {
  const nov = s('2026-11-24', 'scheduled');
  const d = bill([nov], '2026-11', {
    mode: 'after',
    invoices: [invoice('2026-11', [{ sessionId: nov.id, amount: 25 }])],
    now: '2026-11-12T00:00:00+05:30',
  });
  assert.equal(d.lines.length, 0);
});

// --- helpers and country features -------------------------------------------------

test('billing month suggestion', () => {
  assert.equal(suggestBillingMonth('advance', '2026-11-12', []), '2026-11');
  assert.equal(suggestBillingMonth('advance', '2026-11-12', [invoice('2026-11', [])]), '2026-12');
  assert.equal(suggestBillingMonth('advance', '2026-11-12', [invoice('2026-11', [], { status: 'CANCELLED' })]), '2026-11');
  assert.equal(suggestBillingMonth('after', '2026-11-12', []), '2026-10');
});

test('time helpers', () => {
  assert.equal(prevMonth('2026-01'), '2025-12');
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(lastDayOfMonth('2028-02'), '2028-02-29');
  assert.equal(formatDates(['2026-11-10', '2026-10-27', '2026-11-03']), '27 Oct; 3, 10 Nov');
  assert.equal(localIso(new Date('2026-11-12T12:30:00Z'), 'Asia/Kolkata'), '2026-11-12T18:00:00+05:30');
  assert.equal(localIso(new Date('2026-07-01T12:00:00Z'), 'Europe/London'), '2026-07-01T13:00:00+01:00');
  assert.equal(todayIn('Asia/Kolkata', new Date('2026-11-12T20:00:00Z')), '2026-11-13');
  assert.equal(wallTimeToIso('2026-11-12', '18:00', 'Asia/Kolkata'), '2026-11-12T18:00:00+05:30');
  assert.equal(wallTimeToIso('2026-07-01', '13:00', 'Europe/London'), '2026-07-01T13:00:00+01:00'); // summer time
  assert.equal(wallTimeToIso('2026-12-01', '13:00', 'Europe/London'), '2026-12-01T13:00:00+00:00');
  assert.equal(wallTimeToIso('2026-11-01', '23:30', 'America/New_York'), '2026-11-01T23:30:00-05:00'); // day DST ends
});

test('weekly classes are generated ahead, once', () => {
  const data = generateDemoData(new Date('2026-11-12T06:00:00Z'));
  assert.equal(data.teacher.scheduledUntil, '2026-12-31');
  assert.equal(extendSchedule(data, new Date('2026-11-20T06:00:00Z')), 0); // still within the horizon

  const added = extendSchedule(data, new Date('2026-12-02T06:00:00Z'));
  const perWeek = data.students.reduce((n, s) => n + s.slots.length, 0);
  assert.ok(added >= perWeek * 4 && added <= perWeek * 5, `January classes added: ${added}`);
  assert.equal(data.teacher.scheduledUntil, '2027-01-31');
  assert.equal(extendSchedule(data, new Date('2026-12-02T07:00:00Z')), 0); // idempotent
  assert.equal(new Set(data.sessions.map((s) => s.id)).size, data.sessions.length); // ids stay unique
});

test('partial payments depend on the teacher country', () => {
  assert.equal(paypalFeatures('IN').partialPayments, false);
  assert.equal(paypalFeatures('br').partialPayments, false);
  assert.equal(paypalFeatures('GB').partialPayments, true);
});
