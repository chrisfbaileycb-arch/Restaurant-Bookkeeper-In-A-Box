/**
 * Record payment of a vendor invoice for the ACTIVE location — member +
 * subscription + ap_payment ack. Recording only; no money moves.
 * POST { invoice_no, payment_date, check_number?, bank_account_id? }
 * Check payments also register an outstanding check for reconciliation.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { payInvoice } from 'lib/ap.js';

export const access = 'member';
export const methods = ['POST'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('ap_payment', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const invoiceNo = req.body?.invoice_no;
  const paymentDate = req.body?.payment_date;
  const checkNumber = req.body?.check_number ?? null;
  const bankAccountId = req.body?.bank_account_id ?? 'primary';

  const issues = [];
  if (typeof invoiceNo !== 'string' || !invoiceNo) issues.push('invoice_no required');
  if (typeof paymentDate !== 'string' || !DATE_RE.test(paymentDate)) issues.push('payment_date must be YYYY-MM-DD');
  if (checkNumber !== null && (typeof checkNumber !== 'string' || !checkNumber)) issues.push('check_number must be a nonempty string when provided');
  if (issues.length > 0) return res.status(400).json({ error: 'Validation failed', issues });

  const result = await payInvoice(ctx, { invoiceNo, paymentDate, checkNumber, bankAccountId });
  if (!result.ok) {
    const status = result.error === 'invoice_not_found_or_paid' ? 404 : 422;
    return res.status(status).json(result.errors ? { error: 'ap_payment_failed', errors: result.errors } : { error: result.error });
  }

  return res.json({ location: ctx.locationName, ...result });
}
