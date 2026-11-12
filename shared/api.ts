// Response shapes of the Tanpura API, shared by backend and frontend.
import type { Currency, InvoiceDraft, InvoiceFilter, InvoiceRecord, Session, SessionStatus, Student } from './billing';
import type { PayPalFeatures } from './paypal-features';
import type { Teacher } from './settings';

export type ApiErrorBody = { error: string; issues?: { path: string; message: string }[] };

export type Me = { email: string };

export type AuthSession = { user: Me | null };

export type AuthConfig = { demo: { email: string; password: string } | null };

export type TeacherView = Teacher & {
  paypalFeatures: PayPalFeatures;
  today: string; // YYYY-MM-DD in the teacher's zone
  suggestedMonth: string; // YYYY-MM to bill next
  integrations: { paypal: 'sandbox' | 'mock'; ai: 'live' | 'mock' };
  demoMode: boolean;
};

export type SessionView = Session & {
  studentName: string;
  effectiveStatus: SessionStatus; // with automatic attendance applied
  auto: boolean; // effectiveStatus came from automatic attendance
  makeupId?: string; // latest makeup booked for this class
  canWaive: boolean;
  canBookMakeup: boolean;
  billed: { amount: number; months: string[] } | null; // charged on invoices already sent, if any
};

export type DraftView = InvoiceDraft & { student: Student };

export type SendResult = { sent: InvoiceRecord[]; skipped: { studentId: string; reason: string }[] };

export type SyncResult = { checked: number; updated: number };

export type InvoiceRow = InvoiceRecord & { studentName: string };

export type InvoicePage = {
  items: InvoiceRow[];
  total: number; // matching the search and filter, across all pages
  page: number;
  pageSize: number;
  counts: Record<InvoiceFilter, number>; // per filter, for the current search
};

export type MoneyTotal = { currency: Currency; amount: number };

export type BillingOverview = { invoiceCount: number; overdue: { count: number; totals: MoneyTotal[] } };

// Pushed to signed-in browsers; `message` is shown as a toast.
export type LiveEvent = { type: 'invoice-paid' | 'invoice-updated'; message: string; invoiceId: string };

// Money received through PayPal in a month (Transaction Search), matched to invoices.
export type PaymentRow = {
  id: string;
  date: string; // YYYY-MM-DD
  currency: Currency;
  gross: number;
  fee: number; // PayPal's fee, as a positive amount
  net: number;
  status: string; // completed, pending, ...
  invoiceId?: string;
  studentId?: string;
  studentName?: string;
  payerEmail?: string;
};

export type PaymentsReport = {
  source: 'paypal' | 'mock';
  month: string;
  rows: PaymentRow[];
  totals: { currency: Currency; gross: number; fee: number; net: number }[];
  unmatched: number; // payments that match no invoice
  note?: string;
  // Money received, converted to the teacher's home currency at each payment date's ECB rate.
  home?: { currency: string; gross: number; fee: number; net: number };
};

// Rows for the AG Studio dashboard. Money is never converted between currencies.
export type DashboardData = {
  asOf: string;
  licenseKey?: string;
  families: { id: string; student: string; parent: string; country: string; currency: Currency; rate: number }[];
  invoices: {
    id: string;
    familyId: string;
    month: string; // first day of the billed month
    issued: string;
    due: string;
    paid: string | null;
    state: string;
    currency: Currency;
    billed: number;
    collected: number;
    outstanding: number;
    overdue: number;
    daysToPay: number; // days from issue to payment, or so far if still open
    isPaid: boolean;
  }[];
  classes: { id: string; familyId: string; date: string; outcome: string; isMakeup: boolean; minutes: number }[];
};
