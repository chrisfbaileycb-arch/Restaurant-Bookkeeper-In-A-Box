/**
 * Colorado + federal compliance calendar — per-location.
 *
 * Each location gets its own ComplianceEvent rows; estimated_amount always
 * comes from THAT location's liability account balances as of the period
 * end — no tax rates are hardcoded. Zero-balance overdue periods auto-file.
 *
 * Cadences: DR 0100 monthly (20th), DR 1094 monthly (15th), FAMLI/UITR-1/
 * Form 941 quarterly (month-end after quarter), Form 940 annual (Jan 31).
 */
import { db } from 'hatchable';
import { cents } from 'lib/contract.js';

const SCHEDULES = [
  { taxType: 'CO_SALES_TAX', form: 'DR 0100', cadence: 'monthly', liabilityAccount: 'Sales Tax Payable - CO', due: 'next-month-20' },
  { taxType: 'CO_PIT', form: 'DR 1094', cadence: 'monthly', liabilityAccount: 'CO Income Tax Withholding Payable', due: 'next-month-15' },
  { taxType: 'CO_FAMLI', form: 'FAMLI Quarterly Report', cadence: 'quarterly', liabilityAccount: 'FAMLI Premiums Payable', due: 'next-month-end' },
  { taxType: 'CO_SUI', form: 'UITR-1', cadence: 'quarterly', liabilityAccount: 'SUI Payable - CO', due: 'next-month-end' },
  { taxType: 'FED_941', form: 'Form 941', cadence: 'quarterly', liabilityAccount: 'Federal Payroll Taxes Payable', due: 'next-month-end' },
  { taxType: 'FED_940', form: 'Form 940', cadence: 'annual', liabilityAccount: 'FUTA Payable', due: 'jan-31' },
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function periodEnds(cadence, today) {
  const lo = new Date(today.getTime() - 92 * 86_400_000).toISOString().slice(0, 10);
  const hi = new Date(today.getTime() + 366 * 86_400_000).toISOString().slice(0, 10);
  const ends = [];
  const y = today.getUTCFullYear();
  for (let yy = y - 1; yy <= y + 1; yy++) {
    if (cadence === 'monthly') for (let m = 1; m <= 12; m++) ends.push(iso(yy, m, lastDay(yy, m)));
    if (cadence === 'quarterly') for (const m of [3, 6, 9, 12]) ends.push(iso(yy, m, lastDay(yy, m)));
    if (cadence === 'annual') ends.push(iso(yy, 12, 31));
  }
  return ends.filter((e) => e >= lo && e <= hi);
}

function dueDate(rule, periodEnd) {
  const [y, m] = periodEnd.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  if (rule === 'next-month-20') return iso(ny, nm, 20);
  if (rule === 'next-month-15') return iso(ny, nm, 15);
  if (rule === 'next-month-end') return iso(ny, nm, lastDay(ny, nm));
  if (rule === 'jan-31') return iso(y + 1, 1, 31);
  throw new Error('unknown due rule: ' + rule);
}

/** Insert any missing events for ctx's location (idempotent). */
export async function ensureEvents(ctx, today = new Date()) {
  for (const s of SCHEDULES) {
    for (const periodEnd of periodEnds(s.cadence, today)) {
      await db.query(
        'INSERT INTO compliance_events (organization_id, location_id, tax_type, form_number, period_end, due_date, liability_account) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (location_id, tax_type, period_end) DO NOTHING',
        [ctx.orgId, ctx.locationId, s.taxType, s.form, periodEnd, dueDate(s.due, periodEnd), s.liabilityAccount],
      );
    }
  }
}

/** Per-day liability deltas for ctx's location, in one query. */
async function liabilityDeltas(ctx) {
  const names = SCHEDULES.map((s) => s.liabilityAccount);
  const placeholders = names.map((_, i) => '$' + (i + 3)).join(',');
  const r = await db.query(
    'SELECT a.name, je.entry_date, SUM(l.credit - l.debit) AS delta ' +
      'FROM journal_lines l JOIN accounts a ON a.id = l.account_id ' +
      'JOIN journal_entries je ON je.id = l.journal_entry_id ' +
      'WHERE a.organization_id = $1 AND je.location_id = $2 AND a.name IN (' + placeholders + ') ' +
      'GROUP BY a.name, je.entry_date',
    [ctx.orgId, ctx.locationId, ...names],
  );
  return r.rows.map((row) => ({ name: row.name, date: row.entry_date, delta: Number(row.delta) }));
}

function balanceAsOf(deltas, name, periodEnd) {
  return cents(deltas.filter((d) => d.name === name && d.date <= periodEnd).reduce((s, d) => s + d.delta, 0));
}

/** Refresh ctx's location: statuses + amounts. Zero-balance overdue auto-files. */
export async function refreshEvents(ctx, today = new Date()) {
  await ensureEvents(ctx, today);
  const todayIso = today.toISOString().slice(0, 10);
  const deltas = await liabilityDeltas(ctx);

  const open = await db.query("SELECT * FROM compliance_events WHERE location_id = $1 AND status != 'FILED'", [ctx.locationId]);
  for (const ev of open.rows) {
    const amount = balanceAsOf(deltas, ev.liability_account, ev.period_end);
    const daysLeft = Math.floor((Date.parse(ev.due_date) - Date.parse(todayIso)) / 86_400_000);
    let status = 'UPCOMING';
    if (daysLeft < 0) status = amount === 0 ? 'FILED' : 'OVERDUE';
    else if (daysLeft <= ev.alert_threshold_days) status = 'DUE_SOON';
    if (Number(ev.estimated_amount) !== amount || ev.status !== status) {
      await db.query('UPDATE compliance_events SET estimated_amount = $2, status = $3 WHERE id = $1', [ev.id, amount, status]);
    }
  }
  return open.rows.length;
}

/** Dashboard listing for ctx's location. */
export async function listEvents(ctx, today = new Date(), { includeFiled = false, horizonDays = 120 } = {}) {
  const todayIso = today.toISOString().slice(0, 10);
  const r = await db.query('SELECT * FROM compliance_events WHERE location_id = $1 ORDER BY due_date, tax_type', [ctx.locationId]);
  return r.rows
    .filter((ev) => includeFiled || ev.status !== 'FILED')
    .map((ev) => ({
      id: Number(ev.id),
      taxType: ev.tax_type,
      form: ev.form_number,
      periodEnd: ev.period_end,
      dueDate: ev.due_date,
      estimatedAmount: Number(ev.estimated_amount),
      status: ev.status,
      daysRemaining: Math.floor((Date.parse(ev.due_date) - Date.parse(todayIso)) / 86_400_000),
      liabilityAccount: ev.liability_account,
    }))
    .filter((ev) => ev.status === 'OVERDUE' || ev.daysRemaining <= horizonDays);
}

/** Cron sweep: refresh every location in every organization. */
export async function refreshAllLocations(today = new Date()) {
  const locs = await db.query('SELECT id, organization_id FROM locations ORDER BY id');
  let locations = 0, events = 0;
  for (const l of locs.rows) {
    const ctx = { orgId: Number(l.organization_id), locationId: Number(l.id) };
    events += await refreshEvents(ctx, today);
    locations++;
  }
  return { locations, events };
}
