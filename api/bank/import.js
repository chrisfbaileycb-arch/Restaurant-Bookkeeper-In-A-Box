/**
 * Import cleared checks (bank CSV) for the ACTIVE location —
 * check_number,cleared_date,cleared_amount,description,routing_number,account_number_last4,bank_account_id
 * — then run the matching engine. Re-imports dedupe silently.
 * Phone/MICR scanning is phase 2 and will feed this same table.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parseClearedCsv, insertCleared, runMatching } from 'lib/checks.js';

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

  const parsed = parseClearedCsv(req.body.csv);
  if (!parsed.ok) return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });

  const inserted = await insertCleared(ctx, parsed.rows);
  const matching = await runMatching(ctx);

  return res.json({
    location: ctx.locationName,
    linesImported: inserted.imported,
    duplicateLinesSkipped: inserted.duplicates,
    ...matching,
  });
}
