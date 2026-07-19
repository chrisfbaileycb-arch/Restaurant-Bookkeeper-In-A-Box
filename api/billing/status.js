/**
 * Subscription status for the signed-in caller — drives the pricing UI.
 * The project admin always reads as subscribed.
 */
import { admin } from 'hatchable';
import { getSubscription, isActive, price, checkoutUrl } from 'lib/billing.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const isAdmin = await admin.check(req);
  const email = req.member?.email ?? null;
  const sub = isAdmin ? null : await getSubscription(email);

  return res.json({
    product: 'Restaurant Bookkeeper in a Box',
    price: price(),
    subscribed: isAdmin || isActive(sub),
    admin: isAdmin,
    email,
    status: isAdmin ? 'owner' : (sub?.status ?? 'none'),
    currentPeriodEnd: sub?.current_period_end ?? null,
    checkoutUrl: checkoutUrl(),
  });
}
