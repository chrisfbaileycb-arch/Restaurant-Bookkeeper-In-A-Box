/**
 * Chart of accounts with balances for the ACTIVE location — the
 * trial-balance view. Optional ?from / ?to (YYYY-MM-DD).
 */
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { accountBalances } from 'lib/ledger.js';
import { cents } from 'lib/contract.js';

export const access = 'member';
export const methods = ['GET'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const from = req.query.from ?? '0000-01-01';
  const to = req.query.to ?? '9999-12-31';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
  }

  const accounts = await accountBalances(ctx, from, to);
  const totalDebits = cents(accounts.reduce((s, a) => s + a.debits, 0));
  const totalCredits = cents(accounts.reduce((s, a) => s + a.credits, 0));

  return res.json({
    location: ctx.locationName,
    accounts,
    totals: { debits: totalDebits, credits: totalCredits },
    inBalance: Math.abs(totalDebits - totalCredits) < 0.01,
  });
}
