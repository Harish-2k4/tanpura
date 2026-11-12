// The month's bills for every family: review, then send them all through PayPal at once.
import Send from '@mui/icons-material/Send';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { BillingOverview, DraftView, SendResult, TeacherView } from '../../../../shared/api';
import { monthSchema } from '../../../../shared/schemas';
import { addMonths, nextMonth } from '../../../../shared/time';
import { useBillingOverview, useDrafts, useSendInvoices, useTeacher } from '../../api/queries';
import { useConfirm } from '../../components/ConfirmDialog';
import { MonthPicker } from '../../components/pickers';
import type { Country } from '../../../../shared/billing';
import { SearchField } from '../../components/SearchField';
import { CountryFilter, SelectFilter } from '../../components/SelectFilter';
import { TablePager } from '../../components/TablePager';
import { toast } from '../../components/toast';
import { EmptyState, PageHeader, QueryState, StatCard } from '../../components/ui';
import { SessionDialog } from '../../features/sessions/SessionDialog';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { pageOf, usePagination } from '../../hooks/usePagination';
import { formatMonth, formatTotals, plural } from '../../lib/format';
import { REVIEW_FLAGS } from './DraftDetails';
import { DraftsTable } from './DraftsTable';
import { InvoicesPanel } from './InvoicesPanel';
import { PaymentsPanel } from './PaymentsPanel';
import { useWords } from '../../hooks/useWords';

const needsReview = (d: DraftView) => d.flags.some((f) => REVIEW_FLAGS.includes(f.code));

export function BillingPage() {
  return <QueryState query={useTeacher()}>{(teacher) => <Billing teacher={teacher} />}</QueryState>;
}

function Billing({ teacher }: { teacher: TeacherView }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('month');
  const month = requested && monthSchema.safeParse(requested).success ? requested : teacher.suggestedMonth;
  const tab = (['invoices', 'payments'] as const).find((t) => t === params.get('tab')) ?? 'bills';
  const setParam = (key: string, value: string) => setParams((p) => (p.set(key, value), p), { replace: true });
  const current = teacher.today.slice(0, 7);
  const mock = teacher.integrations.paypal === 'mock';

  const drafts = useDrafts(month);
  const overview = useBillingOverview();
  const [openSession, setOpenSession] = useState<string | null>(null);
  const w = useWords();

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle={
          teacher.billingMode === 'advance'
            ? `You bill in advance: ${formatMonth(month)} ${w.classes} are billed before they happen, and changes are corrected on the next bill.`
            : `You bill after the month: ${formatMonth(month)} is billed for the ${w.classes} that happened.`
        }
        actions={<MonthPicker value={month} onChange={(m) => setParam('month', m)} label="Bills for" min={addMonths(current, -12)} max={nextMonth(current)} />}
      />

      {mock && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          PayPal is in mock mode: invoices are recorded here but not sent. Add sandbox keys to <code>backend/.env</code> to send real sandbox invoices.
        </Alert>
      )}

      <Stats drafts={drafts.data} overview={overview.data} />

      <Card>
        <Tabs value={tab} onChange={(_, v: string) => setParam('tab', v)} variant="scrollable" scrollButtons={false} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="bills" label="To send" />
          <Tab value="invoices" label={`Sent invoices${overview.data ? ` (${overview.data.invoiceCount})` : ''}`} />
          <Tab value="payments" label="Payments received" />
        </Tabs>
        {tab === 'bills' ? (
          <QueryState query={drafts}>
            {(list) => (
              <Bills
                key={month}
                month={month}
                drafts={list}
                mock={mock}
                stale={drafts.isPlaceholderData}
                onOpenSession={setOpenSession}
                onShowInvoices={() => setParam('tab', 'invoices')}
              />
            )}
          </QueryState>
        ) : tab === 'invoices' ? (
          <InvoicesPanel today={teacher.today} mock={mock} />
        ) : (
          <PaymentsPanel month={current} />
        )}
      </Card>

      <SessionDialog sessionId={openSession} onClose={() => setOpenSession(null)} />
    </>
  );
}

function Stats({ drafts, overview }: { drafts?: DraftView[]; overview?: BillingOverview }) {
  const w = useWords();
  const ready = drafts?.filter((d) => d.sendable) ?? [];
  const review = drafts?.filter(needsReview).length ?? 0;
  const overdue = overview?.overdue;
  return (
    <Grid container spacing={1.5} sx={{ mb: 2 }}>
      <Grid size={{ xs: 6, lg: 3 }}>
        <StatCard label="Ready to send" value={drafts ? `${ready.length} of ${drafts.length}` : '…'} hint={`${w.families} with a bill`} />
      </Grid>
      <Grid size={{ xs: 6, lg: 3 }}>
        <StatCard label="To bill" value={drafts ? formatTotals(ready.map((d) => ({ currency: d.currency, amount: d.total }))) : '…'} hint={`in each ${w.family}'s currency`} />
      </Grid>
      <Grid size={{ xs: 6, lg: 3 }}>
        <StatCard label="Needs your review" value={drafts ? review : '…'} tone={review ? 'warning' : 'default'} hint={`missed ${w.classes}, credits, late payers`} />
      </Grid>
      <Grid size={{ xs: 6, lg: 3 }}>
        <StatCard
         
          label="Overdue invoices"
          value={overdue ? overdue.count : '…'}
          tone={overdue?.count ? 'error' : 'success'}
          hint={overdue?.count ? formatTotals(overdue.totals) : 'everyone is up to date'}
        />
      </Grid>
    </Grid>
  );
}

type BillStatus = 'ready' | 'review' | 'not_sendable';
const BILL_STATUS_OPTIONS: { value: BillStatus; label: string }[] = [
  { value: 'ready', label: 'Ready' },
  { value: 'review', label: 'To review' },
  { value: 'not_sendable', label: 'Not sendable' },
];
const matchesStatus = (d: DraftView, s: BillStatus | '') => !s || (s === 'ready' ? d.sendable : s === 'review' ? needsReview(d) : !d.sendable);

type BillsProps = { month: string; drafts: DraftView[]; mock: boolean; stale: boolean; onOpenSession: (id: string) => void; onShowInvoices: () => void };

function Bills({ month, drafts, mock, stale, onOpenSession, onShowInvoices }: BillsProps) {
  const w = useWords();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState<Country | ''>('');
  const [status, setStatus] = useState<BillStatus | ''>('');
  const q = useDebouncedValue(search.trim().toLowerCase());
  const filtered = useMemo(
    () =>
      drafts.filter(
        (d) =>
          (!country || d.student.country === country) &&
          matchesStatus(d, status) &&
          (!q || [d.student.name, d.student.parent.name, d.student.parent.email].some((t) => t.toLowerCase().includes(q))),
      ),
    [drafts, q, country, status],
  );
  const pagination = usePagination(`${q}|${country}|${status}`);
  const clearFilters = () => {
    setSearch('');
    setCountry('');
    setStatus('');
  };

  const sendable = useMemo(() => drafts.filter((d) => d.sendable).map((d) => d.studentId), [drafts]);
  // Nothing is ticked at first: the teacher picks each bill, or uses select all.
  const [selected, setSelected] = useState(() => new Set<string>());
  const [result, setResult] = useState<SendResult | null>(null);
  const send = useSendInvoices();
  const confirm = useConfirm();

  // Keep the selection to bills that can still be sent (e.g. after sending, or a waiver).
  useEffect(() => setSelected((prev) => new Set([...prev].filter((id) => sendable.includes(id)))), [sendable]);

  const chosen = drafts.filter((d) => selected.has(d.studentId));
  const hiddenBySearch = chosen.filter((d) => !filtered.includes(d)).length;
  const names = new Map(drafts.map((d) => [d.studentId, d.student.name]));

  const sendSelected = async () => {
    const review = chosen.filter(needsReview).length;
    const ok = await confirm({
      title: `Send ${plural(chosen.length, 'invoice')} through PayPal?`,
      message: (
        <Stack spacing={1.5}>
          <Typography>
            Total {formatTotals(chosen.map((d) => ({ currency: d.currency, amount: d.total })))}. Each {w.family} gets a PayPal invoice by email, in their own currency, with every {w.class} date listed.
          </Typography>
          {review > 0 && <Alert severity="warning">{plural(review, 'bill')} still {review === 1 ? 'has' : 'have'} something to review: missed {w.classes}, credits or late payments.</Alert>}
          {hiddenBySearch > 0 && <Alert severity="info">Includes {plural(hiddenBySearch, 'selected bill')} hidden by your filters.</Alert>}
          {mock && <Alert severity="warning">Mock mode: nothing is sent to PayPal.</Alert>}
        </Stack>
      ),
      confirmText: `Send ${chosen.length}`,
    });
    if (!ok) return;
    send.mutate(
      { month, bills: chosen.map((d) => ({ studentId: d.studentId, total: d.total })) },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.sent.length) toast.success(`${plural(res.sent.length, 'invoice')} sent${mock ? ' (mock)' : ' through PayPal'}`);
          if (res.skipped.length) toast.warning(`${plural(res.skipped.length, 'bill')} not sent. See the details above the list.`);
        },
      },
    );
  };

  if (!drafts.length) return <EmptyState title={`No ${w.students} yet`} />;

  return (
    <Box sx={{ opacity: stale ? 0.6 : 1, transition: 'opacity .2s' }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} sx={{ px: 2, py: 1.5, alignItems: { lg: 'center' }, justifyContent: 'space-between' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <SearchField value={search} onChange={setSearch} placeholder={`Search ${w.student} or ${w.parent}`} label="Search bills" width={260} />
          <CountryFilter value={country} onChange={setCountry} />
          <SelectFilter label="Status" value={status} onChange={setStatus} options={BILL_STATUS_OPTIONS} allLabel="All bills" />
        </Stack>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography color="text.secondary">
            {sendable.length ? `${plural(chosen.length, 'bill')} selected of ${sendable.length} ready` : 'No bills to send for this month'}
          </Typography>
          <Button variant="contained" startIcon={<Send />} disabled={!chosen.length || stale} loading={send.isPending} onClick={sendSelected} sx={{ whiteSpace: 'nowrap' }}>
            Send {chosen.length ? plural(chosen.length, 'invoice') : 'invoices'}
          </Button>
        </Stack>
      </Stack>
      {result && result.skipped.length > 0 && (
        <Alert severity="warning" onClose={() => setResult(null)} sx={{ mx: 2, mb: 1.5 }}>
          Not sent:
          <List dense disablePadding>
            {result.skipped.map((s) => (
              <ListItem key={s.studentId} disableGutters>
                <ListItemText primary={`${names.get(s.studentId) ?? s.studentId}: ${s.reason}`} />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}
      {filtered.length === 0 ? (
        <EmptyState title="No bills match these filters" action={<Button onClick={clearFilters}>Clear filters</Button>} />
      ) : (
        <>
          <DraftsTable
            rows={pageOf(filtered, pagination)}
            selectableIds={filtered.filter((d) => d.sendable).map((d) => d.studentId)}
            selected={selected}
            onSelectedChange={setSelected}
            onOpenSession={onOpenSession}
            onShowInvoices={onShowInvoices}
          />
          <TablePager count={filtered.length} pagination={pagination} />
        </>
      )}
    </Box>
  );
}
