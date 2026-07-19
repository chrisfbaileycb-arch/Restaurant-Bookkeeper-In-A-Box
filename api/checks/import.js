/**
 * Import the check register CSV for the ACTIVE location —
 * check_number,check_date,payee,written_amount,memo,bank_account_id
 * Strict all-or-nothing.
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parseRegisterCsv, insertRegister } from 'lib/checks.js';

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

  const parsed = parseRegisterCsv(req.body.csv);
  if (!parsed.ok) return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });

  const result = await insertRegister(ctx, parsed.checks);
  if (!result.ok) return res.status(422).json({ error: 'register_conflict', errors: result.errors });

  return res.json({ location: ctx.locationName, registered: result.registered });
}
