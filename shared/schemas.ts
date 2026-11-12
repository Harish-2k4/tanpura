// Request schemas, shared by the API (validation) and the frontend (forms).
import { z } from 'zod';
import { INVOICE_FILTERS, SESSION_STATUSES } from './billing';
import { COUNTRIES, zonesFor } from './regions';
import { ATTENDANCE_MODES, BILLING_MODES, CHARGE_CHOICES } from './settings';
import { daysBetween } from './time';
import { PROFESSIONS } from './words';

const MAX_PRICE = 100_000;
const MAX_RANGE_DAYS = 400;
const hasCents = (n: number) => Math.round(n * 100) / 100 === n;

export const idSchema = z.string().regex(/^[a-z0-9-]{1,40}$/i, 'Invalid id');
export const invoiceIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,60}$/, 'Invalid invoice id');
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export const dateSchema = z.iso.date();
export const priceSchema = z.number().positive().max(MAX_PRICE).refine(hasCents, 'At most 2 decimals');

export const loginSchema = z.strictObject({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export const sessionsQuerySchema = z
  .strictObject({ from: dateSchema, to: dateSchema, studentId: idSchema.optional() })
  .refine((q) => q.from <= q.to, 'from must be on or before to')
  .refine((q) => daysBetween(q.from, q.to) <= MAX_RANGE_DAYS, `At most ${MAX_RANGE_DAYS} days at a time`);

export const sessionPatchSchema = z
  .strictObject({
    status: z.enum(SESSION_STATUSES).optional(),
    waived: z.boolean().optional(),
    price: priceSchema.nullable().optional(), // null clears the override
    note: z.string().trim().max(500).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export const makeupSchema = z.strictObject({ start: z.iso.datetime({ offset: true }) });

export const studentPatchSchema = z.strictObject({ rate: priceSchema });
// A weekly slot: weekday 0 = Sunday, time in the teacher's zone.
export const slotSchema = z.strictObject({
  weekday: z.int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  minutes: z.int().min(15).max(240),
});

// Adding a student, or editing one. The currency follows the country.
export const studentInputSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Required').max(80),
    parent: z.strictObject({ name: z.string().trim().min(1, 'Required').max(80), email: z.email('Enter a valid email').max(200) }),
    country: z.enum(COUNTRIES),
    timezone: z.string().max(60),
    rate: priceSchema,
    slots: z.array(slotSchema).min(1, 'Add at least one weekly time').max(7),
  })
  .refine((s) => zonesFor(s.country).includes(s.timezone), { message: 'Pick a time zone in that country', path: ['timezone'] })
  .refine((s) => new Set(s.slots.map((x) => `${x.weekday}-${x.time}`)).size === s.slots.length, { message: 'Two weekly times are the same', path: ['slots'] });

export type StudentInput = z.infer<typeof studentInputSchema>;

export const endEnrolmentSchema = z.strictObject({ lastDate: dateSchema });

export const teacherPatchSchema = z
  .strictObject({
    billingMode: z.enum(BILLING_MODES),
    attendance: z.enum(ATTENDANCE_MODES),
    paymentTermDays: z.int().min(0).max(90),
    policy: z.strictObject({
      noShow: z.enum(CHARGE_CHOICES),
      lateCancel: z.enum(CHARGE_CHOICES),
      noticeHours: z.int().min(0).max(168),
    }),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export const draftsQuerySchema = z.strictObject({ month: monthSchema });

// Each bill carries the total the teacher approved; a bill that changed since is not sent.
export const refundSchema = z.strictObject({ studentId: idSchema, month: monthSchema, total: z.number().finite().negative() });

export const sendInvoicesSchema = z.strictObject({
  month: monthSchema,
  bills: z.array(z.strictObject({ studentId: idSchema, total: z.number().finite() })).min(1).max(500),
});

export const recordPaymentSchema = z.strictObject({ date: dateSchema });

export const PAGE_SIZES = [10, 25, 50, 100] as const;

// Query strings arrive as text, so numbers are coerced.
export const invoicesQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(0).max(10_000).default(0),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n), 'Unsupported page size')
    .default(25),
  q: z.string().trim().max(100).default(''),
  filter: z.enum(INVOICE_FILTERS).default('all'),
});

export type SessionPatch = z.infer<typeof sessionPatchSchema>;
export type TeacherPatch = z.infer<typeof teacherPatchSchema>;

export const professionSchema = z.strictObject({ profession: z.enum(PROFESSIONS) });
