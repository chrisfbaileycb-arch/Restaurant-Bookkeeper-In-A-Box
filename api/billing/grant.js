/**
 * Admin override — manually activate (comp) or cancel a subscription by
 * email. Useful before Stripe is connected, and for support cases.
 */
import { admin } from 'hatchable';
import { activateSubscription, cancelSubscription } from 'lib/billing.js';

export const access = 'admin';
export const methods = ['POST'];

export default async function (req, res) {
  const allowed = await admin.require(req, res);
  if (!allowed) return;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const action = req.body?.action ?? 'activate';
  if (!email || !['activate', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'Validation failed', issues: ['email required; action must be activate|cancel'] });
  }

  if (action === 'activate') {
    await activateSubscription(email);
    return res.json({ email: email.toLowerCase(), status: 'active' });
  }
  const found = await cancelSubscription(email);
  if (!found) return res.status(404).json({ error: 'no_subscription_for_email' });
  return res.json({ email: email.toLowerCase(), status: 'canceled' });
}
