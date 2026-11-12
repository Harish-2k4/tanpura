import { useState } from 'react';
import type { SessionView } from '../../../../shared/api';
import type { Student } from '../../../../shared/billing';
import { useUpdateSession } from '../../api/queries';
import { FormDialog } from '../../components/FormDialog';
import { MoneyField, isValidAmount } from '../../components/MoneyField';
import { toast } from '../../components/toast';
import { formatMoney } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

type Props = { session: SessionView; student: Student; open: boolean; onClose: () => void };

// Sets a price for one class (e.g. a longer recital rehearsal). Blank uses the student's rate.
export function PriceDialog({ session, student, open, onClose }: Props) {
  const w = useWords();
  const [value, setValue] = useState(session.price?.toString() ?? '');
  const update = useUpdateSession();
  const price = value.trim() === '' ? null : Number(value);

  return (
    <FormDialog
      open={open}
      title={`Price for this ${w.class}`}
      description={`Leave blank to use ${student.name.split(' ')[0]}'s usual rate of ${formatMoney(student.rate, student.currency)}. Only ${w.classes} not billed yet change.`}
      busy={update.isPending}
      submitDisabled={!isValidAmount(value, true)}
      onClose={onClose}
      onSubmit={() =>
        update.mutate(
          { id: session.id, patch: { price } },
          {
            onSuccess: () => {
              toast.success(price === null ? `This ${w.class} uses the usual rate again` : `Price set to ${formatMoney(price, student.currency)}`);
              onClose();
            },
          },
        )
      }
    >
      <MoneyField label="Price" value={value} onChange={setValue} currency={student.currency} optional autoFocus />
    </FormDialog>
  );
}
