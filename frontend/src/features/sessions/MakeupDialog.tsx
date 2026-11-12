import { useState } from 'react';
import type { SessionView } from '../../../../shared/api';
import { useBookMakeup } from '../../api/queries';
import { FormDialog } from '../../components/FormDialog';
import { DateTimeField } from '../../components/pickers';
import { toast } from '../../components/toast';
import { formatDateTime } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

const DAY_MS = 86_400_000;

// Suggests the same time of day, two days later, moved forward until it is in the future.
function suggestedStart(session: SessionView): string {
  let start = Date.parse(session.start) + 2 * DAY_MS;
  while (start <= Date.now()) start += DAY_MS;
  return new Date(start).toISOString();
}

type Props = { session: SessionView; timeZone: string; open: boolean; onClose: () => void; onBooked?: (makeup: SessionView) => void };

export function MakeupDialog({ session, timeZone, open, onClose, onBooked }: Props) {
  const w = useWords();
  const [start, setStart] = useState<string | null>(() => suggestedStart(session));
  const book = useBookMakeup();

  return (
    <FormDialog
      open={open}
      title={`Book a ${w.makeup} for ${session.studentName.split(' ')[0]}`}
      description={`Replaces the ${w.class} on ${formatDateTime(session.start, timeZone)}. The bill counts it once: no extra charge, no credit.`}
      submitText={`Book ${w.makeup}`}
      busy={book.isPending}
      submitDisabled={!start}
      onClose={onClose}
      onSubmit={() =>
        start &&
        book.mutate(
          { id: session.id, start },
          {
            onSuccess: (makeup) => {
              toast.success(`${w.Makeup} booked for ${formatDateTime(makeup.start, timeZone)}`);
              onBooked?.(makeup);
              onClose();
            },
          },
        )
      }
    >
      <DateTimeField label={w.Makeup} value={start} onChange={setStart} timeZone={timeZone} helperText={`${session.minutes} minutes, times in ${timeZone}`} />
    </FormDialog>
  );
}
