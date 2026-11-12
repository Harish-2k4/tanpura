// The words for the people and sessions being billed, from the user's profession setting.
import { useMemo } from 'react';
import { cap, wordsFor, type Words } from '../../../shared/words';
import { useTeacher } from '../api/queries';

export type UiWords = Words & { Student: string; Students: string; Class: string; Classes: string; Family: string; Families: string; Parent: string; Makeup: string; Pro: string };

// The same object while the profession stays the same, so it is safe in effect and memo deps.
export function useWords(): UiWords {
  const profession = useTeacher().data?.profession;
  return useMemo(() => {
    const w = wordsFor(profession);
    return {
      ...w,
      Student: cap(w.student),
      Students: cap(w.students),
      Class: cap(w.class),
      Classes: cap(w.classes),
      Family: cap(w.family),
      Families: cap(w.families),
      Parent: cap(w.parent),
      Makeup: cap(w.makeup),
      Pro: cap(w.pro),
    };
  }, [profession]);
}
