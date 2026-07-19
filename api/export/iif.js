/**
 * Tier 2 QuickBooks bridge for the ACTIVE location — the ledger month as an
 * IIF file for QuickBooks Desktop.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { entriesForMonth } from 'lib/ledger.js';
import { toIif } from 'lib/ledgercsv.js';

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

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="journal-' + month + '.iif"');
  return res.send(toIif(entries));
}
