/**
 * The ACTIVE location's check register.
 * GET ?status=outstanding|cleared|amount_mismatch|void to filter.
 * POST { check_number, bank_account_id?, status } to void/reopen.
 */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { listRegister, setCheckStatus } from 'lib/checks.js';

export const access = 'member';
export const methods = ['GET', 'POST'];

const STATUSES = ['outstanding', 'cleared', 'amount_mismatch', 'void'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (req.method === 'GET') {
    const status = req.query.status;
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'status must be one of ' + STATUSES.join('|') });
    }
    return res.json({ location: ctx.locationName, checks: await listRegister(ctx, status) });
  }

  const checkNumber = req.body?.check_number;
  const bankAccountId = req.body?.bank_account_id ?? 'primary';
  const status = req.body?.status;
  if (typeof checkNumber !== 'string' || !checkNumber || !['void', 'outstanding'].includes(status)) {
    return res.status(400).json({ error: 'Validation failed', issues: ['check_number required; status must be void or outstanding'] });
  }
  const updated = await setCheckStatus(ctx, checkNumber, bankAccountId, status);
  if (!updated) return res.status(404).json({ error: 'check_not_found' });
  return res.json({ checkNumber: updated.check_number, status: updated.status });
}
