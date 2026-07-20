/**
 * Period-over-period P&L comparison for the ACTIVE location.
 * GET ?p1_from&p1_to&p2_from&p2_to (all YYYY-MM-DD).
 */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { comparativeStatements } from 'lib/reports.js';

export const access = 'member';
export const methods = ['GET'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const params = ['p1_from', 'p1_to', 'p2_from', 'p2_to'].map((k) => req.query[k]);
  if (params.some((v) => typeof v !== 'string' || !DATE_RE.test(v))) {
    return res.status(400).json({ error: 'p1_from, p1_to, p2_from, p2_to are required as YYYY-MM-DD' });
  }

  return res.json(await comparativeStatements(ctx, ...params));
}
