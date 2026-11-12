// AG Studio theme matching the app's MUI theme (same colours and font, light or dark).
import type { Theme } from '@mui/material/styles';
import { studioTheme } from 'ag-studio';

export function studioThemeFor({ palette }: Theme) {
  return studioTheme.withParams({
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
    fontSize: 14,
    textColor: palette.text.primary,
    foregroundColor: palette.text.primary,
    subtleTextColor: palette.text.secondary,
    backgroundColor: palette.background.paper,
    borderColor: palette.divider,
    accentColor: palette.primary.main,
    studioWrapperBorder: false,
    studioCanvasBackgroundColor: palette.background.default,
    studioWrapperBackgroundColor: palette.background.default,
  });
}
