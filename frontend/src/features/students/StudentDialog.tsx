// Add a student, or edit one: who they are, who pays, where they live, the rate and weekly times.
// Weekly times are in the teacher's zone; the family's local time is shown next to each.
import Add from '@mui/icons-material/Add';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { TeacherView } from '../../../../shared/api';
import type { Slot, Student } from '../../../../shared/billing';
import { COUNTRIES, REGIONS, type Country } from '../../../../shared/regions';
import { studentInputSchema, type StudentInput } from '../../../../shared/schemas';
import { useSaveStudent } from '../../api/queries';
import { FormDialog } from '../../components/FormDialog';
import { MoneyField, isValidAmount } from '../../components/MoneyField';
import { toast } from '../../components/toast';
import { useWords } from '../../hooks/useWords';
import dayjs from '../../lib/dayjs';
import { plural } from '../../lib/format';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LENGTHS = [30, 45, 50, 60, 75, 90, 120];

type Props = { student?: Student; teacher: TeacherView; onClose: () => void };

export function StudentDialog({ student, teacher, onClose }: Props) {
  const w = useWords();
  const save = useSaveStudent();
  const clientMode = w.family === w.student;
  const [name, setName] = useState(student?.name ?? '');
  const [selfPay, setSelfPay] = useState(student ? student.parent.name === student.name : clientMode);
  const [parentName, setParentName] = useState(student?.parent.name ?? '');
  const [email, setEmail] = useState(student?.parent.email ?? '');
  const [country, setCountry] = useState<Country>(student?.country ?? 'US');
  const [timezone, setTimezone] = useState(student?.timezone ?? REGIONS.US.zones[0].id);
  const [rate, setRate] = useState(student ? String(student.rate) : '');
  const [slots, setSlots] = useState<Slot[]>(student?.slots ?? [{ weekday: 6, time: '18:00', minutes: 45 }]);
  const [touched, setTouched] = useState(false);

  const input: StudentInput = {
    name: name.trim(),
    parent: { name: (selfPay ? name : parentName).trim(), email: email.trim() },
    country,
    timezone,
    rate: Number(rate),
    slots,
  };
  const parsed = studentInputSchema.safeParse(input);
  const problems = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
  const show = (key: string) => (touched ? problems[key] : undefined);
  const valid = parsed.success && isValidAmount(rate);

  const setSlot = (i: number, patch: Partial<Slot>) => setSlots((all) => all.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const first = name.trim().split(' ')[0];

  // "Sat 6:00 pm" for the family, for a slot in the teacher's zone.
  const familyTime = (slot: Slot) => {
    let date = dayjs.tz(teacher.today, teacher.timezone);
    while (date.day() !== slot.weekday) date = date.add(1, 'day');
    const start = dayjs.tz(`${date.format('YYYY-MM-DD')} ${slot.time}`, teacher.timezone);
    return start.tz(timezone).format('ddd h:mm a');
  };

  return (
    <FormDialog
      open
      maxWidth="sm"
      title={student ? `Edit ${student.name}` : `Add a ${w.student}`}
      submitText={student ? 'Save' : `Add ${w.student}`}
      busy={save.isPending}
      submitDisabled={touched && !valid}
      onClose={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!valid) return;
        save.mutate(
          { id: student?.id, input },
          {
            onSuccess: (r) => {
              toast.success(student ? `${input.name} saved${r.moved ? `. ${plural(r.moved, w.class, w.classes)} set to the new times` : ''}` : `${input.name} added, with weekly ${w.classes} on the calendar`);
              onClose();
            },
          },
        );
      }}
    >
      <TextField label={`${w.Student} name`} value={name} onChange={(e) => setName(e.target.value)} error={Boolean(show('name'))} helperText={show('name')} fullWidth autoFocus slotProps={{ htmlInput: { maxLength: 80 } }} />
      <FormControlLabel control={<Checkbox checked={selfPay} onChange={(e) => setSelfPay(e.target.checked)} />} label={first ? `${first} pays for themselves` : 'They pay for themselves'} />
      {!selfPay && (
        <TextField label={`${w.Parent} name`} value={parentName} onChange={(e) => setParentName(e.target.value)} error={Boolean(show('parent.name'))} helperText={show('parent.name')} fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
      )}
      <TextField
        label="Email for invoices"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={Boolean(show('parent.email'))}
        helperText={show('parent.email') ?? 'PayPal sends invoices and reminders here.'}
        fullWidth
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label="Country"
          value={country}
          onChange={(e) => {
            const c = e.target.value as Country;
            setCountry(c);
            setTimezone(REGIONS[c].zones[0].id);
          }}
          helperText={`Billed in ${REGIONS[country].currency}`}
          fullWidth
        >
          {COUNTRIES.map((c) => (
            <MenuItem key={c} value={c}>
              {REGIONS[c].label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)} fullWidth disabled={REGIONS[country].zones.length === 1}>
          {REGIONS[country].zones.map((z) => (
            <MenuItem key={z.id} value={z.id}>
              {z.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <MoneyField label={`Rate per ${w.class}`} value={rate} onChange={setRate} currency={REGIONS[country].currency} quietWhenEmpty={!touched} />

      <Typography variant="subtitle2">Weekly {w.classes} (your time)</Typography>
      {slots.map((slot, i) => (
        <Stack key={i} direction="row" useFlexGap spacing={1} sx={{ alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
          <TextField select label="Day" value={slot.weekday} onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })} sx={{ minWidth: 0, flex: { xs: '1 1 100%', sm: 1.3 } }}>
            {WEEKDAYS.map((d, k) => (
              <MenuItem key={d} value={k}>
                {d}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Start"
            type="time"
            value={slot.time}
            onChange={(e) => e.target.value && setSlot(i, { time: e.target.value })}
            helperText={familyTime(slot)}
            sx={{ minWidth: 0, flex: 1.2 }}
            slotProps={{ htmlInput: { step: 900 } }}
          />
          <TextField select label="Minutes" value={slot.minutes} onChange={(e) => setSlot(i, { minutes: Number(e.target.value) })} sx={{ minWidth: 0, flex: 1 }}>
            {[...new Set([...LENGTHS, slot.minutes])].sort((a, b) => a - b).map((m) => (
              <MenuItem key={m} value={m}>
                {m}
              </MenuItem>
            ))}
          </TextField>
          <IconButton aria-label="Remove this time" onClick={() => setSlots((all) => all.filter((_, k) => k !== i))} disabled={slots.length === 1} sx={{ mt: 1 }}>
            <DeleteOutlined fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      {show('slots') && <Alert severity="error">{show('slots')}</Alert>}
      <Button startIcon={<Add />} onClick={() => setSlots((all) => [...all, { weekday: (all.at(-1)?.weekday ?? 5) + 1 > 6 ? 0 : (all.at(-1)?.weekday ?? 5) + 1, time: all.at(-1)?.time ?? '18:00', minutes: all.at(-1)?.minutes ?? 45 }])} disabled={slots.length >= 7} sx={{ alignSelf: 'flex-start' }}>
        Add a weekly time
      </Button>
      {student && (
        <Typography variant="body2" color="text.secondary">
          New times apply to {w.classes} not billed yet. {w.Classes} on an invoice already sent keep their time.
        </Typography>
      )}
    </FormDialog>
  );
}
