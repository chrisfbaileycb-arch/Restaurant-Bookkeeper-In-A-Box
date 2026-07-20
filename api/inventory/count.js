/**
 * Physical inventory counts for the ACTIVE location.
 * GET  — count history with variances.
 * POST { count_date, food_count?, beverage_count?, paper_count? } — records
 * the count and posts the COGS adjustment (inventory_count ack required).
 * Omitted categories are skipped.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { recordCount, listCounts } from 'lib/inventory.js';

export const access = 'member';
export const methods = ['GET', 'POST'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;

  if (req.method === 'GET') {
    const ctx = await getContext(req, res);
    if (!ctx) return;
    return res.json({ location: ctx.locationName, counts: await listCounts(ctx) });
  }

  if (!requireAck('inventory_count', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const countDate = req.body?.count_date;
  if (typeof countDate !== 'string' || !DATE_RE.test(countDate)) {
    return res.status(400).json({ error: 'Validation failed', issues: ['count_date must be YYYY-MM-DD'] });
  }
  const num = (v) => (v === undefined || v === null ? undefined : Number(v));
  const result = await recordCount(ctx, countDate, {
    food: num(req.body?.food_count),
    beverage: num(req.body?.beverage_count),
    paper: num(req.body?.paper_count),
  });
  if (!result.ok) {
    return res.status(422).json(result.errors ? { error: 'inventory_adjustment_failed', errors: result.errors } : { error: result.error, message: result.message });
  }
  return res.json({ location: ctx.locationName, ...result });
}
