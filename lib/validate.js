/**
 * Strict-Schema Validator for manual CSV imports.
 *
 * Enforces the EXACT canonical CSV_HEADER — no legacy columns, no extra
 * columns, no missing columns. Any row parse failure causes the ENTIRE file
 * to be rejected (all-or-nothing; no partial import).
 *
 * Row parsing is done in two passes:
 *   1. Split CSV columns and parse into raw objects.
 *   2. Schema-validate after sanitizePayload so prototype-pollution attempts
 *      in modifiers_json are intercepted before any schema enforcement.
 *
 * The original service validated with Zod; the schema below is the same
 * NormalizedTransaction contract expressed as plain checks.
 */
import { CSV_HEADER, splitCsvLine } from 'lib/contract.js';
import { sanitizePayload } from 'lib/sanitize.js';

export const POS_SOURCES = ['Toast', 'Heartland', 'Square', 'Clover', 'Manual'];
export const PAYMENT_METHODS = [
  'Credit_Visa',
  'Credit_MC',
  'Credit_Amex',
  'Credit_Discover',
  'Cash',
  'Gift_Card',
  'Other',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const CANONICAL_HEADER = CSV_HEADER.join(',');

/**
 * Validate one raw row object against the NormalizedTransaction contract.
 * Returns { ok:true, value } with defaults applied, or { ok:false, issues:[...] }.
 */
export function validateTransaction(raw) {
  const issues = [];
  const v = raw ?? {};

  if (typeof v.transaction_id !== 'string' || v.transaction_id.length < 1) {
    issues.push('transaction_id: required non-empty string');
  }
  if (!POS_SOURCES.includes(v.source_pos)) {
    issues.push('source_pos: must be one of ' + POS_SOURCES.join('|'));
  }
  if (typeof v.business_date !== 'string' || !DATE_RE.test(v.business_date)) {
    issues.push('business_date: must match YYYY-MM-DD');
  }
  if (typeof v.timestamp !== 'string' || !DATETIME_RE.test(v.timestamp) || isNaN(Date.parse(v.timestamp))) {
    issues.push('timestamp: must be an ISO 8601 datetime');
  }
  for (const field of ['gross_sales', 'net_sales', 'discounts_applied', 'taxes_collected', 'tips']) {
    const n = v[field];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      issues.push(field + ': must be a nonnegative finite number');
    }
  }
  if (typeof v.adjustments !== 'number' || !Number.isFinite(v.adjustments)) {
    issues.push('adjustments: must be a finite number');
  }
  if (!PAYMENT_METHODS.includes(v.payment_method)) {
    issues.push('payment_method: must be one of ' + PAYMENT_METHODS.join('|'));
  }
  if (v.auth_code !== undefined && typeof v.auth_code !== 'string') {
    issues.push('auth_code: must be a string');
  }
  if (v.customer_id !== undefined && typeof v.customer_id !== 'string') {
    issues.push('customer_id: must be a string');
  }
  let modifiers = v.modifiers_json;
  if (modifiers === undefined) modifiers = [];
  if (!Array.isArray(modifiers)) {
    issues.push('modifiers_json: must be an array');
  } else {
    modifiers.forEach((m, i) => {
      if (
        m === null || typeof m !== 'object' || Array.isArray(m) ||
        typeof m.name !== 'string' || m.name.length < 1 ||
        typeof m.price !== 'number' || !Number.isFinite(m.price)
      ) {
        issues.push('modifiers_json[' + i + ']: must be {name: non-empty string, price: finite number}');
      }
    });
  }
  for (const field of ['postal_code', 'promo_code', 'tenant_id']) {
    if (v[field] !== undefined && typeof v[field] !== 'string') {
      issues.push(field + ': must be a string');
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      transaction_id: v.transaction_id,
      source_pos: v.source_pos,
      business_date: v.business_date,
      timestamp: v.timestamp,
      gross_sales: v.gross_sales,
      net_sales: v.net_sales,
      discounts_applied: v.discounts_applied,
      adjustments: v.adjustments,
      taxes_collected: v.taxes_collected,
      tips: v.tips,
      payment_method: v.payment_method,
      auth_code: v.auth_code ?? 'N/A',
      customer_id: v.customer_id ?? '',
      modifiers_json: modifiers.map((m) => ({ name: m.name, price: m.price })),
      ...(v.postal_code !== undefined ? { postal_code: v.postal_code } : {}),
      ...(v.promo_code !== undefined ? { promo_code: v.promo_code } : {}),
    },
  };
}

/**
 * Strictly validate and parse a CSV string.
 *
 * - Line 1 MUST equal the canonical header exactly.
 * - Each data row is parsed into a raw object, run through sanitizePayload
 *   (drops __proto__ etc.), then schema-validated.
 * - On ANY error the entire file is rejected with ALL accumulated errors.
 */
export function strictValidateCsv(csv) {
  const errors = [];
  const allAclViolations = [];

  const rawLines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) {
    return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  }

  const header = rawLines[0];
  if (header !== CANONICAL_HEADER) {
    return {
      ok: false,
      errors: [{ line: 1, message: 'header_mismatch: expected "' + CANONICAL_HEADER + '", got "' + header + '"' }],
    };
  }

  const dataLines = rawLines.slice(1);
  const goodRows = [];

  for (let i = 0; i < dataLines.length; i++) {
    const lineNum = i + 2; // 1-indexed; +1 for header
    const line = dataLines[i];

    try {
      const cols = splitCsvLine(line);
      if (cols.length !== CSV_HEADER.length) {
        errors.push({ line: lineNum, message: 'column_count_mismatch: expected ' + CSV_HEADER.length + ', got ' + cols.length });
        continue;
      }

      // Parse modifiers_json as raw JS (pre-validation) so sanitizePayload can see __proto__
      let modifiersRaw;
      try {
        modifiersRaw = JSON.parse(cols[13] || '[]');
      } catch {
        modifiersRaw = [];
      }

      const rawRow = {
        transaction_id: cols[0],
        source_pos: cols[1],
        business_date: cols[2],
        timestamp: cols[3],
        gross_sales: Number(cols[4]),
        net_sales: Number(cols[5]),
        discounts_applied: Number(cols[6]),
        adjustments: Number(cols[7]),
        taxes_collected: Number(cols[8]),
        tips: Number(cols[9]),
        payment_method: cols[10],
        auth_code: cols[11],
        customer_id: cols[12],
        modifiers_json: modifiersRaw,
        ...(cols[14] ? { postal_code: cols[14] } : {}),
        ...(cols[15] ? { promo_code: cols[15] } : {}),
      };

      // Sanitize before schema validation (catches __proto__ etc.)
      const sanitized = sanitizePayload(rawRow);
      allAclViolations.push(...sanitized.violations);

      const parsed = validateTransaction(sanitized.value);
      if (!parsed.ok) {
        errors.push({ line: lineNum, message: parsed.issues.join('; ') });
        continue;
      }

      goodRows.push(parsed.value);
    } catch (err) {
      errors.push({ line: lineNum, message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, rows: goodRows, aclViolations: allAclViolations };
}
