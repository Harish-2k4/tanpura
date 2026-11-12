// A compact dropdown filter for a table toolbar. '' means no filter.
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { COUNTRIES, REGIONS, type Country } from '../../../shared/regions';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = { label: string; value: T | ''; onChange: (value: T | '') => void; options: Option<T>[]; allLabel?: string; width?: number };

export function SelectFilter<T extends string>({ label, value, onChange, options, allLabel = 'All', width = 160 }: Props<T>) {
  return (
    <TextField select label={label} value={value} onChange={(e) => onChange(e.target.value as T | '')} sx={{ width: { xs: '100%', sm: width } }}>
      <MenuItem value="">{allLabel}</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c, label: REGIONS[c].label }));

export function CountryFilter({ value, onChange }: { value: Country | ''; onChange: (value: Country | '') => void }) {
  return <SelectFilter label="Country" value={value} onChange={onChange} options={COUNTRY_OPTIONS} allLabel="All countries" width={180} />;
}
