/**
 * Manual POS CSV import into the ACTIVE location — member + subscription +
 * manual_import ack. ingestionValidated:true only after the insert succeeds.
 */
import { strictValidateCsv } from 'lib/validate.js';
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { insertTransactions, recordImportSuccess } from 'lib/store.js';
import { cycleStart } from 'lib/contract.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('manual_import', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const body = req.body;
  if (!body || typeof body.csv !== 'string') {
    return res.status(422).json({ error: 'strict_validation_failed', errors: [{ line: 0, message: 'missing_csv_field' }] });
  }

  const validation = strictValidateCsv(body.csv);
  if (!validation.ok) {
    return res.status(422).json({ error: 'strict_validation_failed', errors: validation.errors });
  }

  const aclViolations = validation.aclViolations;

  let imported;
  try {
    imported = await insertTransactions(ctx, validation.rows);
  } catch (err) {
    return res.status(500).json({
      error: 'persistence_failed',
      message: 'Import validation passed, but the transaction data could not be saved. No import success was recorded.',
    });
  }

  const weekOf = cycleStart(new Date()).toISOString().slice(0, 10);
  await recordImportSuccess(ctx, weekOf, imported);

  return res.json({
    location: ctx.locationName,
    imported,
    weekOf,
    ingestionValidated: true,
    ...(aclViolations.length > 0 ? { aclViolations } : {}),
  });
}
