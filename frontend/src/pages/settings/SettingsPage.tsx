// How Tanpura bills: billing mode, attendance, missed-session charges, payment terms.
import RestartAlt from '@mui/icons-material/RestartAlt';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import type { TeacherView } from '../../../../shared/api';
import type { TeacherPatch } from '../../../../shared/schemas';
import type { AttendanceMode, BillingMode, Policy } from '../../../../shared/settings';
import { useResetDemo, useTeacher, useUpdateTeacher } from '../../api/queries';
import { useWords } from '../../hooks/useWords';
import { useConfirm } from '../../components/ConfirmDialog';
import { toast } from '../../components/toast';
import { PageHeader, QueryState } from '../../components/ui';

export function SettingsPage() {
  // Keyed by the saved settings only, so a background refresh (e.g. a new day) keeps unsaved edits.
  return <QueryState query={useTeacher()}>{(teacher) => <Settings key={JSON.stringify(toForm(teacher))} teacher={teacher} />}</QueryState>;
}

type Form = { billingMode: BillingMode; attendance: AttendanceMode; paymentTermDays: string; policy: Omit<Policy, 'noticeHours'> & { noticeHours: string } };

const toForm = (t: TeacherView): Form => ({
  billingMode: t.billingMode,
  attendance: t.attendance,
  paymentTermDays: String(t.paymentTermDays),
  policy: { ...t.policy, noticeHours: String(t.policy.noticeHours) },
});

const wholeNumber = (v: string, max: number) => /^\d+$/.test(v) && Number(v) <= max;

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="h6">{title}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function Choice({ value, title, detail }: { value: string; title: string; detail: string }) {
  return (
    <FormControlLabel
      value={value}
      control={<Radio />}
      sx={{ alignItems: 'flex-start', mb: 1, '.MuiRadio-root': { pt: 0.5 } }}
      label={
        <Box>
          <Typography sx={{ fontWeight: 500 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {detail}
          </Typography>
        </Box>
      }
    />
  );
}

function Settings({ teacher }: { teacher: TeacherView }) {
  const [form, setForm] = useState(() => toForm(teacher));
  const update = useUpdateTeacher();
  const reset = useResetDemo();
  const confirm = useConfirm();
  const w = useWords();

  const initial = toForm(teacher);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const termValid = wholeNumber(form.paymentTermDays, 90);
  const noticeValid = wholeNumber(form.policy.noticeHours, 168);
  const setPolicy = (p: Partial<Form['policy']>) => setForm((f) => ({ ...f, policy: { ...f.policy, ...p } }));

  // Leaving the page (in the app, or by reloading/closing the tab) with unsaved changes asks first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !update.isPending && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({ title: 'Leave without saving?', message: 'Your changes to the settings will be lost.', confirmText: 'Leave', cancelText: 'Stay', tone: 'danger' }).then((leave) =>
      leave ? blocker.proceed() : blocker.reset(),
    );
  }, [blocker, confirm]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const discard = async () => {
    if (await confirm({ title: 'Discard your changes?', message: 'The settings go back to what is saved.', confirmText: 'Discard', tone: 'danger' })) setForm(initial);
  };

  const save = async () => {
    if (form.billingMode !== teacher.billingMode) {
      const ok = await confirm({
        title: form.billingMode === 'advance' ? 'Bill in advance from now on?' : 'Bill after each month from now on?',
        message: `Invoices already sent stay as they are. The next bill corrects anything that changes, so no ${w.class} is charged twice or missed.`,
        confirmText: 'Change billing',
      });
      if (!ok) return;
    }
    const patch: TeacherPatch = {
      billingMode: form.billingMode,
      attendance: form.attendance,
      paymentTermDays: Number(form.paymentTermDays),
      policy: { ...form.policy, noticeHours: Number(form.policy.noticeHours) },
    };
    update.mutate(patch, { onSuccess: () => toast.success('Settings saved. Bills are updated.') });
  };

  const resetDemo = async () => {
    const ok = await confirm({
      title: 'Reset the demo data?',
      message: `${w.Students}, ${w.classes} and invoices go back to the demo set, built around today. Your changes are lost.`,
      confirmText: 'Reset',
      tone: 'danger',
    });
    if (ok) reset.mutate(undefined, { onSuccess: () => toast.success('Demo data reset') });
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`${teacher.name} · ${teacher.city}`}
        actions={
          <>
            <Button disabled={!dirty || update.isPending} onClick={discard}>
              Discard
            </Button>
            <Button variant="contained" disabled={!dirty || !termValid || !noticeValid} loading={update.isPending} onClick={save}>
              Save changes
            </Button>
          </>
        }
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack spacing={2}>
            <Section title="Billing" description={`When ${w.families} are billed. Either way, every bill corrects for what actually happened.`}>
              <RadioGroup value={form.billingMode} onChange={(e) => setForm((f) => ({ ...f, billingMode: e.target.value as BillingMode }))}>
                <Choice value="advance" title="Bill in advance" detail={`Bill a month's ${w.classes} before it starts, like a subscription. Cancellations that aren't made up become credits on the next bill.`} />
                <Choice value="after" title="Bill after the month" detail={`Bill each month once it is over, for the ${w.classes} that happened.`} />
              </RadioGroup>
              <TextField
                label="Payment due after"
                type="number"
                value={form.paymentTermDays}
                onChange={(e) => setForm((f) => ({ ...f, paymentTermDays: e.target.value }))}
                error={!termValid}
                helperText={termValid ? 'days from the invoice date' : 'Whole days, 0 to 90'}
                sx={{ mt: 1, width: { xs: '100%', sm: 220 } }}
                slotProps={{ htmlInput: { min: 0, max: 90 } }}
              />
            </Section>

            <Section title="Attendance" description={`How ${w.classes} are marked as held.`}>
              <RadioGroup value={form.attendance} onChange={(e) => setForm((f) => ({ ...f, attendance: e.target.value as AttendanceMode }))}>
                <Choice value="auto" title="Automatic" detail={`A ${w.class} counts as held once it ends. You only mark what went differently: a no-show or a cancellation.`} />
                <Choice value="manual" title="Manual" detail={`You mark every ${w.class}. Unmarked ${w.classes} aren't billed after the month.`} />
              </RadioGroup>
            </Section>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack spacing={2}>
            <Section title={`Missed ${w.classes}`} description={`Defaults for ${w.classes} a ${w.family} misses. You can still waive any single ${w.class}.`}>
              <Stack spacing={1}>
                <FormControlLabel
                  control={<Switch checked={form.policy.noShow === 'charge'} onChange={(e) => setPolicy({ noShow: e.target.checked ? 'charge' : 'free' })} />}
                  label="Charge for no-shows"
                />
                <FormControlLabel
                  control={<Switch checked={form.policy.lateCancel === 'charge'} onChange={(e) => setPolicy({ lateCancel: e.target.checked ? 'charge' : 'free' })} />}
                  label="Charge for late cancellations"
                />
                <TextField
                  label="Late means less notice than"
                  type="number"
                  value={form.policy.noticeHours}
                  onChange={(e) => setPolicy({ noticeHours: e.target.value })}
                  error={!noticeValid}
                  helperText={noticeValid ? `hours before the ${w.class}` : 'Whole hours, 0 to 168'}
                  sx={{ width: { xs: '100%', sm: 260 }, mt: 1 }}
                  slotProps={{ htmlInput: { min: 0, max: 168 } }}
                />
                <Typography variant="body2" color="text.secondary">
                  {w.Classes} cancelled with enough notice, or by you, are never charged: book a {w.makeup} or they become a credit.
                </Typography>
              </Stack>
            </Section>

            <Section title="PayPal" description="Features follow what PayPal offers in your account's country.">
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ minWidth: { xs: 130, sm: 160 } }}>Account country</Typography>
                  <Chip size="small" label={teacher.country} />
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ minWidth: { xs: 130, sm: 160 } }}>Partial payments</Typography>
                  <Chip size="small" color={teacher.paypalFeatures.partialPayments ? 'success' : 'default'} label={teacher.paypalFeatures.partialPayments ? 'Allowed on invoices' : `Not offered in ${teacher.country}`} />
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ minWidth: { xs: 130, sm: 160 } }}>Connection</Typography>
                  <Chip size="small" color={teacher.integrations.paypal === 'sandbox' ? 'success' : 'warning'} label={teacher.integrations.paypal === 'sandbox' ? 'PayPal sandbox' : 'Mock (no keys)'} />
                </Stack>
              </Stack>
            </Section>

            {teacher.demoMode && (
              <Section title="Demo" description={`This is a demo account with sample ${w.families} and ${w.classes}.`}>
                <Alert severity="info" action={<Button color="inherit" startIcon={<RestartAlt />} onClick={resetDemo} loading={reset.isPending}>Reset</Button>}>
                  Reset rebuilds the demo around today&apos;s date.
                </Alert>
              </Section>
            )}
          </Stack>
        </Grid>
      </Grid>
    </>
  );
}
