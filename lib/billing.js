/**
 * Subscription billing — $149/month flat.
 *
 * The paywall gates operator routes: the project admin (owner) always
 * passes; signed-in members need an active subscription row. Payment
 * collection itself runs through Stripe — set STRIPE_PAYMENT_LINK (the
 * hosted checkout URL shown to unsubscribed users) and
 * STRIPE_WEBHOOK_SECRET (activates subscriptions automatically via
 * /api/billing/webhook). Until Stripe is wired, the admin can comp
 * accounts manually via /api/billing/grant.
 */
import { db, admin } from 'hatchable';

export function price() {
  const e = globalThis.process?.env ?? {};
  return {
    amount: Number(e.BILLING_PRICE_USD ?? 149),
    currency: 'USD',
    interval: 'month',
    plan: 'standard-149',
  };
}

export function checkoutUrl() {
  return globalThis.process?.env?.STRIPE_PAYMENT_LINK ?? null;
}

export async function getSubscription(email) {
  if (!email) return null;
  const r = await db.query('SELECT * FROM subscriptions WHERE email = lower($1)', [email]);
  return r.rows[0] ?? null;
}

export function isActive(sub) {
  if (!sub || sub.status !== 'active') return false;
  if (sub.current_period_end === null || sub.current_period_end === undefined) return true;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

/**
 * Paywall gate. Returns true when the caller may proceed (project admin, or
 * member with an active subscription); otherwise sends 402 Payment Required
 * with the price and checkout link and returns false.
 */
export async function requireSubscription(req, res) {
  if (await admin.check(req)) return true;

  const email = req.member?.email;
  const sub = await getSubscription(email);
  if (isActive(sub)) return true;

  res.status(402).json({
    error: 'subscription_required',
    price: price(),
    message: 'This feature requires an active subscription — ' + price().amount + ' USD per month.',
    checkoutUrl: checkoutUrl(),
  });
  return false;
}

/** Upsert an active subscription (webhook + admin grant path). */
export async function activateSubscription(email, fields = {}) {
  await db.query(
    'INSERT INTO subscriptions (email, status, stripe_customer_id, stripe_subscription_id, current_period_end) ' +
      'VALUES (lower($1), $2, $3, $4, $5) ' +
      'ON CONFLICT (email) DO UPDATE SET status = $2, ' +
      'stripe_customer_id = COALESCE($3, subscriptions.stripe_customer_id), ' +
      'stripe_subscription_id = COALESCE($4, subscriptions.stripe_subscription_id), ' +
      'current_period_end = COALESCE($5, subscriptions.current_period_end), updated_at = now()',
    [email, 'active', fields.stripeCustomerId ?? null, fields.stripeSubscriptionId ?? null, fields.currentPeriodEnd ?? null],
  );
}

/** Cancel by email. Returns true if a row was updated. */
export async function cancelSubscription(email) {
  const r = await db.query(
    "UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE email = lower($1) RETURNING id",
    [email],
  );
  return r.rows.length > 0;
}

/** Cancel by Stripe subscription id (subscription.deleted webhook). */
export async function cancelByStripeId(stripeSubscriptionId) {
  const r = await db.query(
    "UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE stripe_subscription_id = $1 RETURNING id",
    [stripeSubscriptionId],
  );
  return r.rows.length > 0;
}
