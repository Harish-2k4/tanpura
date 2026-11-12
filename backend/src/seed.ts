// Demo data built around the real current date: two months of history, this month,
// next month's schedule, and the invoice history (billed in advance, built by the engine).
// Deterministic for a given date.
import { buildDraft, endMs, type InvoiceRecord, type Session, type SessionStatus, type Slot, type Student } from '../../shared/billing';
import { DEFAULT_POLICY, type Teacher } from '../../shared/settings';
import type { Profession } from '../../shared/words';
import { addDays, addMonths, eachDay, lastDayOfMonth, monthOfDate, todayIn, wallTimeToIso, weekdayOf } from '../../shared/time';
import type { Dataset } from './store';

const TZ = 'Asia/Kolkata';

type Country = 'US' | 'UK' | 'AU'; // the demo families live here
const FAMILY_TZ: Record<Country, string> = { US: 'America/New_York', UK: 'Europe/London', AU: 'Australia/Sydney' };
const CURRENCY = { US: 'USD', UK: 'GBP', AU: 'AUD' } as const;
// IST start times that fall in the family's evening or weekend morning.
const TIMES: Record<Country, string[]> = {
  US: ['05:30', '06:30', '19:30', '20:30'],
  UK: ['22:00', '23:00', '15:30', '16:30'],
  AU: ['11:30', '12:30', '13:30', '14:30'],
};

// name, parent (who pays), country, rate per class, class length, classes per week
type Roster = [string, string, Country, number, number, number][];
const MUSIC_ROSTER: Roster = [
  ['Aarav Iyer', 'Priya Iyer', 'US', 30, 45, 1],
  ['Meera Krishnan', 'Sangeetha Krishnan', 'UK', 25, 45, 2],
  ['Diya Raman', 'Suresh Raman', 'US', 35, 60, 1],
  ['Arjun Subramanian', 'Kavitha Subramanian', 'AU', 40, 45, 1],
  ['Ananya Venkatesh', 'Ravi Venkatesh', 'US', 30, 45, 2],
  ['Rohan Nair', 'Deepa Nair', 'UK', 28, 45, 1],
  ['Ishaan Rao', 'Anitha Rao', 'AU', 45, 60, 2],
  ['Saanvi Menon', 'Vinod Menon', 'US', 30, 45, 1],
  ['Kavya Sundaram', 'Meena Sundaram', 'UK', 25, 45, 1],
  ['Aditya Balaji', 'Gayathri Balaji', 'US', 40, 60, 1],
  ['Nila Murthy', 'Karthik Murthy', 'AU', 40, 45, 2],
  ['Vihaan Pillai', 'Shalini Pillai', 'UK', 30, 60, 1],
  ['Tara Ganesan', 'Ramesh Ganesan', 'US', 30, 45, 1],
  ['Krish Chandran', 'Uma Chandran', 'AU', 40, 45, 1],
  ['Avani Shankar', 'Hari Shankar', 'UK', 25, 45, 2],
  ['Dhruv Natarajan', 'Revathi Natarajan', 'US', 35, 45, 1],
  ['Shreya Mohan', 'Arun Mohan', 'AU', 50, 60, 1],
  ['Kabir Srinivasan', 'Lalitha Srinivasan', 'US', 30, 45, 1],
  ['Pooja Ramesh', 'Mohan Ramesh', 'UK', 25, 45, 2],
  ['Siddharth Gopal', 'Vani Gopal', 'AU', 40, 45, 1],
];

// Adults abroad in online therapy; most pay for themselves, a few through a partner or employer.
const THERAPY_ROSTER: Roster = [
  ['Anjali Sharma', 'Anjali Sharma', 'US', 90, 50, 1],
  ['Rahul Mehta', 'Rahul Mehta', 'UK', 70, 50, 2],
  ['Neha Kapoor', 'Neha Kapoor', 'US', 100, 50, 1],
  ['Vikram Rao', 'Vikram Rao', 'AU', 120, 50, 1],
  ['Sneha Reddy', 'Arvind Reddy', 'US', 90, 50, 2],
  ['Karan Malhotra', 'Karan Malhotra', 'UK', 75, 50, 1],
  ['Priyanka Das', 'Priyanka Das', 'AU', 130, 50, 1],
  ['Aditi Joshi', 'Aditi Joshi', 'US', 95, 50, 1],
  ['Manish Gupta', 'Manish Gupta', 'UK', 70, 50, 1],
  ['Ritu Bansal', 'Ritu Bansal', 'US', 110, 50, 1],
  ['Sameer Khan', 'Sameer Khan', 'AU', 120, 50, 1],
  ['Divya Menon', 'Ajay Menon', 'UK', 80, 50, 1],
  ['Arjun Bhatia', 'Arjun Bhatia', 'US', 90, 50, 1],
  ['Lakshmi Pillai', 'Lakshmi Pillai', 'AU', 120, 50, 1],
  ['Rohit Saxena', 'Rohit Saxena', 'UK', 75, 50, 2],
  ['Isha Verma', 'Isha Verma', 'US', 100, 50, 1],
  ['Nikhil Jain', 'Nikhil Jain', 'AU', 140, 80, 1],
  ['Pallavi Rao', 'Pallavi Rao', 'US', 90, 50, 1],
  ['Tanvi Shah', 'Tanvi Shah', 'UK', 70, 50, 1],
  ['Aman Arora', 'Aman Arora', 'AU', 120, 50, 1],
];

const PERSONA: Record<Profession, { name: string; city: string; roster: Roster; notes: { unwell: string; busy: string; late: string; special: string; specialPrice: number } }> = {
  teaching: {
    name: 'Lakshmi Raghavan',
    city: 'Coimbatore',
    roster: MUSIC_ROSTER,
    notes: { unwell: 'Teacher unwell', busy: 'Exam week', late: 'Cancelled 2 hours before', special: 'Recital rehearsal (90 min)', specialPrice: 55 },
  },
  client_sessions: {
    name: 'Meera Iyer',
    city: 'Bengaluru',
    roster: THERAPY_ROSTER,
    notes: { unwell: 'Therapist unwell', busy: 'Work travel', late: 'Cancelled 2 hours before', special: 'Extended session (90 min)', specialPrice: 150 },
  },
};

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (date: string, time: string) => wallTimeToIso(date, time, TZ);
const startOfDay = (date: string) => Date.parse(at(date, '00:00'));

export function generateDemoData(now = new Date(), opts: { buyerEmail?: string; profession?: Profession } = {}): Dataset {
  // Without a work type the data is the teaching set, and the app asks for the work type at first sign-in.
  const persona = PERSONA[opts.profession ?? 'teaching'];
  const rand = prng(42);
  const nowMs = now.getTime();
  const today = todayIn(TZ, now);
  const current = monthOfDate(today);
  const from = `${addMonths(current, -2)}-01`;
  const to = lastDayOfMonth(addMonths(current, 1));

  const teacher: Teacher = {
    name: persona.name,
    city: persona.city,
    country: 'IN',
    timezone: TZ,
    billingMode: 'advance',
    attendance: 'auto',
    policy: DEFAULT_POLICY,
    paymentTermDays: 10,
    scheduledUntil: to,
    ...(opts.profession && { profession: opts.profession }),
  };

  // Weekly slots, never two students at the same weekday and time.
  const taken = new Set<string>();
  const students: Student[] = persona.roster.map(([name, parent, country, rate, minutes, perWeek], i) => {
    const slots: Slot[] = [];
    for (let k = 0; slots.length < perWeek && k < 28; k++) {
      const weekday = (i * 2 + k * 3) % 7;
      const time = TIMES[country][(i + k) % TIMES[country].length];
      if (taken.has(`${weekday}-${time}`)) continue;
      taken.add(`${weekday}-${time}`);
      slots.push({ weekday, time, minutes });
    }
    const id = `s${String(i + 1).padStart(2, '0')}`;
    const email = id === 's01' && opts.buyerEmail ? opts.buyerEmail : `${parent.toLowerCase().replace(/ /g, '.')}@example.com`;
    return { id, name, parent: { name: parent, email }, country, timezone: FAMILY_TZ[country], currency: CURRENCY[country], rate, slots };
  });

  const sessions: Session[] = [];
  let nextId = 1;
  const newId = () => `c${String(nextId++).padStart(4, '0')}`;

  function randomStatus(): SessionStatus {
    const r = rand();
    if (r < 0.05) return 'cancelled_student';
    if (r < 0.07) return 'cancelled_late';
    if (r < 0.09) return 'no_show';
    if (r < 0.11) return 'cancelled_teacher';
    return 'attended';
  }

  for (const st of students) {
    for (const date of eachDay(from, to)) {
      for (const slot of st.slots.filter((s) => s.weekday === weekdayOf(date))) {
        const s: Session = { id: newId(), studentId: st.id, start: at(date, slot.time), minutes: slot.minutes, status: 'scheduled' };
        // Past classes are marked; the last three days are left to automatic attendance.
        if (endMs(s) <= nowMs) {
          const status = randomStatus();
          if (status !== 'attended' || date < addDays(today, -3)) s.status = status;
        }
        sessions.push(s);
      }
    }
  }

  const clashes = (start: string, minutes: number) => {
    const a = Date.parse(start);
    const b = a + minutes * 60_000;
    return sessions.some((s) => !s.status.startsWith('cancelled') && Date.parse(s.start) < b && endMs(s) > a);
  };
  // Books a makeup 1-4 days after the missed class, at a free time.
  function bookMakeup(of: Session, times: string[]) {
    const date = of.start.slice(0, 10);
    for (let d = 1; d <= 4; d++) {
      for (const time of times) {
        const start = at(addDays(date, d), time);
        if (clashes(start, of.minutes)) continue;
        const m: Session = { id: newId(), studentId: of.studentId, start, minutes: of.minutes, status: 'scheduled', makeupFor: of.id };
        if (endMs(m) <= nowMs) m.status = 'attended';
        sessions.push(m);
        return;
      }
    }
  }
  const studentOf = (id: string) => students.find((s) => s.id === id)!;

  // Teacher cancellations always get a makeup; most notice cancellations do too.
  for (const s of [...sessions]) {
    if (s.status === 'cancelled_teacher' || (s.status === 'cancelled_student' && rand() < 0.7)) {
      bookMakeup(s, [s.start.slice(11, 16), ...TIMES[studentOf(s.studentId).country as Country]]);
    }
  }

  // Scripted demo cases since this month's bill (or the last four weeks early in a month).
  const windowStart = [`${current}-01`, addDays(today, -28)];
  const recent = (studentId: string, count: number) => {
    for (const start of windowStart) {
      const list = sessions.filter((s) => s.studentId === studentId && !s.makeupFor && s.start.slice(0, 10) >= start && endMs(s) <= nowMs);
      if (list.length >= count) return list.slice(-count); // the latest ones, so they fall after this month's bill
    }
    return [];
  };
  // Removes a class's makeup chain (scripted cases replace whatever random history it had).
  const dropMakeups = (id: string) => {
    for (const m of sessions.filter((s) => s.makeupFor === id)) {
      dropMakeups(m.id);
      sessions.splice(sessions.indexOf(m), 1);
    }
  };
  const script = (studentId: string, count: number, status: SessionStatus, note?: string, makeup?: boolean) => {
    for (const s of recent(studentId, count)) {
      dropMakeups(s.id);
      s.status = status;
      if (note) s.note = note;
      if (makeup) bookMakeup(s, [...TIMES[studentOf(studentId).country as Country], s.start.slice(11, 16)]);
    }
  };
  script('s01', 1, 'cancelled_teacher', persona.notes.unwell); // Aarav: never made up -> credit
  script('s02', 3, 'cancelled_student', persona.notes.busy, true); // Meera: three makeups -> flag
  script('s19', 2, 'no_show'); // Pooja: two no-shows -> charged, waivable
  script('s06', 1, 'cancelled_late', persona.notes.late); // Rohan: late cancellation

  // A special class with its own price next month.
  const special = sessions.find((s) => s.studentId === 's05' && !s.makeupFor && s.start.startsWith(addMonths(current, 1)));
  if (special) {
    const end = Date.parse(special.start) + 90 * 60_000;
    const free = !sessions.some((s) => s !== special && Date.parse(s.start) < end && endMs(s) > Date.parse(special.start));
    if (free) Object.assign(special, { minutes: 90, price: persona.notes.specialPrice, note: persona.notes.special });
  }

  sessions.sort((a, b) => a.start.localeCompare(b.start) || a.studentId.localeCompare(b.studentId));

  // What the data looked like at `instant`: later classes not yet happened,
  // and no makeups yet for classes that had not yet happened.
  function asOf(instant: number): Session[] {
    const future = new Set(sessions.filter((s) => Date.parse(s.start) >= instant && !s.makeupFor).map((s) => s.id));
    return sessions
      .filter((s) => !(s.makeupFor && future.has(s.makeupFor)))
      .map((s) => (Date.parse(s.start) >= instant ? { ...s, status: 'scheduled' as const, waived: undefined } : s));
  }

  // Invoice history: issued on the 1st of each month, billed in advance.
  const invoices: InvoiceRecord[] = [];
  const unpaid: Record<string, string[]> = { [addMonths(current, -1)]: ['s19'], [current]: ['s06', 's13', 's19'] };
  for (let month = addMonths(current, -2); month <= current; month = addMonths(month, 1)) {
    const issued = `${month}-01`;
    const instant = startOfDay(issued);
    const snapshot = asOf(instant);
    for (const st of students) {
      const draft = buildDraft({ student: st, sessions: snapshot, invoices, teacher, month, today: issued, now: new Date(instant).toISOString() });
      if (!draft.sendable) continue;
      const isUnpaid = unpaid[month]?.includes(st.id);
      const paidOn = addDays(issued, 1 + Math.floor(rand() * 8));
      invoices.push({
        id: `MOCK-${st.id}-${month}-1`,
        studentId: st.id,
        month,
        currency: draft.currency,
        total: draft.total,
        entries: draft.entries,
        status: isUnpaid ? 'SENT' : 'PAID',
        issuedAt: issued,
        dueDate: addDays(issued, teacher.paymentTermDays),
        ...(isUnpaid ? {} : { paidAt: paidOn < today ? paidOn : today }),
        mock: true,
      });
    }
  }

  return { teacher, students, sessions, invoices };
}
