// Money received, converted to the teacher's home currency at each payment date's reference rate
// (European Central Bank rates via the free Frankfurter API). Display only: no bill uses it.
import { config } from './config';

const API = 'https://api.frankfurter.dev/v1';
const TIMEOUT_MS = 5_000;

// The currency a PayPal account in this country is paid out in.
const HOME: Record<string, string> = { IN: 'INR', US: 'USD', GB: 'GBP', AU: 'AUD', CA: 'CAD', SG: 'SGD', NZ: 'NZD', DE: 'EUR', FR: 'EUR', IE: 'EUR', NL: 'EUR' };
export const homeCurrency = (country: string): string | undefined => HOME[country.toUpperCase()];

// Past rates never change, so they are kept for the life of the process.
const rates = new Map<string, Promise<number>>();

function rate(date: string, from: string, to: string): Promise<number> {
  if (from === to) return Promise.resolve(1);
  const key = `${date}|${from}|${to}`;
  let hit = rates.get(key);
  if (!hit) {
    hit = (async () => {
      const res = await fetch(`${API}/${date}?base=${from}&symbols=${to}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Rate lookup failed (${res.status})`);
      const value = ((await res.json()) as { rates?: Record<string, number> }).rates?.[to];
      if (typeof value !== 'number' || !(value > 0)) throw new Error('No rate returned');
      return value;
    })();
    hit.catch(() => rates.delete(key)); // try again next time
    rates.set(key, hit);
  }
  return hit;
}

type Received = { date: string; currency: string; gross: number; fee: number; net: number };
export type HomeTotals = { currency: string; gross: number; fee: number; net: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

// Totals in `home`, or undefined when there is nothing to convert or a rate is unavailable.
export async function convertReceived(rows: Received[], home: string | undefined): Promise<HomeTotals | undefined> {
  if (!home || !rows.length || !config.fxEnabled) return undefined;
  if (rows.every((r) => r.currency === home)) return undefined; // nothing to convert
  try {
    const converted = await Promise.all(rows.map(async (r) => ({ r, k: await rate(r.date, r.currency, home) })));
    const sum = (f: (r: Received) => number) => round2(converted.reduce((s, { r, k }) => s + f(r) * k, 0));
    return { currency: home, gross: sum((r) => r.gross), fee: sum((r) => r.fee), net: sum((r) => r.net) };
  } catch {
    return undefined;
  }
}
