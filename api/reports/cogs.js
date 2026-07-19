/** COGS summary for the ACTIVE location — ?from/?to, ?format=csv. */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { cogsSummary, rowsToCsv } from 'lib/reports.js';

export const access = 'member';
export const methods = ['GET'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const now = new Date().toISOString().slice(0, 10);
  const from = req.query.from ?? now.slice(0, 8) + '01';
  const to = req.query.to ?? now;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });

  const report = await cogsSummary(ctx, from, to);

  if (req.query.format === 'csv') {
    const csv = rowsToCsv(
      [...report.lines, { account: 'TOTAL COGS', amount: report.totals.cogs, pctOfRevenue: report.totals.cogsPctOfRevenue }],
      ['Account', 'Amount', 'Pct of Revenue'],
      (r) => [r.account, r.amount.toFixed(2), r.pctOfRevenue ?? ''],
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cogs-' + from + '-to-' + to + '.csv"');
    return res.send(csv);
  }

  return res.json(report);
}
