// PayPal features that depend on the teacher's (seller's) country.
// Only facts verified in PayPal's docs go here; add a source link with each rule.

// Partial payments on invoices are not available to users in these countries.
// Source: https://developer.paypal.com/docs/platforms/invoicing/integrate/
const NO_PARTIAL_PAYMENTS = ['IN', 'BR', 'IL'];

export type PayPalFeatures = { partialPayments: boolean };

export function paypalFeatures(country: string): PayPalFeatures {
  return { partialPayments: !NO_PARTIAL_PAYMENTS.includes(country.toUpperCase()) };
}
