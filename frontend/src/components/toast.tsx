// Toast notifications on MUI Snackbar + Alert. Call `toast.success(...)` from anywhere,
// including outside React (e.g. the React Query error handler). One shows at a time.
import Alert, { type AlertColor } from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { useEffect, useState, type ReactNode } from 'react';

type Toast = { id: number; message: ReactNode; severity: AlertColor };

const listeners = new Set<(t: Toast) => void>();
let nextId = 1;
const emit = (severity: AlertColor) => (message: ReactNode) => listeners.forEach((l) => l({ id: nextId++, message, severity }));

export const toast = { success: emit('success'), error: emit('error'), info: emit('info'), warning: emit('warning') };

const DURATION: Record<AlertColor, number> = { success: 4000, info: 5000, warning: 7000, error: 7000 };

export function Toaster() {
  const [queue, setQueue] = useState<Toast[]>([]);
  const [open, setOpen] = useState(false);
  const current = queue[0];

  useEffect(() => {
    const add = (t: Toast) => setQueue((q) => [...q, t]);
    listeners.add(add);
    return () => void listeners.delete(add);
  }, []);
  useEffect(() => setOpen(Boolean(current)), [current]);

  return (
    <Snackbar
      key={current?.id}
      open={open}
      autoHideDuration={current ? DURATION[current.severity] : null}
      onClose={(_, reason) => reason !== 'clickaway' && setOpen(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{ transition: { onExited: () => setQueue((q) => q.slice(1)) } }}
    >
      {current ? (
        <Alert variant="filled" severity={current.severity} onClose={() => setOpen(false)} sx={{ minWidth: 300, alignItems: 'center' }}>
          {current.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
