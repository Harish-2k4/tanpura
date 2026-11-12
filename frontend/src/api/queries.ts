// React Query hooks for every API call. Mutations refresh whatever they can change.
import type { Profession } from '../../../shared/words';
import type { StudentInput } from '../../../shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AuthConfig, AuthSession, BillingOverview, DashboardData, DraftView, InvoicePage, InvoiceRow, Me, PaymentsReport, SendResult, SessionView, SyncResult, TeacherView } from '../../../shared/api';
import type { ApplyResult, AssistantAction, AssistantProposal, ReminderDraft } from '../../../shared/assistant';
import type { InvoiceFilter, InvoiceRecord, Student } from '../../../shared/billing';
import type { SessionPatch, TeacherPatch } from '../../../shared/schemas';
import { api } from './client';

export const keys = {
  me: ['me'] as const,
  authConfig: ['auth-config'] as const,
  teacher: ['teacher'] as const,
  students: ['students'] as const,
  sessions: (from?: string, to?: string) => (from ? (['sessions', from, to] as const) : (['sessions'] as const)),
  session: (id?: string) => (id ? (['session', id] as const) : (['session'] as const)),
  drafts: (month?: string) => (month ? (['drafts', month] as const) : (['drafts'] as const)),
  invoices: (params?: InvoiceQuery) => (params ? (['invoices', params] as const) : (['invoices'] as const)),
  overview: ['billing-overview'] as const,
  invoice: (id?: string) => (id ? (['invoice', id] as const) : (['invoice'] as const)),
  payments: (month?: string) => (month ? (['payments', month] as const) : (['payments'] as const)),
  dashboard: ['dashboard'] as const,
};

export type InvoiceQuery = { page: number; pageSize: number; q: string; filter: InvoiceFilter };

// Anything about classes changes bills, and anything about bills changes the overview.
const refreshClasses = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: keys.sessions() }),
    qc.invalidateQueries({ queryKey: keys.session() }),
    qc.invalidateQueries({ queryKey: keys.drafts() }),
  ]);
export const refreshBilling = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: keys.invoices() }),
    qc.invalidateQueries({ queryKey: keys.invoice() }),
    qc.invalidateQueries({ queryKey: keys.overview }),
    qc.invalidateQueries({ queryKey: keys.payments() }),
    qc.invalidateQueries({ queryKey: keys.dashboard }),
    qc.invalidateQueries({ queryKey: keys.drafts() }),
    qc.invalidateQueries({ queryKey: keys.teacher }),
  ]);

// --- auth -------------------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => (await api<AuthSession>('/auth/session')).user,
    staleTime: Infinity,
  });
}

export const useAuthConfig = () => useQuery({ queryKey: keys.authConfig, queryFn: () => api<AuthConfig>('/auth/config'), staleTime: Infinity });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api<Me>('/auth/login', { method: 'POST', body }),
    // A new sign-in can be a new demo copy: drop anything cached from the last session first.
    onSuccess: (me) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
      qc.setQueryData(keys.me, me);
    },
    meta: { silent: true }, // the form shows the error itself
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.setQueryData(keys.me, null);
      setTimeout(() => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] }));
    },
  });
}

// --- teacher, students, classes -----------------------------------------------------

export const useTeacher = () => useQuery({ queryKey: keys.teacher, queryFn: () => api<TeacherView>('/teacher') });

export function useUpdateTeacher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: TeacherPatch) => api<TeacherView>('/teacher', { method: 'PATCH', body: patch }),
    onSuccess: (teacher) => {
      qc.setQueryData(keys.teacher, teacher);
      return refreshClasses(qc);
    },
  });
}

export const useStudents = () => useQuery({ queryKey: keys.students, queryFn: () => api<Student[]>('/students') });

export function useUpdateStudentRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rate }: { id: string; rate: number }) => api<Student>(`/students/${id}`, { method: 'PATCH', body: { rate } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.students }), refreshClasses(qc)]),
  });
}

export function useSaveStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: StudentInput }) =>
      id
        ? api<{ student: Student; moved: number }>(`/students/${id}`, { method: 'PUT', body: input })
        : api<Student>('/students', { method: 'POST', body: input }).then((student) => ({ student, moved: 0 })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.students }), refreshClasses(qc), refreshBilling(qc)]),
  });
}

// Ending or restarting an enrolment changes the calendar, the bills and the dashboard.
export function useEndEnrolment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lastDate }: { id: string; lastDate: string }) =>
      api<{ removed: number; credited: number }>(`/students/${id}/end`, { method: 'POST', body: { lastDate } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.students }), refreshClasses(qc), refreshBilling(qc)]),
  });
}

export function useReEnrol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ added: number }>(`/students/${id}/reenrol`, { method: 'POST' }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.students }), refreshClasses(qc), refreshBilling(qc)]),
  });
}

export const useSessions = (from: string, to: string) =>
  useQuery({
    queryKey: keys.sessions(from, to),
    queryFn: () => api<SessionView[]>('/sessions', { query: { from, to } }),
    placeholderData: keepPreviousData,
  });

export const useSession = (id: string | undefined) =>
  useQuery({ queryKey: keys.session(id), queryFn: () => api<SessionView>(`/sessions/${id}`), enabled: Boolean(id) });

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SessionPatch }) => api<SessionView>(`/sessions/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => refreshClasses(qc),
  });
}

export function useBookMakeup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, start }: { id: string; start: string }) => api<SessionView>(`/sessions/${id}/makeup`, { method: 'POST', body: { start } }),
    onSuccess: () => refreshClasses(qc),
  });
}

// --- billing ------------------------------------------------------------------------

export const useDrafts = (month: string) =>
  useQuery({ queryKey: keys.drafts(month), queryFn: () => api<DraftView[]>('/billing/drafts', { query: { month } }), placeholderData: keepPreviousData });

export const useInvoicePage = (params: InvoiceQuery) =>
  useQuery({
    queryKey: keys.invoices(params),
    queryFn: () =>
      api<InvoicePage>('/billing/invoices', {
        query: { page: String(params.page), pageSize: String(params.pageSize), q: params.q || undefined, filter: params.filter },
      }),
    placeholderData: keepPreviousData,
  });

export const useBillingOverview = () => useQuery({ queryKey: keys.overview, queryFn: () => api<BillingOverview>('/billing/overview') });

export function useSendInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { month: string; bills: { studentId: string; total: number }[] }) => api<SendResult>('/billing/send', { method: 'POST', body }),
    onSettled: () => refreshBilling(qc),
  });
}

export function useRecordRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { studentId: string; month: string; total: number }) => api<InvoiceRecord>('/billing/refund', { method: 'POST', body }),
    onSettled: () => Promise.all([refreshBilling(qc), qc.invalidateQueries({ queryKey: keys.drafts() })]),
  });
}

export function useCancelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<InvoiceRecord>(`/billing/invoices/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => refreshBilling(qc),
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => api<InvoiceRecord>(`/billing/invoices/${id}/payment`, { method: 'POST', body: { date } }),
    onSuccess: () => refreshBilling(qc),
  });
}

export function useSyncInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SyncResult>('/billing/invoices/sync', { method: 'POST' }),
    onSuccess: () => refreshBilling(qc),
  });
}

export const useInvoice = (id: string | undefined) =>
  useQuery({ queryKey: keys.invoice(id), queryFn: () => api<InvoiceRow>(`/billing/invoices/${id}`), enabled: Boolean(id) });

export const fetchPayPalLink = (id: string) => api<{ url: string }>(`/billing/invoices/${id}/paypal-link`);

// Not cached: each open of the reminder dialog asks for a fresh draft.
export function useReminderDraft() {
  return useMutation({ mutationFn: (id: string) => api<ReminderDraft>(`/billing/invoices/${id}/reminder-draft`, { method: 'POST' }) });
}

export function useSendReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, subject, note }: { id: string; subject: string; note: string }) => api<InvoiceRow>(`/billing/invoices/${id}/remind`, { method: 'POST', body: { subject, note } }),
    onSuccess: () => refreshBilling(qc),
  });
}

export const usePayments = (month: string) =>
  useQuery({ queryKey: keys.payments(month), queryFn: () => api<PaymentsReport>('/billing/payments', { query: { month } }), placeholderData: keepPreviousData });

export const useDashboardData = () => useQuery({ queryKey: keys.dashboard, queryFn: () => api<DashboardData>('/dashboard') });

// --- AI assistant -------------------------------------------------------------------

export function usePropose() {
  return useMutation({ mutationFn: (message: string) => api<AssistantProposal>('/assistant/propose', { method: 'POST', body: { message } }) });
}

export function useApplyActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actions: AssistantAction[]) => api<ApplyResult>('/assistant/apply', { method: 'POST', body: { actions } }),
    onSuccess: () => Promise.all([refreshClasses(qc), qc.invalidateQueries({ queryKey: keys.dashboard })]),
  });
}

// The kind of work, chosen once at first sign-in. Everything else is refreshed, since the
// demo data is rebuilt to match.
export function useChooseProfession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profession: Profession) => api<TeacherView>('/teacher/profession', { method: 'POST', body: { profession } }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }),
  });
}

export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/demo/reset', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }),
  });
}
