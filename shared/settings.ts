// Teacher settings. Stored in backend/data/teacher.json, edited on the Settings page.
import type { Profession } from './words';

// advance: bill a month before it starts (like school fees), then correct for what happened.
// after:   bill a month once it is over, for what happened.
export const BILLING_MODES = ['advance', 'after'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

// auto:   a class that has ended counts as held unless the teacher marks it otherwise.
// manual: a class stays "scheduled" until the teacher marks it.
export const ATTENDANCE_MODES = ['auto', 'manual'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const CHARGE_CHOICES = ['charge', 'free'] as const;
export type ChargeChoice = (typeof CHARGE_CHOICES)[number];

export type Policy = {
  noShow: ChargeChoice; // default for no-shows; the teacher can still waive one class
  lateCancel: ChargeChoice; // default for cancellations with under `noticeHours` notice
  noticeHours: number;
};

export type Teacher = {
  name: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2 of the teacher's PayPal account, e.g. IN
  timezone: string; // IANA zone all class times are shown and stored in
  billingMode: BillingMode;
  attendance: AttendanceMode;
  policy: Policy;
  paymentTermDays: number;
  scheduledUntil: string; // YYYY-MM-DD: weekly classes exist up to this date
  profession?: Profession; // the words the app uses; teaching when unset
};

export const DEFAULT_POLICY: Policy = { noShow: 'charge', lateCancel: 'charge', noticeHours: 24 };
