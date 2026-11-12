// PayPal webhook: invoice paid or cancelled. Public (PayPal calls it), so every event's
// signature is checked with PayPal before anything changes. Replays are ignored.
import { Router } from 'express';
import type { InvoiceRecord } from '../../../shared/billing';
import { config } from '../config';
import { broadcast } from '../events';
import { HttpError } from '../http';
import { mapStatus } from '../invoicing';
import { verifyWebhookSignature, type PayPalInvoice } from '../paypal';
import { exclusive, loadAll, saveInvoices } from '../store';
import { paidMessage } from './billing';

const seen = new Set<string>();
const remember = (id: string) => {
  seen.add(id);
  if (seen.size > 1000) seen.delete(seen.values().next().value!);
};

type PayPalEvent = { id?: string; event_type?: string; resource?: Partial<PayPalInvoice> & { invoice?: Partial<PayPalInvoice> } };

export const webhookRouter = Router();

webhookRouter.post('/', async (req, res) => {
  if (!config.paypal || !config.paypalWebhookId) throw new HttpError(503, 'PayPal webhooks are not set up');
  const event = req.body as PayPalEvent;
  if (typeof event?.id !== 'string' || typeof event.event_type !== 'string') throw new HttpError(400, 'Not a PayPal event');
  if (seen.has(event.id)) return void res.json({ ok: true, duplicate: true });

  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  if (!(await verifyWebhookSignature(headers, event, config.paypalWebhookId))) throw new HttpError(401, 'Signature check failed');
  remember(event.id);

  const invoice = event.resource?.invoice ?? event.resource;
  const status = invoice?.status ? mapStatus(invoice.status) : undefined;
  if (event.event_type.startsWith('INVOICING.INVOICE.') && invoice?.id && status) {
    await exclusive(async () => {
      const data = await loadAll();
      const inv = data.invoices.find((i) => i.id === invoice.id);
      if (!inv || inv.status === status) return;
      const paidAt = invoice.payments?.transactions?.map((t) => t.payment_date?.slice(0, 10)).filter(Boolean).sort().at(-1);
      Object.assign(inv, { status, ...(status === 'PAID' ? { paidAt: paidAt ?? new Date().toISOString().slice(0, 10) } : {}) } satisfies Partial<InvoiceRecord>);
      await saveInvoices(data.invoices);
      broadcast({ type: status === 'PAID' ? 'invoice-paid' : 'invoice-updated', invoiceId: inv.id, message: paidMessage(data, inv) });
    });
  }
  res.json({ ok: true });
});
