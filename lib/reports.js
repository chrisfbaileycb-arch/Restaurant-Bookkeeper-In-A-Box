/**
 * Reporting suite — derived entirely from location-scoped ledger queries.
 * Every report requires the workspace context.
 */
import { accountBalances } from 'lib/ledger.js';
import { cents } from 'lib/contract.js';

function sum(rows) {
  return cents(rows.reduce((s, r) => s + r.balance, 0));
}

function nonzero(rows) {
  return rows.filter((r) => r.balance !== 0 || r.debits !== 0 || r.credits !== 0);
}

/** Profit & Loss over an inclusive date range, with restaurant KPIs. */
export async function profitLoss(ctx, from, to) {
  const rows = await accountBalances(ctx, from, to);
  const revenue = nonzero(rows.filter((r) => r.type === 'revenue'));
  const cogs = nonzero(rows.filter((r) => r.type === 'cogs'));
  const expenses = nonzero(rows.filter((r) => r.type === 'expense'));

  const totalRevenue = sum(revenue);
  const totalCogs = sum(cogs);
  const totalExpenses = sum(expenses);

  const foodSales = revenue.find((r) => r.name === 'Food Sales')?.balance ?? 0;
  const foodCost = cents(cogs.filter((r) => r.name.startsWith('Food Cost')).reduce((s, r) => s + r.balance, 0));
  const bevSales = revenue.find((r) => r.name === 'Beverage Sales')?.balance ?? 0;
  // 'Beverage Cost' is a roll-up parent since migration 0006: sum its own
  // (historical) balance plus its sub-accounts.
  const bevCost = cents(cogs.filter((r) => r.name.startsWith('Beverage Cost')).reduce((s, r) => s + r.balance, 0));

  return {
    from, to,
    location: ctx.locationName,
    revenue, cogs, expenses,
    totals: {
      revenue: totalRevenue,
      cogs: totalCogs,
      grossProfit: cents(totalRevenue - totalCogs),
      expenses: totalExpenses,
      netIncome: cents(totalRevenue - totalCogs - totalExpenses),
    },
    kpis: {
      foodCostPct: foodSales > 0 ? cents((foodCost / foodSales) * 100) : null,
      beverageCostPct: bevSales > 0 ? cents((bevCost / bevSales) * 100) : null,
    },
  };
}

/** Balance Sheet as of a date; `balanced` is the integrity check. */
export async function balanceSheet(ctx, asOf) {
  const rows = await accountBalances(ctx, '0000-01-01', asOf);
  const assets = nonzero(rows.filter((r) => r.type === 'asset'));
  const liabilities = nonzero(rows.filter((r) => r.type === 'liability'));
  const equity = nonzero(rows.filter((r) => r.type === 'equity'));

  const netIncomeToDate = cents(
    sum(rows.filter((r) => r.type === 'revenue')) -
    sum(rows.filter((r) => r.type === 'cogs')) -
    sum(rows.filter((r) => r.type === 'expense')),
  );

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = cents(sum(equity) + netIncomeToDate);

  return {
    asOf,
    location: ctx.locationName,
    assets, liabilities, equity,
    netIncomeToDate,
    totals: {
      assets: totalAssets,
      liabilities: totalLiabilities,
      equity: totalEquity,
      liabilitiesAndEquity: cents(totalLiabilities + totalEquity),
    },
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
  };
}

/** COGS summary by category over a range, with percent of revenue. */
export async function cogsSummary(ctx, from, to) {
  const rows = await accountBalances(ctx, from, to);
  const cogs = nonzero(rows.filter((r) => r.type === 'cogs'));
  const totalRevenue = sum(rows.filter((r) => r.type === 'revenue'));
  const totalCogs = sum(cogs);
  return {
    from, to,
    location: ctx.locationName,
    lines: cogs.map((r) => ({
      account: r.name,
      amount: r.balance,
      pctOfRevenue: totalRevenue > 0 ? cents((r.balance / totalRevenue) * 100) : null,
    })),
    totals: {
      cogs: totalCogs,
      revenue: totalRevenue,
      cogsPctOfRevenue: totalRevenue > 0 ? cents((totalCogs / totalRevenue) * 100) : null,
    },
  };
}

/** Generic account-rows → CSV serializer for report exports. */
export function rowsToCsv(rows, headers, pick) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(pick(r).map(esc).join(','));
  return lines.join('\n') + '\n';
}
