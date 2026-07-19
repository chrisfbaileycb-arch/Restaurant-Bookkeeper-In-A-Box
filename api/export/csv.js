/**
 * Export the ACTIVE location's transactions as canonical CSV — member +
 * subscription + data_export ack. Optional ?month=YYYY-MM (required for
 * anything bound for QuickBooks); omitting month exports the full archive.
 */
import { toCsv } from 'lib/contract.js';
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { allTransactions } from 'lib/store.js';

export const access = 'member';
export const methods = ['GET'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('data_export', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const month = req.query.month;
  if (month !== undefined && (typeof month !== 'string' || !MONTH_RE.test(month))) {
    return res.status(400).json({ error: 'invalid_month', message: 'month must be YYYY-MM' });
  }

  const txs = await allTransactions(ctx, month);
  const csv = toCsv(txs);

  const filename = month ? 'transactions-' + month + '.csv' : 'transactions.csv';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  return res.send(csv);
}
