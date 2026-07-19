/**
 * The caller's workspace context: organization, plan, accessible locations,
 * and the ACTIVE location every other route is scoped to.
 */
import { getContext, PLANS } from 'lib/tenant.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const ctx = await getContext(req, res);
  if (!ctx) return;
  return res.json({
    email: ctx.email,
    organization: { id: ctx.orgId, name: ctx.orgName, plan: ctx.plan, planLimits: PLANS[ctx.plan] ?? null },
    activeLocation: { id: ctx.locationId, name: ctx.locationName },
    locations: ctx.locations,
  });
}
