/**
 * Multi-unit tenant model — one app, one login, multiple isolated location
 * workspaces.
 *
 *   organization = the customer account (restaurant group)
 *   location     = one restaurant within the organization (1–7 by plan)
 *   org_user     = a login (email) belonging to one organization
 *   workspace    = the user's ACTIVE location context
 *
 * getContext() is the single isolation chokepoint: every location-scoped
 * route must call it and pass the returned {orgId, locationId} into every
 * data-layer function, all of which filter on BOTH ids. (Platform note:
 * Hatchable's SQL gateway doesn't expose per-request session settings, so
 * Postgres RLS via current_setting isn't available — this app-layer
 * chokepoint is the enforced boundary instead.)
 */
import { db, admin } from 'hatchable';

export const PLANS = {
  single: { label: 'Single', maxLocations: 1, priceUsd: 149 },
  group: { label: 'Group', maxLocations: 3, priceUsd: 249 },
  premium_group: { label: 'Premium Group', maxLocations: 7, priceUsd: 499 },
};

async function callerEmail(req) {
  if (req.member?.email) return req.member.email.toLowerCase();
  const profile = await admin.profile(req).catch(() => null);
  return profile?.email ? profile.email.toLowerCase() : null;
}

/**
 * Resolve the caller's active workspace. Sends the error response and
 * returns null when the caller has no identity, no organization, or no
 * location access. Falls back to the first accessible location when the
 * stored active location is stale.
 */
export async function getContext(req, res) {
  const email = await callerEmail(req);
  if (!email) {
    res.status(401).json({ error: 'no_identity' });
    return null;
  }

  const u = await db.query(
    'SELECT ou.id, ou.organization_id, ou.role, ou.active_location_id, o.name AS org_name, o.plan ' +
      'FROM org_users ou JOIN organizations o ON o.id = ou.organization_id WHERE ou.email = $1',
    [email],
  );
  if (u.rows.length === 0) {
    res.status(409).json({
      error: 'no_workspace',
      message: 'No organization yet for this login. Create one: POST /api/org/setup {"name", "plan", "locationName"}.',
      plans: PLANS,
    });
    return null;
  }
  const user = u.rows[0];

  const locs = await db.query(
    'SELECT l.id, l.name FROM locations l JOIN user_locations ul ON ul.location_id = l.id ' +
      'WHERE ul.org_user_id = $1 ORDER BY l.id',
    [user.id],
  );
  if (locs.rows.length === 0) {
    res.status(403).json({ error: 'no_location_access', message: 'This login has no location access in its organization.' });
    return null;
  }

  let locationId = Number(user.active_location_id);
  if (!locs.rows.some((l) => Number(l.id) === locationId)) {
    locationId = Number(locs.rows[0].id);
    await db.query('UPDATE org_users SET active_location_id = $2 WHERE id = $1', [user.id, locationId]);
  }

  return {
    email,
    userId: Number(user.id),
    role: user.role,
    orgId: Number(user.organization_id),
    orgName: user.org_name,
    plan: user.plan,
    locationId,
    locationName: locs.rows.find((l) => Number(l.id) === locationId)?.name,
    locations: locs.rows.map((l) => ({ id: Number(l.id), name: l.name })),
  };
}

/**
 * Create the caller's organization + first location, copy the shared
 * restaurant COA template (accounts with organization_id NULL) into the
 * org, and grant + activate the first workspace.
 */
export async function createOrganization({ name, plan, locationName, email }) {
  if (!PLANS[plan]) return { ok: false, error: 'invalid_plan', message: 'plan must be one of: ' + Object.keys(PLANS).join(', ') };

  const existing = await db.query('SELECT id FROM org_users WHERE email = $1', [email]);
  if (existing.rows.length > 0) return { ok: false, error: 'already_in_organization', message: 'This login already belongs to an organization.' };

  const org = await db.query('INSERT INTO organizations (name, plan) VALUES ($1, $2) RETURNING id', [name, plan]);
  const orgId = Number(org.rows[0].id);

  // Org-level copy of the shared restaurant COA template.
  await db.query(
    'INSERT INTO accounts (organization_id, account_no, name, type, qb_type, active) ' +
      'SELECT $1, account_no, name, type, qb_type, active FROM accounts WHERE organization_id IS NULL',
    [orgId],
  );

  const loc = await db.query('INSERT INTO locations (organization_id, name) VALUES ($1, $2) RETURNING id', [orgId, locationName]);
  const locationId = Number(loc.rows[0].id);

  const ou = await db.query(
    "INSERT INTO org_users (organization_id, email, role, active_location_id) VALUES ($1, $2, 'owner', $3) RETURNING id",
    [orgId, email, locationId],
  );
  await db.query('INSERT INTO user_locations (org_user_id, location_id) VALUES ($1, $2)', [Number(ou.rows[0].id), locationId]);

  return { ok: true, orgId, locationId };
}

/** Add a location — enforces the organization's plan limit. */
export async function addLocation(ctx, name) {
  const plan = PLANS[ctx.plan] ?? PLANS.single;
  const count = await db.query('SELECT count(*) AS n FROM locations WHERE organization_id = $1', [ctx.orgId]);
  if (Number(count.rows[0].n) >= plan.maxLocations) {
    return {
      ok: false,
      error: 'location_limit_reached',
      message: 'The ' + plan.label + ' plan allows up to ' + plan.maxLocations + ' location(s). Upgrade your plan to add more.',
      plan: ctx.plan,
      maxLocations: plan.maxLocations,
    };
  }
  const dup = await db.query('SELECT id FROM locations WHERE organization_id = $1 AND name = $2', [ctx.orgId, name]);
  if (dup.rows.length > 0) return { ok: false, error: 'duplicate_location_name' };

  const loc = await db.query('INSERT INTO locations (organization_id, name) VALUES ($1, $2) RETURNING id', [ctx.orgId, name]);
  const locationId = Number(loc.rows[0].id);
  await db.query('INSERT INTO user_locations (org_user_id, location_id) VALUES ($1, $2)', [ctx.userId, locationId]);
  return { ok: true, locationId, name };
}

/** Switch the caller's active workspace (must be an accessible location). */
export async function switchLocation(ctx, locationId) {
  if (!ctx.locations.some((l) => l.id === locationId)) {
    return { ok: false, error: 'location_not_accessible' };
  }
  await db.query('UPDATE org_users SET active_location_id = $2 WHERE id = $1', [ctx.userId, locationId]);
  return { ok: true, locationId };
}

/** All locations in the org with access/active flags for the caller. */
export async function listOrgLocations(ctx) {
  const r = await db.query('SELECT id, name FROM locations WHERE organization_id = $1 ORDER BY id', [ctx.orgId]);
  return r.rows.map((l) => ({
    id: Number(l.id),
    name: l.name,
    accessible: ctx.locations.some((a) => a.id === Number(l.id)),
    active: Number(l.id) === ctx.locationId,
  }));
}
