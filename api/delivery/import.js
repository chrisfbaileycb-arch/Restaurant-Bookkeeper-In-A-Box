/**
 * Import delivery platform payout statements for the ACTIVE location —
 * member + subscription + delivery_import ack. One CSV row per platform
 * payout period (see lib/delivery.js for the contract and identity check).
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parseDeliveryCsv, importStatements } from 'lib/delivery.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('delivery_import', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (!req.body || typeof req.body.csv !== 'string') {
    return res.status(422).json({ error: 'strict_validation_failed', errors: [{ line: 0, message: 'missing_csv_field' }] });
  }

  const parsed = parseDeliveryCsv(req.body.csv);
  if (!parsed.ok) return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });

  const result = await importStatements(ctx, parsed.statements);
  if (!result.ok) return res.status(422).json({ error: 'delivery_import_failed', errors: result.errors });

  return res.json({
    location: ctx.locationName,
    imported: result.imported,
    journalEntriesPosted: result.entriesPosted,
    statements: parsed.statements.map((s) => ({ platform: s.platform, periodEnd: s.periodEnd, grossSales: s.grossSales, netPayout: s.netPayout })),
  });
}
