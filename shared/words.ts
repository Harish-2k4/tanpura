// The words the app uses for the people and sessions it bills, per profession. The billing works
// the same for anyone who bills by the session; only the vocabulary changes.
export const PROFESSIONS = ['teaching', 'client_sessions'] as const;
export type Profession = (typeof PROFESSIONS)[number];

export type Words = {
  profession: string; // the choice shown at first sign-in
  examples: string; // who it suits, shown under the choice
  who: string; // the user, in a sentence: 'a teacher'
  student: string; // the person who attends
  students: string;
  class: string; // one booked session
  classes: string;
  family: string; // who is billed
  families: string;
  parent: string; // the person who pays and gets the invoice
  makeup: string; // a session that replaces a missed one
  makeups: string;
  pro: string; // the user
};

export const WORDS: Record<Profession, Words> = {
  teaching: {
    profession: 'Teaching',
    examples: 'Music, tutoring, dance, languages: a student attends, a family pays.',
    who: 'an independent teacher',
    student: 'student',
    students: 'students',
    class: 'class',
    classes: 'classes',
    family: 'family',
    families: 'families',
    parent: 'parent',
    makeup: 'makeup class',
    makeups: 'makeup classes',
    pro: 'teacher',
  },
  client_sessions: {
    profession: 'Client sessions',
    examples: 'Therapy, coaching, fitness, consulting: the client attends and pays.',
    who: 'an independent professional who runs client sessions',
    student: 'client',
    students: 'clients',
    class: 'session',
    classes: 'sessions',
    family: 'client',
    families: 'clients',
    parent: 'billing contact',
    makeup: 'makeup session',
    makeups: 'makeup sessions',
    pro: 'practitioner',
  },
};

export const wordsFor = (profession: Profession | undefined): Words => WORDS[profession ?? 'teaching'] ?? WORDS.teaching;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
