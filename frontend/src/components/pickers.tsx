// Date pickers with the app's formats. Values are plain strings, never Date objects:
// months as YYYY-MM, dates as YYYY-MM-DD, date-times as ISO instants.
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import type { Dayjs } from 'dayjs';
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

export function DateTimeField({ value, onChange, label, timeZone, minutesStep = 15, disablePast, helperText, error }: DateTimeProps) {
  return (
    <DateTimePicker
      label={label}
      ampm
      timezone={timeZone}
      minutesStep={minutesStep}
      disablePast={disablePast}
      format="ddd D MMM YYYY, h:mm a"
      value={value ? dayjs(value).tz(timeZone) : null}
      // The value is taken only on OK (or on picking the last part); Cancel or Esc keeps the old one.
      closeOnSelect={false}
      onAccept={(v) => onChange(valid(v) ? v.toISOString() : null)}
      onChange={(v, ctx) => {
        // Typing in the field still works directly.
        if (!ctx.validationError && valid(v) && document.activeElement?.closest('.MuiPickersInputBase-root')) onChange(v.toISOString());
      }}
      slotProps={{ textField: { fullWidth: true, helperText, error }, actionBar: { actions: ['cancel', 'accept'] } }}
    />
  );
}
