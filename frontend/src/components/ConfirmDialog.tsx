// A promise-based confirmation dialog: `if (await confirm({ title })) { ... }`.
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void }>();
  const [open, setOpen] = useState(false);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise((resolve) => {
        setRequest({ options, resolve });
        setOpen(true);
      }),
    [],
  );
  const answer = (ok: boolean) => {
    request?.resolve(ok);
    setOpen(false);
  };
  const options = request?.options;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onClose={() => answer(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{options?.title}</DialogTitle>
        {options?.message && (
          <DialogContent>
            {typeof options.message === 'string' ? <Typography color="text.secondary">{options.message}</Typography> : options.message}
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => answer(false)}>{options?.cancelText ?? 'Cancel'}</Button>
          <Button variant="contained" color={options?.tone === 'danger' ? 'error' : 'primary'} onClick={() => answer(true)} autoFocus>
            {options?.confirmText ?? 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider');
  return confirm;
}
