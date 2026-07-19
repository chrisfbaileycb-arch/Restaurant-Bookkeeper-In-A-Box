/**
 * Tier 1 QuickBooks bridge for the ACTIVE location — the ledger month as
 * QBO's journal-entry import CSV. Month-scoped; 1,000-line QBO cap flagged.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { entriesForMonth } from 'lib/ledger.js';
import { toQboJournalCsv, qboLineCount } from 'lib/ledgercsv.js';

export const access = 'member';
export const methods = ['GET'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('data_export', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const month = req.query.month;
  if (typeof month !== 'string' || !MONTH_RE.test(month)) {
    return res.status(400).json({ error: 'month_required', message: 'QuickBooks exports are one month at a time. Pass ?month=YYYY-MM.' });
  }

  const entries = await entriesForMonth(ctx, month);
  if (entries.length === 0) return res.status(404).json({ error: 'no_ledger_entries_for_month', month });

  const lines = qboLineCount(entries);
  if (lines > 1000) {
    return res.status(422).json({ error: 'qbo_line_limit_exceeded', lines, message: 'QBO journal imports cap at 1,000 lines; split the month or export IIF.' });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="qbo-journal-' + month + '.csv"');
  return res.send(toQboJournalCsv(entries));
}
