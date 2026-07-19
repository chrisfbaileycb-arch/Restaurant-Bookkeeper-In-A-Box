/**
 * Canonical Expo Proxy data contract — CSV serialization + cadence helpers.
 * Ported from the vendored @expo-proxy/shared package (csv.ts, cadence.ts, utils).
 */

export const CSV_HEADER = [
  'transaction_id',
  'source_pos',
  'business_date',
  'timestamp',
  'gross_sales',
  'net_sales',
  'discounts_applied',
  'adjustments',
  'taxes_collected',
  'tips',
  'payment_method',
  'auth_code',
  'customer_id',
  'modifiers_json',
  'postal_code',
  'promo_code',
];

function escapeField(v) {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

/** Parse a single CSV line respecting RFC-4180 quoting. */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Serialize normalized transactions into the canonical Expo Proxy CSV. */
export function toCsv(rows) {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.transaction_id,
        r.source_pos,
        r.business_date,
        r.timestamp,
        r.gross_sales.toFixed(2),
        r.net_sales.toFixed(2),
        r.discounts_applied.toFixed(2),
        r.adjustments.toFixed(2),
        r.taxes_collected.toFixed(2),
        r.tips.toFixed(2),
        r.payment_method,
        r.auth_code,
        r.customer_id,
        escapeField(JSON.stringify(r.modifiers_json)),
        r.postal_code ?? '',
        r.promo_code ?? '',
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** Round to cents using half-up rounding (avoids floating-point drift). */
export function cents(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const DAY_MS = 86_400_000;

/** UTC midnight of the Sunday that STARTS the cycle containing `date`. */
export function cycleStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(d.getTime() - d.getUTCDay() * DAY_MS);
}
