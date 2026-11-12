// A dialog wrapping a form: Enter submits, the submit button shows progress, and the
// dialog can't be dismissed while saving.
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  submitText?: string;
  busy?: boolean;
  submitDisabled?: boolean;
  tone?: 'default' | 'danger';
  maxWidth?: 'xs' | 'sm' | 'md';
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
};

export function FormDialog({ open, title, description, submitText = 'Save', busy, submitDisabled, tone, maxWidth = 'xs', onClose, onSubmit, children }: Props) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth={maxWidth} fullWidth>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !submitDisabled) onSubmit();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            {description && <Typography color="text.secondary">{description}</Typography>}
            {children}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color={tone === 'danger' ? 'error' : 'primary'} loading={busy} disabled={submitDisabled}>
            {submitText}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
