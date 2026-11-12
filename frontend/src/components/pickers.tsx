// Date pickers with the app's formats. Values are plain strings, never Date objects:
// months as YYYY-MM, dates as YYYY-MM-DD, date-times as ISO instants.
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import type { Dayjs } from 'dayjs';
import { useRef, useState } from 'react';
import dayjs from '../lib/dayjs';

const valid = (v: Dayjs | null): v is Dayjs => Boolean(v?.isValid());

type MonthProps = { value: string; onChange: (month: string) => void; label?: string; width?: number; min?: string; max?: string };

export function MonthPicker({ value, onChange, label = 'Month', width = 190, min, max }: MonthProps) {
  return (
    <DatePicker
      label={label}
      views={['year', 'month']}
      openTo="month"
      format="MMMM YYYY"
      value={dayjs(`${value}-01`)}
      minDate={min ? dayjs(`${min}-01`) : undefined}
      maxDate={max ? dayjs(`${max}-01`) : undefined}
      onChange={(v) => valid(v) && onChange(v.format('YYYY-MM'))}
      slotProps={{ textField: { size: 'small', sx: { width } } }}
    />
  );
}

type DateProps = { value: string; onChange: (date: string) => void; label: string; min?: string; max?: string; helperText?: string };

export function DateField({ value, onChange, label, min, max, helperText }: DateProps) {
  return (
    <DatePicker
      label={label}
      format="ddd D MMM YYYY"
      value={dayjs(value)}
      minDate={min ? dayjs(min) : undefined}
      maxDate={max ? dayjs(max) : undefined}
      onChange={(v) => valid(v) && onChange(v.format('YYYY-MM-DD'))}
      slotProps={{ textField: { fullWidth: true, helperText } }}
    />
  );
}

type DateTimeProps = {
  value: string | null;
  onChange: (iso: string | null) => void;
  label: string;
  timeZone: string; // shown and picked in this zone
  minutesStep?: number;
  disablePast?: boolean;
  helperText?: string;
  error?: boolean;
};

// Keep the popup on screen (it moves up on short screens), so OK and Cancel are always visible.
const ON_SCREEN = { modifiers: [{ name: 'flip', enabled: true }, { name: 'preventOverflow', options: { altAxis: true, padding: 8 } }] };

// Cancel and OK under the picker. OK keeps the day and time picked; Cancel (or Esc) keeps the old value.
function PickerButtons({ onCancel, onOk, className }: { onCancel?: () => void; onOk?: () => void; className?: string }) {
  return (
    <DialogActions className={className} sx={{ gridColumn: '1 / -1', gridRow: 3 }}>
      <Button onClick={onCancel}>Cancel</Button>
      <Button onClick={onOk}>OK</Button>
    </DialogActions>
  );
}

export function DateTimeField({ value, onChange, label, timeZone, minutesStep = 15, disablePast, helperText, error }: DateTimeProps) {
  const committed = value ? dayjs(value).tz(timeZone) : null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Dayjs | null>(null); // what is picked while the popup is open
  // The picker keeps the buttons it was first given, so they read the latest values through refs.
  const latest = useRef({ draft, onChange });
  latest.current = { draft, onChange };
  const close = useRef(() => setOpen(false)).current;
  const ok = useRef(() => {
    const { draft: picked, onChange: save } = latest.current;
    if (valid(picked)) save(picked.toISOString());
    setOpen(false);
  }).current;
  return (
    <DateTimePicker
      label={label}
      ampm
      timezone={timeZone}
      minutesStep={minutesStep}
      disablePast={disablePast}
      format="ddd D MMM YYYY, h:mm a"
      open={open}
      onOpen={() => {
        setDraft(committed);
        setOpen(true);
      }}
      onClose={close}
      value={open ? draft : committed}
      closeOnSelect={false}
      onChange={(v, ctx) => {
        if (open) setDraft(v);
        else if (!ctx.validationError && valid(v)) onChange(v.toISOString()); // typing in the field
      }}
      slots={{ actionBar: PickerButtons }}
      slotProps={{ textField: { fullWidth: true, helperText, error }, actionBar: { onCancel: close, onOk: ok } as object, popper: ON_SCREEN }}
    />
  );
}
