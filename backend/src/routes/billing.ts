import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { BillingOverview, InvoicePage, InvoiceRow, MoneyTotal, SendResult, SyncResult } from '../../../shared/api';
import { reminderSchema, type ReminderDraft } from '../../../shared/assistant';
import { INVOICE_FILTERS, invoiceState, matchesInvoiceFilter, monthLabel, type InvoiceFilter, type InvoiceRecord } from '../../../shared/billing';
import { wordsFor } from '../../../shared/words';
import { draftsQuerySchema, invoiceIdSchema, invoicesQuerySchema, recordPaymentSchema, refundSchema, sendInvoicesSchema } from '../../../shared/schemas';
import { draftReminder } from '../ai/reminders';
import { config } from '../config';
import { broadcast } from '../events';
import { HttpError, parse } from '../http';
import { cancelInvoice, fetchStatus, issueInvoice, recordFullPayment } from '../invoicing';
import { getInvoice, PayPalApiError, remindInvoice } from '../paypal';
import { clearPaymentsCache, paymentsReport } from '../payments';
import { exclusive, loadAll, saveInvoices, type Dataset } from '../store';
import { draftViews, teacherToday } from '../views';

export const billingRouter = Router();

// AI calls cost money and time: a generous limit for one teacher, a wall for scripts.
const aiLimiter = rateLimit({ windowMs: 60_000, limit: config.env === 'test' ? 1000 : 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Wait a minute and try again.' } });

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);

// "Priya Iyer paid US$90 for Aarav's December 2026 classes"
export function paidMessage(data: Dataset, inv: InvoiceRecord): string {
  const st = data.students.find((s) => s.id === inv.studentId);
  const w = wordsFor(data.teacher.profession);
  const who = st?.parent.name ?? `A ${w.family}`;
  const what = st && st.parent.name === st.name ? `their ${monthLabel(inv.month)} ${w.classes}` : `${st?.name.split(' ')[0] ?? 'their'}'s ${monthLabel(inv.month)} ${w.classes}`;
  if (inv.status === 'PAID') return `${who} paid ${money(inv.total, inv.currency)} for ${what}`;
  if (inv.status === 'CANCELLED') return `The invoice for ${what} was cancelled in PayPal`;
  return `${who} paid part of the invoice for ${what}`;
}

const rowOf = (data: Dataset, inv: InvoiceRecord): InvoiceRow => ({ ...inv, studentName: data.students.find((s) => s.id === inv.studentId)?.name ?? inv.studentId });

billingRouter.get('/drafts', async (req, res) => {
  const { month } = parse(draftsQuerySchema, req.query);
  res.json(draftViews(await loadAll(), month, new Date()));
});

// Sends the approved invoices. Drafts are rebuilt here, never taken from the client; a bill whose
// total changed since the teacher approved it is held back, and a student already invoiced for
// the month is skipped, so a double click can't double-bill.
// After an enrolment ends, a credit is owed back. The teacher refunds it on PayPal, then records it
// here; it settles the credit so it stops appearing on bills. Checked against the reviewed amount.
billingRouter.post('/refund', async (req, res) => {
  const { studentId, month, total } = parse(refundSchema, req.body);
  const record = await exclusive(async () => {
    const data = await loadAll();
    const now = new Date();
    const draft = draftViews(data, month, now).find((d) => d.studentId === studentId);
    if (!draft || !draft.student.endedOn || draft.total >= 0) throw new HttpError(409, 'There is no refund owed here');
    if (Math.round(draft.total * 100) !== Math.round(total * 100)) throw new HttpError(409, 'This amount changed since you reviewed it. Check it and try again.');
    const today = teacherToday(data, now);
    const n = data.invoices.filter((i) => i.studentId === studentId && i.refund).length + 1;
    const rec: InvoiceRecord = {
      id: `REFUND-${studentId}-${month}-${n}`,
      studentId,
      month,
      currency: draft.currency,
      total: draft.total,
      entries: draft.entries,
      status: 'PAID',
      issuedAt: today,
      dueDate: today,
      paidAt: today,
      mock: false,
      refund: true,
    };
    data.invoices.push(rec);
    await saveInvoices(data.invoices);
    return rec;
  });
  res.status(201).json(record);
});

billingRouter.post('/send', async (req, res) => {
  const { month, bills } = parse(sendInvoicesSchema, req.body);
  const result = await exclusive(async (): Promise<SendResult> => {
    const data = await loadAll();
    const now = new Date();
    const today = teacherToday(data, now);
    const drafts = draftViews(data, month, now);
    const sent: InvoiceRecord[] = [];
    const skipped: SendResult['skipped'] = [];

    const approved = new Map(bills.map((b) => [b.studentId, b.total]));
    for (const [id, total] of approved) {
      const draft = drafts.find((d) => d.studentId === id);
      if (!draft) {
        skipped.push({ studentId: id, reason: 'Not found' });
        continue;
      }
      if (!draft.sendable) {
        skipped.push({ studentId: id, reason: draft.flags.at(-1)?.message ?? 'Nothing to send' });
        continue;
      }
      if (Math.round(draft.total * 100) !== Math.round(total * 100)) {
        skipped.push({ studentId: id, reason: 'This bill changed since you reviewed it. Check it and send again.' });
        continue;
      }
      try {
        const attempt = data.invoices.filter((i) => i.studentId === id && i.month === month).length + 1;
        const record = await issueInvoice(draft, draft.student, data.teacher, today, attempt);
        data.invoices.push(record);
        sent.push(record);
        await saveInvoices(data.invoices); // after each one, so a later failure keeps earlier sends recorded
      } catch (e) {
        console.error(e);
        const why = e instanceof PayPalApiError && e.description ? `PayPal: ${e.description}` : 'PayPal did not accept this invoice. Try again.';
        skipped.push({ studentId: id, reason: why });
      }
    }
    return { sent, skipped };
  });
  res.json(result);
});

// Newest first; searchable by student, parent or invoice id; filterable by state; paged.
billingRouter.get('/invoices', async (req, res) => {
  const { page, pageSize, q, filter } = parse(invoicesQuerySchema, req.query);
  const data = await loadAll();
  const today = teacherToday(data, new Date());
  const students = new Map(data.students.map((s) => [s.id, s]));
  const needle = q.toLowerCase();
  const matchesSearch = (inv: InvoiceRecord, name: string) =>
    !needle || [name, students.get(inv.studentId)?.parent.name ?? '', inv.id].some((t) => t.toLowerCase().includes(needle));

  const rows = data.invoices
    .map((inv) => ({ ...inv, studentName: students.get(inv.studentId)?.name ?? inv.studentId }))
    .filter((inv) => matchesSearch(inv, inv.studentName))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || a.studentName.localeCompare(b.studentName));

  const states = rows.map((inv) => invoiceState(inv, today));
  const count = (f: InvoiceFilter) => states.filter((s) => matchesInvoiceFilter(s, f)).length;
  const counts = Object.fromEntries(INVOICE_FILTERS.map((f) => [f, count(f)])) as Record<InvoiceFilter, number>;
  const matching = rows.filter((_, i) => matchesInvoiceFilter(states[i], filter));
  const body: InvoicePage = { items: matching.slice(page * pageSize, (page + 1) * pageSize), total: matching.length, page, pageSize, counts };
  res.json(body);
});

billingRouter.get('/overview', async (_req, res) => {
  const data = await loadAll();
  const today = teacherToday(data, new Date());
  const overdue = data.invoices.filter((i) => invoiceState(i, today) === 'overdue');
  const totals = new Map<MoneyTotal['currency'], number>();
  for (const i of overdue) totals.set(i.currency, Math.round(((totals.get(i.currency) ?? 0) + i.total) * 100) / 100);
  const body: BillingOverview = {
    invoiceCount: data.invoices.length,
    overdue: { count: overdue.length, totals: [...totals].map(([currency, amount]) => ({ currency, amount })) },
  };
  res.json(body);
});

function findInvoice(data: Dataset, id: string): InvoiceRecord {
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return inv;
}

const awaitingPayment = (inv: InvoiceRecord) => inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID';

// Every invoice as CSV, for accounts or tax time. Text cells that a spreadsheet could read as a
// formula are prefixed with an apostrophe.
billingRouter.get('/invoices.csv', async (_req, res) => {
  const data = await loadAll();
  const today = teacherToday(data, new Date());
  const students = new Map(data.students.map((s) => [s.id, s]));
  const text = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  const rows = [...data.invoices]
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((i) => {
      const st = students.get(i.studentId);
      const state = i.refund ? 'refunded' : invoiceState(i, today);
      return [text(i.id), text(st?.name ?? i.studentId), text(st?.parent.name ?? ''), text(st?.parent.email ?? ''), i.month, i.issuedAt, i.dueDate, i.paidAt ?? '', i.currency, i.total.toFixed(2), state, i.mock ? 'yes' : 'no'].join(',');
    });
  const header = 'Invoice,Name,Billed to,Email,Month,Issued,Due,Paid on,Currency,Amount,Status,Mock';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tanpura-invoices-${today}.csv"`);
  res.send(`\uFEFF${[header, ...rows].join('\r\n')}\r\n`);
});

billingRouter.get('/invoices/:id', async (req, res) => {
  const id = parse(invoiceIdSchema, req.params.id);
  const data = await loadAll();
  res.json(rowOf(data, findInvoice(data, id)));
});

// The invoice's page on PayPal (the teacher's view, with PayPal's own print and download).
billingRouter.get('/invoices/:id/paypal-link', async (req, res) => {
  const id = parse(invoiceIdSchema, req.params.id);
  const inv = findInvoice(await loadAll(), id);
  if (inv.mock) throw new HttpError(409, 'Mock invoices are not on PayPal');
  const meta = (await getInvoice(inv.id)).detail.metadata;
  const url = meta?.invoicer_view_url ?? meta?.recipient_view_url;
  // Only ever hand back a PayPal address.
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*paypal\.com\//i.test(url)) throw new HttpError(502, 'PayPal did not return a link for this invoice');
  res.json({ url });
});

// An AI-written (or template) friendly reminder, for the teacher to read and edit before sending.
billingRouter.post('/invoices/:id/reminder-draft', aiLimiter, async (req, res) => {
  const id = parse(invoiceIdSchema, req.params.id);
  const data = await loadAll();
  const inv = findInvoice(data, id);
  if (!awaitingPayment(inv)) throw new HttpError(409, 'This invoice is not awaiting payment');
  const draft: ReminderDraft = await draftReminder(data, inv, teacherToday(data, new Date()));
  res.json(draft);
});

// Sends the reminder through PayPal (an email linking the invoice). At most one a day per invoice.
billingRouter.post('/invoices/:id/remind', async (req, res) => {
  const id = parse(invoiceIdSchema, req.params.id);
  const { subject, note } = parse(reminderSchema, req.body);
  const updated = await exclusive(async () => {
    const data = await loadAll();
    const inv = findInvoice(data, id);
    if (!awaitingPayment(inv)) throw new HttpError(409, 'This invoice is not awaiting payment');
    const today = teacherToday(data, new Date());
    if (inv.reminders?.includes(today)) throw new HttpError(409, 'A reminder for this invoice already went today. Give them a day or two.');
    if (!inv.mock) await remindInvoice(inv.id, subject, note);
    inv.reminders = [...(inv.reminders ?? []), today];
    await saveInvoices(data.invoices);
    return rowOf(data, inv);
  });
  res.json(updated);
});

// Money received through PayPal in a month, matched to invoices (Transaction Search via PayPal's SDK).
billingRouter.get('/payments', async (req, res) => {
  const { month } = parse(draftsQuerySchema, req.query);
  res.json(await paymentsReport(await loadAll(), month, new Date()));
});

// Cancelling puts the invoice's classes back to "not billed", so the next bill includes them.
billingRouter.post('/invoices/:id/cancel', async (req, res) => {
  const id = parse(invoiceIdSchema, req.params.id);
  const updated = await exclusive(async () => {
    const data = await loadAll();
    const inv = findInvoice(data, id);
    if (inv.status !== 'SENT') throw new HttpError(409, 'Only an unpaid invoice can be cancelled');
    await cancelInvoice(inv, data.students.find((s) => s.id === inv.studentId)?.name ?? 'your child');
    inv.status = 'CANCELLED';
    await saveInvoices(data.invoices);
    return inv;
  });
  res.json(updated);
});

// For payments made outside PayPal (e.g. a bank transfer).
billingRouter.post('/invoices/:id/payment', async (req, res) => {
  const id = parse(invoiceIdSchema, req.params.id);
  const { date } = parse(recordPaymentSchema, req.body);
  const updated = await exclusive(async () => {
    const data = await loadAll();
    const inv = findInvoice(data, id);
    if (inv.status !== 'SENT' && inv.status !== 'PARTIALLY_PAID') throw new HttpError(409, 'This invoice is not awaiting payment');
    if (date < inv.issuedAt || date > teacherToday(data, new Date())) throw new HttpError(400, 'Payment date must be between the invoice date and today');
    await recordFullPayment(inv, date);
    inv.status = 'PAID';
    inv.paidAt = date;
    await saveInvoices(data.invoices);
    clearPaymentsCache();
    broadcast({ type: 'invoice-paid', invoiceId: inv.id, message: paidMessage(data, inv) });
    return inv;
  });
  res.json(updated);
});

// Refreshes unpaid invoices from PayPal (payments made by families on PayPal).
billingRouter.post('/invoices/sync', async (_req, res) => {
  const result = await exclusive(async (): Promise<SyncResult> => {
    const data = await loadAll();
    const open = data.invoices.filter((i) => !i.mock && (i.status === 'SENT' || i.status === 'PARTIALLY_PAID'));
    let updated = 0;
    for (const inv of open) {
      const change = await fetchStatus(inv);
      if (!change) continue;
      Object.assign(inv, change);
      updated++;
      broadcast({ type: inv.status === 'PAID' ? 'invoice-paid' : 'invoice-updated', invoiceId: inv.id, message: paidMessage(data, inv) });
    }
    if (updated) {
      await saveInvoices(data.invoices);
      clearPaymentsCache();
    }
    return { checked: open.length, updated };
  });
  res.json(result);
});
