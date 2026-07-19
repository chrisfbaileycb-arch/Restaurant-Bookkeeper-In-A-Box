/**
 * Compliance dashboard for the ACTIVE location — deadlines with estimated
 * amounts pulled live from this location's liability balances.
 */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { refreshEvents, listEvents } from 'lib/compliance.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const now = new Date();
  await refreshEvents(ctx, now);
  const events = await listEvents(ctx, now, { includeFiled: req.query.include_filed === 'true' });

  return res.json({
    location: ctx.locationName,
    asOf: now.toISOString().slice(0, 10),
    dueSoon: events.filter((e) => e.status === 'DUE_SOON'),
    overdue: events.filter((e) => e.status === 'OVERDUE'),
    upcoming: events.filter((e) => e.status === 'UPCOMING'),
    ...(req.query.include_filed === 'true' ? { filed: events.filter((e) => e.status === 'FILED') } : {}),
  });
}
