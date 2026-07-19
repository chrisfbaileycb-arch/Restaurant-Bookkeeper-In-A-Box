/** P&L for the ACTIVE location — ?from/?to (default current month), ?format=csv. */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { profitLoss, rowsToCsv } from 'lib/reports.js';

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

  const report = await profitLoss(ctx, from, to);

  if (req.query.format === 'csv') {
    const rows = [
      ...report.revenue.map((r) => ({ section: 'Revenue', ...r })),
      ...report.cogs.map((r) => ({ section: 'COGS', ...r })),
      ...report.expenses.map((r) => ({ section: 'Expenses', ...r })),
      { section: 'Totals', name: 'Gross Profit', balance: report.totals.grossProfit },
      { section: 'Totals', name: 'Net Income', balance: report.totals.netIncome },
    ];
    const csv = rowsToCsv(rows, ['Section', 'Account', 'Amount'], (r) => [r.section, r.name, r.balance.toFixed(2)]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="profit-loss-' + from + '-to-' + to + '.csv"');
    return res.send(csv);
  }

  return res.json(report);
}
