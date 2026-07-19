/**
 * Post daily-sales journal entries into the ACTIVE location's ledger from
 * its POS transaction store. One balanced journal per business date;
 * idempotent via journal_no DS-<date> (per location).
 */
import { requireAck } from 'lib/disclaimers.js';
import { requireSubscription } from 'lib/billing.js';
import { getContext } from 'lib/tenant.js';
import { allTransactions } from 'lib/store.js';
import { postEntries } from 'lib/ledger.js';
import { cents } from 'lib/contract.js';

export const access = 'member';
export const methods = ['POST'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const TENDER_ACCOUNT = {
  Cash: 'Cash Drawer',
  Credit_Visa: 'Visa Clearing Account',
  Credit_MC: 'Mastercard Clearing Account',
  Credit_Amex: 'Amex Clearing Account',
  Credit_Discover: 'Discover Clearing Account',
  Gift_Card: 'Gift Card Liability',
  Other: 'Other Tender Clearing',
};

export default async function (req, res) {
  if (!(await requireSubscription(req, res))) return;
  if (!requireAck('manual_import', req, res)) return;
  const ctx = await getContext(req, res);
  if (!ctx) return;

  const month = req.body?.month;
  if (typeof month !== 'string' || !MONTH_RE.test(month)) {
    return res.status(400).json({ error: 'month_required', message: 'Pass {"month":"YYYY-MM"}.' });
  }

  const txs = await allTransactions(ctx, month);
  if (txs.length === 0) {
    return res.status(404).json({ error: 'no_transactions_for_month', month });
  }

  const byDate = new Map();
  for (const tx of txs) {
    if (!byDate.has(tx.business_date)) byDate.set(tx.business_date, new Map());
    const tenders = byDate.get(tx.business_date);
    const t = tenders.get(tx.payment_method) ?? { net: 0, tax: 0, tips: 0 };
    t.net += tx.net_sales; t.tax += tx.taxes_collected; t.tips += tx.tips;
    tenders.set(tx.payment_method, t);
  }

  const entries = [];
  for (const [date, tenders] of [...byDate.entries()].sort()) {
    const lines = [];
    let net = 0, tax = 0, tips = 0;
    for (const [tender, t] of tenders) {
      const collected = cents(t.net + t.tax + t.tips);
      if (collected !== 0) {
        lines.push({ accountName: TENDER_ACCOUNT[tender], description: 'Daily sales — ' + tender, debit: collected, credit: 0, categoryTag: 'daily_sales' });
      }
      net += t.net; tax += t.tax; tips += t.tips;
    }
    if (cents(net) > 0) lines.push({ accountName: 'Food Sales', description: 'Daily sales summary', debit: 0, credit: cents(net), categoryTag: 'daily_sales' });
    if (cents(tax) > 0) lines.push({ accountName: 'Sales Tax Payable - CO', description: 'Sales tax collected', debit: 0, credit: cents(tax), categoryTag: 'sales_tax' });
    if (cents(tips) > 0) lines.push({ accountName: 'Tips Payable', description: 'Tips collected', debit: 0, credit: cents(tips), categoryTag: 'tips' });
    if (lines.length >= 2) {
      entries.push({ journalNo: 'DS-' + date, date, description: 'Daily Sales Summary', source: 'pos_import', lines });
    }
  }

  const result = await postEntries(ctx, entries, { skipExisting: true });
  if (!result.ok) {
    return res.status(422).json({ error: 'ledger_validation_failed', errors: result.errors });
  }

  return res.json({ location: ctx.locationName, month, datesPosted: result.posted, datesSkipped: result.skipped, lines: result.lines });
}
