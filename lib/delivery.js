/**
 * Part 10 — Third-party delivery reconciliation (location-scoped).
 *
 * Statement CSV (one row per platform payout period):
 * platform,period_start,period_end,gross_sales,commissions,marketing_fees,refunds,driver_tips,net_payout
 *
 * Reconciliation identity (enforced; file rejected otherwise):
 *   net_payout = gross_sales − commissions − marketing_fees − refunds
 * driver_tips are pass-through money the platform pays drivers directly —
 * recorded for reference, never posted to the ledger.
 *
 * Journal DL-<platform>-<period_end>:
 *   debits:  Delivery Payout Clearing (net payout, in transit to the bank),
 *            Delivery Commissions & Fees, Marketing (marketing_fees),
 *            Delivery Sales (refunds — contra-revenue)
 *   credit:  Delivery Sales (gross)
 * Bank matching later clears the payout from clearing into Cash.
 */
import { db } from 'hatchable';
import { splitCsvLine, cents } from 'lib/contract.js';
import { postEntries } from 'lib/ledger.js';

export const DELIVERY_CSV_HEADER =
  'platform,period_start,period_end,gross_sales,commissions,marketing_fees,refunds,driver_tips,net_payout';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_FIELDS = ['grossSales', 'commissions', 'marketingFees', 'refunds', 'driverTips', 'netPayout'];

// ── CSV parser (strict, all-or-nothing) ────────────────────────────────────

export function parseDeliveryCsv(csv) {
  const errors = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  if (lines[0].trim() !== DELIVERY_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + DELIVERY_CSV_HEADER + '"' }] };
  }

  const statements = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length !== 9) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 9' }); continue; }

    const s = {
      platform: cols[0],
      periodStart: cols[1],
      periodEnd: cols[2],
      grossSales: Number(cols[3]),
      commissions: Number(cols[4]),
      marketingFees: Number(cols[5]),
      refunds: Number(cols[6]),
      driverTips: Number(cols[7]),
      netPayout: Number(cols[8]),
    };

    if (!s.platform) errors.push({ line: i + 1, message: 'platform required' });
    if (!DATE_RE.test(s.periodStart)) errors.push({ line: i + 1, message: 'period_start must be YYYY-MM-DD' });
    if (!DATE_RE.test(s.periodEnd)) errors.push({ line: i + 1, message: 'period_end must be YYYY-MM-DD' });
    if (DATE_RE.test(s.periodStart) && DATE_RE.test(s.periodEnd) && s.periodEnd < s.periodStart) {
      errors.push({ line: i + 1, message: 'period_end before period_start' });
    }
    for (const f of NUMERIC_FIELDS) {
      if (!Number.isFinite(s[f]) || s[f] < 0) errors.push({ line: i + 1, message: f + ' must be a nonnegative number' });
    }

    const key = s.platform + '/' + s.periodStart + '/' + s.periodEnd;
    if (seen.has(key)) errors.push({ line: i + 1, message: 'duplicate platform/period in file: ' + key });
    seen.add(key);

    const expectedNet = cents(s.grossSales - s.commissions - s.marketingFees - s.refunds);
    if (NUMERIC_FIELDS.every((f) => Number.isFinite(s[f])) && Math.abs(expectedNet - cents(s.netPayout)) > 0.01) {
      errors.push({
        line: i + 1,
        message: 'net_payout does not reconcile: gross − commissions − marketing − refunds = ' +
          expectedNet.toFixed(2) + ' but file says ' + cents(s.netPayout).toFixed(2),
      });
    }
    if (s.grossSales <= 0) errors.push({ line: i + 1, message: 'gross_sales must be positive' });
    statements.push(s);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, statements };
}

// ── Journal construction + import ──────────────────────────────────────────

const line = (accountName, description, debit, credit) => ({ accountName, description, debit, credit });

/** Build the balanced journal entry for one statement. */
export function buildDeliveryEntry(s) {
  const desc = s.platform + ' ' + s.periodStart + ' → ' + s.periodEnd;
  return {
    journalNo: 'DL-' + s.platform + '-' + s.periodEnd,
    date: s.periodEnd,
    description: 'Delivery payout reconciliation — ' + desc,
    source: 'delivery_import',
    lines: [
      ...(s.netPayout > 0 ? [line('Delivery Payout Clearing', 'Payout in transit — ' + desc, cents(s.netPayout), 0)] : []),
      ...(s.commissions > 0 ? [line('Delivery Commissions & Fees', 'Platform commission — ' + desc, cents(s.commissions), 0)] : []),
      ...(s.marketingFees > 0 ? [line('Marketing', 'Platform marketing fees — ' + desc, cents(s.marketingFees), 0)] : []),
      ...(s.refunds > 0 ? [line('Delivery Sales', 'Customer refunds (contra-revenue) — ' + desc, cents(s.refunds), 0)] : []),
      line('Delivery Sales', 'Gross marketplace sales — ' + desc, 0, cents(s.grossSales)),
    ],
  };
}

/** Import statements for ctx's location: all-or-nothing, then post. */
export async function importStatements(ctx, statements) {
  const errors = [];
  for (const s of statements) {
    const dup = await db.query(
      'SELECT id FROM delivery_statements WHERE location_id = $1 AND platform = $2 AND period_start = $3 AND period_end = $4',
      [ctx.locationId, s.platform, s.periodStart, s.periodEnd],
    );
    if (dup.rows.length > 0) errors.push({ platform: s.platform, periodEnd: s.periodEnd, message: 'statement already imported for this platform/period' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const posted = await postEntries(ctx, statements.map(buildDeliveryEntry));
  if (!posted.ok) return { ok: false, errors: posted.errors };

  for (const s of statements) {
    await db.query(
      'INSERT INTO delivery_statements (organization_id, location_id, platform, period_start, period_end, gross_sales, commissions, marketing_fees, refunds, driver_tips, net_payout) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [ctx.orgId, ctx.locationId, s.platform, s.periodStart, s.periodEnd,
        cents(s.grossSales), cents(s.commissions), cents(s.marketingFees), cents(s.refunds), cents(s.driverTips), cents(s.netPayout)],
    );
  }
  return { ok: true, imported: statements.length, entriesPosted: posted.posted };
}

/** Imported statements for ctx's location, newest period first. */
export async function listStatements(ctx, platform) {
  const r = platform
    ? await db.query('SELECT * FROM delivery_statements WHERE location_id = $1 AND platform = $2 ORDER BY period_end DESC', [ctx.locationId, platform])
    : await db.query('SELECT * FROM delivery_statements WHERE location_id = $1 ORDER BY period_end DESC', [ctx.locationId]);
  return r.rows.map((row) => ({
    platform: row.platform,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossSales: Number(row.gross_sales),
    commissions: Number(row.commissions),
    marketingFees: Number(row.marketing_fees),
    refunds: Number(row.refunds),
    driverTips: Number(row.driver_tips),
    netPayout: Number(row.net_payout),
    effectiveRatePct: Number(row.gross_sales) > 0
      ? cents(((Number(row.commissions) + Number(row.marketing_fees)) / Number(row.gross_sales)) * 100)
      : null,
  }));
}
