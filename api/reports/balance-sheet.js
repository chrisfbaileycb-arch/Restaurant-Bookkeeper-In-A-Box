/** Balance Sheet for the ACTIVE location — ?as_of (default today), ?format=csv. */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { balanceSheet, rowsToCsv } from 'lib/reports.js';

export const access = 'member';
export const methods = ['GET'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const asOf = req.query.as_of ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(asOf)) return res.status(400).json({ error: 'as_of must be YYYY-MM-DD' });

  const report = await balanceSheet(ctx, asOf);

  if (req.query.format === 'csv') {
    const rows = [
      ...report.assets.map((r) => ({ section: 'Assets', ...r })),
      ...report.liabilities.map((r) => ({ section: 'Liabilities', ...r })),
      ...report.equity.map((r) => ({ section: 'Equity', ...r })),
      { section: 'Equity', name: 'Net Income To Date', balance: report.netIncomeToDate },
      { section: 'Totals', name: 'Total Assets', balance: report.totals.assets },
      { section: 'Totals', name: 'Total Liabilities + Equity', balance: report.totals.liabilitiesAndEquity },
    ];
    const csv = rowsToCsv(rows, ['Section', 'Account', 'Amount'], (r) => [r.section, r.name, r.balance.toFixed(2)]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="balance-sheet-' + asOf + '.csv"');
    return res.send(csv);
  }

  return res.json(report);
}
