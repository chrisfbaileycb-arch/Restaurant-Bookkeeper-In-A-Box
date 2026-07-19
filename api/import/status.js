/**
 * Cadence watchdog for the ACTIVE location — whether this week's CSV import
 * has validated.
 */
import { cycleStart } from 'lib/contract.js';
import { getImportStatus } from 'lib/store.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const currentWeek = cycleStart(new Date()).toISOString().slice(0, 10);
  const last = await getImportStatus(ctx);

  return res.json({
    location: ctx.locationName,
    weekOf: currentWeek,
    lastImportAt: last?.lastImportAt ?? null,
    lastWeekOf: last?.lastWeekOf ?? null,
    validatedThisWeek: last !== null && last.lastWeekOf === currentWeek,
  });
}
