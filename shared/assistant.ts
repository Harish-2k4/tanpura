// The AI assistant's proposals. The AI only reads a message and suggests; every change is checked
// by the same rules as the app and applied only after the teacher approves.
import { z } from 'zod';
import type { Currency } from './billing';
import { idSchema } from './schemas';

export const assistantActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cancel'),
    sessionId: idSchema,
    status: z.enum(['cancelled_student', 'cancelled_late', 'cancelled_teacher']),
    note: z.string().trim().max(200).optional(),
  }),
  z.strictObject({ kind: z.literal('makeup'), forSessionId: idSchema, start: z.iso.datetime({ offset: true }) }),
]);
export type AssistantAction = z.infer<typeof assistantActionSchema>;

export const assistantMessageSchema = z.strictObject({ message: z.string().trim().min(3).max(2000) });
export const assistantApplySchema = z.strictObject({ actions: z.array(assistantActionSchema).min(1).max(20) });

export type ActionView = {
  action: AssistantAction;
  title: string; // e.g. "Cancel Aarav's class on Tue 17 Nov, 5:30 am"
  effect: string; // what it does to the bill, in plain words
};

export type BillImpact = { studentId: string; studentName: string; currency: Currency; before: number; after: number };

export type AssistantProposal = {
  source: 'ai' | 'mock';
  writer: 'family' | 'teacher' | 'unknown';
  summary: string;
  actions: ActionView[];
  warnings: string[];
  reply: string; // a suggested reply to whoever wrote the message
  impactMonth: string; // the next bill the changes affect
  impact: BillImpact[];
};

export type ApplyResult = { applied: number; makeupIds: string[] };

export const reminderSchema = z.strictObject({
  subject: z.string().trim().min(3).max(200),
  note: z.string().trim().min(10).max(1500),
});
export type ReminderDraft = z.infer<typeof reminderSchema> & { source: 'ai' | 'mock' };
