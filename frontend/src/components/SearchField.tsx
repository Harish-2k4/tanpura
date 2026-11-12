// A search box with a clear button. The parent owns the text and debounces it.
import Clear from '@mui/icons-material/Clear';
import Search from '@mui/icons-material/Search';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';

type Props = { value: string; onChange: (value: string) => void; placeholder: string; label?: string; width?: number | string };

export function SearchField({ value, onChange, placeholder, label = 'Search', width = 280 }: Props) {
  return (
    <TextField
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      sx={{ width: { xs: '100%', sm: width } }}
      slotProps={{
        htmlInput: { 'aria-label': label, maxLength: 100 },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Search fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => onChange('')} aria-label="Clear search" edge="end">
                <Clear fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}
