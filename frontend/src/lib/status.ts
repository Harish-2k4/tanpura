// Labels and colours for class and invoice states, shared by chips, menus and the calendar.
import type { ChipProps } from '@mui/material/Chip';
import { invoiceState, type InvoiceRecord, type InvoiceState, type SessionStatus } from '../../../shared/billing';

type Meta = { label: string; action: string; chip: ChipProps['color']; calendar: string };

export const SESSION_STATUS: Record<SessionStatus, Meta> = {
  scheduled: { label: 'Scheduled', action: 'Not marked yet', chip: 'default', calendar: 'blue' },
  attended: { label: 'Held', action: 'Held', chip: 'success', calendar: 'green' },
  no_show: { label: 'No-show', action: 'No-show', chip: 'warning', calendar: 'orange' },
  cancelled_student: { label: 'Cancelled with notice', action: 'They cancelled (with notice)', chip: 'default', calendar: 'gray' },
  cancelled_late: { label: 'Late cancellation', action: 'They cancelled (late)', chip: 'warning', calendar: 'orange' },
  cancelled_teacher: { label: 'Cancelled by you', action: 'Cancelled by me', chip: 'info', calendar: 'violet' },
};

export const INVOICE_STATE: Record<InvoiceState, { label: string; chip: ChipProps['color'] }> = {
  awaiting: { label: 'Awaiting payment', chip: 'info' },
  overdue: { label: 'Overdue', chip: 'error' },
  partial: { label: 'Partly paid', chip: 'warning' },
  paid: { label: 'Paid', chip: 'success' },
  cancelled: { label: 'Cancelled', chip: 'default' },
};

export const invoiceChip = (inv: InvoiceRecord, today: string) =>
  inv.refund ? { label: 'Refunded', chip: 'default' as ChipProps['color'] } : INVOICE_STATE[invoiceState(inv, today)];
