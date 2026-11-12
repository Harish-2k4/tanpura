// End-to-end API tests against a real server on a random port, with demo data in a temp dir.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { BillingOverview, DashboardData, DraftView, InvoicePage, InvoiceRow, PaymentsReport, SendResult, SessionView, TeacherView } from '../../shared/api';
import type { ApplyResult, AssistantProposal, ReminderDraft } from '../../shared/assistant';
import type { InvoiceRecord, Student } from '../../shared/billing';
import { addDays } from '../../shared/time';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tanpura-test-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATA_DIR: dataDir,
  APP_EMAIL: 'teacher@example.com',
  APP_PASSWORD: 'correct horse battery',
  SESSION_SECRET: 'x'.repeat(48),
  DEMO_MODE: 'true',
  PAYPAL_CLIENT_ID: '',
  PAYPAL_SECRET: '',
  GEMINI_API_KEY: '',
});

const { createApp } = await import('../src/app');
const { generateDemoData } = await import('../src/seed');
const { saveAll } = await import('../src/store');
const { config } = await import('../src/config');

let base = '';
let cookie = '';
let close = () => {};

type Call = { body?: unknown; auth?: boolean; cookie?: string; raw?: string };
async function call<T = unknown>(method: string, url: string, opts: Call = {}) {
  const headers: Record<string, string> = {};
  if (opts.raw !== undefined) headers['Content-Type'] = 'text/plain';
  else if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (opts.cookie ?? (opts.auth !== false && cookie)) headers.Cookie = opts.cookie ?? cookie;
  const res = await fetch(`${base}${url}`, {
    method,
    headers,
    body: opts.raw ?? (method === 'GET' ? undefined : JSON.stringify(opts.body ?? {})),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : undefined) as T };
}

before(async () => {
  await saveAll(generateDemoData(new Date()));
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => server.close();
});

after(() => {
  close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('guards', () => {
  const protectedRoutes: [string, string][] = [
    ['GET', '/teacher'],
    ['PATCH', '/teacher'],
    ['GET', '/students'],
    ['PATCH', '/students/s01'],
    ['GET', '/sessions?from=2026-11-01&to=2026-11-30'],
    ['PATCH', '/sessions/c0001'],
    ['POST', '/sessions/c0001/makeup'],
    ['GET', '/billing/drafts?month=2026-11'],
    ['POST', '/billing/send'],
    ['GET', '/billing/invoices'],
    ['GET', '/billing/overview'],
    ['GET', '/billing/invoices/MOCK-1'],
    ['POST', '/billing/invoices/MOCK-1/reminder-draft'],
    ['POST', '/billing/invoices/MOCK-1/remind'],
    ['GET', '/billing/payments?month=2026-11'],
    ['POST', '/assistant/propose'],
    ['POST', '/assistant/apply'],
    ['POST', '/assistant/studio'],
    ['GET', '/dashboard'],
    ['GET', '/events'],
    ['POST', '/billing/invoices/MOCK-1/cancel'],
    ['POST', '/billing/invoices/MOCK-1/payment'],
    ['POST', '/billing/invoices/sync'],
    ['POST', '/demo/reset'],
    ['GET', '/no-such-route'],
  ];

  test('health, sign-in config and the session check are public', async () => {
    assert.equal((await call('GET', '/health', { auth: false })).status, 200);
    assert.deepEqual((await call('GET', '/auth/session', { auth: false })).body, { user: null });
    const cfg = await call<{ demo: { email: string } | null }>('GET', '/auth/config', { auth: false });
    assert.equal(cfg.body.demo?.email, 'teacher@example.com');
  });

  test('every other route rejects requests without a session', async () => {
    for (const [method, url] of protectedRoutes) {
      const res = await call(method, url, { auth: false });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
  });

  test('the PayPal webhook is public but refuses to work without webhook settings', async () => {
    const res = await call('POST', '/paypal/webhook', { auth: false, body: { id: 'WH-1', event_type: 'INVOICING.INVOICE.PAID' } });
    assert.equal(res.status, 503);
  });

  test('forged and expired session cookies are rejected', async () => {
    const future = Date.now() + 3_600_000;
    for (const forged of [`tanpura_session=${future}.bad-signature`, `tanpura_session=1.abc`, 'tanpura_session=garbage']) {
      assert.equal((await call('GET', '/teacher', { cookie: forged })).status, 401);
    }
  });

  test('wrong credentials are rejected; right ones set a strict httpOnly cookie', async () => {
    assert.equal((await call('POST', '/auth/login', { auth: false, body: { email: 'teacher@example.com', password: 'nope' } })).status, 401);
    assert.equal((await call('POST', '/auth/login', { auth: false, body: { email: 'not-an-email', password: 'x' } })).status, 400);

    const ok = await call('POST', '/auth/login', { auth: false, body: { email: 'Teacher@Example.com', password: 'correct horse battery' } });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.getSetCookie()[0];
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    cookie = setCookie.split(';')[0];
    assert.deepEqual((await call('GET', '/auth/session')).body, { user: { email: 'teacher@example.com' } });
  });

  test('mutations must be JSON, and bodies are validated', async () => {
    assert.equal((await call('PATCH', '/teacher', { raw: 'billingMode=after' })).status, 415);
    const bad = await call<{ issues: unknown[] }>('PATCH', '/teacher', { body: { billingMode: 'sometimes' } });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.issues.length > 0);
    assert.equal((await call('PATCH', '/teacher', { body: { unknownField: 1 } })).status, 400);
    assert.equal((await call('GET', '/billing/drafts?month=2026-13')).status, 400);
    assert.equal((await call('GET', '/no-such-route')).status, 404);
  });
});

describe('billing', () => {
  test('drafts for the suggested month can be sent once', async () => {
    const teacher = (await call<TeacherView>('GET', '/teacher')).body;
    const drafts = (await call<DraftView[]>('GET', `/billing/drafts?month=${teacher.suggestedMonth}`)).body;
    const ready = drafts.filter((d) => d.sendable).map((d) => ({ studentId: d.studentId, total: d.total }));
    assert.ok(ready.length >= 3, 'expected sendable drafts');

    const first = await call<SendResult>('POST', '/billing/send', { body: { month: teacher.suggestedMonth, bills: ready.slice(0, 2) } });
    assert.equal(first.body.sent.length, 2);
    const again = await call<SendResult>('POST', '/billing/send', { body: { month: teacher.suggestedMonth, bills: ready.slice(0, 2) } });
    assert.equal(again.body.sent.length, 0);
    assert.equal(again.body.skipped.length, 2);
  });

  test('a bill whose total changed since review is not sent', async () => {
    const teacher = (await call<TeacherView>('GET', '/teacher')).body;
    const drafts = (await call<DraftView[]>('GET', `/billing/drafts?month=${teacher.suggestedMonth}`)).body;
    const d = drafts.find((x) => x.sendable)!;
    const res = await call<SendResult>('POST', '/billing/send', { body: { month: teacher.suggestedMonth, bills: [{ studentId: d.studentId, total: d.total + 1 }] } });
    assert.equal(res.body.sent.length, 0);
    assert.match(res.body.skipped[0].reason, /changed since you reviewed/);
  });

  test('send requests are validated', async () => {
    assert.equal((await call('POST', '/billing/send', { body: { month: '2026-11', bills: [] } })).status, 400);
    assert.equal((await call('POST', '/billing/send', { body: { month: '2026-11', studentIds: ['s01'] } })).status, 400);
  });

  test('invoices are paged, searchable and filterable', async () => {
    const all = (await call<InvoicePage>('GET', '/billing/invoices?pageSize=10')).body;
    assert.equal(all.items.length, 10);
    assert.ok(all.total > 10);
    assert.equal(all.counts.all, all.total);
    assert.equal(all.counts.open + all.counts.overdue + all.counts.paid + all.counts.cancelled, all.total);
    const last = (await call<InvoicePage>('GET', `/billing/invoices?pageSize=10&page=${Math.floor((all.total - 1) / 10)}`)).body;
    assert.equal(last.items.length, all.total - Math.floor((all.total - 1) / 10) * 10);
    const beyond = (await call<InvoicePage>('GET', '/billing/invoices?pageSize=10&page=999')).body;
    assert.equal(beyond.items.length, 0);

    const meera = (await call<InvoicePage>('GET', '/billing/invoices?q=meera')).body;
    assert.ok(meera.total > 0 && meera.items.every((i) => i.studentName === 'Meera Krishnan'));
    const byParent = (await call<InvoicePage>('GET', '/billing/invoices?q=SANGEETHA')).body;
    assert.equal(byParent.total, meera.total);
    const overdue = (await call<InvoicePage>('GET', '/billing/invoices?filter=overdue')).body;
    assert.equal(overdue.total, all.counts.overdue);
    const overview = (await call<BillingOverview>('GET', '/billing/overview')).body;
    assert.equal(overview.overdue.count, all.counts.overdue);

    assert.equal((await call('GET', '/billing/invoices?pageSize=7')).status, 400);
    assert.equal((await call('GET', '/billing/invoices?page=-1')).status, 400);
    assert.equal((await call('GET', '/billing/invoices?filter=late')).status, 400);
    assert.equal((await call('GET', `/billing/invoices?q=${'x'.repeat(101)}`)).status, 400);
  });

  test('invoices export as CSV', async () => {
    const res = await fetch(`${base}/billing/invoices.csv`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    const text = await res.text();
    const [header, ...rows] = text.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(header, /^Invoice,Name,/);
    assert.ok(rows.length > 0);
    assert.equal((await fetch(`${base}/billing/invoices.csv`)).status, 401);
  });

  test('invoice actions check the invoice state', async () => {
    const invoices = (await call<InvoicePage>('GET', '/billing/invoices?pageSize=100')).body.items;
    const paid = invoices.find((i) => i.status === 'PAID')!;
    const open = invoices.find((i) => i.status === 'SENT')!;
    assert.equal((await call('POST', `/billing/invoices/${paid.id}/cancel`)).status, 409);
    assert.equal((await call('POST', `/billing/invoices/${open.id}/payment`, { body: { date: addDays(open.issuedAt, -1) } })).status, 400);
    const today = (await call<TeacherView>('GET', '/teacher')).body.today;
    const recorded = await call<InvoiceRecord>('POST', `/billing/invoices/${open.id}/payment`, { body: { date: today } });
    assert.equal(recorded.body.status, 'PAID');
  });
});

describe('AI assistant (rule-based in tests)', () => {
  test('proposes, then applies only what was approved', async () => {
    const bad = await call('POST', '/assistant/propose', { body: { message: 'x' } });
    assert.equal(bad.status, 400);
    const p = (await call<AssistantProposal>('POST', '/assistant/propose', { body: { message: 'Rohan is unwell, he will miss his next class' } })).body;
    assert.ok(p.actions.length >= 1);
    const applied = await call<ApplyResult>('POST', '/assistant/apply', { body: { actions: p.actions.map((a) => a.action) } });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.applied, p.actions.length);
    const again = await call('POST', '/assistant/apply', { body: { actions: p.actions.map((a) => a.action) } });
    assert.equal(again.status, 409);
    assert.equal((await call('POST', '/assistant/apply', { body: { actions: [{ kind: 'delete', sessionId: 'c0001' }] } })).status, 400);
  });
});

describe('dashboard AI', () => {
  test('needs a Gemini key (none in tests)', async () => {
    const res = await call<{ error: string }>('POST', '/assistant/studio', { body: { input: [], responseFormat: { type: 'text' } } });
    assert.equal(res.status, 503);
  });
});

describe('reminders, payments, dashboard', () => {
  test('a reminder is drafted, sent, and not sent twice in a day', async () => {
    const open = (await call<InvoicePage>('GET', '/billing/invoices?filter=overdue')).body.items[0] ?? (await call<InvoicePage>('GET', '/billing/invoices?filter=open')).body.items[0];
    assert.ok(open, 'expected an unpaid invoice');
    const draft = (await call<ReminderDraft>('POST', `/billing/invoices/${open.id}/reminder-draft`)).body;
    assert.ok(draft.subject.length > 3 && draft.note.includes(open.studentName.split(' ')[0]));
    const sent = await call<InvoiceRow>('POST', `/billing/invoices/${open.id}/remind`, { body: { subject: draft.subject, note: draft.note } });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.reminders?.length, 1);
    assert.equal((await call('POST', `/billing/invoices/${open.id}/remind`, { body: { subject: draft.subject, note: draft.note } })).status, 409);
    assert.equal((await call('POST', `/billing/invoices/${open.id}/remind`, { body: { subject: 'Hi', note: '' } })).status, 400);
    const paid = (await call<InvoicePage>('GET', '/billing/invoices?filter=paid')).body.items[0];
    assert.equal((await call('POST', `/billing/invoices/${paid.id}/reminder-draft`)).status, 409);
  });

  test('payments report (sample data without keys) matches invoices and totals per currency', async () => {
    const teacher = (await call<TeacherView>('GET', '/teacher')).body;
    const month = teacher.today.slice(0, 7);
    const report = (await call<PaymentsReport>('GET', `/billing/payments?month=${month}`)).body;
    assert.equal(report.source, 'mock');
    assert.ok(report.rows.length > 0);
    assert.ok(report.rows.every((r) => r.studentId && Math.abs(r.gross - r.fee - r.net) < 0.01));
    for (const t of report.totals) {
      const sum = report.rows.filter((r) => r.currency === t.currency).reduce((n, r) => n + r.gross, 0);
      assert.ok(Math.abs(sum - t.gross) < 0.01);
    }
    assert.equal((await call('GET', '/billing/payments?month=nope')).status, 400);
  });

  test('dashboard rows', async () => {
    const d = (await call<DashboardData>('GET', '/dashboard')).body;
    assert.equal(d.families.length, 20);
    assert.ok(d.invoices.length > 0 && d.classes.length > 0);
    assert.ok(d.invoices.every((i) => i.billed === i.collected + i.outstanding));
  });
});

describe('classes', () => {
  const range = async () => {
    const today = (await call<TeacherView>('GET', '/teacher')).body.today;
    return (await call<SessionView[]>('GET', `/sessions?from=${addDays(today, -60)}&to=${addDays(today, 40)}`)).body;
  };

  test('a future class cannot be marked held, and only missed classes can be waived', async () => {
    const sessions = await range();
    const future = sessions.find((s) => Date.parse(s.start) > Date.now())!;
    assert.equal((await call('PATCH', `/sessions/${future.id}`, { body: { status: 'attended' } })).status, 400);
    const held = sessions.find((s) => s.status === 'attended')!;
    assert.equal((await call('PATCH', `/sessions/${held.id}`, { body: { waived: true } })).status, 400);
  });

  test('makeups: clashes are refused, one makeup per class', async () => {
    const sessions = await range();
    const missed = sessions.find((s) => s.canBookMakeup)!;
    const busy = sessions.find((s) => Date.parse(s.start) > Date.now() && s.status === 'scheduled')!;
    assert.equal((await call('POST', `/sessions/${missed.id}/makeup`, { body: { start: busy.start } })).status, 409);

    const free = new Date(Date.now() + 2 * 86_400_000);
    free.setUTCHours(21, 0, 0, 0); // 02:30 IST, no classes at that hour
    const booked = await call<SessionView>('POST', `/sessions/${missed.id}/makeup`, { body: { start: free.toISOString() } });
    assert.equal(booked.status, 201);
    assert.equal(booked.body.makeupFor, missed.id);
    assert.match(booked.body.start, /\+05:30$/);
    assert.equal((await call('POST', `/sessions/${missed.id}/makeup`, { body: { start: free.toISOString() } })).status, 409);
  });

  test('class ranges are bounded', async () => {
    assert.equal((await call('GET', '/sessions?from=2026-01-01&to=2027-06-01')).status, 400);
    assert.equal((await call('GET', '/sessions?from=2026-12-01&to=2026-11-01')).status, 400);
    assert.equal((await call('GET', '/sessions/c9999')).status, 404);
  });

  test('student rates are validated', async () => {
    assert.equal((await call('PATCH', '/students/s01', { body: { rate: -5 } })).status, 400);
    assert.equal((await call('PATCH', '/students/s01', { body: { rate: 12.345 } })).status, 400);
    assert.equal((await call('PATCH', '/students/s99', { body: { rate: 30 } })).status, 404);
    assert.equal((await call('PATCH', '/students/s01', { body: { rate: 32.5 } })).status, 200);
  });
});

describe('enrolment', () => {
  test('ending takes later classes off the calendar and credits paid ones; re-enrolling brings them back', async () => {
    const teacher = (await call<TeacherView>('GET', '/teacher')).body;
    const { today } = teacher;
    const invoiced = (await call<InvoicePage>('GET', '/billing/invoices?filter=open')).body.items[0];
    const id = invoiced.studentId;
    const mine = async () => (await call<SessionView[]>('GET', `/sessions?from=${addDays(today, -30)}&to=${addDays(today, 60)}`)).body.filter((s) => s.studentId === id);

    assert.equal((await call('POST', `/students/${id}/end`, { body: { lastDate: addDays(today, -400) } })).status, 400);
    assert.equal((await call('POST', `/students/${id}/reenrol`)).status, 409);

    const ended = await call<{ removed: number; credited: number }>('POST', `/students/${id}/end`, { body: { lastDate: today } });
    assert.equal(ended.status, 200);
    assert.equal((await call('POST', `/students/${id}/end`, { body: { lastDate: today } })).status, 409);
    const later = (await mine()).filter((s) => s.start.slice(0, 10) > today);
    assert.ok(later.every((s) => s.status === 'cancelled_student'), 'only credited classes remain after the last day');
    assert.equal(later.length, ended.body.credited);

    if (ended.body.credited) {
      const drafts = (await call<DraftView[]>('GET', `/billing/drafts?month=${invoiced.month}`)).body;
      const flag = drafts.find((d) => d.studentId === id)?.flags.find((f) => f.code === 'credit_carried' || f.code === 'already_invoiced');
      assert.ok(flag, 'the final bill notes the credit');
    }

    const back = await call<{ added: number }>('POST', `/students/${id}/reenrol`);
    assert.equal(back.status, 200);
    assert.ok(back.body.added > 0);
    assert.ok((await mine()).some((s) => s.start.slice(0, 10) > today && s.status === 'scheduled'));
  });
});

describe('students', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    name: 'Zara Test',
    parent: { name: 'Omar Test', email: 'Omar.Test@example.com' },
    country: 'CA',
    timezone: 'America/Toronto',
    rate: 45,
    slots: [{ weekday: 3, time: '03:00', minutes: 45 }],
    ...over,
  });

  test('can be added with weekly classes, and validated', async () => {
    assert.equal((await call('POST', '/students', { body: input({ timezone: 'Europe/London' }) })).status, 400);
    assert.equal((await call('POST', '/students', { body: input({ slots: [] }) })).status, 400);
    assert.equal((await call('POST', '/students', { body: input({ parent: { name: 'x', email: 'nope' } }) })).status, 400);
    const added = await call<Student>('POST', '/students', { body: input() });
    assert.equal(added.status, 201);
    assert.equal(added.body.currency, 'CAD');
    assert.equal(added.body.parent.email, 'omar.test@example.com');
    assert.equal((await call('POST', '/students', { body: input() })).status, 409, 'no duplicates');
    const today = (await call<TeacherView>('GET', '/teacher')).body.today;
    const mine = (await call<SessionView[]>('GET', `/sessions?from=${today}&to=${addDays(today, 40)}`)).body.filter((x) => x.studentId === added.body.id);
    assert.ok(mine.length >= 4, 'weekly classes are on the calendar');

    // Another student's weekly time is refused.
    const other = (await call<Student[]>('GET', '/students')).body.find((x) => x.id !== added.body.id)!;
    assert.equal((await call('POST', '/students', { body: input({ name: 'Clash Test', slots: [other.slots[0]] }) })).status, 409);
  });

  test('editing moves unbilled classes to the new times; the currency is kept once invoiced', async () => {
    const list = (await call<Student[]>('GET', '/students')).body;
    const zara = list.find((x) => x.name === 'Zara Test')!;
    const moved = await call<{ moved: number }>('PUT', `/students/${zara.id}`, { body: input({ slots: [{ weekday: 4, time: '03:30', minutes: 60 }] }) });
    assert.equal(moved.status, 200);
    const today = (await call<TeacherView>('GET', '/teacher')).body.today;
    const mine = (await call<SessionView[]>('GET', `/sessions?from=${addDays(today, 1)}&to=${addDays(today, 40)}`)).body.filter((x) => x.studentId === zara.id);
    assert.ok(mine.length > 0 && mine.every((x) => x.start.slice(11, 16) === '03:30' && x.minutes === 60));

    const invoiced = (await call<InvoicePage>('GET', '/billing/invoices')).body.items[0];
    const st = list.find((x) => x.id === invoiced.studentId)!;
    const body = { name: st.name, parent: st.parent, country: 'DE', timezone: 'Europe/Berlin', rate: st.rate, slots: st.slots };
    assert.equal((await call('PUT', `/students/${st.id}`, { body })).status, 409);
  });

  test('a refund owed after an enrolment ends can be recorded once', async () => {
    const teacher = (await call<TeacherView>('GET', '/teacher')).body;
    // Someone billed in advance for this month stops today: their later paid classes become a credit.
    const paid = (await call<InvoicePage>('GET', `/billing/invoices?pageSize=100`)).body.items.find((i) => i.month === teacher.today.slice(0, 7) && !i.refund)!;
    assert.equal((await call('POST', '/billing/refund', { body: { studentId: paid.studentId, month: teacher.suggestedMonth, total: -1 } })).status, 409, 'nothing owed yet');
    assert.equal((await call('POST', `/students/${paid.studentId}/end`, { body: { lastDate: teacher.today } })).status, 200);
    const drafts = (await call<DraftView[]>('GET', `/billing/drafts?month=${teacher.suggestedMonth}`)).body;
    const owing = drafts.find((d) => d.studentId === paid.studentId && d.total < 0);
    assert.ok(owing, 'the final bill shows a credit owed back');
    assert.ok(owing.flags.some((f) => f.code === 'credit_carried' && /refund/i.test(f.message)), JSON.stringify(owing.flags.map((f) => f.code)));
    assert.equal((await call('POST', '/billing/refund', { body: { studentId: owing.studentId, month: owing.month, total: owing.total - 1 } })).status, 409);
    assert.equal((await call('POST', '/billing/refund', { body: { studentId: owing.studentId, month: owing.month, total: owing.total } })).status, 201);
    const after = (await call<DraftView[]>('GET', `/billing/drafts?month=${teacher.suggestedMonth}`)).body;
    assert.ok(!after.some((d) => d.studentId === owing.studentId && d.total < 0), 'the credit is settled');
  });
});

describe('kind of work', () => {
  test('is chosen once; client sessions use their own words', async () => {
    assert.equal((await call('POST', '/teacher/profession', { body: { profession: 'astronaut' } })).status, 400);
    assert.equal((await call('PATCH', '/teacher', { body: { profession: 'teaching' } })).status, 400);
    const chosen = await call<TeacherView>('POST', '/teacher/profession', { body: { profession: 'client_sessions' } });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.profession, 'client_sessions');
    assert.equal((await call('POST', '/teacher/profession', { body: { profession: 'teaching' } })).status, 409);
    const drafts = (await call<DraftView[]>('GET', `/billing/drafts?month=${chosen.body.suggestedMonth}`)).body;
    const lines = drafts.flatMap((d) => d.lines.map((l) => l.description));
    assert.ok(lines.some((l) => l.startsWith('Sessions in')), 'bill lines say sessions');
    assert.ok(!lines.some((l) => /class/i.test(l)));
    assert.equal((await call('POST', '/demo/reset')).status, 204);
    assert.equal((await call<TeacherView>('GET', '/teacher')).body.profession, 'client_sessions', 'reset keeps the choice');
  });
});

describe('public demo: a private copy per visitor', () => {
  const login = async () => {
    const res = await call('POST', '/auth/login', { auth: false, body: { email: 'teacher@example.com', password: 'correct horse battery' } });
    assert.equal(res.status, 200);
    return res.headers.getSetCookie()[0].split(';')[0];
  };

  test("one visitor's changes never reach another", async () => {
    config.visitorCopies = true;
    try {
      const [a, b] = [await login(), await login()];
      assert.notEqual(a, b);
      // Each copy starts fresh and asks for the kind of work.
      assert.equal((await call<TeacherView>('GET', '/teacher', { cookie: a })).body.profession, undefined);
      assert.equal((await call('POST', '/teacher/profession', { cookie: a, body: { profession: 'teaching' } })).status, 200);
      const today = (await call<TeacherView>('GET', '/teacher', { cookie: a })).body.today;
      assert.equal((await call('POST', '/students/s01/end', { cookie: a, body: { lastDate: today } })).status, 200);
      const endedA = (await call<Student[]>('GET', '/students', { cookie: a })).body.find((s) => s.id === 's01');
      assert.equal(endedA?.endedOn, today);

      const s01 = (await call<Student[]>('GET', '/students', { cookie: b })).body.find((s) => s.id === 's01');
      assert.equal(s01?.endedOn, undefined, "B's student is untouched");
      assert.equal((await call<TeacherView>('GET', '/teacher', { cookie: b })).body.profession, undefined);

      // A tampered workspace id fails the signature.
      const [name, value] = a.split('=');
      const parts = decodeURIComponent(value).split('.');
      const forged = `${name}=${[parts[0], 'aaaaaaaaaaaa', parts[2]].join('.')}`;
      assert.equal((await call('GET', '/teacher', { cookie: forged })).status, 401);
    } finally {
      config.visitorCopies = false;
    }
  });
});

test('the AI budget stops a visitor after the hourly limit', async () => {
  const { spendBudget, resetAiBudget, AiLimitError, AI_LIMITS } = await import('../src/gemini');
  resetAiBudget();
  for (let i = 0; i < AI_LIMITS.hour.perVisitor; i++) spendBudget();
  assert.throws(() => spendBudget(), (e) => e instanceof AiLimitError && e.message === AI_LIMITS.hour.message);
  resetAiBudget();
});

test('signing out ends the session', async () => {
  assert.equal((await call('POST', '/auth/logout')).status, 204);
  // The cookie value itself stays valid until expiry; the browser drops it on sign-out.
  assert.equal((await call('GET', '/teacher', { cookie: '' , auth: false })).status, 401);
});
