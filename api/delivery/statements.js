/**
 * Imported delivery statements for the ACTIVE location, newest first.
 * Optional ?platform= filter. Includes the effective platform take rate
 * ((commissions + marketing) / gross) per statement.
 */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { listStatements } from 'lib/delivery.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const platform = req.query.platform;
  return res.json({ location: ctx.locationName, statements: await listStatements(ctx, platform) });
}
