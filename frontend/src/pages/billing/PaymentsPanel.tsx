// Money that actually arrived through PayPal in the month, with PayPal's fees and what's left,
// matched to each family's invoice (PayPal Transaction Search through PayPal's SDK).
import Alert from '@mui/material/Alert';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { PaymentRow } from '../../../../shared/api';
import { usePayments } from '../../api/queries';
import { TablePager } from '../../components/TablePager';
import { EmptyState, Money, QueryState, StatCard, SCROLL_TABLE_SX } from '../../components/ui';
import { pageOf, usePagination } from '../../hooks/usePagination';
import { formatMoney, formatMonth, formatShortDate, formatTotals, plural } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

// Text cells a spreadsheet could read as a formula get an apostrophe in front.
const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

function downloadPayments(rows: PaymentRow[], month: string) {
  const header = 'Date,Name,Payer email,Currency,Received,PayPal fee,You keep,Status,Invoice';
  const lines = rows.map((r) =>
    [r.date, cell(r.studentName ?? ''), cell(r.payerEmail ?? ''), r.currency, r.gross.toFixed(2), r.fee.toFixed(2), r.net.toFixed(2), cell(r.status), cell(r.invoiceId ?? '')].join(','),
  );
  const blob = new Blob([`\uFEFF${[header, ...lines].join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `tanpura-payments-${month}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PaymentsPanel({ month }: { month: string }) {
  const w = useWords();
  const payments = usePayments(month);
  const pagination = usePagination(month);

  return (
    <QueryState query={payments}>
      {(report) => (
        <Box sx={{ opacity: payments.isPlaceholderData ? 0.6 : 1 }}>
          <Stack spacing={1.5} sx={{ px: 2, py: 1.5 }}>
            {report.note && <Alert severity={report.source === 'mock' ? 'warning' : 'info'}>{report.note}</Alert>}
            {report.rows.length > 0 && (
              <Button onClick={() => downloadPayments(report.rows, month)} startIcon={<FileDownloadOutlined />} sx={{ alignSelf: 'flex-start' }}>
                Export CSV
              </Button>
            )}
            {report.home && (
              <Typography variant="body2" color="text.secondary">
                In {report.home.currency}: received ≈ {formatMoney(report.home.gross, report.home.currency)}, fees ≈ {formatMoney(report.home.fee, report.home.currency)}, you keep ≈{' '}
                <Box component="strong" sx={{ color: 'text.primary' }}>{formatMoney(report.home.net, report.home.currency)}</Box>. Converted at the ECB rate on each payment&apos;s date; PayPal&apos;s own rate is usually a little lower.
              </Typography>
            )}
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, md: 4 }}>
                <StatCard label={`Received in ${formatMonth(month).split(' ')[0]}`} value={formatTotals(report.totals.map((t) => ({ currency: t.currency, amount: t.gross })))} hint={plural(report.rows.length, 'payment')} />
              </Grid>
              <Grid size={{ xs: 6, md: 4 }}>
                <StatCard label="PayPal fees" value={formatTotals(report.totals.map((t) => ({ currency: t.currency, amount: t.fee })))} hint="taken by PayPal" />
              </Grid>
              <Grid size={{ xs: 6, md: 4 }}>
                <StatCard label="You keep" value={formatTotals(report.totals.map((t) => ({ currency: t.currency, amount: t.net })))} tone="success" hint="from your Tanpura invoices" />
              </Grid>
            </Grid>
          </Stack>
          {report.rows.length === 0 ? (
            <EmptyState title={`No PayPal payments in ${formatMonth(month)} yet`} />

          ) : (
            <>
              <TableContainer sx={SCROLL_TABLE_SX}>
                <Table stickyHeader size="small" aria-label="Payments">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>{w.Family}</TableCell>
                      <TableCell align="right">Received</TableCell>
                      <TableCell align="right">Fee</TableCell>
                      <TableCell align="right">You keep</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Status</TableCell>
                      <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Invoice</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pageOf(report.rows, pagination).map((r) => (
                      <TableRow key={r.id} hover>
                        <TableCell>{formatShortDate(r.date)}</TableCell>
                        <TableCell>
                          {r.studentName ? (
                            r.studentName
                          ) : (
                            <Typography variant="body2" color="warning.main">
                              Not matched{r.payerEmail ? ` (${r.payerEmail})` : ''}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Money amount={r.gross} currency={r.currency} />
                        </TableCell>
                        <TableCell align="right">
                          <Money amount={r.fee} currency={r.currency} />
                        </TableCell>
                        <TableCell align="right">
                          <Money amount={r.net} currency={r.currency} strong />
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, textTransform: 'capitalize' }}>{r.status}</TableCell>
                        <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, fontFamily: 'monospace', fontSize: 13 }}>{r.invoiceId ?? '–'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePager count={report.rows.length} pagination={pagination} />
            </>
          )}
        </Box>
      )}
    </QueryState>
  );
}
