/**
 * AP aging report for the ACTIVE location — unpaid invoices binned
 * 0-15 / 16-30 / 31+ days by invoice date. Optional ?as_of=YYYY-MM-DD
 * (defaults to today).
 */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { apAging } from 'lib/ap.js';

export const access = 'member';
export const methods = ['GET'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const asOf = req.query.as_of ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(asOf)) {
    return res.status(400).json({ error: 'as_of must be YYYY-MM-DD' });
  }

  return res.json({ location: ctx.locationName, ...(await apAging(ctx, asOf)) });
}
