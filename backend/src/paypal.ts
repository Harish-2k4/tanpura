// PayPal REST client (sandbox), plain fetch, no SDK. Server-side only.
// Adapted from PayPal's hackathon boilerplate (paypaldev/hackathon-paypal-ag-grid-boilerplate).
import { config } from './config';

const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;

export class PayPalApiError extends Error {
  readonly status: number;
  readonly issue: string | undefined; // PayPal's error name, e.g. DUPLICATE_INVOICE_NUMBER
  readonly description: string | undefined; // PayPal's own explanation, safe to show the teacher

  constructor(status: number, path: string, body: string) {
    super(`PayPal ${status} on ${path}: ${body.slice(0, 1000)}`);
    this.name = 'PayPalApiError';
    this.status = status;
    let detail: { issue?: string; description?: string } | undefined;
    try {
      detail = (JSON.parse(body) as { details?: { issue?: string; description?: string }[] }).details?.[0];
    } catch {
      // not JSON
    }
    this.issue = detail?.issue ?? /"(?:issue|name)"\s*:\s*"([A-Z_]+)"/.exec(body)?.[1];
    this.description = detail?.description?.slice(0, 300);
  }
}

export const paypalConfigured = () => Boolean(config.paypal);

let cachedToken: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  if (!config.paypal) throw new Error('PayPal credentials are not set (backend/.env)');

  const { clientId, secret } = config.paypal;
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());

  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so an in-flight request never carries an expired token.
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

export async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }

    // A revoked or expired token: drop it and mint a new one once.
    if (res.status === 401 && attempt === 1) {
      cachedToken = undefined;
      continue;
    }
    // POSTs are not retried on 5xx: the invoice may already exist.
    if ((res.status === 429 || (res.status >= 500 && method === 'GET')) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    throw new PayPalApiError(res.status, path, await res.text());
  }
}

export type Money = { value: string; currency_code: string };

export type PayPalInvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'SCHEDULED'
  | 'UNPAID'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'MARKED_AS_PAID'
  | 'PARTIALLY_PAID'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'MARKED_AS_REFUNDED'
  | 'CANCELLED';

export type PayPalInvoice = {
  id: string;
  status: PayPalInvoiceStatus;
  detail: { invoice_number: string; currency_code: string; metadata?: { invoicer_view_url?: string; recipient_view_url?: string } };
  primary_recipients?: { billing_info?: { email_address?: string } }[];
  amount?: Money;
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions?: { payment_date?: string; amount: Money }[] };
};

const invoicePath = (id: string) => `/v2/invoicing/invoices/${encodeURIComponent(id)}`;

export const getInvoice = (id: string) => request<PayPalInvoice>('GET', invoicePath(id));

export async function findInvoiceByNumber(invoiceNumber: string): Promise<PayPalInvoice | undefined> {
  const res = await request<{ items?: PayPalInvoice[] }>('POST', '/v2/invoicing/search-invoices?page_size=5', { invoice_number: invoiceNumber });
  return res?.items?.find((i) => i.detail.invoice_number === invoiceNumber);
}

export const createInvoice = (body: unknown) => request<PayPalInvoice>('POST', '/v2/invoicing/invoices', body);

export const sendInvoice = (id: string) => request<void>('POST', `${invoicePath(id)}/send`, { send_to_invoicer: false });

export const cancelInvoice = (id: string, note: string) =>
  request<void>('POST', `${invoicePath(id)}/cancel`, { subject: 'Invoice cancelled', note, send_to_recipient: true, send_to_invoicer: false });

// PayPal emails the family a reminder with this subject and note, linking the invoice.
export const remindInvoice = (id: string, subject: string, note: string) =>
  request<void>('POST', `${invoicePath(id)}/remind`, { subject, note, send_to_invoicer: false, send_to_recipient: true });

// Checks that a webhook call really came from PayPal, for the webhook registered as `webhookId`.
export async function verifyWebhookSignature(headers: Record<string, string | undefined>, event: unknown, webhookId: string): Promise<boolean> {
  const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (required.some((h) => !headers[h])) return false;
  const res = await request<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: event,
  });
  return res?.verification_status === 'SUCCESS';
}

export const recordPayment = (id: string, date: string, amount: Money) =>
  request<{ payment_id: string }>('POST', `${invoicePath(id)}/payments`, { method: 'BANK_TRANSFER', payment_date: date, amount });
