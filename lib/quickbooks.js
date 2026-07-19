/**
 * QuickBooks Online sales-receipt builder.
 *
 * Groups NormalizedTransaction records by business_date + payment_method into
 * daily sales-receipt summaries mapped to QBO clearing accounts. Includes a
 * zero-variance guard to confirm receipts reconcile with source transactions.
 * Ported unchanged from the core-pipeline service (pure logic).
 */
import { cents } from 'lib/contract.js';

export const DEFAULT_CLEARING_ACCOUNTS = {
  Credit_Visa: 'Visa Clearing Account',
  Credit_MC: 'Mastercard Clearing Account',
  Credit_Amex: 'Amex Clearing Account',
  Credit_Discover: 'Discover Clearing Account',
  Cash: 'Cash Drawer',
  Gift_Card: 'Gift Card Liability',
  Other: 'Other Tender Clearing',
};

/**
 * Group NormalizedTransactions by (business_date, payment_method) and build
 * daily sales receipts mapped to QBO clearing accounts.
 *
 * Throws if any receipt's gross_total would be negative
 * (Intuit Error 6000 guard — QBO rejects negative sales receipts).
 */
export function buildSalesReceipts(txs, clearingAccounts) {
  const buckets = new Map();

  for (const tx of txs) {
    const key = tx.business_date + '::' + tx.payment_method;
    const bucket = buckets.get(key) ?? [];
    bucket.push(tx);
    buckets.set(key, bucket);
  }

  const receipts = [];

  for (const [key, bucket] of buckets) {
    const [businessDate, paymentMethod] = key.split('::');

    const grossTotal = cents(bucket.reduce((s, t) => s + t.gross_sales, 0));
    const netTotal = cents(bucket.reduce((s, t) => s + t.net_sales, 0));
    const taxTotal = cents(bucket.reduce((s, t) => s + t.taxes_collected, 0));
    const tipTotal = cents(bucket.reduce((s, t) => s + t.tips, 0));
    const discountTotal = cents(bucket.reduce((s, t) => s + t.discounts_applied, 0));

    // Intuit Error 6000 guard: QBO cannot accept negative sales receipt totals
    if (grossTotal < 0) {
      throw new Error(
        '[QBO Error 6000 guard] Negative gross total ' + grossTotal + ' for ' +
          businessDate + ' / ' + paymentMethod + ' — check for unbalanced voids.',
      );
    }

    const lines = [
      { description: 'Gross Sales — ' + paymentMethod, amount: grossTotal },
      { description: 'Tax Collected', amount: taxTotal },
      { description: 'Tips', amount: tipTotal },
      { description: 'Discounts Applied', amount: -discountTotal },
    ].filter((l) => l.amount !== 0);

    receipts.push({
      business_date: businessDate,
      payment_method: paymentMethod,
      clearing_account: clearingAccounts[paymentMethod] ?? DEFAULT_CLEARING_ACCOUNTS[paymentMethod],
      gross_total: grossTotal,
      net_total: netTotal,
      tax_total: taxTotal,
      tip_total: tipTotal,
      discount_total: discountTotal,
      transaction_count: bucket.length,
      lines,
    });
  }

  // Sort for deterministic output: date then payment_method
  receipts.sort((a, b) => {
    const d = a.business_date.localeCompare(b.business_date);
    return d !== 0 ? d : a.payment_method.localeCompare(b.payment_method);
  });

  return receipts;
}

/**
 * Assert that receipt totals reconcile with source transaction totals to the cent.
 * Call this after buildSalesReceipts() to verify no data was lost or duplicated.
 * Throws with details if any monetary field is out of balance.
 */
export function verifyZeroVariance(txs, receipts) {
  const txGross = cents(txs.reduce((s, t) => s + t.gross_sales, 0));
  const txNet = cents(txs.reduce((s, t) => s + t.net_sales, 0));
  const txTax = cents(txs.reduce((s, t) => s + t.taxes_collected, 0));
  const txTip = cents(txs.reduce((s, t) => s + t.tips, 0));

  const rcGross = cents(receipts.reduce((s, r) => s + r.gross_total, 0));
  const rcNet = cents(receipts.reduce((s, r) => s + r.net_total, 0));
  const rcTax = cents(receipts.reduce((s, r) => s + r.tax_total, 0));
  const rcTip = cents(receipts.reduce((s, r) => s + r.tip_total, 0));

  const errors = [];
  if (Math.abs(txGross - rcGross) > 0.005) errors.push('gross_sales variance: txs=' + txGross + ' receipts=' + rcGross);
  if (Math.abs(txNet - rcNet) > 0.005) errors.push('net_sales variance: txs=' + txNet + ' receipts=' + rcNet);
  if (Math.abs(txTax - rcTax) > 0.005) errors.push('taxes_collected variance: txs=' + txTax + ' receipts=' + rcTax);
  if (Math.abs(txTip - rcTip) > 0.005) errors.push('tips variance: txs=' + txTip + ' receipts=' + rcTip);

  if (errors.length > 0) {
    throw new Error('Zero-variance assertion failed:\n' + errors.join('\n'));
  }
}
