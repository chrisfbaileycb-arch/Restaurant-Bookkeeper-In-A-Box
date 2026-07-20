/**
 * Part 13 — POS daily-summary normalizer (location-scoped).
 *
 * Meets operators where they are: Toast/Clover/Square daily summary exports
 * normalize into ONE canonical contract with REAL category splits — no
 * hardcoded food/beverage ratios (the v5 prototype's 80/20 shortcut is
 * deliberately not ported):
 *
 * source_pos,business_date,food_sales,beverage_sales,sales_tax,cc_tips,cash_drops,gift_cards,processing_fees,actual_cash_drop
 *
 * One row per business date. actual_cash_drop (optional) is what was really
 * counted at the safe drop — the difference from expected cash posts to
 * Cash Over/Short. Card collections (everything not taken in cash) debit
 * Other Tender Clearing net of processing fees; the bank feed clears them.
 * Journal DSUM-<pos>-<date>, idempotent per date.
 */
import { splitCsvLine, cents } from 'lib/contract.js';
import { postEntries } from 'lib/ledger.js';

export const POS_SUMMARY_CSV_HEADER =
  'source_pos,business_date,food_sales,beverage_sales,sales_tax,cc_tips,cash_drops,gift_cards,processing_fees,actual_cash_drop';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = ['Toast', 'Clover', 'Square', 'Other'];
const NUMERIC_FIELDS = ['foodSales', 'beverageSales', 'salesTax', 'ccTips', 'cashDrops', 'giftCards', 'processingFees'];

// ── CSV parser (strict, all-or-nothing) ────────────────────────────────────

export function parsePosSummaryCsv(csv) {
  const errors = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  if (lines[0].trim() !== POS_SUMMARY_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + POS_SUMMARY_CSV_HEADER + '"' }] };
  }

  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length !== 10) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 10' }); continue; }

    const row = {
      sourcePos: cols[0],
      businessDate: cols[1],
      foodSales: Number(cols[2]),
      beverageSales: Number(cols[3]),
      salesTax: Number(cols[4]),
      ccTips: Number(cols[5]),
      cashDrops: Number(cols[6]),
      giftCards: Number(cols[7]),
      processingFees: Number(cols[8] === '' ? 0 : cols[8]),
      actualCashDrop: cols[9] === '' ? null : Number(cols[9]),
    };

    if (!SOURCES.includes(row.sourcePos)) errors.push({ line: i + 1, message: 'source_pos must be one of ' + SOURCES.join('|') });
    if (!DATE_RE.test(row.businessDate)) errors.push({ line: i + 1, message: 'business_date must be YYYY-MM-DD' });
    const key = row.sourcePos + '/' + row.businessDate;
    if (seen.has(key)) errors.push({ line: i + 1, message: 'duplicate source_pos/business_date in file: ' + key });
    seen.add(key);
    for (const f of NUMERIC_FIELDS) {
      if (!Number.isFinite(row[f]) || row[f] < 0) errors.push({ line: i + 1, message: f + ' must be a nonnegative number' });
    }
    if (row.actualCashDrop !== null && (!Number.isFinite(row.actualCashDrop) || row.actualCashDrop < 0)) {
      errors.push({ line: i + 1, message: 'actual_cash_drop must be a nonnegative number when present' });
    }

    if (NUMERIC_FIELDS.every((f) => Number.isFinite(row[f]))) {
      const collected = cents(row.foodSales + row.beverageSales + row.salesTax + row.ccTips + row.giftCards);
      if (collected <= 0) errors.push({ line: i + 1, message: 'nothing collected — all amounts zero' });
      const cardGross = cents(collected - row.cashDrops);
      if (cardGross < 0) errors.push({ line: i + 1, message: 'cash_drops exceeds total collected' });
      if (row.processingFees > 0 && row.processingFees > cardGross) {
        errors.push({ line: i + 1, message: 'processing_fees exceeds card collections' });
      }
    }
    rows.push(row);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

// ── Journal construction ───────────────────────────────────────────────────

const line = (accountName, description, debit, credit) => ({ accountName, description, debit, credit });

/** Balanced daily-summary entry for one normalized row. */
export function buildSummaryEntry(row) {
  const desc = row.sourcePos + ' daily summary ' + row.businessDate;
  const collected = cents(row.foodSales + row.beverageSales + row.salesTax + row.ccTips + row.giftCards);
  const cardGross = cents(collected - row.cashDrops);
  const actualCash = row.actualCashDrop ?? row.cashDrops;
  const overShort = cents(actualCash - row.cashDrops); // + = drawer over, − = short

  return {
    journalNo: 'DSUM-' + row.sourcePos + '-' + row.businessDate,
    date: row.businessDate,
    description: desc,
    source: 'pos_summary',
    lines: [
      ...(actualCash > 0 ? [line('Cash Drawer', 'Cash collected — ' + desc, cents(actualCash), 0)] : []),
      ...(cardGross > 0 ? [line('Other Tender Clearing', 'Card collections — ' + desc, cents(cardGross - row.processingFees), 0)] : []),
      ...(row.processingFees > 0 ? [line('POS and Software Fees', 'Processing fees — ' + desc, cents(row.processingFees), 0)] : []),
      ...(overShort < 0 ? [line('Cash Over/Short', 'Drawer short — ' + desc, cents(-overShort), 0)] : []),
      ...(row.foodSales > 0 ? [line('Food Sales', desc, 0, cents(row.foodSales))] : []),
      ...(row.beverageSales > 0 ? [line('Beverage Sales', desc, 0, cents(row.beverageSales))] : []),
      ...(row.salesTax > 0 ? [line('Sales Tax Payable - CO', 'Sales tax — ' + desc, 0, cents(row.salesTax))] : []),
      ...(row.ccTips > 0 ? [line('Tips Payable', 'Card tips — ' + desc, 0, cents(row.ccTips))] : []),
      ...(row.giftCards > 0 ? [line('Gift Card Liability', 'Gift cards activated — ' + desc, 0, cents(row.giftCards))] : []),
      ...(overShort > 0 ? [line('Cash Over/Short', 'Drawer over — ' + desc, 0, cents(overShort))] : []),
    ],
  };
}

/** Post all rows; idempotent per source/date via DSUM- journal numbers. */
export async function importSummaries(ctx, rows) {
  const result = await postEntries(ctx, rows.map(buildSummaryEntry), { skipExisting: true });
  if (!result.ok) return result;
  return { ok: true, days: rows.length, entriesPosted: result.posted, entriesSkipped: result.skipped, lines: result.lines };
}
