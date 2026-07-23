/**
 * Import payroll journals for the ACTIVE location — member + subscription +
 * payroll_import ack. One CSV row per pay run (see lib/payroll.js for the
 * contract). Idempotent per pay date; refreshes the compliance calendar so
 * liability-driven estimates update immediately.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parsePayrollCsv, importPayroll } from 'lib/payroll.js';
import { refreshEvents } from 'lib/compliance.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('payroll_import', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (!req.body || typeof req.body.csv !== 'string') {
    return res.status(422).json({ error: 'strict_validation_failed', errors: [{ line: 0, message: 'missing_csv_field' }] });
  }

  const parsed = parsePayrollCsv(req.body.csv);
  if (!parsed.ok) return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });

  const result = await importPayroll(ctx, parsed.runs);
  if (!result.ok) return res.status(422).json({ error: 'ledger_validation_failed', errors: result.errors });

  await refreshEvents(ctx);

  return res.json({
    location: ctx.locationName,
    runs: result.runs,
    entriesPosted: result.entriesPosted,
    entriesSkipped: result.entriesSkipped,
    lines: result.lines,
    complianceRefreshed: true,
  });
}
