// Rows for the AG Studio dashboard: families, invoices (with payment timing) and classes.
import type { DashboardData } from '../../shared/api';
import { dateOf, effectiveStatus, invoiceState, outcomeOf } from '../../shared/billing';
import { daysBetween } from '../../shared/time';
import { config } from './config';
import type { Dataset } from './store';
import { teacherToday } from './views';

const OUTCOME = { held: 'Held', missed_charged: 'Missed (charged)', missed_free: 'Cancelled (not charged)', pending: 'Upcoming' } as const;

export function dashboardData(data: Dataset, now: Date): DashboardData {
  const today = teacherToday(data, now);
  const nowMs = now.getTime();

  const invoices = data.invoices
    .filter((i) => i.status !== 'CANCELLED' && !i.refund)
    .map((i) => {
      const state = invoiceState(i, today);
      const open = state !== 'paid';
      return {
        id: i.id,
        familyId: i.studentId,
        month: `${i.month}-01`,
        issued: i.issuedAt,
        due: i.dueDate,
        paid: i.paidAt ?? null,
        state: state[0].toUpperCase() + state.slice(1),
        currency: i.currency,
        billed: i.total,
        collected: open ? 0 : i.total,
        outstanding: open ? i.total : 0,
        overdue: state === 'overdue' ? i.total : 0,
        daysToPay: Math.max(0, daysBetween(i.issuedAt, i.paidAt ?? today)),
        isPaid: !open,
      };
    });

  const classes = data.sessions.map((s) => {
    const outcome = outcomeOf(effectiveStatus(s, nowMs, data.teacher.attendance), s.waived, data.teacher.policy);
    const label = s.status === 'cancelled_teacher' ? 'Cancelled by you' : OUTCOME[outcome];
    return { id: s.id, familyId: s.studentId, date: dateOf(s), outcome: label, isMakeup: Boolean(s.makeupFor), minutes: s.minutes };
  });

  return {
    asOf: now.toISOString(),
    licenseKey: config.agStudioLicense,
    families: data.students.map((s) => ({ id: s.id, student: s.name, parent: s.parent.name, country: s.country, currency: s.currency, rate: s.rate })),
    invoices,
    classes,
  };
}
