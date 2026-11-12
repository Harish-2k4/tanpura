// A friendly payment reminder: drafted by AI from the family's history, edited by the teacher,
// then sent by PayPal as an email that links the invoice.
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { reminderSchema } from '../../../../shared/assistant';
import { invoiceState } from '../../../../shared/billing';
import { useInvoice, useReminderDraft, useSendReminder, useTeacher } from '../../api/queries';
import { FormDialog } from '../../components/FormDialog';
import { toast } from '../../components/toast';
import { Money } from '../../components/ui';
import { formatMonth, formatShortDate } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

export function ReminderDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const w = useWords();
  const invoice = useInvoice(invoiceId);
  const teacher = useTeacher();
  const draft = useReminderDraft();
  const send = useSendReminder();
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');

  const write = () =>
    draft.mutate(invoiceId, {
      onSuccess: (d) => {
        setSubject(d.subject);
        setNote(d.note);
      },
    });
  // Draft when the dialog opens for an invoice.
  const { mutate } = draft;
  useEffect(() => {
    mutate(invoiceId, {
      onSuccess: (d) => {
        setSubject(d.subject);
        setNote(d.note);
      },
    });
  }, [invoiceId, mutate]);

  const inv = invoice.data;
  const today = teacher.data?.today ?? '';
  const valid = reminderSchema.safeParse({ subject, note }).success;
  const sentToday = Boolean(inv?.reminders?.includes(today));

  return (
    <FormDialog
      open
      maxWidth="sm"
      title="Send a friendly reminder"
      submitText="Send through PayPal"
      busy={send.isPending}
      submitDisabled={!valid || draft.isPending || sentToday || !inv}
      onClose={onClose}
      onSubmit={() =>
        send.mutate(
          { id: invoiceId, subject, note },
          {
            onSuccess: () => {
              toast.success(inv?.mock ? 'Reminder recorded (demo invoice, not in PayPal)' : 'Reminder sent through PayPal');
              onClose();
            },
          },
        )
      }
    >
      {inv && (
        <Stack spacing={1}>
          <Typography>
            {inv.studentName}&apos;s {formatMonth(inv.month)} invoice, <Money amount={inv.total} currency={inv.currency} strong />, due {formatShortDate(inv.dueDate)}
            {today && invoiceState(inv, today) === 'overdue' ? ' (overdue)' : ''}.
          </Typography>
          {inv.reminders?.length ? (
            <Typography variant="body2" color="text.secondary">
              Reminders already sent: {inv.reminders.map(formatShortDate).join(', ')}.
            </Typography>
          ) : null}
          {sentToday && <Alert severity="info">A reminder already went today. Give them a day or two.</Alert>}
        </Stack>
      )}

      {draft.isPending ? (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">Writing a draft from this {w.family}&apos;s payment history…</Typography>
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={160} />
        </Stack>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            {draft.data && <Chip size="small" variant="outlined" label={draft.data.source === 'ai' ? 'Written by Gemini, edit freely' : 'Written from a template, edit freely'} />}
            <Button size="small" onClick={write} startIcon={<EditNoteOutlined />}>
              Rewrite
            </Button>
          </Stack>
          <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
          <TextField
            label="Message"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={6}
            fullWidth
            helperText={`${note.length}/1500. PayPal adds a link to the invoice.`}
            slotProps={{ htmlInput: { maxLength: 1500 } }}
          />
        </>
      )}
    </FormDialog>
  );
}
