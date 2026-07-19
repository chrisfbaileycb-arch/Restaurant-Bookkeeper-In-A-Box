/**
 * Switch the caller's active workspace. Body: { locationId }.
 * Every subsequent request operates in the new location context.
 */
import { getContext, switchLocation } from 'lib/tenant.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const locationId = Number(req.body?.locationId);
  if (!Number.isInteger(locationId)) {
    return res.status(400).json({ error: 'Validation failed', issues: ['locationId (integer) required'] });
  }

  const result = await switchLocation(ctx, locationId);
  if (!result.ok) return res.status(403).json(result);
  return res.json({ activeLocationId: locationId, name: ctx.locations.find((l) => l.id === locationId)?.name });
}
