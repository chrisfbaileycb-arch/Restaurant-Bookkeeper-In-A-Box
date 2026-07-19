/**
 * Mark one of the ACTIVE location's compliance events FILED (or reopen).
 * Body: { id, status }. Scoped: cannot touch another location's events.
 */
import { db } from 'hatchable';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const id = Number(req.body?.id);
  const status = req.body?.status ?? 'FILED';
  if (!Number.isInteger(id) || !['FILED', 'UPCOMING'].includes(status)) {
    return res.status(400).json({ error: 'Validation failed', issues: ['id (integer) required; status must be FILED or UPCOMING'] });
  }

  const r = await db.query(
    'UPDATE compliance_events SET status = $2 WHERE id = $1 AND location_id = $3 RETURNING id, tax_type, period_end, status',
    [id, status, ctx.locationId],
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'event_not_found' });
  return res.json(r.rows[0]);
}
