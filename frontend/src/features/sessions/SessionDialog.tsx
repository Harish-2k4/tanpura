// Everything about one class: what happened, whether it's charged, makeups and price.
import EventRepeat from '@mui/icons-material/EventRepeat';
import Sell from '@mui/icons-material/Sell';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { SessionView, TeacherView } from '../../../../shared/api';
import { SESSION_STATUSES, outcomeOf, type SessionStatus, type Student } from '../../../../shared/billing';
import { useSession, useStudents, useTeacher, useUpdateSession } from '../../api/queries';
import { useConfirm } from '../../components/ConfirmDialog';
import { toast } from '../../components/toast';
import { ErrorState, Loading, Money, SessionStatusChip } from '../../components/ui';
import { formatDateTime, formatMoney, formatMonth, formatTime, zoneCity } from '../../lib/format';
import { SESSION_STATUS } from '../../lib/status';
import { MakeupDialog } from './MakeupDialog';
import { PriceDialog } from './PriceDialog';
import { useWords } from '../../hooks/useWords';

type Props = { sessionId: string | null; onClose: () => void };

export function SessionDialog({ sessionId, onClose }: Props) {
  // Following a makeup link swaps which class is shown without closing the dialog.
  const [shownId, setShownId] = useState<string | null>(null);
  const id = shownId ?? sessionId;
  const close = () => {
    setShownId(null);
    onClose();
  };

  return (
    <Dialog open={Boolean(sessionId)} onClose={close} maxWidth="sm" fullWidth>
      {id && <SessionDetails key={id} id={id} onOpen={setShownId} onClose={close} />}
    </Dialog>
  );
}

function SessionDetails({ id, onOpen, onClose }: { id: string; onOpen: (id: string) => void; onClose: () => void }) {
  const session = useSession(id);
  const teacher = useTeacher();
  const students = useStudents();

  if (session.isError) return <DialogContent><ErrorState error={session.error} /></DialogContent>;
  if (!session.data || !teacher.data || !students.data) return <DialogContent><Loading /></DialogContent>;

  const student = students.data.find((s) => s.id === session.data.studentId)!;
  return <SessionBody s={session.data} teacher={teacher.data} student={student} onOpen={onOpen} onClose={onClose} />;
}

type BodyProps = { s: SessionView; teacher: TeacherView; student: Student; onOpen: (id: string) => void; onClose: () => void };

function SessionBody({ s, teacher, student, onOpen, onClose }: BodyProps) {
  const w = useWords();
  const timeZone = teacher.timezone;
  const update = useUpdateSession();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<'makeup' | 'price' | null>(null);
  const [note, setNote] = useState(s.note ?? '');
  const started = Date.parse(s.start) <= Date.now();
  const first = student.name.split(' ')[0];

  // Charged under the billing rules? (Not yet held counts as charged once it's on a sent invoice.)
  const charged = (status: SessionStatus, waived?: boolean) => outcomeOf(status, waived, teacher.policy) !== 'missed_free';

  // A class already on a sent invoice: changing whether it's charged corrects on the next bill.
  const confirmIfBilled = async (title: string, chargedAfter: boolean) => {
    if (!s.billed || chargedAfter === charged(s.effectiveStatus, s.waived)) return true;
    const invoice = `${s.billed.months.map(formatMonth).join(' and ')} invoice${s.billed.months.length > 1 ? 's' : ''}`;
    return confirm({
      title,
      message: `This ${w.class} is on the ${invoice} you already sent (${formatMoney(s.billed.amount, student.currency)}). That invoice stays as it is; the next bill ${chargedAfter ? 'charges' : 'credits'} it to correct it.`,
      confirmText: 'Change it',
    });
  };

  const setStatus = async (status: SessionStatus) => {
    const keepsWaiver = status === 'no_show' || status === 'cancelled_late' ? s.waived : undefined;
    if (!(await confirmIfBilled(`Mark this ${w.class} as "${SESSION_STATUS[status].action.toLowerCase()}"?`, charged(status, keepsWaiver)))) return;
    update.mutate({ id: s.id, patch: { status } }, { onSuccess: () => toast.success(`${first}'s ${w.class}: ${SESSION_STATUS[status].label.toLowerCase()}`) });
  };

  const setWaived = async (waived: boolean) => {
    if (!(await confirmIfBilled(waived ? `Don't charge for this ${w.class}?` : `Charge for this ${w.class} again?`, charged(s.status, waived)))) return;
    update.mutate(
      { id: s.id, patch: { waived } },
      { onSuccess: () => toast.success(waived ? `${first} won't be charged for this ${w.class}` : `${first} is charged for this ${w.class} again`) },
    );
  };

  return (
    <>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{student.name}</span>
          <SessionStatusChip status={s.effectiveStatus} auto={s.auto} waived={s.waived} />
        </Stack>
        <Typography color="text.secondary">
          {formatDateTime(s.start, timeZone)} ({zoneCity(timeZone)}) · {formatTime(s.start, student.timezone)} in {zoneCity(student.timezone)} · {s.minutes} min
        </Typography>
      </DialogTitle>
      {update.isPending && <LinearProgress aria-label="Saving" />}
      <DialogContent>
        <Stack spacing={2.5} divider={<Divider flexItem />}>
          {(s.makeupFor || s.makeupId) && (
            <Alert severity="info" icon={<EventRepeat />}>
              {s.makeupFor && (
                <>
                  Makeup for a missed class.{' '}
                  <Link component="button" type="button" onClick={() => onOpen(s.makeupFor!)}>
                    Open the original
                  </Link>
                </>
              )}
              {s.makeupId && (
                <>
                  A makeup is booked for this class.{' '}
                  <Link component="button" type="button" onClick={() => onOpen(s.makeupId!)}>
                    Open the makeup
                  </Link>
                </>
              )}
            </Alert>
          )}

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">What happened?</Typography>
            <TextField
              select
              label={`${w.Class} status`}
              value={s.status}
              onChange={(e) => void setStatus(e.target.value as SessionStatus)}
              disabled={update.isPending}
              helperText={s.auto ? 'Counted as held automatically. Change it if something else happened.' : ' '}
              fullWidth
            >
              {SESSION_STATUSES.map((status) => (
                <MenuItem key={status} value={status} disabled={!started && (status === 'attended' || status === 'no_show')}>
                  {status === 'scheduled' && s.auto ? 'Not marked (counts as held)' : SESSION_STATUS[status].action}
                </MenuItem>
              ))}
            </TextField>
            {s.canWaive && (
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(s.waived)}
                    disabled={update.isPending}
                    onChange={(e) => void setWaived(e.target.checked)}
                  />
                }
                label={`Don't charge for this ${w.class}`}
              />
            )}
            {s.canBookMakeup && (
              <Box>
                <Button variant="outlined" startIcon={<EventRepeat />} onClick={() => setDialog('makeup')}>
                  Book a makeup
                </Button>
              </Box>
            )}
          </Stack>

          {s.billed && (
            <Typography variant="body2" color="text.secondary">
              On the {s.billed.months.map(formatMonth).join(' and ')} invoice already sent ({formatMoney(s.billed.amount, student.currency)}).
            </Typography>
          )}

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="subtitle2">Price</Typography>
              <Typography color="text.secondary">
                <Money amount={s.price ?? student.rate} currency={student.currency} /> {s.price ? '(special price)' : '(usual rate)'}
                {s.makeupFor && ` · uses the original ${w.class} price`}
              </Typography>
            </Box>
            {!s.makeupFor && (
              <Button startIcon={<Sell />} onClick={() => setDialog('price')}>
                Change
              </Button>
            )}
          </Stack>

          <TextField
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (s.note ?? '') && update.mutate({ id: s.id, patch: { note } }, { onSuccess: () => toast.success('Note saved') })}
            placeholder="e.g. Exam week"
            fullWidth
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>

      {dialog === 'makeup' && <MakeupDialog open session={s} timeZone={timeZone} onClose={() => setDialog(null)} onBooked={(m) => onOpen(m.id)} />}
      {dialog === 'price' && <PriceDialog open session={s} student={student} onClose={() => setDialog(null)} />}
    </>
  );
}
