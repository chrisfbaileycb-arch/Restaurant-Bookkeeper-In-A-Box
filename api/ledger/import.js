/**
 * Import the universal journal CSV into the ACTIVE location's ledger —
 * member + subscription + manual_import ack. All-or-nothing.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parseJournalCsv } from 'lib/ledgercsv.js';
import { postEntries } from 'lib/ledger.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('manual_import', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (!req.body || typeof req.body.csv !== 'string') {
    return res.status(422).json({ error: 'strict_validation_failed', errors: [{ line: 0, message: 'missing_csv_field' }] });
  }

  const parsed = parseJournalCsv(req.body.csv);
  if (!parsed.ok) {
    return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });
  }

  const result = await postEntries(ctx, parsed.entries);
  if (!result.ok) {
    return res.status(422).json({ error: 'ledger_validation_failed', errors: result.errors });
  }

  return res.json({ location: ctx.locationName, posted: result.posted, lines: result.lines });
}
