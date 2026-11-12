// Calendar-date helpers. Dates are plain strings: YYYY-MM-DD for days, YYYY-MM for months.
// Session times are ISO strings carrying the teacher's UTC offset, e.g. 2026-11-12T18:00:00+05:30.

const pad = (n: number) => String(n).padStart(2, '0');

// Date, time and UTC offset of an instant as seen in `timeZone`.
export function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, offset };
}

// ISO string for an instant in `timeZone`, with that zone's offset.
export function localIso(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.date}T${p.time}:00${p.offset}`;
}

export const todayIn = (timeZone: string, now = new Date()) => zonedParts(now, timeZone).date;

// ISO string for a wall-clock date and time in `timeZone`, e.g. ('2026-11-12', '18:00', 'Asia/Kolkata')
// -> '2026-11-12T18:00:00+05:30'. Corrects twice so daylight-saving changes land right.
export function wallTimeToIso(date: string, time: string, timeZone: string): string {
  const wanted = Date.parse(`${date}T${time}:00Z`);
  let instant = wanted;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(instant), timeZone);
    instant += wanted - Date.parse(`${p.date}T${p.time}:00Z`);
  }
  return localIso(new Date(instant), timeZone);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const monthOfDate = (date: string) => date.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export const prevMonth = (month: string) => addMonths(month, -1);
export const nextMonth = (month: string) => addMonths(month, 1);

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function lastDayOfMonth(month: string): string {
  return addDays(`${nextMonth(month)}-01`, -1);
}

// Weekday (0 = Sunday) of a calendar date.
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

// Every date from `from` to `to`, inclusive.
export function* eachDay(from: string, to: string) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}
