// PayPal invoicing for Tanpura: issue, cancel, record payment, refresh status.
// Without PayPal credentials every call runs in mock mode, so the app works end to end.
import type { InvoiceDraft, InvoiceRecord, InvoiceStatus, Student } from '../../shared/billing';
import { paypalFeatures } from '../../shared/paypal-features';
import type { Teacher } from '../../shared/settings';
import { addDays } from '../../shared/time';
import { cap, wordsFor } from '../../shared/words';
import { currentContext, workspaceCode } from './context';
import * as paypal from './paypal';

// Unique per student, month and attempt (a cancelled invoice can be re-issued). PayPal rejects
// a duplicate number, which stops a retried request from creating a second invoice.
// A demo visitor's copy adds its own code, so two copies never share an invoice number.
export const invoiceNumber = (studentId: string, month: string, attempt: number) => {
  const ws = currentContext()?.workspace;
  return `TP-${ws ? `${workspaceCode(ws)}-` : ''}${studentId}-${month}-${attempt}`;
};

export function toPayPalInvoice(draft: InvoiceDraft, student: Student, teacher: Teacher, number: string, today: string) {
  const w = wordsFor(teacher.profession);
  const itemName = { classes: cap(w.classes), unbilled: `Earlier ${w.classes} not yet billed` };
  const [given, ...rest] = student.parent.name.split(' ');
  const money = (n: number) => ({ currency_code: draft.currency, value: n.toFixed(2) });
  const charges = draft.lines.filter((l) => l.kind !== 'credit');
  const credit = -draft.lines.filter((l) => l.kind === 'credit').reduce((sum, l) => sum + l.amount, 0);

  return {
    detail: {
      invoice_number: number,
      currency_code: draft.currency,
      reference: `${student.id}-${draft.month}`,
      invoice_date: today,
      note: `${cap(w.classes)} for ${student.name} with ${teacher.name}. Every line lists the ${w.class} dates. Thank you!`,
      payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: addDays(today, teacher.paymentTermDays) },
    },
    primary_recipients: [
      { billing_info: { name: { given_name: given, ...(rest.length ? { surname: rest.join(' ') } : {}) }, email_address: student.parent.email } },
    ],
    items: charges.map((l) => ({
      name: itemName[l.kind as keyof typeof itemName],
      description: l.description.slice(0, 1000),
      quantity: String(l.quantity),
      unit_amount: money(l.unitAmount),
      unit_of_measure: 'QUANTITY',
    })),
    // PayPal items can't be negative, so credits become an invoice-level discount.
    ...(credit > 0 ? { amount: { breakdown: { discount: { invoice_discount: { amount: money(credit) } } } } } : {}),
    configuration: {
      allow_tip: false,
      // Only where PayPal offers partial payments in the teacher's country.
      partial_payment: { allow_partial_payment: paypalFeatures(teacher.country).partialPayments },
    },
  };
}

export async function issueInvoice(
  draft: InvoiceDraft,
  student: Student,
  teacher: Teacher,
  today: string,
  attempt: number,
): Promise<InvoiceRecord> {
  const record = (id: string, mock: boolean): InvoiceRecord => ({
    id,
    studentId: student.id,
    month: draft.month,
    currency: draft.currency,
    total: draft.total,
    entries: draft.entries,
    status: 'SENT',
    issuedAt: today,
    dueDate: addDays(today, teacher.paymentTermDays),
    mock,
  });
  if (!paypal.paypalConfigured()) return record(`MOCK-${invoiceNumber(student.id, draft.month, attempt).slice(3)}`, true);

  // A number already taken in PayPal is reused only if it is this same bill, still open: created
  // by an earlier attempt that never got recorded (e.g. the server stopped mid-way). Anything
  // else under that number (another amount or recipient, or cancelled) moves on to the next one.
  // Up to 50 numbers ahead: on a host whose disk is wiped on restart (Render's free plan), numbering
  // starts again at 1 while PayPal keeps the earlier invoices.
  for (let n = attempt; n < attempt + 50; n++) {
    const number = invoiceNumber(student.id, draft.month, n);
    let invoice: paypal.PayPalInvoice;
    try {
      invoice = await paypal.createInvoice(toPayPalInvoice(draft, student, teacher, number, today));
    } catch (e) {
      if (!(e instanceof paypal.PayPalApiError && e.issue === 'DUPLICATE_INVOICE_NUMBER')) throw e;
      const found = await paypal.findInvoiceByNumber(number);
      const existing = found && (await paypal.getInvoice(found.id));
      if (!existing || !isSameOpenBill(existing, draft, student)) continue;
      invoice = existing;
    }
    if (invoice.status === 'DRAFT') await paypal.sendInvoice(invoice.id);
    return record(invoice.id, false);
  }
  throw new Error(`No free invoice number for ${student.id} ${draft.month}`);
}

function isSameOpenBill(inv: paypal.PayPalInvoice, draft: InvoiceDraft, student: Student): boolean {
  const open = inv.status === 'DRAFT' || inv.status === 'SENT' || inv.status === 'UNPAID' || inv.status === 'SCHEDULED';
  const to = inv.primary_recipients?.[0]?.billing_info?.email_address?.toLowerCase();
  const total = inv.amount ? Number(inv.amount.value) : NaN;
  return open && to === student.parent.email.toLowerCase() && inv.amount?.currency_code === draft.currency && Math.round(total * 100) === Math.round(draft.total * 100);
}

export async function cancelInvoice(inv: InvoiceRecord, studentName: string) {
  if (!inv.mock) await paypal.cancelInvoice(inv.id, `This invoice for ${studentName} was cancelled. A corrected bill will follow.`);
}

export async function recordFullPayment(inv: InvoiceRecord, date: string) {
  if (inv.mock) return;
  const live = await paypal.getInvoice(inv.id);
  const due = live.due_amount ?? live.amount;
  if (due && Number(due.value) > 0) await paypal.recordPayment(inv.id, date, due);
}

// Our status for a PayPal invoice; undefined when it should stay as it is.
export function mapStatus(status: paypal.PayPalInvoiceStatus): InvoiceStatus | undefined {
  switch (status) {
    case 'PAID':
    case 'MARKED_AS_PAID':
      return 'PAID';
    case 'PARTIALLY_PAID':
      return 'PARTIALLY_PAID';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return undefined;
  }
}

export async function fetchStatus(inv: InvoiceRecord): Promise<{ status: InvoiceStatus; paidAt?: string } | undefined> {
  if (inv.mock) return undefined;
  const live = await paypal.getInvoice(inv.id);
  const status = mapStatus(live.status);
  if (!status || status === inv.status) return undefined;
  const paidAt = live.payments?.transactions?.map((t) => t.payment_date?.slice(0, 10)).filter(Boolean).sort().at(-1);
  return { status, ...(status === 'PAID' && paidAt ? { paidAt } : {}) };
}
