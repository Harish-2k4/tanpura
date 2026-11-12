// Where families can live: each country's currency (one PayPal supports for invoicing) and the
// time zones offered when adding someone there.
export const COUNTRIES = ['US', 'UK', 'CA', 'AU', 'NZ', 'SG', 'IE', 'DE'] as const;
export type Country = (typeof COUNTRIES)[number];

export const CURRENCIES = ['USD', 'GBP', 'CAD', 'AUD', 'NZD', 'SGD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

type Region = { label: string; currency: Currency; zones: { id: string; label: string }[] };

export const REGIONS: Record<Country, Region> = {
  US: {
    label: 'United States',
    currency: 'USD',
    zones: [
      { id: 'America/New_York', label: 'Eastern (New York)' },
      { id: 'America/Chicago', label: 'Central (Chicago)' },
      { id: 'America/Denver', label: 'Mountain (Denver)' },
      { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
    ],
  },
  UK: { label: 'United Kingdom', currency: 'GBP', zones: [{ id: 'Europe/London', label: 'London' }] },
  CA: {
    label: 'Canada',
    currency: 'CAD',
    zones: [
      { id: 'America/Toronto', label: 'Eastern (Toronto)' },
      { id: 'America/Winnipeg', label: 'Central (Winnipeg)' },
      { id: 'America/Edmonton', label: 'Mountain (Calgary)' },
      { id: 'America/Vancouver', label: 'Pacific (Vancouver)' },
    ],
  },
  AU: {
    label: 'Australia',
    currency: 'AUD',
    zones: [
      { id: 'Australia/Sydney', label: 'Sydney / Melbourne' },
      { id: 'Australia/Brisbane', label: 'Brisbane' },
      { id: 'Australia/Adelaide', label: 'Adelaide' },
      { id: 'Australia/Perth', label: 'Perth' },
    ],
  },
  NZ: { label: 'New Zealand', currency: 'NZD', zones: [{ id: 'Pacific/Auckland', label: 'Auckland' }] },
  SG: { label: 'Singapore', currency: 'SGD', zones: [{ id: 'Asia/Singapore', label: 'Singapore' }] },
  IE: { label: 'Ireland', currency: 'EUR', zones: [{ id: 'Europe/Dublin', label: 'Dublin' }] },
  DE: { label: 'Germany', currency: 'EUR', zones: [{ id: 'Europe/Berlin', label: 'Berlin' }] },
};

export const zonesFor = (country: Country) => REGIONS[country].zones.map((z) => z.id);
