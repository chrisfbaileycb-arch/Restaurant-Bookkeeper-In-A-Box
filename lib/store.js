/**
 * POS transaction store — location-scoped. Every function requires the
 * workspace context ctx = {orgId, locationId}; dedup by transaction_id is
 * per location (ON CONFLICT (location_id, transaction_id)). The cadence
 * watchdog lives in location_import_status, one row per location.
 */
import { db } from 'hatchable';

const COLUMNS = [
  'organization_id', 'location_id',
  'transaction_id', 'source_pos', 'business_date', 'ts',
  'gross_sales', 'net_sales', 'discounts_applied', 'adjustments',
  'taxes_collected', 'tips', 'payment_method', 'auth_code',
  'customer_id', 'modifiers_json', 'postal_code', 'promo_code',
];

function txParams(ctx, tx) {
  return [
    ctx.orgId, ctx.locationId,
    tx.transaction_id, tx.source_pos, tx.business_date, tx.timestamp,
    tx.gross_sales, tx.net_sales, tx.discounts_applied, tx.adjustments,
    tx.taxes_collected, tx.tips, tx.payment_method, tx.auth_code,
    tx.customer_id, JSON.stringify(tx.modifiers_json),
    tx.postal_code ?? null, tx.promo_code ?? null,
  ];
}

/** Insert transactions for ctx's location. Returns count actually inserted. */
export async function insertTransactions(ctx, txs) {
  const CHUNK = 100;
  let added = 0;
  for (let i = 0; i < txs.length; i += CHUNK) {
    const chunk = txs.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((tx, rowIdx) => {
      const base = rowIdx * COLUMNS.length;
      params.push(...txParams(ctx, tx));
      return '(' + COLUMNS.map((_, colIdx) => '$' + (base + colIdx + 1)).join(',') + ')';
    });
    const result = await db.query(
      'INSERT INTO transactions (' + COLUMNS.join(',') + ') VALUES ' + tuples.join(',') +
        ' ON CONFLICT (location_id, transaction_id) DO NOTHING RETURNING transaction_id',
      params,
    );
    added += result.rows.length;
  }
  return added;
}

/** Transactions for ctx's location, optionally restricted to YYYY-MM. */
export async function allTransactions(ctx, month) {
  const result = month
    ? await db.query('SELECT * FROM transactions WHERE location_id = $1 AND business_date LIKE $2 ORDER BY id', [ctx.locationId, month + '-%'])
    : await db.query('SELECT * FROM transactions WHERE location_id = $1 ORDER BY id', [ctx.locationId]);
  return result.rows.map(rowToTx);
}

/** Distinct months (YYYY-MM) present for ctx's location, newest first. */
export async function availableMonths(ctx) {
  const result = await db.query(
    'SELECT DISTINCT left(business_date, 7) AS month FROM transactions WHERE location_id = $1 ORDER BY month DESC',
    [ctx.locationId],
  );
  return result.rows.map((r) => r.month);
}

function rowToTx(row) {
  const modifiers = typeof row.modifiers_json === 'string'
    ? JSON.parse(row.modifiers_json)
    : (row.modifiers_json ?? []);
  return {
    transaction_id: row.transaction_id,
    source_pos: row.source_pos,
    business_date: row.business_date,
    timestamp: row.ts,
    gross_sales: Number(row.gross_sales),
    net_sales: Number(row.net_sales),
    discounts_applied: Number(row.discounts_applied),
    adjustments: Number(row.adjustments),
    taxes_collected: Number(row.taxes_collected),
    tips: Number(row.tips),
    payment_method: row.payment_method,
    auth_code: row.auth_code,
    customer_id: row.customer_id,
    modifiers_json: modifiers,
    ...(row.postal_code ? { postal_code: row.postal_code } : {}),
    ...(row.promo_code ? { promo_code: row.promo_code } : {}),
  };
}

/** Record a successful import for ctx's location. */
export async function recordImportSuccess(ctx, weekOf, imported) {
  await db.query(
    'INSERT INTO location_import_status (organization_id, location_id, last_import_at, last_week_of, imported) ' +
      'VALUES ($1, $2, now(), $3, $4) ' +
      'ON CONFLICT (location_id) DO UPDATE SET last_import_at = now(), last_week_of = $3, imported = $4',
    [ctx.orgId, ctx.locationId, weekOf, imported],
  );
}

/** Last import-status record for ctx's location, or null. */
export async function getImportStatus(ctx) {
  const result = await db.query(
    'SELECT last_import_at, last_week_of, imported FROM location_import_status WHERE location_id = $1',
    [ctx.locationId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    lastImportAt: row.last_import_at instanceof Date ? row.last_import_at.toISOString() : row.last_import_at,
    lastWeekOf: row.last_week_of,
    imported: Number(row.imported),
  };
}
