/**
 * Import supplier invoices for the ACTIVE location — member + subscription +
 * ap_import ack. CSV:
 * invoice_no,invoice_date,vendor,due_date,item_description,qty,unit_price,category
 * Strict all-or-nothing; registers invoices and posts AP journal entries.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parseInvoiceCsv, registerInvoices } from 'lib/ap.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('ap_import', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (!req.body || typeof req.body.csv !== 'string') {
    return res.status(422).json({ error: 'strict_validation_failed', errors: [{ line: 0, message: 'missing_csv_field' }] });
  }

  const parsed = parseInvoiceCsv(req.body.csv);
  if (!parsed.ok) return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });

  const result = await registerInvoices(ctx, parsed.invoices);
  if (!result.ok) return res.status(422).json({ error: 'ap_register_failed', errors: result.errors });

  return res.json({
    location: ctx.locationName,
    registered: result.registered,
    journalEntriesPosted: result.posted,
    invoices: parsed.invoices.map((i) => ({ invoiceNo: i.invoiceNo, vendor: i.vendor, amount: i.amount, dueDate: i.dueDate })),
  });
}
