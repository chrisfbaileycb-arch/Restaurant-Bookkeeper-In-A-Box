/**
 * Part 6 — Check reconciliation engine (location-scoped).
 *
 * Check Register CSV:  check_number,check_date,payee,written_amount,memo,bank_account_id
 * Cleared Checks CSV:  check_number,cleared_date,cleared_amount,description,routing_number,account_number_last4,bank_account_id
 * bank_account_id may be blank → 'primary'. Phone/MICR scanning is phase 2;
 * the cleared_checks schema already carries routing/last4/image_ref for it.
 *
 * Matching (within the active location + bank account, by check_number):
 *   register + cleared, amounts equal   → register 'cleared',        cleared 'matched'
 *   register + cleared, amounts differ  → both 'amount_mismatch'
 *   register only                       → stays 'outstanding'
 *   cleared only                        → 'missing_from_register'
 *
 * Reconciliation: starting bank balance − outstanding checks ± corrections
 * (cleared − written on mismatches) = reconciled cash balance, compared to
 * the location's ledger cash balance.
 */
import { db } from 'hatchable';
import { splitCsvLine, cents } from 'lib/contract.js';

export const REGISTER_CSV_HEADER = 'check_number,check_date,payee,written_amount,memo,bank_account_id';
export const CLEARED_CSV_HEADER = 'check_number,cleared_date,cleared_amount,description,routing_number,account_number_last4,bank_account_id';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── CSV parsers (strict, all-or-nothing) ──────────────────────────────────

export function parseRegisterCsv(csv) {
  const errors = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  if (lines[0].trim() !== REGISTER_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + REGISTER_CSV_HEADER + '"' }] };
  }
  const checks = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length !== 6) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 6' }); continue; }
    const [checkNumber, checkDate, payee, amountRaw, memo, bankRaw] = cols;
    const bankAccountId = bankRaw || 'primary';
    const amount = Number(amountRaw);
    if (!checkNumber) errors.push({ line: i + 1, message: 'check_number required' });
    const key = bankAccountId + '/' + checkNumber;
    if (seen.has(key)) errors.push({ line: i + 1, message: 'duplicate check_number in file: ' + checkNumber });
    seen.add(key);
    if (!DATE_RE.test(checkDate)) errors.push({ line: i + 1, message: 'check_date must be YYYY-MM-DD' });
    if (!payee) errors.push({ line: i + 1, message: 'payee required' });
    if (!Number.isFinite(amount) || amount <= 0) errors.push({ line: i + 1, message: 'written_amount must be a positive number' });
    checks.push({ checkNumber, checkDate, payee, writtenAmount: cents(amount), memo, bankAccountId });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, checks };
}

export function parseClearedCsv(csv) {
  const errors = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  if (lines[0].trim() !== CLEARED_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + CLEARED_CSV_HEADER + '"' }] };
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length !== 7) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 7' }); continue; }
    const [checkNumber, clearedDate, amountRaw, description, routing, last4, bankRaw] = cols;
    const amount = Number(amountRaw);
    if (!DATE_RE.test(clearedDate)) errors.push({ line: i + 1, message: 'cleared_date must be YYYY-MM-DD' });
    if (!Number.isFinite(amount) || amount <= 0) errors.push({ line: i + 1, message: 'cleared_amount must be a positive number' });
    rows.push({
      checkNumber, clearedDate, clearedAmount: cents(amount), description,
      routingNumber: routing || null, accountNumberLast4: last4 || null,
      bankAccountId: bankRaw || 'primary',
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

// ── Writes (location-scoped) ───────────────────────────────────────────────

/** Strict register insert: duplicate (bank, check_number) rejects the file. */
export async function insertRegister(ctx, checks) {
  const errors = [];
  for (const c of checks) {
    const dup = await db.query(
      'SELECT id FROM check_register WHERE location_id = $1 AND bank_account_id = $2 AND check_number = $3',
      [ctx.locationId, c.bankAccountId, c.checkNumber],
    );
    if (dup.rows.length > 0) errors.push({ checkNumber: c.checkNumber, message: 'already in register for this bank account' });
  }
  if (errors.length > 0) return { ok: false, errors };
  for (const c of checks) {
    await db.query(
      'INSERT INTO check_register (organization_id, location_id, bank_account_id, check_number, check_date, payee, written_amount, memo) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctx.orgId, ctx.locationId, c.bankAccountId, c.checkNumber, c.checkDate, c.payee, c.writtenAmount, c.memo],
    );
  }
  return { ok: true, registered: checks.length };
}

/** Cleared-check import; statement re-imports dedupe silently. */
export async function insertCleared(ctx, rows) {
  let imported = 0, duplicates = 0;
  for (const r of rows) {
    const result = await db.query(
      'INSERT INTO cleared_checks (organization_id, location_id, bank_account_id, check_number, cleared_date, cleared_amount, description, routing_number, account_number_last4) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ' +
        'ON CONFLICT (location_id, bank_account_id, check_number, cleared_date, cleared_amount) DO NOTHING RETURNING id',
      [ctx.orgId, ctx.locationId, r.bankAccountId, r.checkNumber, r.clearedDate, r.clearedAmount, r.description, r.routingNumber, r.accountNumberLast4],
    );
    if (result.rows.length > 0) imported++; else duplicates++;
  }
  return { imported, duplicates };
}

// ── Matching engine ────────────────────────────────────────────────────────

/** Run matching for the active location. Returns a summary. */
export async function runMatching(ctx) {
  const summary = { matched: 0, amountMismatches: 0, missingFromRegister: 0 };

  const cleared = await db.query(
    "SELECT * FROM cleared_checks WHERE location_id = $1 AND match_status = 'unmatched' ORDER BY cleared_date, id",
    [ctx.locationId],
  );

  for (const cc of cleared.rows) {
    if (!cc.check_number) {
      await db.query("UPDATE cleared_checks SET match_status = 'missing_from_register' WHERE id = $1", [cc.id]);
      summary.missingFromRegister++;
      continue;
    }
    const reg = await db.query(
      "SELECT * FROM check_register WHERE location_id = $1 AND bank_account_id = $2 AND check_number = $3 AND status != 'void'",
      [ctx.locationId, cc.bank_account_id, cc.check_number],
    );
    if (reg.rows.length === 0) {
      await db.query("UPDATE cleared_checks SET match_status = 'missing_from_register' WHERE id = $1", [cc.id]);
      summary.missingFromRegister++;
      continue;
    }
    const r = reg.rows[0];
    if (cents(Number(r.written_amount)) === cents(Number(cc.cleared_amount))) {
      await db.query("UPDATE check_register SET status = 'cleared' WHERE id = $1", [r.id]);
      await db.query("UPDATE cleared_checks SET match_status = 'matched', matched_register_id = $2 WHERE id = $1", [cc.id, r.id]);
      summary.matched++;
    } else {
      await db.query("UPDATE check_register SET status = 'amount_mismatch' WHERE id = $1", [r.id]);
      await db.query("UPDATE cleared_checks SET match_status = 'amount_mismatch', matched_register_id = $2 WHERE id = $1", [cc.id, r.id]);
      summary.amountMismatches++;
    }
  }
  return summary;
}

// ── Views + reconciliation ─────────────────────────────────────────────────

function regRow(c) {
  return {
    id: Number(c.id), bankAccountId: c.bank_account_id, checkNumber: c.check_number,
    checkDate: c.check_date, payee: c.payee, writtenAmount: Number(c.written_amount),
    memo: c.memo, status: c.status,
  };
}

export async function listRegister(ctx, status) {
  const r = status
    ? await db.query('SELECT * FROM check_register WHERE location_id = $1 AND status = $2 ORDER BY check_date, check_number', [ctx.locationId, status])
    : await db.query('SELECT * FROM check_register WHERE location_id = $1 ORDER BY check_date, check_number', [ctx.locationId]);
  return r.rows.map(regRow);
}

export async function setCheckStatus(ctx, checkNumber, bankAccountId, status) {
  const r = await db.query(
    'UPDATE check_register SET status = $4 WHERE location_id = $1 AND bank_account_id = $2 AND check_number = $3 RETURNING check_number, status',
    [ctx.locationId, bankAccountId, checkNumber, status],
  );
  return r.rows[0] ?? null;
}

/** Cleared-vs-written discrepancy report + unregistered bank activity. */
export async function discrepancyReport(ctx) {
  const mismatches = await db.query(
    'SELECT cc.check_number, cc.bank_account_id, cc.cleared_date, cc.cleared_amount, r.written_amount, r.payee ' +
      "FROM cleared_checks cc JOIN check_register r ON r.id = cc.matched_register_id " +
      "WHERE cc.location_id = $1 AND cc.match_status = 'amount_mismatch' ORDER BY cc.cleared_date",
    [ctx.locationId],
  );
  const missing = await db.query(
    "SELECT check_number, bank_account_id, cleared_date, cleared_amount, description FROM cleared_checks " +
      "WHERE location_id = $1 AND match_status = 'missing_from_register' ORDER BY cleared_date",
    [ctx.locationId],
  );
  return {
    amountMismatches: mismatches.rows.map((m) => ({
      checkNumber: m.check_number, bankAccountId: m.bank_account_id, payee: m.payee,
      writtenAmount: Number(m.written_amount), clearedAmount: Number(m.cleared_amount),
      difference: cents(Number(m.cleared_amount) - Number(m.written_amount)), clearedDate: m.cleared_date,
    })),
    missingFromRegister: missing.rows.map((m) => ({
      checkNumber: m.check_number || null, bankAccountId: m.bank_account_id,
      clearedDate: m.cleared_date, clearedAmount: Number(m.cleared_amount), description: m.description,
    })),
  };
}

/**
 * Bank reconciliation summary:
 *   startingBalance − outstanding ± corrections = reconciledCashBalance
 * corrections = Σ(cleared − written) on amount mismatches (bank cleared more
 * or less than the register recorded).
 */
export async function reconciliationSummary(ctx, asOf, startingBalance, ledgerCashBalance) {
  const outstanding = (await listRegister(ctx, 'outstanding')).filter((c) => c.checkDate <= asOf);
  const outstandingTotal = cents(outstanding.reduce((s, c) => s + c.writtenAmount, 0));
  const disc = await discrepancyReport(ctx);
  const corrections = cents(disc.amountMismatches.reduce((s, m) => s + m.difference, 0));

  const summary = {
    asOf,
    outstandingChecks: outstanding,
    outstandingTotal,
    corrections,
    discrepancies: disc,
  };
  if (startingBalance !== null) {
    summary.startingBankBalance = startingBalance;
    summary.reconciledCashBalance = cents(startingBalance - outstandingTotal - corrections);
    if (ledgerCashBalance !== null) {
      summary.ledgerCashBalance = ledgerCashBalance;
      summary.difference = cents(summary.reconciledCashBalance - ledgerCashBalance);
      summary.reconciled = Math.abs(summary.difference) < 0.01;
    }
  }
  return summary;
}
