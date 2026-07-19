/**
 * Stripe webhook — activates and cancels subscriptions automatically.
 * Point a Stripe webhook endpoint at this route with events:
 * checkout.session.completed, invoice.paid, customer.subscription.deleted.
 * Requires STRIPE_WEBHOOK_SECRET. Signature is verified over the exact raw
 * body with a replay window, per Stripe's t/v1 scheme.
 */
import { webhooks } from 'hatchable';
import { activateSubscription, cancelByStripeId } from 'lib/billing.js';

export const access = 'public'; // the Stripe signature is the authentication
export const methods = ['POST'];

export default async function (req, res) {
  const secret = globalThis.process?.env?.STRIPE_WEBHOOK_SECRET ?? '';
  if (!secret) {
    return res.status(503).json({ error: 'stripe_not_configured', detail: 'Set the STRIPE_WEBHOOK_SECRET environment variable.' });
  }

  const parts = Object.fromEntries(
    (req.headers['stripe-signature'] || '').split(',').map((kv) => kv.split('=').map((s) => s.trim())),
  );
  const ok = await webhooks.verifyHmac({
    raw: parts.t + '.' + (req.rawBody ?? ''),
    signature: parts.v1,
    secret,
    timestamp: parts.t,
  });
  if (!ok) return res.status(400).json({ error: 'invalid_signature' });

  const event = req.body;
  const obj = event?.data?.object ?? {};

  switch (event?.type) {
    case 'checkout.session.completed': {
      const email = obj.customer_details?.email ?? obj.customer_email;
      if (email) {
        await activateSubscription(email, {
          stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : null,
          stripeSubscriptionId: typeof obj.subscription === 'string' ? obj.subscription : null,
        });
      }
      break;
    }
    case 'invoice.paid': {
      const email = obj.customer_email;
      const periodEnd = obj.lines?.data?.[0]?.period?.end;
      if (email) {
        await activateSubscription(email, {
          stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : null,
          stripeSubscriptionId: typeof obj.subscription === 'string' ? obj.subscription : null,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      if (typeof obj.id === 'string') await cancelByStripeId(obj.id);
      break;
    }
    default:
      break; // ignore unhandled event types
  }

  return res.status(200).json({ received: true });
}
