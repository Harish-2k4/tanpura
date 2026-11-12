// One family's bill, line by line, with the flags that need a decision.
import Alert, { type AlertColor } from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { DraftView } from '../../../../shared/api';
import { useState } from 'react';
import type { Flag, FlagCode, Item } from '../../../../shared/billing';
import { useRecordRefund, useUpdateSession } from '../../api/queries';
import { useConfirm } from '../../components/ConfirmDialog';
import { ReminderDialog } from '../../features/reminders/ReminderDialog';
import { toast } from '../../components/toast';
import { Money } from '../../components/ui';
import { formatMoney, formatShortDate, plural } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

const FLAG_SEVERITY: Record<FlagCode, AlertColor> = {
  missed_charged: 'warning',
  credited_not_made_up: 'warning',
  unpaid_previous: 'error',
  many_makeups: 'info',
  still_scheduled: 'info',
  nothing_to_bill: 'info',
  credit_carried: 'info',
  already_invoiced: 'success',
};

// Flags the teacher should look at before sending (the rest explain why a bill can't be sent).
export const REVIEW_FLAGS: FlagCode[] = ['missed_charged', 'credited_not_made_up', 'unpaid_previous', 'many_makeups'];

const OUTCOME_LABEL: Record<Item['outcome'], string> = {
  held: 'held',
  pending: 'not held yet',
  missed_charged: 'missed, charged',
  missed_free: 'not charged',
};

type Props = { draft: DraftView; onOpenSession: (id: string) => void; onShowInvoices: () => void };

export function DraftDetails({ draft, onOpenSession, onShowInvoices }: Props) {
  const { currency } = draft;

  return (
    <Stack spacing={2} sx={{ py: 2 }}>
      {draft.lines.length > 0 ? (
        <Table size="small" aria-label={`Bill lines for ${draft.student.name}`}>
          <TableHead>
            <TableRow>
              <TableCell>Line</TableCell>
              <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Qty</TableCell>
              <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Each</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {draft.lines.map((line) => (
              <TableRow key={`${line.kind}-${line.unitAmount}`}>
                <TableCell>
                  <Typography variant="body2">{line.description}</Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                    {line.items.map((item) => (
                      <Chip
                        key={item.sessionId}
                        size="small"
                        variant="outlined"
                        label={`${formatShortDate(item.date)} · ${OUTCOME_LABEL[item.outcome]}`}
                        onClick={() => onOpenSession(item.sessionId)}
                      />
                    ))}
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{line.quantity}</TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  <Money amount={line.unitAmount} currency={currency} />
                </TableCell>
                <TableCell align="right">
                  <Money amount={line.amount} currency={currency} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3} sx={{ fontWeight: 600, borderBottom: 0, display: { xs: 'none', sm: 'table-cell' } }}>
                Total
              </TableCell>
              <TableCell sx={{ fontWeight: 600, borderBottom: 0, display: { xs: 'table-cell', sm: 'none' } }}>
                Total
              </TableCell>
              <TableCell align="right" sx={{ borderBottom: 0 }}>
                <Money amount={draft.total} currency={currency} strong />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      ) : (
        <Typography color="text.secondary">No changes to bill.</Typography>
      )}

      {draft.notCharged.length > 0 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Not charged this month:
          </Typography>
          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {draft.notCharged.map((item) => (
              <Chip key={item.sessionId} size="small" label={formatShortDate(item.date)} onClick={() => onOpenSession(item.sessionId)} />
            ))}
          </Stack>
        </Box>
      )}

      {draft.flags.map((flag) => (
        <FlagAlert key={flag.code} flag={flag} draft={draft} studentName={draft.student.name} onOpenSession={onOpenSession} onShowInvoices={onShowInvoices} />
      ))}
    </Stack>
  );
}

type FlagProps = { flag: Flag; draft: DraftView; studentName: string; onOpenSession: (id: string) => void; onShowInvoices: () => void };

function FlagAlert({ flag, draft, studentName, onOpenSession, onShowInvoices }: FlagProps) {
  const refund = useRecordRefund();
  const w = useWords();
  const update = useUpdateSession();
  const confirm = useConfirm();
  const [reminding, setReminding] = useState(false);
  const classes = flag.classes ?? [];
  const first = studentName.split(' ')[0];

  // One at a time; on a failure the error toast shows and the rest are left as they were.
  const waiveAll = async () => {
    const ok = await confirm({
      title: `Don't charge ${first} for ${plural(classes.length, `missed ${w.class}`, `missed ${w.classes}`)}?`,
      message: `${classes.map((c) => formatShortDate(c.date)).join(', ')}. If ${classes.length === 1 ? 'it was' : 'they were'} already billed, the next bill gives a credit. You can change this on each ${w.class} later.`,
      confirmText: 'Waive',
    });
    if (!ok) return;
    let done = 0;
    try {
      for (const c of classes) {
        await update.mutateAsync({ id: c.id, patch: { waived: true } });
        done++;
      }
    } finally {
      if (done) toast.success(`${plural(done, w.class, w.classes)} won't be charged. The bill is updated.`);
    }
  };

  const markRefunded = async () => {
    const amount = formatMoney(-draft.total, draft.currency);
    const ok = await confirm({
      title: `Mark ${amount} as refunded to ${first}?`,
      message: `Do this after you have sent ${amount} back from your PayPal account. Tanpura records it, and the credit stops showing on bills. No money is moved by Tanpura.`,
      confirmText: 'Mark refunded',
    });
    if (ok) refund.mutate({ studentId: draft.studentId, month: draft.month, total: draft.total }, { onSuccess: () => toast.success(`Refund of ${amount} recorded`) });
  };

  const action =
    flag.code === 'missed_charged' ? (
      <Button color="inherit" size="small" onClick={waiveAll} loading={update.isPending}>
        Waive
      </Button>
    ) : flag.code === 'unpaid_previous' ? (
      <Stack direction="row" spacing={0.5}>
        <Button color="inherit" size="small" onClick={() => setReminding(true)}>
          Remind
        </Button>
        <Button color="inherit" size="small" onClick={onShowInvoices}>
          View
        </Button>
      </Stack>
    ) : flag.code === 'credit_carried' && draft.student.endedOn ? (
      <Button color="inherit" size="small" onClick={markRefunded} loading={refund.isPending}>
        Mark refunded
      </Button>
    ) : undefined;

  const latestOverdue = flag.invoiceIds?.at(-1);
  return (
    <>
      <Alert severity={FLAG_SEVERITY[flag.code]} action={action}>
        {flag.message}
        {classes.length > 0 && (
          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
            {classes.map((c) => (
              <Chip key={c.id} size="small" variant="outlined" label={formatShortDate(c.date)} onClick={() => onOpenSession(c.id)} />
            ))}
          </Stack>
        )}
      </Alert>
      {reminding && latestOverdue && <ReminderDialog invoiceId={latestOverdue} onClose={() => setReminding(false)} />}
    </>
  );
}
