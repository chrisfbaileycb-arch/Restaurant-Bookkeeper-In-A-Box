/**
 * Import POS daily summaries for the ACTIVE location — member +
 * subscription + pos_summary ack. One CSV row per business date with REAL
 * food/beverage category splits (see lib/possummary.js). Idempotent per
 * source/date.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parsePosSummaryCsv, importSummaries } from 'lib/possummary.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('pos_summary', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (!req.body || typeof req.body.csv !== 'string') {
    return res.status(422).json({ error: 'strict_validation_failed', errors: [{ line: 0, message: 'missing_csv_field' }] });
  }

  const parsed = parsePosSummaryCsv(req.body.csv);
  if (!parsed.ok) return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });

  const result = await importSummaries(ctx, parsed.rows);
  if (!result.ok) return res.status(422).json({ error: 'ledger_validation_failed', errors: result.errors });

  return res.json({ location: ctx.locationName, ...result });
}
