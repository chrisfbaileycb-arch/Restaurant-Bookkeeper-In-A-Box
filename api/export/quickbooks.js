/**
 * QuickBooks daily sales receipts for the ACTIVE location — month-scoped
 * (?month=YYYY-MM required; QuickBooks rejects larger imports).
 */
import { buildSalesReceipts, DEFAULT_CLEARING_ACCOUNTS } from 'lib/quickbooks.js';
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { allTransactions, availableMonths } from 'lib/store.js';

export const access = 'member';
export const methods = ['GET'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function buildClearingAccounts() {
  const env = globalThis.process?.env ?? {};
  return {
    Credit_Visa: env.QBO_CLEARING_VISA ?? DEFAULT_CLEARING_ACCOUNTS.Credit_Visa,
    Credit_MC: env.QBO_CLEARING_MC ?? DEFAULT_CLEARING_ACCOUNTS.Credit_MC,
    Credit_Amex: env.QBO_CLEARING_AMEX ?? DEFAULT_CLEARING_ACCOUNTS.Credit_Amex,
    Credit_Discover: env.QBO_CLEARING_DISCOVER ?? DEFAULT_CLEARING_ACCOUNTS.Credit_Discover,
    Cash: env.QBO_CLEARING_CASH ?? DEFAULT_CLEARING_ACCOUNTS.Cash,
    Gift_Card: env.QBO_CLEARING_GIFT ?? DEFAULT_CLEARING_ACCOUNTS.Gift_Card,
    Other: env.QBO_CLEARING_OTHER ?? DEFAULT_CLEARING_ACCOUNTS.Other,
  };
}

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('data_export', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const month = req.query.month;
  if (typeof month !== 'string' || !MONTH_RE.test(month)) {
    return res.status(400).json({
      error: 'month_required',
      message: 'QuickBooks exports must be one month at a time (larger imports are rejected by QuickBooks as too large). Pass ?month=YYYY-MM.',
      availableMonths: await availableMonths(ctx),
    });
  }

  const txs = await allTransactions(ctx, month);

  let receipts;
  try {
    receipts = buildSalesReceipts(txs, buildClearingAccounts());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(422).json({ error: 'quickbooks_build_error', detail: msg });
  }

  return res.json({ location: ctx.locationName, month, transaction_count: txs.length, receipts });
}
