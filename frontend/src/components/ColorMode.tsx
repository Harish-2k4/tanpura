// Light or dark mode: follows the system until the user picks one, and remembers the pick.
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, type PaletteMode } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { buildTheme } from '../theme';

const KEY = 'tanpura.colorMode';

function saved(): PaletteMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

type ColorMode = { mode: PaletteMode; toggle: () => void };
const ColorModeContext = createContext<ColorMode | null>(null);

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [picked, setPicked] = useState<PaletteMode | null>(saved);
  const mode: PaletteMode = picked ?? (prefersDark ? 'dark' : 'light');
  const theme = useMemo(() => buildTheme(mode), [mode]);

  const value = useMemo<ColorMode>(
    () => ({
      mode,
      toggle: () => {
        const next = mode === 'dark' ? 'light' : 'dark';
        setPicked(next);
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Storage can be blocked; the choice then lasts until reload.
        }
      },
    }),
    [mode],
  );

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): ColorMode {
  const ctx = useContext(ColorModeContext);
  if (!ctx) throw new Error('useColorMode must be used inside ColorModeProvider');
  return ctx;
}
