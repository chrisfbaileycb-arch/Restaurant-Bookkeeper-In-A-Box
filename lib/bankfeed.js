/**
 * Part 11 — Bank feed matching (location-scoped). Extends reconciliation
 * beyond checks: full statement rows are imported, deposits are matched to
 * clearing accounts by description keywords, and check withdrawals route
 * into the existing cleared-checks matcher.
 *
 * Bank feed CSV: txn_date,description,amount,fee_amount,bank_account_id
 *   amount > 0 = deposit, amount < 0 = withdrawal; fee_amount isolates the
 *   merchant processing fee on card settlements that land net of fees.
 *
 * Matched deposit journal BK-<bank>-<line id>:
 *   debit  Cash - General (deposit amount)
 *   debit  POS and Software Fees (fee, when present)
 *   credit <matched clearing account> (deposit + fee — the gross amount the
 *          clearing account was originally debited for)
 *
 * Unmatched rows are stored for review and NEVER posted — a bank line the
 * rules can't identify must not invent a journal entry.
 */
import { db } from 'hatchable';
import { splitCsvLine, cents } from 'lib/contract.js';
import { postEntries } from 'lib/ledger.js';
import { insertCleared, runMatching } from 'lib/checks.js';

export const BANK_CSV_HEADER = 'txn_date,description,amount,fee_amount,bank_account_id';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHECK_RE = /check\s*#?\s*(\d+)/i;

// Ordered deposit routing — first keyword hit wins; specific tenders before
// the generic card-settlement catch-all.
const DEPOSIT_ROUTES = [
  [['visa'], 'Visa Clearing Account'],
  [['mastercard', 'master card'], 'Mastercard Clearing Account'],
  [['amex', 'american express'], 'Amex Clearing Account'],
  [['discover'], 'Discover Clearing Account'],
  [['doordash', 'ubereats', 'uber eats', 'grubhub'], 'Delivery Payout Clearing'],
  [['safe drop', 'night deposit', 'cash deposit'], 'Cash Drawer'],
  [['card', 'pos ', 'merchant', 'settlement'], 'Other Tender Clearing'],
];

/** Route a deposit description to a clearing account name, or null. */
export function routeDeposit(description) {
  const d = (description ?? '').toLowerCase();
  for (const [keywords, account] of DEPOSIT_ROUTES) {
    if (keywords.some((k) => d.includes(k))) return account;
  }
  return null;
}

/** Extract a check number from a withdrawal description, or null. */
export function extractCheckNumber(description) {
  const m = CHECK_RE.exec(description ?? '');
  return m ? m[1] : null;
}

// ── CSV parser (strict, all-or-nothing) ────────────────────────────────────

export function parseBankFeedCsv(csv) {
  const errors = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  if (lines[0].trim() !== BANK_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + BANK_CSV_HEADER + '"' }] };
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length !== 5) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 5' }); continue; }
    const [txnDate, description, amountRaw, feeRaw, bankRaw] = cols;
    const amount = Number(amountRaw);
    const feeAmount = Number(feeRaw === '' ? 0 : feeRaw);
    if (!DATE_RE.test(txnDate)) errors.push({ line: i + 1, message: 'txn_date must be YYYY-MM-DD' });
    if (!description) errors.push({ line: i + 1, message: 'description required' });
    if (!Number.isFinite(amount) || amount === 0) errors.push({ line: i + 1, message: 'amount must be a nonzero number' });
    if (!Number.isFinite(feeAmount) || feeAmount < 0) errors.push({ line: i + 1, message: 'fee_amount must be a nonnegative number' });
    if (feeAmount > 0 && amount < 0) errors.push({ line: i + 1, message: 'fee_amount only applies to deposits' });
    rows.push({ txnDate, description, amount: cents(amount), feeAmount: cents(feeAmount), bankAccountId: bankRaw || 'primary' });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

// ── Journal construction ───────────────────────────────────────────────────

/** Balanced deposit entry for a matched bank line (id makes journal_no unique). */
export function buildDepositEntry(row, clearingAccount, lineId) {
  const gross = cents(row.amount + row.feeAmount);
  return {
    journalNo: 'BK-' + row.bankAccountId + '-' + lineId,
    date: row.txnDate,
    description: 'Bank deposit match: ' + row.description,
    source: 'bank_feed',
    lines: [
      { accountName: 'Cash - General', description: row.description, debit: row.amount, credit: 0 },
      ...(row.feeAmount > 0
        ? [{ accountName: 'POS and Software Fees', description: 'Merchant processing fee — ' + row.description, debit: row.feeAmount, credit: 0 }]
        : []),
      { accountName: clearingAccount, description: row.description, debit: 0, credit: gross },
    ],
  };
}

// ── Feed processing ────────────────────────────────────────────────────────

/**
 * Process statement rows: dedupe, route, post matched deposits, feed check
 * withdrawals to the cleared-checks matcher, park the rest as unmatched.
 */
export async function processBankFeed(ctx, rows) {
  const summary = { depositsMatched: 0, checksRouted: 0, unmatched: [], duplicates: 0 };
  const clearedRows = [];
  const posts = [];

  for (const row of rows) {
    const inserted = await db.query(
      'INSERT INTO bank_feed_lines (organization_id, location_id, bank_account_id, txn_date, description, amount, fee_amount) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7) ' +
        'ON CONFLICT (location_id, bank_account_id, txn_date, description, amount) DO NOTHING RETURNING id',
      [ctx.orgId, ctx.locationId, row.bankAccountId, row.txnDate, row.description, row.amount, row.feeAmount],
    );
    if (inserted.rows.length === 0) { summary.duplicates++; continue; }
    const lineId = Number(inserted.rows[0].id);

    const checkNumber = row.amount < 0 ? extractCheckNumber(row.description) : null;
    if (checkNumber) {
      clearedRows.push({
        checkNumber,
        clearedDate: row.txnDate,
        clearedAmount: cents(Math.abs(row.amount)),
        description: row.description,
        routingNumber: null,
        accountNumberLast4: null,
        bankAccountId: row.bankAccountId,
      });
      await db.query("UPDATE bank_feed_lines SET match_status = 'check_routed' WHERE id = $1", [lineId]);
      summary.checksRouted++;
      continue;
    }

    const clearingAccount = row.amount > 0 ? routeDeposit(row.description) : null;
    if (clearingAccount) {
      posts.push({ entry: buildDepositEntry(row, clearingAccount, lineId), lineId, clearingAccount });
      continue;
    }

    summary.unmatched.push({ txnDate: row.txnDate, description: row.description, amount: row.amount, bankAccountId: row.bankAccountId });
  }

  if (posts.length > 0) {
    const posted = await postEntries(ctx, posts.map((p) => p.entry), { skipExisting: true });
    if (!posted.ok) return { ok: false, errors: posted.errors };
    for (const p of posts) {
      await db.query(
        "UPDATE bank_feed_lines SET match_status = 'matched_deposit', matched_account = $2, journal_no = $3 WHERE id = $1",
        [p.lineId, p.clearingAccount, p.entry.journalNo],
      );
    }
    summary.depositsMatched = posts.length;
  }

  if (clearedRows.length > 0) {
    await insertCleared(ctx, clearedRows);
    summary.checkMatching = await runMatching(ctx);
  }

  return { ok: true, ...summary };
}

/** Unmatched bank lines awaiting manual review, oldest first. */
export async function listUnmatched(ctx) {
  const r = await db.query(
    "SELECT txn_date, description, amount, bank_account_id FROM bank_feed_lines " +
      "WHERE location_id = $1 AND match_status = 'unmatched' ORDER BY txn_date, id",
    [ctx.locationId],
  );
  return r.rows.map((row) => ({
    txnDate: row.txn_date,
    description: row.description,
    amount: Number(row.amount),
    bankAccountId: row.bank_account_id,
  }));
}
