/**
 * Bank reconciliation for the ACTIVE location — the three Part 6 outputs in
 * one response: Outstanding Checks, Cleared-vs-Written discrepancies
 * (amount mismatches + missing_from_register), and the Bank Reconciliation
 * summary: starting balance − outstanding ± corrections = reconciled cash
 * balance, compared to the location's ledger Cash - General.
 * ?as_of=YYYY-MM-DD (default today), ?starting_balance=NNN.NN,
 * ?format=csv exports the outstanding-check list.
 */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { reconciliationSummary } from 'lib/checks.js';
import { accountBalance } from 'lib/ledger.js';
import { rowsToCsv } from 'lib/reports.js';

export const access = 'member';
export const methods = ['GET'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const asOf = req.query.as_of ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(asOf)) return res.status(400).json({ error: 'as_of must be YYYY-MM-DD' });

  let startingBalance = null;
  if (req.query.starting_balance !== undefined) {
    startingBalance = Number(req.query.starting_balance);
    if (!Number.isFinite(startingBalance)) return res.status(400).json({ error: 'starting_balance must be a number' });
  }

  const ledgerCash = startingBalance !== null ? await accountBalance(ctx, 'Cash - General', asOf) : null;
  const report = await reconciliationSummary(ctx, asOf, startingBalance, ledgerCash);
  report.location = ctx.locationName;

  if (req.query.format === 'csv') {
    const csv = rowsToCsv(
      report.outstandingChecks,
      ['Check Number', 'Bank Account', 'Date', 'Payee', 'Written Amount', 'Memo'],
      (c) => [c.checkNumber, c.bankAccountId, c.checkDate, c.payee, c.writtenAmount.toFixed(2), c.memo],
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="outstanding-checks-' + asOf + '.csv"');
    return res.send(csv);
  }

  return res.json(report);
}
