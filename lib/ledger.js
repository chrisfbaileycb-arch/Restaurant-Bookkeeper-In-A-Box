/**
 * Double-entry ledger engine — location-scoped.
 *
 * EVERY function requires the workspace context ctx = {orgId, locationId}
 * from lib/tenant.js getContext(). Accounts belong to the organization
 * (shared COA structure); postings belong to the location; balances are
 * always computed from journal entries filtered by location_id. There is
 * no unscoped query path.
 */
import { db } from 'hatchable';
import { cents } from 'lib/contract.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Map of lowercased account name → account row, for ctx's organization. */
export async function accountMap(ctx) {
  const r = await db.query('SELECT id, account_no, name, type, parent_account_no FROM accounts WHERE active AND organization_id = $1', [ctx.orgId]);
  const map = new Map();
  for (const a of r.rows) map.set(a.name.toLowerCase(), a);
  return map;
}

/** account_no set of roll-up parents (accounts other active accounts point at). */
function parentAccountNos(accounts) {
  const parents = new Set();
  for (const a of accounts.values()) if (a.parent_account_no) parents.add(a.parent_account_no);
  return parents;
}

async function existingJournalNos(ctx, nos) {
  const found = new Set();
  const CHUNK = 200;
  for (let i = 0; i < nos.length; i += CHUNK) {
    const chunk = nos.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => '$' + (j + 2)).join(',');
    const r = await db.query(
      'SELECT journal_no FROM journal_entries WHERE location_id = $1 AND journal_no IN (' + placeholders + ')',
      [ctx.locationId, ...chunk],
    );
    for (const row of r.rows) found.add(row.journal_no);
  }
  return found;
}

/**
 * Validate a batch of entries against the org's COA and the balance rule.
 * entries: [{ journalNo, date, description, source, lines: [{accountName, description, debit, credit, categoryTag}] }]
 */
export async function validateEntries(ctx, entries, { skipExisting = false } = {}) {
  const errors = [];
  const accounts = await accountMap(ctx);
  const parents = parentAccountNos(accounts);

  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.journalNo)) errors.push({ journalNo: e.journalNo, message: 'duplicate journal_no within batch' });
    seen.add(e.journalNo);
  }

  const existing = await existingJournalNos(ctx, [...seen]);
  if (!skipExisting) {
    for (const no of existing) errors.push({ journalNo: no, message: 'journal_no already posted in this location' });
  }

  for (const e of entries) {
    if (skipExisting && existing.has(e.journalNo)) continue;
    if (!DATE_RE.test(e.date ?? '')) errors.push({ journalNo: e.journalNo, message: 'date must be YYYY-MM-DD' });
    if (!Array.isArray(e.lines) || e.lines.length < 2) {
      errors.push({ journalNo: e.journalNo, message: 'journal entry needs at least 2 lines' });
      continue;
    }
    let dr = 0, cr = 0;
    for (const l of e.lines) {
      const acct = accounts.get((l.accountName ?? '').toLowerCase());
      if (!acct) {
        errors.push({ journalNo: e.journalNo, message: 'unknown account: ' + l.accountName });
        continue;
      }
      if (parents.has(acct.account_no)) {
        errors.push({ journalNo: e.journalNo, message: 'roll-up parent account, post to one of its sub-accounts: ' + l.accountName });
        continue;
      }
      const debit = Number(l.debit ?? 0), credit = Number(l.credit ?? 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        errors.push({ journalNo: e.journalNo, message: 'debit/credit must be nonnegative numbers (' + l.accountName + ')' });
        continue;
      }
      if ((debit > 0) === (credit > 0)) {
        errors.push({ journalNo: e.journalNo, message: 'each line must have exactly one of debit or credit (' + l.accountName + ')' });
        continue;
      }
      dr += debit; cr += credit;
    }
    if (Math.abs(cents(dr) - cents(cr)) > 0.005) {
      errors.push({ journalNo: e.journalNo, message: 'unbalanced: debits ' + cents(dr).toFixed(2) + ' vs credits ' + cents(cr).toFixed(2) });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, accounts, existing };
}

/** Post entries into the ctx location (validated all-or-nothing first). */
export async function postEntries(ctx, entries, { skipExisting = false } = {}) {
  const validation = await validateEntries(ctx, entries, { skipExisting });
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const { accounts, existing } = validation;

  let posted = 0, skipped = 0, lineCount = 0;
  for (const e of entries) {
    if (existing.has(e.journalNo)) { skipped++; continue; }
    const inserted = await db.query(
      'INSERT INTO journal_entries (organization_id, location_id, journal_no, entry_date, description, source) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [ctx.orgId, ctx.locationId, e.journalNo, e.date, e.description ?? '', e.source ?? 'manual'],
    );
    const entryId = inserted.rows[0].id;
    for (const l of e.lines) {
      const acct = accounts.get(l.accountName.toLowerCase());
      await db.query(
        'INSERT INTO journal_lines (journal_entry_id, account_id, description, debit, credit, category_tag) VALUES ($1, $2, $3, $4, $5, $6)',
        [entryId, acct.id, l.description ?? '', cents(Number(l.debit ?? 0)), cents(Number(l.credit ?? 0)), l.categoryTag ?? null],
      );
      lineCount++;
    }
    posted++;
  }
  return { ok: true, posted, skipped, lines: lineCount };
}

/**
 * Per-account totals over an inclusive date range for ctx's location.
 * balance is signed by normal side (asset/cogs/expense debit-normal).
 */
export async function accountBalances(ctx, from = '0000-01-01', to = '9999-12-31') {
  const r = await db.query(
    'SELECT a.account_no, a.name, a.type, a.qb_type, a.parent_account_no, a.tax_line, ' +
      'COALESCE(SUM(l.debit), 0) AS debits, COALESCE(SUM(l.credit), 0) AS credits ' +
      'FROM accounts a LEFT JOIN (' +
      '  SELECT jl.account_id, jl.debit, jl.credit FROM journal_lines jl ' +
      '  JOIN journal_entries je ON je.id = jl.journal_entry_id ' +
      '  WHERE je.location_id = $2 AND je.entry_date >= $3 AND je.entry_date <= $4' +
      ') l ON l.account_id = a.id ' +
      'WHERE a.active AND a.organization_id = $1 ' +
      'GROUP BY a.account_no, a.name, a.type, a.qb_type, a.parent_account_no, a.tax_line ORDER BY a.account_no',
    [ctx.orgId, ctx.locationId, from, to],
  );
  return r.rows.map((row) => {
    const debits = Number(row.debits), credits = Number(row.credits);
    const debitNormal = row.type === 'asset' || row.type === 'cogs' || row.type === 'expense';
    return {
      accountNo: row.account_no,
      name: row.name,
      type: row.type,
      qbType: row.qb_type,
      parentAccountNo: row.parent_account_no,
      taxLine: row.tax_line,
      debits: cents(debits),
      credits: cents(credits),
      balance: cents(debitNormal ? debits - credits : credits - debits),
    };
  });
}

/** Signed balance of one account (by name) through an as-of date. */
export async function accountBalance(ctx, name, asOf = '9999-12-31') {
  const rows = await accountBalances(ctx, '0000-01-01', asOf);
  const row = rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  return row ? row.balance : 0;
}

/** Full journal entries (with lines) for a YYYY-MM month, for exports. */
export async function entriesForMonth(ctx, month) {
  const entries = await db.query(
    'SELECT id, journal_no, entry_date, description, source FROM journal_entries ' +
      'WHERE location_id = $1 AND entry_date LIKE $2 ORDER BY entry_date, journal_no',
    [ctx.locationId, month + '-%'],
  );
  const out = [];
  for (const e of entries.rows) {
    const lines = await db.query(
      'SELECT a.name AS account_name, l.description, l.debit, l.credit, l.category_tag ' +
        'FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1 ORDER BY l.id',
      [e.id],
    );
    out.push({
      journalNo: e.journal_no,
      date: e.entry_date,
      description: e.description,
      source: e.source,
      lines: lines.rows.map((l) => ({
        accountName: l.account_name,
        description: l.description,
        debit: Number(l.debit),
        credit: Number(l.credit),
        categoryTag: l.category_tag,
      })),
    });
  }
  return out;
}
