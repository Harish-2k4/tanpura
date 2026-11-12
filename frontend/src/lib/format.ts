// Display formatting. Dates are YYYY-MM-DD / YYYY-MM strings; times are ISO instants.
import type { Currency } from '../../../shared/billing';

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: Currency | string): string {
  const key = `${currency}-${Number.isInteger(amount)}`;
  if (!moneyFormats.has(key)) {
    moneyFormats.set(
      key,
      new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-GB', { style: 'currency', currency, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }),
    );
  }
  return moneyFormats.get(key)!.format(amount);
}

const at = (date: string) => new Date(`${date}T12:00:00Z`);

export const formatMonth = (month: string) =>
  at(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const formatDate = (date: string) =>
  at(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const formatShortDate = (date: string) =>
  at(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const formatTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });

export const formatDateTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone });

// "London" from "Europe/London".
export const zoneCity = (timeZone: string) => timeZone.split('/').at(-1)!.replace(/_/g, ' ');

// Totals per currency, e.g. "US$1,170 · £900 · A$1,280".
export function formatTotals(items: { currency: Currency; amount: number }[]): string {
  const sums = new Map<Currency, number>();
  for (const { currency, amount } of items) sums.set(currency, (sums.get(currency) ?? 0) + amount);
  return [...sums].map(([c, a]) => formatMoney(Math.round(a * 100) / 100, c)).join(' · ') || '–';
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
