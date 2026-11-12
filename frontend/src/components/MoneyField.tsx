// An amount input with the currency shown and the same rules the API applies.
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import type { Currency } from '../../../shared/billing';
import { priceSchema } from '../../../shared/schemas';

// `value` as typed; blank is valid only when `optional`.
export function isValidAmount(value: string, optional = false): boolean {
  if (value.trim() === '') return optional;
  return priceSchema.safeParse(Number(value)).success;
}

type Props = { label: string; value: string; onChange: (value: string) => void; currency: Currency; optional?: boolean; helperText?: string; autoFocus?: boolean; quietWhenEmpty?: boolean };

// `quietWhenEmpty`: a blank required field shows no error until the form is submitted.
export function MoneyField({ label, value, onChange, currency, optional, helperText = ' ', autoFocus, quietWhenEmpty }: Props) {
  const invalid = !isValidAmount(value, optional) && !(quietWhenEmpty && value.trim() === '');
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={invalid}
      helperText={invalid ? 'Enter a positive amount with at most 2 decimals' : helperText}
      autoFocus={autoFocus}
      fullWidth
      slotProps={{
        input: { startAdornment: <InputAdornment position="start">{currency}</InputAdornment> },
        htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' },
      }}
    />
  );
}
