/**
 * Part 8 — Accounts Payable subledger (location-scoped).
 *
 * Invoice CSV: invoice_no,invoice_date,vendor,due_date,item_description,qty,unit_price,category
 * A file may carry lines for multiple invoices (grouped by invoice_no);
 * validation is strict all-or-nothing like every other import. Each line is
 * routed to a COGS/expense account by category keywords (ported from the v5
 * prototype's rules); unrecognized categories land in 'Supplies'.
 *
 * Registration posts one journal entry per invoice (journal_no
 * AP-<invoice_no>): debit the routed accounts, credit 'Accounts Payable'.
 * Payment posts AP-PAY-<invoice_no>: debit 'Accounts Payable', credit
 * 'Cash - General' — recording only; this system never moves money. Paying
 * by check also registers an outstanding check so bank reconciliation can
 * clear it later.
 */
import { db } from 'hatchable';
import { splitCsvLine, cents } from 'lib/contract.js';
import { validateEntries, postEntries } from 'lib/ledger.js';
import { insertRegister } from 'lib/checks.js';

export const AP_CSV_HEADER = 'invoice_no,invoice_date,vendor,due_date,item_description,qty,unit_price,category';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ordered routing rules — first keyword hit wins, specific before generic
// (wine/spirits before the packaged-beverage catch-all).
const CATEGORY_ROUTES = [
  [['meat', 'protein', 'beef', 'chicken', 'pork', 'seafood'], 'Food Cost - Meat'],
  [['produce', 'vegetable', 'fruit'], 'Food Cost - Produce'],
  [['dairy', 'cheese', 'milk'], 'Food Cost - Dairy'],
  [['dry', 'grocery', 'flour', 'oil'], 'Food Cost - Dry Goods'],
  [['draught', 'draft'], 'Beverage Cost - Draught Beer'],
  [['wine'], 'Beverage Cost - Wine'],
  [['spirit', 'liquor', 'vodka', 'whiskey', 'tequila'], 'Beverage Cost - Spirits & Liquor'],
  [['soda', 'syrup', 'fountain'], 'Beverage Cost - Fountain Soda'],
  [['packaged', 'bottle', 'beverage', 'beer'], 'Beverage Cost - Packaged & Retail'],
  [['paper', 'box', 'packaging', 'napkin', 'cup', 'to-go'], 'Paper & Packaging Cost'],
];
const DEFAULT_ACCOUNT = 'Supplies';

/** Route a free-text category to a COA account name. */
export function routeCategory(category) {
  const c = (category ?? '').toLowerCase();
  for (const [keywords, account] of CATEGORY_ROUTES) {
    if (keywords.some((k) => c.includes(k))) return account;
  }
  return DEFAULT_ACCOUNT;
}

// ── CSV parser (strict, all-or-nothing) ────────────────────────────────────

export function parseInvoiceCsv(csv) {
  const errors = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  if (lines[0].trim() !== AP_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + AP_CSV_HEADER + '"' }] };
  }

  const invoices = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length !== 8) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 8' }); continue; }
    const [invoiceNo, invoiceDate, vendor, dueDate, description, qtyRaw, priceRaw, category] = cols;
    const qty = Number(qtyRaw);
    const unitPrice = Number(priceRaw);

    if (!invoiceNo) errors.push({ line: i + 1, message: 'invoice_no required' });
    if (!DATE_RE.test(invoiceDate)) errors.push({ line: i + 1, message: 'invoice_date must be YYYY-MM-DD' });
    if (!vendor) errors.push({ line: i + 1, message: 'vendor required' });
    if (!DATE_RE.test(dueDate)) errors.push({ line: i + 1, message: 'due_date must be YYYY-MM-DD' });
    if (!description) errors.push({ line: i + 1, message: 'item_description required' });
    if (!Number.isFinite(qty) || qty <= 0) errors.push({ line: i + 1, message: 'qty must be a positive number' });
    if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.push({ line: i + 1, message: 'unit_price must be a nonnegative number' });

    let inv = invoices.get(invoiceNo);
    if (!inv) {
      inv = { invoiceNo, invoiceDate, vendor, dueDate, lines: [] };
      invoices.set(invoiceNo, inv);
    } else if (inv.invoiceDate !== invoiceDate || inv.vendor !== vendor || inv.dueDate !== dueDate) {
      errors.push({ line: i + 1, message: 'inconsistent invoice_date/vendor/due_date for invoice ' + invoiceNo });
    }
    inv.lines.push({
      description,
      qty,
      unitPrice,
      lineTotal: cents(qty * unitPrice),
      accountName: routeCategory(category),
      category,
    });
  }

  for (const inv of invoices.values()) {
    inv.amount = cents(inv.lines.reduce((s, l) => s + l.lineTotal, 0));
    if (inv.amount <= 0) errors.push({ line: 0, message: 'invoice ' + inv.invoiceNo + ' totals zero — nothing to post' });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, invoices: [...invoices.values()] };
}

// ── Registration (subledger row + journal posting) ─────────────────────────

function invoiceJournalEntry(inv) {
  const byAccount = new Map();
  for (const l of inv.lines) byAccount.set(l.accountName, cents((byAccount.get(l.accountName) ?? 0) + l.lineTotal));
  return {
    journalNo: 'AP-' + inv.invoiceNo,
    date: inv.invoiceDate,
    description: 'Vendor invoice ' + inv.vendor + ' #' + inv.invoiceNo,
    source: 'ap_import',
    lines: [
      ...[...byAccount.entries()].map(([accountName, amount]) => ({ accountName, description: inv.vendor + ' #' + inv.invoiceNo, debit: amount, credit: 0 })),
      { accountName: 'Accounts Payable', description: inv.vendor + ' #' + inv.invoiceNo, debit: 0, credit: inv.amount },
    ],
  };
}

/** Register invoices for ctx's location: all-or-nothing, then post. */
export async function registerInvoices(ctx, invoices) {
  const errors = [];
  for (const inv of invoices) {
    const dup = await db.query(
      'SELECT id FROM vendor_invoices WHERE location_id = $1 AND invoice_no = $2',
      [ctx.locationId, inv.invoiceNo],
    );
    if (dup.rows.length > 0) errors.push({ invoiceNo: inv.invoiceNo, message: 'invoice_no already registered in this location' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const entries = invoices.map(invoiceJournalEntry);
  const validation = await validateEntries(ctx, entries);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  for (const inv of invoices) {
    const breakdown = {};
    for (const l of inv.lines) breakdown[l.accountName] = cents((breakdown[l.accountName] ?? 0) + l.lineTotal);
    await db.query(
      'INSERT INTO vendor_invoices (organization_id, location_id, invoice_no, invoice_date, vendor, amount, due_date, expense_breakdown) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctx.orgId, ctx.locationId, inv.invoiceNo, inv.invoiceDate, inv.vendor, inv.amount, inv.dueDate, JSON.stringify(breakdown)],
    );
  }
  const posted = await postEntries(ctx, entries);
  if (!posted.ok) return { ok: false, errors: posted.errors };
  return { ok: true, registered: invoices.length, posted: posted.posted };
}

// ── Aging report ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const BINS = [
  { label: '0-15 days', min: 0, max: 15 },
  { label: '16-30 days', min: 16, max: 30 },
  { label: '31+ days', min: 31, max: Infinity },
];

/** Unpaid invoices for ctx's location, binned by age as of `asOf`. */
export async function apAging(ctx, asOf) {
  const r = await db.query(
    "SELECT invoice_no, invoice_date, vendor, amount, due_date, expense_breakdown FROM vendor_invoices " +
      "WHERE location_id = $1 AND status = 'unpaid' ORDER BY invoice_date, invoice_no",
    [ctx.locationId],
  );
  const bins = BINS.map((b) => ({ label: b.label, invoices: [], total: 0 }));
  let total = 0;
  for (const row of r.rows) {
    const daysOld = Math.floor((Date.parse(asOf) - Date.parse(row.invoice_date)) / DAY_MS);
    const inv = {
      invoiceNo: row.invoice_no,
      vendor: row.vendor,
      invoiceDate: row.invoice_date,
      dueDate: row.due_date,
      amount: Number(row.amount),
      daysOld,
      pastDue: row.due_date < asOf,
    };
    const bin = bins[BINS.findIndex((b) => daysOld >= b.min && daysOld <= b.max)] ?? bins[0];
    bin.invoices.push(inv);
    bin.total = cents(bin.total + inv.amount);
    total = cents(total + inv.amount);
  }
  return { asOf, bins, total };
}

// ── Payment (recording only — no money movement) ───────────────────────────

/**
 * Record payment of an unpaid invoice: post AP-PAY-<invoice_no>, mark paid,
 * and (for check payments) register an outstanding check for reconciliation.
 */
export async function payInvoice(ctx, { invoiceNo, paymentDate, checkNumber = null, bankAccountId = 'primary' }) {
  const r = await db.query(
    "SELECT id, vendor, amount FROM vendor_invoices WHERE location_id = $1 AND invoice_no = $2 AND status = 'unpaid'",
    [ctx.locationId, invoiceNo],
  );
  if (r.rows.length === 0) return { ok: false, error: 'invoice_not_found_or_paid' };
  const inv = r.rows[0];
  const amount = cents(Number(inv.amount));

  if (checkNumber) {
    const dup = await db.query(
      'SELECT id FROM check_register WHERE location_id = $1 AND bank_account_id = $2 AND check_number = $3',
      [ctx.locationId, bankAccountId, checkNumber],
    );
    if (dup.rows.length > 0) return { ok: false, error: 'check_number_already_registered' };
  }

  const method = checkNumber ? 'Check #' + checkNumber : 'EFT/ACH';
  const posted = await postEntries(ctx, [{
    journalNo: 'AP-PAY-' + invoiceNo,
    date: paymentDate,
    description: 'Payment to ' + inv.vendor + ' for invoice #' + invoiceNo + ' (' + method + ')',
    source: 'ap_payment',
    lines: [
      { accountName: 'Accounts Payable', description: 'Invoice #' + invoiceNo, debit: amount, credit: 0 },
      { accountName: 'Cash - General', description: 'Invoice #' + invoiceNo, debit: 0, credit: amount },
    ],
  }]);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await db.query(
    "UPDATE vendor_invoices SET status = 'paid', paid_date = $2, payment_check_no = $3 WHERE id = $1",
    [inv.id, paymentDate, checkNumber],
  );

  if (checkNumber) {
    await insertRegister(ctx, [{
      checkNumber,
      checkDate: paymentDate,
      payee: inv.vendor,
      writtenAmount: amount,
      memo: 'AP invoice ' + invoiceNo,
      bankAccountId,
    }]);
  }

  return { ok: true, invoiceNo, vendor: inv.vendor, amount, paymentDate, method };
}
