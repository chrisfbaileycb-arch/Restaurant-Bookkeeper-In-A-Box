/**
 * Import a full bank statement feed for the ACTIVE location — member +
 * subscription + bank_import ack. Deposits match to clearing accounts and
 * post; check withdrawals route to the cleared-checks matcher; unmatched
 * rows are parked for review (GET returns them).
 * CSV: txn_date,description,amount,fee_amount,bank_account_id
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { parseBankFeedCsv, processBankFeed, listUnmatched } from 'lib/bankfeed.js';

export const access = 'member';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  const ctx0 = req.method === 'GET' ? await getContext(req, res) : null;
  if (req.method === 'GET') {
    if (!ctx0) return;
    return res.json({ location: ctx0.locationName, unmatched: await listUnmatched(ctx0) });
  }

  if (!requireAck('bank_import', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  if (!req.body || typeof req.body.csv !== 'string') {
    return res.status(422).json({ error: 'strict_validation_failed', errors: [{ line: 0, message: 'missing_csv_field' }] });
  }

  const parsed = parseBankFeedCsv(req.body.csv);
  if (!parsed.ok) return res.status(422).json({ error: 'strict_validation_failed', errors: parsed.errors });

  const result = await processBankFeed(ctx, parsed.rows);
  if (!result.ok) return res.status(422).json({ error: 'bank_feed_failed', errors: result.errors });

  const { ok, ...summary } = result;
  return res.json({ location: ctx.locationName, ...summary });
}
