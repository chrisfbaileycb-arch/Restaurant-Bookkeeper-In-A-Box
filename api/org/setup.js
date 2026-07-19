/**
 * Create the caller's organization: name, plan (single | group |
 * premium_group), and the first location. Copies the shared restaurant COA
 * template into the org and activates the first workspace.
 */
import { createOrganization, PLANS } from 'lib/tenant.js';
import { admin } from 'hatchable';

export const access = 'member';
export const methods = ['POST'];

async function callerEmail(req) {
  if (req.member?.email) return req.member.email.toLowerCase();
  const profile = await admin.profile(req).catch(() => null);
  return profile?.email ? profile.email.toLowerCase() : null;
}

export default async function (req, res) {
  const email = await callerEmail(req);
  if (!email) return res.status(401).json({ error: 'no_identity' });

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const plan = req.body?.plan ?? 'single';
  const locationName = typeof req.body?.locationName === 'string' ? req.body.locationName.trim() : '';
  if (!name || !locationName) {
    return res.status(400).json({ error: 'Validation failed', issues: ['name and locationName are required'], plans: PLANS });
  }

  const result = await createOrganization({ name, plan, locationName, email });
  if (!result.ok) return res.status(409).json(result);

  return res.status(201).json({ organizationId: result.orgId, locationId: result.locationId, plan, activeLocation: locationName });
}
