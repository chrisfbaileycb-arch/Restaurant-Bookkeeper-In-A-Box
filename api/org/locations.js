/**
 * GET: all locations in the caller's organization (with access flags).
 * POST {name}: create a location — enforces the plan limit (Single 1,
 * Group 3, Premium Group 7) with a clear upgrade message.
 */
import { getContext, addLocation, listOrgLocations } from 'lib/tenant.js';

export const access = 'member';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (req.method === 'GET') {
    return res.json({ plan: ctx.plan, locations: await listOrgLocations(ctx) });
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Validation failed', issues: ['name required'] });

  const result = await addLocation(ctx, name);
  if (!result.ok) return res.status(result.error === 'location_limit_reached' ? 402 : 409).json(result);
  return res.status(201).json(result);
}
