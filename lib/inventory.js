/**
 * Part 12 — Periodic physical inventory (location-scoped).
 *
 * The operator counts what is actually on the shelf; the ledger says what
 * should be there (beginning inventory + purchases). The variance posts to a
 * dedicated COGS adjustment account (ledger > physical = product used or
 * lost → COGS up, inventory down; physical > ledger = COGS down), keeping
 * shrink/waste visible separately from purchases. Journal INV-<count_date>;
 * one count per location per date.
 */
import { db } from 'hatchable';
import { cents } from 'lib/contract.js';
import { accountBalance, postEntries } from 'lib/ledger.js';

export const CATEGORIES = [
  { key: 'food', inventoryAccount: 'Inventory - Food', adjustmentAccount: 'Food Cost - Inventory Adjustment' },
  { key: 'beverage', inventoryAccount: 'Inventory - Beverage', adjustmentAccount: 'Beverage Cost - Inventory Adjustment' },
  { key: 'paper', inventoryAccount: 'Inventory - Paper & Packaging', adjustmentAccount: 'Paper & Packaging Cost' },
];

/**
 * Pure: build the corrective entry from ledger-vs-physical pairs.
 * items: [{inventoryAccount, adjustmentAccount, ledgerBalance, physicalCount}]
 * Returns null when every variance is zero (nothing to post).
 */
export function buildAdjustmentEntry(countDate, items) {
  const lines = [];
  for (const it of items) {
    const variance = cents(it.ledgerBalance - it.physicalCount);
    if (variance === 0) continue;
    const desc = 'Physical count ' + countDate + ' — ' + it.inventoryAccount;
    if (variance > 0) {
      lines.push({ accountName: it.adjustmentAccount, description: desc, debit: variance, credit: 0 });
      lines.push({ accountName: it.inventoryAccount, description: desc, debit: 0, credit: variance });
    } else {
      lines.push({ accountName: it.inventoryAccount, description: desc, debit: -variance, credit: 0 });
      lines.push({ accountName: it.adjustmentAccount, description: desc, debit: 0, credit: -variance });
    }
  }
  if (lines.length === 0) return null;
  return {
    journalNo: 'INV-' + countDate,
    date: countDate,
    description: 'Periodic physical inventory adjustment',
    source: 'inventory_count',
    lines,
  };
}

/**
 * Record a count for ctx's location. counts: {food?, beverage?, paper?} —
 * omitted categories are skipped (not counted, not adjusted).
 */
export async function recordCount(ctx, countDate, counts) {
  const dup = await db.query(
    'SELECT id FROM inventory_counts WHERE location_id = $1 AND count_date = $2',
    [ctx.locationId, countDate],
  );
  if (dup.rows.length > 0) return { ok: false, error: 'count_already_recorded_for_date' };

  const items = [];
  const variances = { food: 0, beverage: 0, paper: 0 };
  for (const cat of CATEGORIES) {
    const physical = counts[cat.key];
    if (physical === null || physical === undefined) continue;
    if (!Number.isFinite(physical) || physical < 0) {
      return { ok: false, error: 'invalid_count', message: cat.key + ' count must be a nonnegative number' };
    }
    const ledgerBalance = await accountBalance(ctx, cat.inventoryAccount, countDate);
    items.push({ ...cat, ledgerBalance, physicalCount: cents(physical) });
    variances[cat.key] = cents(ledgerBalance - physical);
  }
  if (items.length === 0) return { ok: false, error: 'no_counts_provided' };

  const entry = buildAdjustmentEntry(countDate, items);
  if (entry) {
    const posted = await postEntries(ctx, [entry]);
    if (!posted.ok) return { ok: false, errors: posted.errors };
  }

  await db.query(
    'INSERT INTO inventory_counts (organization_id, location_id, count_date, food_count, beverage_count, paper_count, food_variance, beverage_variance, paper_variance) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [ctx.orgId, ctx.locationId, countDate,
      counts.food ?? null, counts.beverage ?? null, counts.paper ?? null,
      variances.food, variances.beverage, variances.paper],
  );

  return {
    ok: true,
    countDate,
    adjusted: entry !== null,
    variances: Object.fromEntries(items.map((it) => [it.key, cents(it.ledgerBalance - it.physicalCount)])),
  };
}

/** Count history for ctx's location, newest first. */
export async function listCounts(ctx) {
  const r = await db.query(
    'SELECT count_date, food_count, beverage_count, paper_count, food_variance, beverage_variance, paper_variance ' +
      'FROM inventory_counts WHERE location_id = $1 ORDER BY count_date DESC',
    [ctx.locationId],
  );
  return r.rows.map((row) => ({
    countDate: row.count_date,
    counts: { food: row.food_count === null ? null : Number(row.food_count), beverage: row.beverage_count === null ? null : Number(row.beverage_count), paper: row.paper_count === null ? null : Number(row.paper_count) },
    variances: { food: Number(row.food_variance), beverage: Number(row.beverage_variance), paper: Number(row.paper_variance) },
  }));
}
