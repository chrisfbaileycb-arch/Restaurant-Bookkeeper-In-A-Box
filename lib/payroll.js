/**
 * Part 9 — Payroll journal import (location-scoped). Recording only: payroll
 * is EXECUTED by the operator's third-party payroll service (Gusto, ADP,
 * Paychex); this module records what that service reports. No money moves.
 *
 * Payroll CSV (one row per pay run):
 * pay_date,boh_gross,foh_gross,employer_fed_taxes,employer_futa,employer_sui_co,employer_famli,fed_withholding,co_withholding,employee_famli,net_pay_sweep,provider_remits_taxes
 *
 * Accrual entry PR-<pay_date>:
 *   debits:  Wages - Kitchen (BOH), Wages - Service (FOH),
 *            Payroll Taxes (all employer shares)
 *   credits: Federal Payroll Taxes Payable (employer fed + employee fed
 *            withholding), FUTA Payable, SUI Payable - CO, FAMLI Premiums
 *            Payable (both shares), CO Income Tax Withholding Payable,
 *            Cash - General (net pay sweep)
 *
 * provider_remits_taxes=true adds PR-REMIT-<pay_date>: debit the liability
 * accounts, credit Cash for the tax total — full-service providers sweep and
 * remit taxes themselves, so nothing stays owed. With false, liabilities
 * stay on the books and feed the compliance calendar's estimated amounts.
 */
import { splitCsvLine, cents } from 'lib/contract.js';
import { postEntries } from 'lib/ledger.js';

export const PAYROLL_CSV_HEADER =
  'pay_date,boh_gross,foh_gross,employer_fed_taxes,employer_futa,employer_sui_co,employer_famli,' +
  'fed_withholding,co_withholding,employee_famli,net_pay_sweep,provider_remits_taxes';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_FIELDS = [
  'bohGross', 'fohGross', 'employerFedTaxes', 'employerFuta', 'employerSuiCo', 'employerFamli',
  'fedWithholding', 'coWithholding', 'employeeFamli', 'netPaySweep',
];

// ── CSV parser (strict, all-or-nothing) ────────────────────────────────────

export function parsePayrollCsv(csv) {
  const errors = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };
  if (lines[0].trim() !== PAYROLL_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + PAYROLL_CSV_HEADER + '"' }] };
  }

  const runs = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length !== 12) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 12' }); continue; }

    const run = {
      payDate: cols[0],
      bohGross: Number(cols[1]),
      fohGross: Number(cols[2]),
      employerFedTaxes: Number(cols[3]),
      employerFuta: Number(cols[4]),
      employerSuiCo: Number(cols[5]),
      employerFamli: Number(cols[6]),
      fedWithholding: Number(cols[7]),
      coWithholding: Number(cols[8]),
      employeeFamli: Number(cols[9]),
      netPaySweep: Number(cols[10]),
      providerRemitsTaxes: cols[11].toLowerCase(),
    };

    if (!DATE_RE.test(run.payDate)) errors.push({ line: i + 1, message: 'pay_date must be YYYY-MM-DD' });
    if (seen.has(run.payDate)) errors.push({ line: i + 1, message: 'duplicate pay_date in file: ' + run.payDate });
    seen.add(run.payDate);
    for (const f of NUMERIC_FIELDS) {
      if (!Number.isFinite(run[f]) || run[f] < 0) errors.push({ line: i + 1, message: f + ' must be a nonnegative number' });
    }
    if (!['true', 'false'].includes(run.providerRemitsTaxes)) {
      errors.push({ line: i + 1, message: 'provider_remits_taxes must be true or false' });
    }
    run.providerRemitsTaxes = run.providerRemitsTaxes === 'true';

    // The pay run must reconcile: net pay = gross wages − employee withholdings.
    const expectedNet = cents(run.bohGross + run.fohGross - run.fedWithholding - run.coWithholding - run.employeeFamli);
    if (Number.isFinite(run.netPaySweep) && Math.abs(expectedNet - cents(run.netPaySweep)) > 0.01) {
      errors.push({
        line: i + 1,
        message: 'net_pay_sweep does not reconcile: gross − employee withholdings = ' + expectedNet.toFixed(2) +
          ' but file says ' + cents(run.netPaySweep).toFixed(2),
      });
    }
    runs.push(run);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, runs };
}

// ── Journal construction ───────────────────────────────────────────────────

const line = (accountName, description, debit, credit) => ({ accountName, description, debit, credit });

/** Build the accrual (and, if provider-remitted, remittance) entries for a run. */
export function buildPayrollEntries(run) {
  const employerTaxes = cents(run.employerFedTaxes + run.employerFuta + run.employerSuiCo + run.employerFamli);
  const fedLiability = cents(run.employerFedTaxes + run.fedWithholding);
  const famliLiability = cents(run.employerFamli + run.employeeFamli);

  const liabilities = [
    ['Federal Payroll Taxes Payable', fedLiability],
    ['FUTA Payable', cents(run.employerFuta)],
    ['SUI Payable - CO', cents(run.employerSuiCo)],
    ['FAMLI Premiums Payable', famliLiability],
    ['CO Income Tax Withholding Payable', cents(run.coWithholding)],
  ].filter(([, amount]) => amount > 0);

  const accrual = {
    journalNo: 'PR-' + run.payDate,
    date: run.payDate,
    description: 'Payroll journal — pay date ' + run.payDate,
    source: 'payroll_import',
    lines: [
      ...(run.bohGross > 0 ? [line('Wages - Kitchen (BOH)', 'Gross wages BOH', cents(run.bohGross), 0)] : []),
      ...(run.fohGross > 0 ? [line('Wages - Service (FOH)', 'Gross wages FOH', cents(run.fohGross), 0)] : []),
      ...(employerTaxes > 0 ? [line('Payroll Taxes', 'Employer payroll taxes', employerTaxes, 0)] : []),
      ...liabilities.map(([name, amount]) => line(name, 'Payroll liability accrual', 0, amount)),
      ...(run.netPaySweep > 0 ? [line('Cash - General', 'Net pay sweep by payroll provider', 0, cents(run.netPaySweep))] : []),
    ],
  };

  const entries = [accrual];
  const taxTotal = cents(liabilities.reduce((s, [, amount]) => s + amount, 0));
  if (run.providerRemitsTaxes && taxTotal > 0) {
    entries.push({
      journalNo: 'PR-REMIT-' + run.payDate,
      date: run.payDate,
      description: 'Payroll taxes remitted by provider — pay date ' + run.payDate,
      source: 'payroll_import',
      lines: [
        ...liabilities.map(([name, amount]) => line(name, 'Remitted by payroll provider', amount, 0)),
        line('Cash - General', 'Tax sweep by payroll provider', 0, taxTotal),
      ],
    });
  }
  return entries;
}

/** Post all runs; idempotent per pay date via PR-<date> journal numbers. */
export async function importPayroll(ctx, runs) {
  const entries = runs.flatMap(buildPayrollEntries);
  const result = await postEntries(ctx, entries, { skipExisting: true });
  if (!result.ok) return result;
  return { ok: true, runs: runs.length, entriesPosted: result.posted, entriesSkipped: result.skipped, lines: result.lines };
}
