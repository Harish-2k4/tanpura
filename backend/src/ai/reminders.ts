// Drafts a friendly payment reminder for an overdue (or soon due) invoice. Gemini writes it from
// the family's payment history; without a key, or if Gemini fails, a template does.
import { reminderSchema, type ReminderDraft } from '../../../shared/assistant';
import { monthLabel, type InvoiceRecord } from '../../../shared/billing';
import { paypalFeatures } from '../../../shared/paypal-features';
import { daysBetween } from '../../../shared/time';
import { wordsFor, type Words } from '../../../shared/words';
import { AiError, generateJson, geminiEnabled, type GeminiSchema } from '../gemini';
import type { Dataset } from '../store';

const SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    subject: { type: 'STRING', description: 'Email subject, under 70 characters' },
    note: { type: 'STRING', description: 'The message, 60 to 110 words, signed with the teacher first name' },
  },
  required: ['subject', 'note'],
};

const system = (w: Words) => `You write short payment reminders from ${w.who} to a ${w.student}'s ${w.parent}.
The relationship matters more than the money: be warm and kind, assume they simply forgot, never guilt-trip, threaten or mention fees or penalties.
Mention the ${w.student}'s first name, the month, the amount and that they can pay from the PayPal invoice linked in the email.
Call the sessions "${w.classes}". If the ${w.family} has paid late several times, gently offer to talk about a payment date that suits them better.
If the ${w.parent} and the ${w.student} are the same person, write to them directly.
Write 60 to 110 words in plain English, no placeholders, no emojis, signed with the sender's first name.`;

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export async function draftReminder(data: Dataset, inv: InvoiceRecord, today: string): Promise<ReminderDraft> {
  const student = data.students.find((s) => s.id === inv.studentId)!;
  const w = wordsFor(data.teacher.profession);
  const first = (name: string) => name.split(' ')[0];
  const history = data.invoices.filter((i) => i.studentId === inv.studentId && i.id !== inv.id && i.status !== 'CANCELLED');
  const paidLate = history.filter((i) => (i.paidAt ? i.paidAt > i.dueDate : i.dueDate < today)).length;
  const facts = {
    teacher: first(data.teacher.name),
    parent: first(student.parent.name),
    student: first(student.name),
    month: monthLabel(inv.month),
    amount: money(inv.total, inv.currency),
    due: day(inv.dueDate),
    daysOverdue: Math.max(0, daysBetween(inv.dueDate, today)),
    earlierInvoices: history.length,
    earlierPaidLate: paidLate,
    remindersAlreadySent: inv.reminders?.length ?? 0,
    partialPaymentsPossible: paypalFeatures(data.teacher.country).partialPayments,
  };

  if (geminiEnabled()) {
    try {
      const draft = await generateJson({ system: system(w), prompt: JSON.stringify(facts, null, 2), schema: SCHEMA, validate: (v) => reminderSchema.parse(v) });
      return { ...draft, source: 'ai' };
    } catch (e) {
      console.error(e instanceof AiError ? e.message : e);
    }
  }

  const self = student.parent.name === student.name; // the client pays for themselves
  const lateNote = paidLate >= 2 ? ' If another date in the month would work better for paying, just tell me and we can sort it out.' : '';
  const when = facts.daysOverdue > 0 ? `was due on ${facts.due}` : `is due on ${facts.due}`;
  return {
    subject: self ? `A gentle reminder: your ${facts.month} ${w.classes}` : `A gentle reminder: ${facts.student}'s ${facts.month} ${w.classes}`,
    note:
      `Hi ${facts.parent}, I hope you are all well! Just a gentle reminder that the invoice for ${self ? 'your' : `${facts.student}'s`} ${w.classes} in ${facts.month} (${facts.amount}) ${when}. ` +
      `You can pay it from the PayPal invoice linked in this email.${lateNote} Thank you, and it is always a joy working with ${self ? 'you' : facts.student}. ${facts.teacher}`,
    source: 'mock',
  };
}
