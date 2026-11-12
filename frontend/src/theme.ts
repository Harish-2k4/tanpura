import { createTheme, type PaletteMode, type Theme } from '@mui/material/styles';

const LIGHT = {
  primary: { main: '#0070E0', dark: '#003087', contrastText: '#FFFFFF' },
  secondary: { main: '#001C64' },
  success: { main: '#00875A' },
  warning: { main: '#B25E09' },
  error: { main: '#C2253D' },
  background: { default: '#F5F7FA', paper: '#FFFFFF' },
  text: { primary: '#001435', secondary: '#545D68' },
  divider: '#DBE1E8',
};

const DARK = {
  primary: { main: '#5AA9FF', dark: '#2F7FD8', contrastText: '#06121F' },
  secondary: { main: '#B9CCFF' },
  success: { main: '#4CC38A' },
  warning: { main: '#F0B04A' },
  error: { main: '#FF6B81' },
  background: { default: '#0E141B', paper: '#161E27' },
  text: { primary: '#E6EDF5', secondary: '#9AA8B6' },
  divider: '#2A3541',
};

export function buildTheme(mode: PaletteMode): Theme {
  return createTheme({
    palette: { mode, ...(mode === 'dark' ? DARK : LIGHT) },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
      h4: { fontWeight: 700, letterSpacing: '-0.01em' },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { fontVariantNumeric: 'tabular-nums' } } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiTableCell: {
        styleOverrides: {
          head: ({ theme }) => ({ fontWeight: 600, color: theme.palette.text.secondary, whiteSpace: 'nowrap' }),
        },
      },
      MuiTooltip: { defaultProps: { arrow: true } },
    },
  });
}
