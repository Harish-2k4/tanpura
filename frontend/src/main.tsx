import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, setUnauthorizedHandler } from './api/client';
import { keys } from './api/queries';
import { App } from './App';
import { ColorModeProvider } from './components/ColorMode';
import { ConfirmProvider } from './components/ConfirmDialog';
import { Toaster, toast } from './components/toast';
import './lib/dayjs';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Don't retry what the server rejected on purpose.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
  // Every failed action shows a toast, unless the screen handles the error itself.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (!mutation.meta?.silent) toast.error(error.message);
    },
  }),
});

// A 401 anywhere means the session ended: show the sign-in page.
setUnauthorizedHandler(() => queryClient.setQueryData(keys.me, null));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorModeProvider>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en-gb">
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>
            <App />
            <Toaster />
          </ConfirmProvider>
        </QueryClientProvider>
      </LocalizationProvider>
    </ColorModeProvider>
  </StrictMode>,
);
