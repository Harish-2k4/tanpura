// Small building blocks used across pages.
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Currency, InvoiceRecord, SessionStatus } from '../../../shared/billing';
import { formatMoney } from '../lib/format';
import { SESSION_STATUS, invoiceChip } from '../lib/status';

// Tables keep a fixed height and scroll inside, with the header row staying in view.
export const SCROLL_TABLE_SX = { maxHeight: { xs: 480, md: 'calc(100vh - 320px)' }, minHeight: 240, overflowY: 'auto' } as const;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
      <Box>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Stack spacing={2} sx={{ py: 10, alignItems: 'center' }} role="status">
      <CircularProgress />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
      {error.message}
    </Alert>
  );
}

// Renders loading and error states, then `children` with the data.
export function QueryState<T>({ query, children, loading }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; loading?: ReactNode }) {
  if (query.isPending) return <>{loading ?? <Loading />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function EmptyState({ title, message, action }: { title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <Stack spacing={1} sx={{ py: 5, alignItems: 'center', textAlign: 'center' }}>
      <Typography variant="h6">{title}</Typography>
      {message && <Typography color="text.secondary">{message}</Typography>}
      {action}
    </Stack>
  );
}

type Tone = 'default' | 'success' | 'warning' | 'error';

export function StatCard({ label, value, hint, tone = 'default', icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  const color = tone === 'default' ? 'text.primary' : `${tone}.main`;
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', mb: 0.5 }}>
          {icon}
          <Typography variant="subtitle2">{label}</Typography>
        </Stack>
        <Typography variant="h6" sx={{ color, fontWeight: 700 }}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function Money({ amount, currency, strong }: { amount: number; currency: Currency; strong?: boolean }) {
  return (
    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 600 : undefined, color: amount < 0 ? 'error.main' : undefined }}>
      {formatMoney(amount, currency)}
    </Box>
  );
}

export function SessionStatusChip({ status, auto, waived, size = 'small' }: { status: SessionStatus; auto?: boolean; waived?: boolean; size?: 'small' | 'medium' }) {
  const meta = SESSION_STATUS[status];
  const label = [meta.label, auto && 'auto', waived && 'not charged'].filter(Boolean).join(' · ');
  return <Chip size={size} color={meta.chip} label={label} variant={status === 'scheduled' ? 'outlined' : 'filled'} />;
}

export function InvoiceStatusChip({ invoice, today }: { invoice: InvoiceRecord; today: string }) {
  const meta = invoiceChip(invoice, today);
  return <Chip size="small" color={meta.chip} label={meta.label} />;
}
