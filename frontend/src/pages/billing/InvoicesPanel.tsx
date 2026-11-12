// Invoices already issued, paged and searched on the server: status, payment, and the
// actions each state allows.
import MoreVert from '@mui/icons-material/MoreVert';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import Sync from '@mui/icons-material/Sync';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { InvoiceRow } from '../../../../shared/api';
import type { InvoiceFilter } from '../../../../shared/billing';
import { fetchPayPalLink, useCancelInvoice, useInvoicePage, useRecordPayment, useSyncInvoices } from '../../api/queries';
import { useConfirm } from '../../components/ConfirmDialog';
import { FormDialog } from '../../components/FormDialog';
import { DateField } from '../../components/pickers';
import { SearchField } from '../../components/SearchField';
import { TablePager } from '../../components/TablePager';
import { toast } from '../../components/toast';
import { EmptyState, ErrorState, InvoiceStatusChip, Loading, Money, SCROLL_TABLE_SX } from '../../components/ui';
import { ReminderDialog } from '../../features/reminders/ReminderDialog';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { clampedPage, usePagination } from '../../hooks/usePagination';
import { formatMonth, formatShortDate, plural } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

const FILTERS: { value: InvoiceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Awaiting' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function InvoicesPanel({ today, mock }: { today: string; mock: boolean }) {
  const w = useWords();
  const [filter, setFilter] = useState<InvoiceFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const pagination = usePagination(`${q}|${filter}`);
  const query = useInvoicePage({ page: pagination.page, pageSize: pagination.pageSize, q, filter });
  const data = query.data;

  // The page asked for can be past the end after invoices change: go to the last page.
  const lastPage = data && data.items.length === 0 && data.total > 0 ? clampedPage(pagination, data.total) : null;
  const { page, setPage } = pagination;
  useEffect(() => {
    if (lastPage !== null && lastPage !== page) setPage(lastPage);
  }, [lastPage, page, setPage]);

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ px: 2, py: 1.5, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <SearchField value={search} onChange={setSearch} placeholder={`Search ${w.student}, ${w.parent} or invoice no.`} label="Search invoices" width={320} />
        <Stack direction="row" spacing={1}>
          <Button component="a" href="/api/billing/invoices.csv" download startIcon={<FileDownloadOutlined />}>
            Export CSV
          </Button>
          <SyncButton mock={mock} />
        </Stack>
      </Stack>
      <Tabs value={filter} onChange={(_, v: InvoiceFilter) => setFilter(v)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        {FILTERS.map((f) => (
          <Tab key={f.value} value={f.value} label={`${f.label}${data ? ` (${data.counts[f.value]})` : ''}`} />
        ))}
      </Tabs>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Box sx={{ p: 2 }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Box>
      ) : data!.items.length === 0 ? (
        <EmptyState
          title={q ? `No invoices match "${q}"` : 'No invoices here'}
          action={q ? <Button onClick={() => setSearch('')}>Clear search</Button> : undefined}
        />
      ) : (
        <Box sx={{ opacity: query.isPlaceholderData ? 0.6 : 1, transition: 'opacity .2s' }}>
          <InvoiceTable rows={data!.items} today={today} />
          <TablePager count={data!.total} pagination={pagination} />
        </Box>
      )}
    </Box>
  );
}

function SyncButton({ mock }: { mock: boolean }) {
  const w = useWords();
  const sync = useSyncInvoices();
  return (
    <Tooltip title={mock ? 'Available with PayPal sandbox keys' : `Fetch payments ${w.families} made on PayPal`}>
      <span>
        <Button
          startIcon={<Sync />}
          disabled={mock}
          loading={sync.isPending}
          onClick={() => sync.mutate(undefined, { onSuccess: (r) => toast.info(r.updated ? `${plural(r.updated, 'invoice')} updated from PayPal` : 'Everything is up to date') })}
        >
          Refresh from PayPal
        </Button>
      </span>
    </Tooltip>
  );
}

const awaiting = (inv?: InvoiceRow) => inv?.status === 'SENT' || inv?.status === 'PARTIALLY_PAID';

function InvoiceTable({ rows, today }: { rows: InvoiceRow[]; today: string }) {
  const w = useWords();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; invoice: InvoiceRow } | null>(null);
  const [paying, setPaying] = useState<InvoiceRow | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);
  const confirm = useConfirm();
  const cancel = useCancelInvoice();

  // Open the tab right away (inside the click, so it isn't blocked), then point it at PayPal.
  const openInPayPal = async (id: string) => {
    setMenu(null);
    const tab = window.open('', '_blank');
    try {
      const { url } = await fetchPayPalLink(id);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.open(url, '_blank', 'noopener');
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : 'Could not open PayPal');
    }
  };

  const askCancel = async (inv: InvoiceRow) => {
    setMenu(null);
    const ok = await confirm({
      title: `Cancel ${inv.studentName}'s ${formatMonth(inv.month)} invoice?`,
      message: `PayPal tells the ${w.family} it was cancelled. Its ${w.classes} go back to "not billed", so the next bill includes them correctly.`,
      confirmText: 'Cancel invoice',
      cancelText: 'Keep it',
      tone: 'danger',
    });
    if (ok) cancel.mutate(inv.id, { onSuccess: () => toast.success('Invoice cancelled') });
  };

  return (
    <>
      <TableContainer sx={SCROLL_TABLE_SX}>
        <Table stickyHeader size="small" aria-label="Invoices">
          <TableHead>
            <TableRow>
              <TableCell>{w.Student}</TableCell>
              <TableCell>For</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Issued</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Due</TableCell>
              <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Invoice</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((inv) => {
              const hasActions = !inv.refund && (!inv.mock || inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID');
              return (
                <TableRow key={inv.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{inv.studentName}</TableCell>
                  <TableCell>{formatMonth(inv.month)}</TableCell>
                  <TableCell align="right">
                    <Money amount={inv.total} currency={inv.currency} strong />
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
                      <InvoiceStatusChip invoice={inv} today={today} />
                      {inv.paidAt && (
                        <Typography variant="caption" color="text.secondary">
                          Paid {formatShortDate(inv.paidAt)}
                        </Typography>
                      )}
                      {!inv.paidAt && inv.reminders?.length ? (
                        <Typography variant="caption" color="text.secondary">
                          Reminded {formatShortDate(inv.reminders.at(-1)!)}
                        </Typography>
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{formatShortDate(inv.issuedAt)}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{formatShortDate(inv.dueDate)}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, fontFamily: 'monospace', fontSize: 13 }}>
                    {inv.id}
                    {inv.mock && (
                      <Tooltip title="Sample history from the demo data: recorded here, not in PayPal">
                        <Box component="span" sx={{ color: 'text.secondary' }}> (demo)</Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell padding="checkbox">
                    <Tooltip title={hasActions ? 'Actions' : 'No actions for this invoice'}>
                      <span>
                        <IconButton size="small" disabled={!hasActions || (cancel.isPending && cancel.variables === inv.id)} onClick={(e) => setMenu({ anchor: e.currentTarget, invoice: inv })} aria-label="Invoice actions">
                          <MoreVert fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu && !menu.invoice.mock && (
          <MenuItem onClick={() => openInPayPal(menu.invoice.id)}>
            <ListItemText primary="Open in PayPal" secondary="The invoice on PayPal, to view or print" />
          </MenuItem>
        )}
        <MenuItem
          disabled={!awaiting(menu?.invoice)}
          onClick={() => {
            setReminding(menu!.invoice.id);
            setMenu(null);
          }}
        >
          <ListItemText primary="Send a friendly reminder" secondary="Written with AI, sent by PayPal" />
        </MenuItem>
        <MenuItem
          disabled={!awaiting(menu?.invoice)}
          onClick={() => {
            setPaying(menu!.invoice);
            setMenu(null);
          }}
        >
          <ListItemText primary="Record a payment" secondary="Paid outside PayPal, e.g. bank transfer" />
        </MenuItem>
        <MenuItem onClick={() => menu && askCancel(menu.invoice)} disabled={menu?.invoice.status !== 'SENT'}>
          <ListItemText primary="Cancel invoice" secondary={`Its ${w.classes} are billed again next time`} />
        </MenuItem>
      </Menu>

      {paying && <RecordPaymentDialog invoice={paying} today={today} onClose={() => setPaying(null)} />}
      {reminding && <ReminderDialog invoiceId={reminding} onClose={() => setReminding(null)} />}
    </>
  );
}

function RecordPaymentDialog({ invoice, today, onClose }: { invoice: InvoiceRow; today: string; onClose: () => void }) {
  const [date, setDate] = useState(today);
  const record = useRecordPayment();
  const outOfRange = date < invoice.issuedAt || date > today;

  return (
    <FormDialog
      open
      title="Record a payment"
      description={
        <>
          Marks {invoice.studentName}&apos;s {formatMonth(invoice.month)} invoice (<Money amount={invoice.total} currency={invoice.currency} />) as paid in full
          {invoice.mock ? '.' : ' in PayPal too.'}
        </>
      }
      submitText="Mark as paid"
      busy={record.isPending}
      submitDisabled={outOfRange}
      onClose={onClose}
      onSubmit={() =>
        record.mutate(
          { id: invoice.id, date },
          {
            onSuccess: () => {
              toast.success('Payment recorded');
              onClose();
            },
          },
        )
      }
    >
      <DateField label="Paid on" value={date} onChange={setDate} min={invoice.issuedAt} max={today} helperText={outOfRange ? 'Between the invoice date and today' : ' '} />
    </FormDialog>
  );
}
