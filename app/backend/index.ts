import { router, json, error, db, storage, ai } from '@appdeploy/sdk';

const DISCLAIMER = 'Automated extraction by an AI agent. Figures are read from the document, not verified: never post them to your books without review. Amounts the AI cannot read are left blank, never guessed. This tool records data only and never moves money. By acknowledging, you accept responsibility for verifying results before accounting use.';
const POST_DISCLAIMER = 'You are posting to your books. Entries are recorded in this app\'s ledger only; nothing is filed and no money moves. Verify every figure first.';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Split one CSV line honoring double-quoted fields. */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
            if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
            else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}

// ── Multi-location workspaces ──
// Every data row carries locationId; rows written before this feature have
// none and belong to the default location. One login, isolated books per
// location, switched from the header picker.
async function getLocations() {
    let locs = await listAll('locations');
    if (locs.length === 0) {
        await db.add('locations', [{ name: 'Main Location', isDefault: true, createdAt: Date.now() }]);
        locs = await listAll('locations');
    }
    const def = locs.find((l) => l.isDefault) || locs[0];
    return { locs, defId: String(def.id) };
}

async function resolveLoc(requested?: string) {
    const { locs, defId } = await getLocations();
    const locId = requested && locs.some((l) => String(l.id) === String(requested)) ? String(requested) : defId;
    return { locId, defId, locs };
}

const inLoc = (row: Record<string, any>, locId: string, defId: string) => String(row.locationId || defId) === locId;

// ── Multi-vertical Chart of Accounts framework ──
// Each industry profile defines its own COA template and KPI definitions.
// The active profile is stored per-location; defaults to 'restaurant'.
type Acct = { accountNo: string; name: string; type: string; qbType: string; parentAccountNo: string | null };
type VerticalProfile = {
    id: string; label: string; description: string;
    coa: Array<[string, string, string, string, (string | null)?]>;
    kpiDefs: Array<{ key: string; label: string; formula: string; warningThreshold?: number }>;
};

// Shared accounts common to all verticals
const SHARED_COA: Array<[string, string, string, string, (string | null)?]> = [
    ['1000', 'Cash - General', 'asset', 'Bank'], ['1010', 'Cash Drawer', 'asset', 'Bank'],
    ['1020', 'Visa Clearing Account', 'asset', 'Other Current Asset'], ['1021', 'Mastercard Clearing Account', 'asset', 'Other Current Asset'],
    ['1022', 'Amex Clearing Account', 'asset', 'Other Current Asset'], ['1023', 'Discover Clearing Account', 'asset', 'Other Current Asset'],
    ['1024', 'Other Tender Clearing', 'asset', 'Other Current Asset'], ['1025', 'Delivery Payout Clearing', 'asset', 'Other Current Asset'],
    ['1200', 'Prepaid Expenses', 'asset', 'Other Current Asset'], ['1500', 'Equipment', 'asset', 'Fixed Asset'],
    ['2000', 'Accounts Payable', 'liability', 'Accounts Payable'], ['2100', 'Sales Tax Payable - CO', 'liability', 'Other Current Liability'],
    ['2110', 'Tips Payable', 'liability', 'Other Current Liability'], ['2120', 'Gift Card Liability', 'liability', 'Other Current Liability'],
    ['2200', 'Wages Payable', 'liability', 'Other Current Liability'], ['2210', 'Federal Payroll Taxes Payable', 'liability', 'Other Current Liability'],
    ['2220', 'CO Income Tax Withholding Payable', 'liability', 'Other Current Liability'], ['2230', 'FAMLI Premiums Payable', 'liability', 'Other Current Liability'],
    ['2240', 'SUI Payable - CO', 'liability', 'Other Current Liability'], ['2250', 'FUTA Payable', 'liability', 'Other Current Liability'],
    ['3000', 'Owner Equity', 'equity', 'Equity'], ['3100', 'Retained Earnings', 'equity', 'Equity'],
    ['4900', 'Other Income', 'revenue', 'Income'],
    ['6000', 'Wages and Salaries', 'expense', 'Expense'], ['6010', 'Payroll Taxes', 'expense', 'Expense'],
    ['6100', 'Rent', 'expense', 'Expense'], ['6110', 'Utilities', 'expense', 'Expense'], ['6120', 'Insurance', 'expense', 'Expense'],
    ['6200', 'Marketing', 'expense', 'Expense'], ['6210', 'Repairs and Maintenance', 'expense', 'Expense'],
    ['6220', 'Supplies', 'expense', 'Expense'], ['6230', 'POS and Software Fees', 'expense', 'Expense'],
    ['6250', 'Cash Over/Short', 'expense', 'Expense'], ['6900', 'Miscellaneous Expense', 'expense', 'Expense']
];

const VERTICALS: Record<string, VerticalProfile> = {
    restaurant: {
        id: 'restaurant', label: 'Restaurant & Food Service',
        description: 'Full-service and quick-service restaurants, food trucks, catering',
        coa: [
            ...SHARED_COA,
            ['1100', 'Inventory - Food', 'asset', 'Other Current Asset'], ['1110', 'Inventory - Beverage', 'asset', 'Other Current Asset'],
            ['1120', 'Inventory - Paper & Packaging', 'asset', 'Other Current Asset'],
            ['4000', 'Food Sales', 'revenue', 'Income'], ['4100', 'Beverage Sales', 'revenue', 'Income'],
            ['4200', 'Catering Sales', 'revenue', 'Income'], ['4300', 'Delivery Sales', 'revenue', 'Income'],
            ['5000', 'Food Cost - Meat', 'cogs', 'Cost of Goods Sold'], ['5010', 'Food Cost - Produce', 'cogs', 'Cost of Goods Sold'],
            ['5020', 'Food Cost - Dairy', 'cogs', 'Cost of Goods Sold'], ['5030', 'Food Cost - Dry Goods', 'cogs', 'Cost of Goods Sold'],
            ['5040', 'Food Cost - Inventory Adjustment', 'cogs', 'Cost of Goods Sold'],
            ['5100', 'Beverage Cost', 'cogs', 'Cost of Goods Sold'],
            ['5110', 'Beverage Cost - Draught Beer', 'cogs', 'Cost of Goods Sold', '5100'], ['5120', 'Beverage Cost - Packaged & Retail', 'cogs', 'Cost of Goods Sold', '5100'],
            ['5130', 'Beverage Cost - Fountain Soda', 'cogs', 'Cost of Goods Sold', '5100'], ['5140', 'Beverage Cost - Wine', 'cogs', 'Cost of Goods Sold', '5100'],
            ['5150', 'Beverage Cost - Spirits & Liquor', 'cogs', 'Cost of Goods Sold', '5100'], ['5160', 'Beverage Cost - Inventory Adjustment', 'cogs', 'Cost of Goods Sold', '5100'],
            ['5200', 'Paper & Packaging Cost', 'cogs', 'Cost of Goods Sold'],
            ['6001', 'Wages - Kitchen (BOH)', 'expense', 'Expense', '6000'], ['6002', 'Wages - Service (FOH)', 'expense', 'Expense', '6000'],
            ['6240', 'Delivery Commissions & Fees', 'expense', 'Expense']
        ],
        kpiDefs: [
            { key: 'foodCostPct', label: 'Food Cost %', formula: 'food_cogs / food_sales * 100', warningThreshold: 35 },
            { key: 'beverageCostPct', label: 'Beverage Cost %', formula: 'bev_cogs / bev_sales * 100', warningThreshold: 28 },
            { key: 'laborCostPct', label: 'Labor Cost %', formula: 'labor / total_revenue * 100', warningThreshold: 35 },
            { key: 'primeCostPct', label: 'Prime Cost %', formula: '(total_cogs + labor) / total_revenue * 100', warningThreshold: 65 }
        ]
    },
    salon: {
        id: 'salon', label: 'Barber Shop & Beauty Salon',
        description: 'Barbershops, hair salons, nail salons, beauty services',
        coa: [
            ...SHARED_COA,
            ['1100', 'Inventory - Retail Products', 'asset', 'Other Current Asset'],
            ['1110', 'Inventory - Professional Supplies', 'asset', 'Other Current Asset'],
            ['4000', 'Service Revenue - Cuts & Styling', 'revenue', 'Income'], ['4100', 'Service Revenue - Color & Chemical', 'revenue', 'Income'],
            ['4200', 'Retail Product Sales', 'revenue', 'Income'], ['4300', 'Booth Rental Income', 'revenue', 'Income'],
            ['5000', 'COGS - Retail Products', 'cogs', 'Cost of Goods Sold'], ['5010', 'COGS - Professional Supplies', 'cogs', 'Cost of Goods Sold'],
            ['5020', 'COGS - Color & Chemical Products', 'cogs', 'Cost of Goods Sold'],
            ['6001', 'Wages - Stylists', 'expense', 'Expense', '6000'], ['6002', 'Wages - Support Staff', 'expense', 'Expense', '6000'],
            ['6050', 'Commission Expense', 'expense', 'Expense'], ['6060', 'Booth Rental Expense', 'expense', 'Expense'],
            ['6240', 'Continuing Education & Licensing', 'expense', 'Expense']
        ],
        kpiDefs: [
            { key: 'retailMarginPct', label: 'Retail Margin %', formula: '(retail_sales - retail_cogs) / retail_sales * 100', warningThreshold: 40 },
            { key: 'laborCostPct', label: 'Labor + Commission %', formula: '(labor + commission) / total_revenue * 100', warningThreshold: 50 },
            { key: 'revenuePerChair', label: 'Revenue per Chair', formula: 'total_revenue / chair_count' },
            { key: 'productUsageRatio', label: 'Supply Cost %', formula: 'professional_supplies / service_revenue * 100', warningThreshold: 12 }
        ]
    },
    tattoo: {
        id: 'tattoo', label: 'Tattoo Parlor & Studio',
        description: 'Tattoo studios, piercing shops, body art businesses',
        coa: [
            ...SHARED_COA,
            ['1100', 'Inventory - Inks & Pigments', 'asset', 'Other Current Asset'],
            ['1110', 'Inventory - Needles & Disposables', 'asset', 'Other Current Asset'],
            ['1120', 'Inventory - Aftercare Products', 'asset', 'Other Current Asset'],
            ['4000', 'Tattoo Service Revenue', 'revenue', 'Income'], ['4100', 'Piercing Revenue', 'revenue', 'Income'],
            ['4200', 'Aftercare & Retail Sales', 'revenue', 'Income'], ['4300', 'Guest Artist Revenue', 'revenue', 'Income'],
            ['5000', 'COGS - Inks & Pigments', 'cogs', 'Cost of Goods Sold'], ['5010', 'COGS - Needles & Disposables', 'cogs', 'Cost of Goods Sold'],
            ['5020', 'COGS - Piercing Jewelry & Supplies', 'cogs', 'Cost of Goods Sold'], ['5030', 'COGS - Aftercare Products', 'cogs', 'Cost of Goods Sold'],
            ['5040', 'COGS - Sterilization Supplies', 'cogs', 'Cost of Goods Sold'],
            ['6001', 'Wages - Artists', 'expense', 'Expense', '6000'], ['6002', 'Wages - Front Desk', 'expense', 'Expense', '6000'],
            ['6050', 'Artist Percentage Splits', 'expense', 'Expense'], ['6060', 'Guest Artist Payouts', 'expense', 'Expense'],
            ['6070', 'Health Dept Licensing & Compliance', 'expense', 'Expense'],
            ['6240', 'Autoclave & Sterilization Maintenance', 'expense', 'Expense']
        ],
        kpiDefs: [
            { key: 'supplyCostPct', label: 'Supply Cost %', formula: 'total_cogs / total_revenue * 100', warningThreshold: 15 },
            { key: 'artistSplitPct', label: 'Artist Split %', formula: 'artist_splits / tattoo_revenue * 100', warningThreshold: 60 },
            { key: 'laborCostPct', label: 'Total Labor %', formula: '(labor + artist_splits) / total_revenue * 100', warningThreshold: 55 },
            { key: 'revenuePerStation', label: 'Revenue per Station', formula: 'total_revenue / station_count' }
        ]
    },
    auto_repair: {
        id: 'auto_repair', label: 'Auto Repair & Service',
        description: 'Mechanical shops, tire shops, oil change, auto body',
        coa: [
            ...SHARED_COA,
            ['1100', 'Inventory - Parts', 'asset', 'Other Current Asset'],
            ['1110', 'Inventory - Fluids & Chemicals', 'asset', 'Other Current Asset'],
            ['1120', 'Inventory - Tires', 'asset', 'Other Current Asset'],
            ['4000', 'Labor Revenue - Mechanical', 'revenue', 'Income'], ['4100', 'Parts Sales Revenue', 'revenue', 'Income'],
            ['4200', 'Sublet Repair Revenue', 'revenue', 'Income'], ['4300', 'Tire Sales Revenue', 'revenue', 'Income'],
            ['4400', 'Diagnostic & Inspection Revenue', 'revenue', 'Income'],
            ['5000', 'COGS - Parts', 'cogs', 'Cost of Goods Sold'], ['5010', 'COGS - Fluids & Chemicals', 'cogs', 'Cost of Goods Sold'],
            ['5020', 'COGS - Tires', 'cogs', 'Cost of Goods Sold'], ['5030', 'COGS - Sublet Repairs', 'cogs', 'Cost of Goods Sold'],
            ['5040', 'COGS - Shop Supplies', 'cogs', 'Cost of Goods Sold'],
            ['6001', 'Wages - Technicians', 'expense', 'Expense', '6000'], ['6002', 'Wages - Service Writers', 'expense', 'Expense', '6000'],
            ['6050', 'Tool Allowance', 'expense', 'Expense'], ['6060', 'Waste Disposal & Environmental', 'expense', 'Expense'],
            ['6070', 'ASE Certification & Training', 'expense', 'Expense'],
            ['6240', 'Shop Equipment Maintenance', 'expense', 'Expense']
        ],
        kpiDefs: [
            { key: 'partsMarginPct', label: 'Parts Margin %', formula: '(parts_sales - parts_cogs) / parts_sales * 100', warningThreshold: 40 },
            { key: 'laborEfficiency', label: 'Labor Efficiency %', formula: 'billed_hours / clocked_hours * 100', warningThreshold: 75 },
            { key: 'laborCostPct', label: 'Labor Cost %', formula: 'labor / total_revenue * 100', warningThreshold: 35 },
            { key: 'effectiveLaborRate', label: 'Effective Labor Rate', formula: 'labor_revenue / billed_hours' }
        ]
    }
};

// Legacy alias for backward compatibility
const COA = VERTICALS.restaurant.coa;

async function listAll(table: string): Promise<Array<Record<string, any>>> {
    const out: Array<Record<string, any>> = [];
    let nextToken: string | undefined;
    do {
        const page = await db.list(table, { limit: 200, nextToken });
        out.push(...page.items);
        nextToken = page.nextToken;
    } while (nextToken);
    return out;
}

async function ensureCoa(): Promise<Array<Record<string, any>>> {
    let accounts = await listAll('accounts');
    if (accounts.length === 0) {
        const records = COA.map(([accountNo, name, type, qbType, parent]) => ({ accountNo, name, type, qbType, parentAccountNo: parent || null, active: true }));
        await db.add('accounts', records);
        accounts = await listAll('accounts');
    }
    return accounts;
}

type JLine = { accountName: string; debit: number; credit: number; description?: string };
type JEntry = { journalNo: string; entryDate: string; description: string; source: string; lines: JLine[] };

async function postEntry(entry: JEntry, locId: string, defId: string): Promise<{ ok: boolean; message?: string }> {
    const accounts = await ensureCoa();
    const byName = new Map(accounts.map((a) => [String(a.name).toLowerCase(), a]));
    const parents = new Set(accounts.filter((a) => a.parentAccountNo).map((a) => a.parentAccountNo));
    if (!DATE_RE.test(entry.entryDate)) return { ok: false, message: 'entry date must be YYYY-MM-DD' };
    if (!entry.lines || entry.lines.length < 2) return { ok: false, message: 'journal entry needs at least 2 lines' };
    let dr = 0, cr = 0;
    for (const l of entry.lines) {
        const acct = byName.get((l.accountName || '').toLowerCase());
        if (!acct) return { ok: false, message: 'unknown account: ' + l.accountName };
        if (parents.has(acct.accountNo)) return { ok: false, message: 'roll-up parent account, post to a sub-account: ' + l.accountName };
        if (!(l.debit >= 0) || !(l.credit >= 0) || (l.debit > 0) === (l.credit > 0)) return { ok: false, message: 'each line needs exactly one of debit or credit (' + l.accountName + ')' };
        dr += l.debit; cr += l.credit;
    }
    if (Math.abs(cents(dr) - cents(cr)) > 0.005) return { ok: false, message: 'unbalanced: debits ' + cents(dr).toFixed(2) + ' vs credits ' + cents(cr).toFixed(2) };
    const existing = await db.list('journal_entries', { filter: { journalNo: entry.journalNo } });
    if (existing.items.some((e) => inLoc(e, locId, defId))) return { ok: false, message: 'journal ' + entry.journalNo + ' already posted' };
    const [id] = await db.add('journal_entries', [{ ...entry, locationId: locId, createdAt: Date.now() }]);
    if (!id) return { ok: false, message: 'failed to save journal entry' };
    return { ok: true };
}

async function locEntries(locId: string, defId: string): Promise<Array<Record<string, any>>> {
    return (await listAll('journal_entries')).filter((e) => inLoc(e, locId, defId));
}

async function accountBalances(from: string, to: string, locId: string, defId: string) {
    const accounts = await ensureCoa();
    const entries = await locEntries(locId, defId);
    const sums = new Map<string, { debits: number; credits: number }>();
    for (const e of entries) {
        const d = String(e.entryDate || '');
        if (d < from || d > to) continue;
        for (const l of (e.lines || []) as JLine[]) {
            const key = (l.accountName || '').toLowerCase();
            const s = sums.get(key) || { debits: 0, credits: 0 };
            s.debits += Number(l.debit) || 0; s.credits += Number(l.credit) || 0;
            sums.set(key, s);
        }
    }
    return accounts.filter((a) => a.active).map((a) => {
        const s = sums.get(String(a.name).toLowerCase()) || { debits: 0, credits: 0 };
        const debitNormal = a.type === 'asset' || a.type === 'cogs' || a.type === 'expense';
        return { accountNo: a.accountNo, name: a.name, type: a.type, parentAccountNo: a.parentAccountNo, debits: cents(s.debits), credits: cents(s.credits), balance: cents(debitNormal ? s.debits - s.credits : s.credits - s.debits) };
    }).sort((x, y) => (x.accountNo < y.accountNo ? -1 : 1));
}

function plFrom(rows: Awaited<ReturnType<typeof accountBalances>>) {
    const sum = (rs: typeof rows) => cents(rs.reduce((s, r) => s + r.balance, 0));
    const nonzero = (rs: typeof rows) => rs.filter((r) => r.balance !== 0 || r.debits !== 0 || r.credits !== 0);
    const revenue = nonzero(rows.filter((r) => r.type === 'revenue'));
    const cogs = nonzero(rows.filter((r) => r.type === 'cogs'));
    const expenses = nonzero(rows.filter((r) => r.type === 'expense'));
    const totalRevenue = sum(revenue), totalCogs = sum(cogs), totalExpenses = sum(expenses);
    const foodSales = revenue.find((r) => r.name === 'Food Sales')?.balance ?? 0;
    const foodCost = cents(cogs.filter((r) => r.name.startsWith('Food Cost')).reduce((s, r) => s + r.balance, 0));
    const bevSales = revenue.find((r) => r.name === 'Beverage Sales')?.balance ?? 0;
    const bevCost = cents(cogs.filter((r) => r.name.startsWith('Beverage Cost')).reduce((s, r) => s + r.balance, 0));
    const laborCost = cents(expenses.filter((r) => r.name.startsWith('Wages') || r.name === 'Payroll Taxes').reduce((s, r) => s + r.balance, 0));
    const primeCost = cents(totalCogs + laborCost);
    const pct = (a: number, b: number) => (b > 0 ? cents((a / b) * 100) : null);
    return {
        revenue, cogs, expenses,
        totals: { revenue: totalRevenue, cogs: totalCogs, grossProfit: cents(totalRevenue - totalCogs), expenses: totalExpenses, netIncome: cents(totalRevenue - totalCogs - totalExpenses) },
        kpis: { foodCostPct: pct(foodCost, foodSales), beverageCostPct: pct(bevCost, bevSales), laborCostPct: pct(laborCost, totalRevenue), primeCostPct: pct(primeCost, totalRevenue), primeCostStatus: totalRevenue > 0 ? ((pct(primeCost, totalRevenue) as number) > 65 ? 'WARNING: prime cost above 65% of sales' : 'healthy') : null }
    };
}

// Compute dynamic KPIs based on active vertical profile
function computeVerticalKpis(rows: Awaited<ReturnType<typeof accountBalances>>, profile: VerticalProfile): Array<{ key: string; label: string; value: number | null; warning: boolean }> {
    const sum = (rs: typeof rows) => cents(rs.reduce((s, r) => s + r.balance, 0));
    const revenue = rows.filter((r) => r.type === 'revenue');
    const cogs = rows.filter((r) => r.type === 'cogs');
    const expenses = rows.filter((r) => r.type === 'expense');
    const totalRevenue = sum(revenue), totalCogs = sum(cogs);
    const labor = cents(expenses.filter((r) => r.name.startsWith('Wages') || r.name === 'Payroll Taxes').reduce((s, r) => s + r.balance, 0));
    const pct = (a: number, b: number) => (b > 0 ? cents((a / b) * 100) : null);
    const byName = (name: string) => rows.find((r) => r.name === name)?.balance ?? 0;
    const byPrefix = (prefix: string) => cents(rows.filter((r) => r.name.startsWith(prefix)).reduce((s, r) => s + r.balance, 0));

    return profile.kpiDefs.map((kpi) => {
        let value: number | null = null;
        switch (kpi.key) {
            // Restaurant
            case 'foodCostPct': value = pct(byPrefix('Food Cost'), byName('Food Sales')); break;
            case 'beverageCostPct': value = pct(byPrefix('Beverage Cost'), byName('Beverage Sales')); break;
            case 'primeCostPct': value = pct(totalCogs + labor, totalRevenue); break;
            // Salon
            case 'retailMarginPct': { const rs = byName('Retail Product Sales'); const rc = byName('COGS - Retail Products'); value = rs > 0 ? pct(rs - rc, rs) : null; break; }
            case 'productUsageRatio': { const svc = sum(revenue.filter((r) => r.name.includes('Service'))); value = pct(byName('COGS - Professional Supplies'), svc); break; }
            case 'revenuePerChair': value = totalRevenue; break; // Placeholder: divide by chair_count when configured
            // Tattoo
            case 'supplyCostPct': value = pct(totalCogs, totalRevenue); break;
            case 'artistSplitPct': value = pct(byName('Artist Percentage Splits'), byName('Tattoo Service Revenue')); break;
            case 'revenuePerStation': value = totalRevenue; break; // Placeholder: divide by station_count when configured
            // Auto repair
            case 'partsMarginPct': { const ps = byName('Parts Sales Revenue'); const pc = byName('COGS - Parts'); value = ps > 0 ? pct(ps - pc, ps) : null; break; }
            case 'laborEfficiency': value = null; break; // Requires billed_hours / clocked_hours tracking
            case 'effectiveLaborRate': value = null; break; // Requires billed_hours tracking
            // Common
            case 'laborCostPct': { const commission = byName('Commission Expense') + byName('Artist Percentage Splits') + byName('Guest Artist Payouts'); value = pct(labor + commission, totalRevenue); break; }
            default: value = null;
        }
        return { key: kpi.key, label: kpi.label, value, warning: value !== null && kpi.warningThreshold !== undefined && value > kpi.warningThreshold };
    });
}

const CATEGORY_ROUTES: Array<[string[], string]> = [
    [['meat', 'protein', 'beef', 'chicken', 'pork', 'seafood'], 'Food Cost - Meat'],
    [['produce', 'vegetable', 'fruit'], 'Food Cost - Produce'],
    [['dairy', 'cheese', 'milk'], 'Food Cost - Dairy'],
    [['dry', 'grocery', 'flour', 'oil'], 'Food Cost - Dry Goods'],
    [['draught', 'draft'], 'Beverage Cost - Draught Beer'],
    [['wine'], 'Beverage Cost - Wine'],
    [['spirit', 'liquor', 'vodka', 'whiskey', 'tequila'], 'Beverage Cost - Spirits & Liquor'],
    [['soda', 'syrup', 'fountain'], 'Beverage Cost - Fountain Soda'],
    [['packaged', 'bottle', 'beverage', 'beer'], 'Beverage Cost - Packaged & Retail'],
    [['paper', 'box', 'packaging', 'napkin', 'cup', 'to-go'], 'Paper & Packaging Cost']
];
const DEPOSIT_ROUTES: Array<[string[], string]> = [
    [['visa'], 'Visa Clearing Account'],
    [['mastercard', 'master card'], 'Mastercard Clearing Account'],
    [['amex', 'american express'], 'Amex Clearing Account'],
    [['discover'], 'Discover Clearing Account'],
    [['doordash', 'ubereats', 'uber eats', 'grubhub'], 'Delivery Payout Clearing'],
    [['safe drop', 'night deposit', 'cash deposit'], 'Cash Drawer'],
    [['card', 'pos ', 'merchant', 'settlement', 'sq *', 'square', 'toast', 'clover'], 'Other Tender Clearing']
];
function routeDeposit(description: string): string | null {
    const d = (description || '').toLowerCase();
    for (const [keys, account] of DEPOSIT_ROUTES) if (keys.some((k) => d.includes(k))) return account;
    return null;
}

function routeCategory(category: string): string {
    const c = (category || '').toLowerCase();
    for (const [keys, account] of CATEGORY_ROUTES) if (keys.some((k) => c.includes(k))) return account;
    return 'Supplies';
}

// ── Delivery reconciliation (ported from the legacy engine) ──
// Identity enforced: net_payout = gross − commissions − marketing − refunds.
// driver_tips are pass-through and never posted.
const DELIVERY_CSV_HEADER = 'platform,period_start,period_end,gross_sales,commissions,marketing_fees,refunds,driver_tips,net_payout';
const DELIVERY_NUM_FIELDS = ['grossSales', 'commissions', 'marketingFees', 'refunds', 'driverTips', 'netPayout'] as const;

function parseDeliveryCsv(csv: string) {
    const errors: Array<{ line: number; message: string }> = [];
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { ok: false as const, errors: [{ line: 0, message: 'empty_file' }] };
    if (lines[0].trim() !== DELIVERY_CSV_HEADER) {
        return { ok: false as const, errors: [{ line: 1, message: 'header_mismatch: expected "' + DELIVERY_CSV_HEADER + '"' }] };
    }
    const statements: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]).map((c) => c.trim());
        if (cols.length !== 9) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 9' }); continue; }
        const s: Record<string, any> = {
            platform: cols[0], periodStart: cols[1], periodEnd: cols[2],
            grossSales: Number(cols[3]), commissions: Number(cols[4]), marketingFees: Number(cols[5]),
            refunds: Number(cols[6]), driverTips: Number(cols[7]), netPayout: Number(cols[8])
        };
        if (!s.platform) errors.push({ line: i + 1, message: 'platform required' });
        if (!DATE_RE.test(s.periodStart)) errors.push({ line: i + 1, message: 'period_start must be YYYY-MM-DD' });
        if (!DATE_RE.test(s.periodEnd)) errors.push({ line: i + 1, message: 'period_end must be YYYY-MM-DD' });
        if (DATE_RE.test(s.periodStart) && DATE_RE.test(s.periodEnd) && s.periodEnd < s.periodStart) errors.push({ line: i + 1, message: 'period_end before period_start' });
        for (const f of DELIVERY_NUM_FIELDS) {
            if (!Number.isFinite(s[f]) || s[f] < 0) errors.push({ line: i + 1, message: f + ' must be a nonnegative number' });
        }
        const key = s.platform + '/' + s.periodStart + '/' + s.periodEnd;
        if (seen.has(key)) errors.push({ line: i + 1, message: 'duplicate platform/period in file: ' + key });
        seen.add(key);
        const expectedNet = cents(s.grossSales - s.commissions - s.marketingFees - s.refunds);
        if (DELIVERY_NUM_FIELDS.every((f) => Number.isFinite(s[f])) && Math.abs(expectedNet - cents(s.netPayout)) > 0.01) {
            errors.push({ line: i + 1, message: 'net_payout does not reconcile: gross - commissions - marketing - refunds = ' + expectedNet.toFixed(2) + ' but file says ' + cents(s.netPayout).toFixed(2) });
        }
        if (s.grossSales <= 0) errors.push({ line: i + 1, message: 'gross_sales must be positive' });
        statements.push(s);
    }
    if (errors.length > 0) return { ok: false as const, errors };
    return { ok: true as const, statements };
}

function buildDeliveryEntry(s: Record<string, any>): JEntry {
    const desc = s.platform + ' ' + s.periodStart + ' to ' + s.periodEnd;
    const line = (accountName: string, description: string, debit: number, credit: number): JLine => ({ accountName, description, debit, credit });
    return {
        journalNo: 'DL-' + s.platform + '-' + s.periodEnd,
        entryDate: s.periodEnd,
        description: 'Delivery payout reconciliation - ' + desc,
        source: 'delivery_import',
        lines: [
            ...(s.netPayout > 0 ? [line('Delivery Payout Clearing', 'Payout in transit - ' + desc, cents(s.netPayout), 0)] : []),
            ...(s.commissions > 0 ? [line('Delivery Commissions & Fees', 'Platform commission - ' + desc, cents(s.commissions), 0)] : []),
            ...(s.marketingFees > 0 ? [line('Marketing', 'Platform marketing fees - ' + desc, cents(s.marketingFees), 0)] : []),
            ...(s.refunds > 0 ? [line('Delivery Sales', 'Customer refunds (contra-revenue) - ' + desc, cents(s.refunds), 0)] : []),
            line('Delivery Sales', 'Gross marketplace sales - ' + desc, 0, cents(s.grossSales))
        ]
    };
}

// ── Payroll journal import (ported) ──
// Recording only: payroll is executed by the operator's provider; this
// records what the provider reports. provider_remits_taxes=true adds a
// remittance entry so nothing stays owed.
const PAYROLL_CSV_HEADER = 'pay_date,boh_gross,foh_gross,employer_fed_taxes,employer_futa,employer_sui_co,employer_famli,fed_withholding,co_withholding,employee_famli,net_pay_sweep,provider_remits_taxes';
const PAYROLL_NUM_FIELDS = ['bohGross', 'fohGross', 'employerFedTaxes', 'employerFuta', 'employerSuiCo', 'employerFamli', 'fedWithholding', 'coWithholding', 'employeeFamli', 'netPaySweep'] as const;

function parsePayrollCsv(csv: string) {
    const errors: Array<{ line: number; message: string }> = [];
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { ok: false as const, errors: [{ line: 0, message: 'empty_file' }] };
    if (lines[0].trim() !== PAYROLL_CSV_HEADER) {
        return { ok: false as const, errors: [{ line: 1, message: 'header_mismatch: expected "' + PAYROLL_CSV_HEADER + '"' }] };
    }
    const runs: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]).map((c) => c.trim());
        if (cols.length !== 12) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 12' }); continue; }
        const run: Record<string, any> = {
            payDate: cols[0],
            bohGross: Number(cols[1]), fohGross: Number(cols[2]),
            employerFedTaxes: Number(cols[3]), employerFuta: Number(cols[4]), employerSuiCo: Number(cols[5]), employerFamli: Number(cols[6]),
            fedWithholding: Number(cols[7]), coWithholding: Number(cols[8]), employeeFamli: Number(cols[9]),
            netPaySweep: Number(cols[10]), providerRemitsTaxes: cols[11].toLowerCase()
        };
        if (!DATE_RE.test(run.payDate)) errors.push({ line: i + 1, message: 'pay_date must be YYYY-MM-DD' });
        if (seen.has(run.payDate)) errors.push({ line: i + 1, message: 'duplicate pay_date in file: ' + run.payDate });
        seen.add(run.payDate);
        for (const f of PAYROLL_NUM_FIELDS) {
            if (!Number.isFinite(run[f]) || run[f] < 0) errors.push({ line: i + 1, message: f + ' must be a nonnegative number' });
        }
        if (!['true', 'false'].includes(run.providerRemitsTaxes)) errors.push({ line: i + 1, message: 'provider_remits_taxes must be true or false' });
        run.providerRemitsTaxes = run.providerRemitsTaxes === 'true';
        const expectedNet = cents(run.bohGross + run.fohGross - run.fedWithholding - run.coWithholding - run.employeeFamli);
        if (Number.isFinite(run.netPaySweep) && Math.abs(expectedNet - cents(run.netPaySweep)) > 0.01) {
            errors.push({ line: i + 1, message: 'net_pay_sweep does not reconcile: gross - employee withholdings = ' + expectedNet.toFixed(2) + ' but file says ' + cents(run.netPaySweep).toFixed(2) });
        }
        runs.push(run);
    }
    if (errors.length > 0) return { ok: false as const, errors };
    return { ok: true as const, runs };
}

function buildPayrollEntries(run: Record<string, any>): JEntry[] {
    const line = (accountName: string, description: string, debit: number, credit: number): JLine => ({ accountName, description, debit, credit });
    const employerTaxes = cents(run.employerFedTaxes + run.employerFuta + run.employerSuiCo + run.employerFamli);
    const fedLiability = cents(run.employerFedTaxes + run.fedWithholding);
    const famliLiability = cents(run.employerFamli + run.employeeFamli);
    const liabilities: Array<[string, number]> = ([
        ['Federal Payroll Taxes Payable', fedLiability],
        ['FUTA Payable', cents(run.employerFuta)],
        ['SUI Payable - CO', cents(run.employerSuiCo)],
        ['FAMLI Premiums Payable', famliLiability],
        ['CO Income Tax Withholding Payable', cents(run.coWithholding)]
    ] as Array<[string, number]>).filter(([, amount]) => amount > 0);

    const accrual: JEntry = {
        journalNo: 'PR-' + run.payDate,
        entryDate: run.payDate,
        description: 'Payroll journal - pay date ' + run.payDate,
        source: 'payroll_import',
        lines: [
            ...(run.bohGross > 0 ? [line('Wages - Kitchen (BOH)', 'Gross wages BOH', cents(run.bohGross), 0)] : []),
            ...(run.fohGross > 0 ? [line('Wages - Service (FOH)', 'Gross wages FOH', cents(run.fohGross), 0)] : []),
            ...(employerTaxes > 0 ? [line('Payroll Taxes', 'Employer payroll taxes', employerTaxes, 0)] : []),
            ...liabilities.map(([name, amount]) => line(name, 'Payroll liability accrual', 0, amount)),
            ...(run.netPaySweep > 0 ? [line('Cash - General', 'Net pay sweep by payroll provider', 0, cents(run.netPaySweep))] : [])
        ]
    };
    const entries = [accrual];
    const taxTotal = cents(liabilities.reduce((s, [, amount]) => s + amount, 0));
    if (run.providerRemitsTaxes && taxTotal > 0) {
        entries.push({
            journalNo: 'PR-REMIT-' + run.payDate,
            entryDate: run.payDate,
            description: 'Payroll taxes remitted by provider - pay date ' + run.payDate,
            source: 'payroll_import',
            lines: [
                ...liabilities.map(([name, amount]) => line(name, 'Remitted by payroll provider', amount, 0)),
                line('Cash - General', 'Tax sweep by payroll provider', 0, taxTotal)
            ]
        });
    }
    return entries;
}

// ── POS daily-summary CSV import (ported from legacy lib/possummary.js) ──
// Meets operators where they are: Toast/Clover/Square daily summary exports
// normalize into one canonical contract with REAL category splits (no hardcoded
// food/beverage ratios). Copy-paste the CSV from your POS export — no API keys.
const POS_SUMMARY_CSV_HEADER = 'source_pos,business_date,food_sales,beverage_sales,sales_tax,cc_tips,cash_drops,gift_cards,processing_fees,actual_cash_drop';
const POS_SOURCES = ['Toast', 'Clover', 'Square', 'Other'];
const POS_NUM_FIELDS = ['foodSales', 'beverageSales', 'salesTax', 'ccTips', 'cashDrops', 'giftCards', 'processingFees'] as const;

function parsePosSummaryCsv(csv: string) {
    const errors: Array<{ line: number; message: string }> = [];
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { ok: false as const, errors: [{ line: 0, message: 'empty_file' }] };
    if (lines[0].trim() !== POS_SUMMARY_CSV_HEADER) {
        return { ok: false as const, errors: [{ line: 1, message: 'header_mismatch: expected "' + POS_SUMMARY_CSV_HEADER + '"' }] };
    }
    const rows: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]).map((c) => c.trim());
        if (cols.length !== 10) { errors.push({ line: i + 1, message: 'column_count_mismatch: expected 10' }); continue; }
        const row: Record<string, any> = {
            sourcePos: cols[0], businessDate: cols[1],
            foodSales: Number(cols[2]), beverageSales: Number(cols[3]), salesTax: Number(cols[4]),
            ccTips: Number(cols[5]), cashDrops: Number(cols[6]), giftCards: Number(cols[7]),
            processingFees: Number(cols[8] === '' ? 0 : cols[8]),
            actualCashDrop: cols[9] === '' ? null : Number(cols[9])
        };
        if (!POS_SOURCES.includes(row.sourcePos)) errors.push({ line: i + 1, message: 'source_pos must be one of ' + POS_SOURCES.join('|') });
        if (!DATE_RE.test(row.businessDate)) errors.push({ line: i + 1, message: 'business_date must be YYYY-MM-DD' });
        const key = row.sourcePos + '/' + row.businessDate;
        if (seen.has(key)) errors.push({ line: i + 1, message: 'duplicate source_pos/business_date in file: ' + key });
        seen.add(key);
        for (const f of POS_NUM_FIELDS) {
            if (!Number.isFinite(row[f]) || row[f] < 0) errors.push({ line: i + 1, message: f + ' must be a nonnegative number' });
        }
        if (row.actualCashDrop !== null && (!Number.isFinite(row.actualCashDrop) || row.actualCashDrop < 0)) {
            errors.push({ line: i + 1, message: 'actual_cash_drop must be a nonnegative number when present' });
        }
        if (POS_NUM_FIELDS.every((f) => Number.isFinite(row[f]))) {
            const collected = cents(row.foodSales + row.beverageSales + row.salesTax + row.ccTips + row.giftCards);
            if (collected <= 0) errors.push({ line: i + 1, message: 'nothing collected — all amounts zero' });
            const cardGross = cents(collected - row.cashDrops);
            if (cardGross < 0) errors.push({ line: i + 1, message: 'cash_drops exceeds total collected' });
            if (row.processingFees > 0 && row.processingFees > cardGross) {
                errors.push({ line: i + 1, message: 'processing_fees exceeds card collections' });
            }
        }
        rows.push(row);
    }
    if (errors.length > 0) return { ok: false as const, errors };
    return { ok: true as const, rows };
}

// POS revenue account mapping per vertical profile
const POS_REVENUE_ACCOUNTS: Record<string, { primary: string; secondary: string }> = {
    restaurant: { primary: 'Food Sales', secondary: 'Beverage Sales' },
    salon: { primary: 'Service Revenue - Cuts & Styling', secondary: 'Retail Product Sales' },
    tattoo: { primary: 'Tattoo Service Revenue', secondary: 'Aftercare & Retail Sales' },
    auto_repair: { primary: 'Labor Revenue - Mechanical', secondary: 'Parts Sales Revenue' }
};

function buildPosSummaryEntry(row: Record<string, any>, profileId?: string): JEntry {
    const desc = row.sourcePos + ' daily summary ' + row.businessDate;
    const collected = cents(row.foodSales + row.beverageSales + row.salesTax + row.ccTips + row.giftCards);
    const cardGross = cents(collected - row.cashDrops);
    const actualCash = row.actualCashDrop ?? row.cashDrops;
    const overShort = cents(actualCash - row.cashDrops);
    const revenueAccounts = POS_REVENUE_ACCOUNTS[profileId || 'restaurant'] || POS_REVENUE_ACCOUNTS.restaurant;
    const lines: JLine[] = [
        ...(actualCash > 0 ? [{ accountName: 'Cash Drawer', debit: cents(actualCash), credit: 0, description: 'Cash collected — ' + desc }] : []),
        ...(cardGross > 0 ? [{ accountName: 'Other Tender Clearing', debit: cents(cardGross - row.processingFees), credit: 0, description: 'Card collections — ' + desc }] : []),
        ...(row.processingFees > 0 ? [{ accountName: 'POS and Software Fees', debit: cents(row.processingFees), credit: 0, description: 'Processing fees — ' + desc }] : []),
        ...(overShort < 0 ? [{ accountName: 'Cash Over/Short', debit: cents(-overShort), credit: 0, description: 'Drawer short — ' + desc }] : []),
        ...(row.foodSales > 0 ? [{ accountName: revenueAccounts.primary, debit: 0, credit: cents(row.foodSales), description: desc }] : []),
        ...(row.beverageSales > 0 ? [{ accountName: revenueAccounts.secondary, debit: 0, credit: cents(row.beverageSales), description: desc }] : []),
        ...(row.salesTax > 0 ? [{ accountName: 'Sales Tax Payable - CO', debit: 0, credit: cents(row.salesTax), description: desc }] : []),
        ...(row.ccTips > 0 ? [{ accountName: 'Tips Payable', debit: 0, credit: cents(row.ccTips), description: 'Card tips — ' + desc }] : []),
        ...(row.giftCards > 0 ? [{ accountName: 'Gift Card Liability', debit: 0, credit: cents(row.giftCards), description: 'Gift cards activated — ' + desc }] : []),
        ...(overShort > 0 ? [{ accountName: 'Cash Over/Short', debit: 0, credit: cents(overShort), description: 'Drawer over — ' + desc }] : [])
    ];
    return { journalNo: 'DSUM-' + row.sourcePos + '-' + row.businessDate, entryDate: row.businessDate, description: desc, source: 'pos_summary', lines };
}

// ── Physical inventory (ported from legacy lib/inventory.js) ──
// The operator counts what is actually on the shelf; the ledger says what
// should be there. The variance posts to a dedicated COGS adjustment account.
const INVENTORY_CATEGORIES_BY_VERTICAL: Record<string, Array<{ key: string; label: string; inventoryAccount: string; adjustmentAccount: string }>> = {
    restaurant: [
        { key: 'food', label: 'Food inventory ($)', inventoryAccount: 'Inventory - Food', adjustmentAccount: 'Food Cost - Inventory Adjustment' },
        { key: 'beverage', label: 'Beverage inventory ($)', inventoryAccount: 'Inventory - Beverage', adjustmentAccount: 'Beverage Cost - Inventory Adjustment' },
        { key: 'paper', label: 'Paper & packaging ($)', inventoryAccount: 'Inventory - Paper & Packaging', adjustmentAccount: 'Paper & Packaging Cost' }
    ],
    salon: [
        { key: 'retail', label: 'Retail products ($)', inventoryAccount: 'Inventory - Retail Products', adjustmentAccount: 'COGS - Retail Products' },
        { key: 'professional', label: 'Professional supplies ($)', inventoryAccount: 'Inventory - Professional Supplies', adjustmentAccount: 'COGS - Professional Supplies' }
    ],
    tattoo: [
        { key: 'inks', label: 'Inks & pigments ($)', inventoryAccount: 'Inventory - Inks & Pigments', adjustmentAccount: 'COGS - Inks & Pigments' },
        { key: 'needles', label: 'Needles & disposables ($)', inventoryAccount: 'Inventory - Needles & Disposables', adjustmentAccount: 'COGS - Needles & Disposables' },
        { key: 'aftercare', label: 'Aftercare products ($)', inventoryAccount: 'Inventory - Aftercare Products', adjustmentAccount: 'COGS - Aftercare Products' }
    ],
    auto_repair: [
        { key: 'parts', label: 'Parts inventory ($)', inventoryAccount: 'Inventory - Parts', adjustmentAccount: 'COGS - Parts' },
        { key: 'fluids', label: 'Fluids & chemicals ($)', inventoryAccount: 'Inventory - Fluids & Chemicals', adjustmentAccount: 'COGS - Fluids & Chemicals' },
        { key: 'tires', label: 'Tires ($)', inventoryAccount: 'Inventory - Tires', adjustmentAccount: 'COGS - Tires' }
    ]
};
// Legacy alias for backward compat
const INVENTORY_CATEGORIES = INVENTORY_CATEGORIES_BY_VERTICAL.restaurant;

function buildInventoryEntry(countDate: string, items: Array<{ inventoryAccount: string; adjustmentAccount: string; ledgerBalance: number; physicalCount: number }>): JEntry | null {
    const lines: JLine[] = [];
    for (const it of items) {
        const variance = cents(it.ledgerBalance - it.physicalCount);
        if (variance === 0) continue;
        const desc = 'Physical count ' + countDate + ' — ' + it.inventoryAccount;
        if (variance > 0) {
            lines.push({ accountName: it.adjustmentAccount, debit: variance, credit: 0, description: desc });
            lines.push({ accountName: it.inventoryAccount, debit: 0, credit: variance, description: desc });
        } else {
            lines.push({ accountName: it.inventoryAccount, debit: -variance, credit: 0, description: desc });
            lines.push({ accountName: it.adjustmentAccount, debit: 0, credit: -variance, description: desc });
        }
    }
    if (lines.length === 0) return null;
    return { journalNo: 'INV-' + countDate, entryDate: countDate, description: 'Periodic physical inventory adjustment', source: 'inventory_count', lines };
}

// ── Compliance calendar (ported) ──
// CO + federal filing deadlines; estimated amounts come live from the
// location's liability balances as of each period end — no tax rates are
// hardcoded. Zero-balance overdue periods auto-file. Manual FILED marks are
// stored as override rows in compliance_events.
const COMPLIANCE_SCHEDULES = [
    { taxType: 'CO_SALES_TAX', form: 'DR 0100', cadence: 'monthly', liabilityAccount: 'Sales Tax Payable - CO', due: 'next-month-20' },
    { taxType: 'CO_PIT', form: 'DR 1094', cadence: 'monthly', liabilityAccount: 'CO Income Tax Withholding Payable', due: 'next-month-15' },
    { taxType: 'CO_FAMLI', form: 'FAMLI Quarterly Report', cadence: 'quarterly', liabilityAccount: 'FAMLI Premiums Payable', due: 'next-month-end' },
    { taxType: 'CO_SUI', form: 'UITR-1', cadence: 'quarterly', liabilityAccount: 'SUI Payable - CO', due: 'next-month-end' },
    { taxType: 'FED_941', form: 'Form 941', cadence: 'quarterly', liabilityAccount: 'Federal Payroll Taxes Payable', due: 'next-month-end' },
    { taxType: 'FED_940', form: 'Form 940', cadence: 'annual', liabilityAccount: 'FUTA Payable', due: 'jan-31' }
];
const ALERT_THRESHOLD_DAYS = 14;

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoYmd = (y: number, m: number, d: number) => y + '-' + pad2(m) + '-' + pad2(d);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function periodEnds(cadence: string, today: Date): string[] {
    const lo = new Date(today.getTime() - 92 * 86400000).toISOString().slice(0, 10);
    const hi = new Date(today.getTime() + 366 * 86400000).toISOString().slice(0, 10);
    const ends: string[] = [];
    const y = today.getUTCFullYear();
    for (let yy = y - 1; yy <= y + 1; yy++) {
        if (cadence === 'monthly') for (let m = 1; m <= 12; m++) ends.push(isoYmd(yy, m, lastDay(yy, m)));
        if (cadence === 'quarterly') for (const m of [3, 6, 9, 12]) ends.push(isoYmd(yy, m, lastDay(yy, m)));
        if (cadence === 'annual') ends.push(isoYmd(yy, 12, 31));
    }
    return ends.filter((e) => e >= lo && e <= hi);
}

function dueDateFor(rule: string, periodEnd: string): string {
    const [y, m] = periodEnd.split('-').map(Number);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    if (rule === 'next-month-20') return isoYmd(ny, nm, 20);
    if (rule === 'next-month-15') return isoYmd(ny, nm, 15);
    if (rule === 'next-month-end') return isoYmd(ny, nm, lastDay(ny, nm));
    return isoYmd(y + 1, 1, 31);
}

// ── QuickBooks exports (ported) — Tier 1 QBO journal CSV, Tier 2 IIF ──
function csvEsc(v: unknown): string {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function usDate(isoDate: string): string {
    const [y, m, d] = isoDate.split('-');
    return m + '/' + d + '/' + y;
}
/** Map journal source to a QuickBooks Class/Department for proper categorization. */
function qbClass(source: string): string {
    if (source === 'daily_sales' || source === 'pos_summary') return 'Sales';
    if (source === 'delivery_import') return 'Delivery';
    if (source === 'payroll_import') return 'Labor';
    if (source === 'ap_scan' || source === 'ap_payment') return 'Cost of Goods';
    if (source === 'bank_import') return 'Operations';
    if (source === 'inventory_count') return 'Inventory';
    return 'General';
}

/** Map account type to a QuickBooks-friendly category for reporting. */
function qbCategory(accountName: string, accounts: Array<Record<string, any>>): string {
    const acct = accounts.find((a) => String(a.name).toLowerCase() === accountName.toLowerCase());
    if (!acct) return '';
    if (acct.type === 'revenue') return 'Income';
    if (acct.type === 'cogs') return 'COGS';
    if (acct.type === 'expense') return 'Expense';
    if (acct.type === 'asset') return 'Asset';
    if (acct.type === 'liability') return 'Liability';
    if (acct.type === 'equity') return 'Equity';
    return '';
}

function toQboJournalCsv(entries: Array<Record<string, any>>, accounts?: Array<Record<string, any>>): string {
    const accts = accounts || [];
    const lines = ['Journal No.,Journal Date,Account Name,Description,Debits,Credits,Class,Category'];
    for (const e of entries) {
        const cls = qbClass(String(e.source || ''));
        for (const l of (e.lines || []) as JLine[]) {
            const cat = qbCategory(l.accountName, accts);
            lines.push([
                csvEsc(e.journalNo), usDate(String(e.entryDate)), csvEsc(l.accountName), csvEsc(l.description || e.description),
                l.debit > 0 ? Number(l.debit).toFixed(2) : '', l.credit > 0 ? Number(l.credit).toFixed(2) : '',
                csvEsc(cls), csvEsc(cat)
            ].join(','));
        }
    }
    return lines.join('\n') + '\n';
}
function toIif(entries: Array<Record<string, any>>): string {
    const out = ['!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO', '!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO', '!ENDTRNS'];
    for (const e of entries) {
        ((e.lines || []) as JLine[]).forEach((l, i) => {
            const amount = l.debit > 0 ? Number(l.debit) : -Number(l.credit);
            const memo = String(l.description || e.description || '').replace(/\t/g, ' ');
            out.push([i === 0 ? 'TRNS' : 'SPL', 'GENERAL', usDate(String(e.entryDate)), String(l.accountName).replace(/\t/g, ' '), amount.toFixed(2), memo].join('\t'));
        });
        out.push('ENDTRNS');
    }
    return out.join('\n') + '\n';
}

async function entriesForMonth(month: string, locId: string, defId: string) {
    const entries = await locEntries(locId, defId);
    return entries
        .filter((e) => String(e.entryDate || '').startsWith(month + '-'))
        .sort((a, b) => (String(a.entryDate) < String(b.entryDate) ? -1 : String(a.entryDate) > String(b.entryDate) ? 1 : String(a.journalNo) < String(b.journalNo) ? -1 : 1));
}

const SCHEMA = {
    type: 'object',
    properties: {
        vendor_name: { type: 'string' }, invoice_no: { type: 'string' },
        invoice_date: { type: 'string', description: 'YYYY-MM-DD or empty when unreadable' },
        due_date: { type: 'string', description: 'YYYY-MM-DD or empty when unreadable' },
        subtotal: { type: ['number', 'null'] }, tax: { type: ['number', 'null'] }, total: { type: ['number', 'null'] },
        line_items: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, qty: { type: ['number', 'null'] }, unit_price: { type: ['number', 'null'] }, category: { type: 'string', description: 'meat, produce, dairy, dry goods, draught beer, packaged beverage, wine, spirits, soda, or paper' } }, required: ['description'] } },
        confidence: { type: 'number' }, warnings: { type: 'array', items: { type: 'string' } }
    },
    required: ['vendor_name', 'line_items', 'confidence']
};

export const handler = router({
    'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
    'GET /api/disclaimer': [async () => json({ disclaimer: DISCLAIMER, postDisclaimer: POST_DISCLAIMER })],
    'GET /api/locations': [async () => {
        const { locs, defId } = await getLocations();
        return json({ defaultId: defId, locations: locs.map((l) => ({ id: String(l.id), name: l.name, isDefault: String(l.id) === defId })) });
    }],
    'POST /api/locations': [async ({ body }) => {
        const b = (body || {}) as { name?: string };
        const name = (b.name || '').trim();
        if (!name) return error('name is required', 400);
        const { locs } = await getLocations();
        if (locs.some((l) => String(l.name).toLowerCase() === name.toLowerCase())) return error('a location with that name already exists', 409);
        const [id] = await db.add('locations', [{ name, isDefault: false, createdAt: Date.now() }]);
        if (!id) return error('failed to create location', 500);
        return json({ id: String(id), name });
    }],
    'POST /api/invoices/scan': [async ({ body }) => {
        const { image: img, mimeType, ack } = (body || {}) as { image?: string; mimeType?: string; ack?: boolean };
        if (ack !== true) return error('disclaimer_acknowledgement_required: ' + DISCLAIMER, 428);
        if (!img || !mimeType) return error('image and mimeType are required', 400);
        const { locId } = await resolveLoc((body as Record<string, any>)?.location_id);
        try {
            const result = await ai.extract({
                prompt: 'Extract structured data from this supplier invoice image for restaurant bookkeeping. Rules: NEVER guess an amount you cannot read - use null and add a warning instead. Dates must be YYYY-MM-DD or empty. Choose each line category from: meat, produce, dairy, dry goods, draught beer, packaged beverage, wine, spirits, soda, paper. Add a warning for anything unclear, cut off, or ambiguous.',
                images: [{ data: img, mimeType }], schema: SCHEMA, thinkingMode: 'FAST'
            });
            const d = result.data as { vendor_name?: string; invoice_no?: string; invoice_date?: string; due_date?: string; subtotal?: number | null; tax?: number | null; total?: number | null; line_items?: Array<{ description?: string; qty?: number | null; unit_price?: number | null; category?: string }>; confidence?: number; warnings?: string[] };
            const warnings: string[] = Array.isArray(d.warnings) ? d.warnings.slice() : [];
            const items = Array.isArray(d.line_items) ? d.line_items : [];
            const sum = cents(items.reduce((s, l) => s + ((typeof l.qty === 'number' && typeof l.unit_price === 'number') ? l.qty * l.unit_price : 0), 0));
            if (typeof d.subtotal === 'number' && Math.abs(sum - d.subtotal) > 0.01) warnings.push('line items sum to ' + sum.toFixed(2) + ' but subtotal reads ' + d.subtotal.toFixed(2) + ' - verify before posting');
            if (typeof d.subtotal === 'number' && typeof d.tax === 'number' && typeof d.total === 'number' && Math.abs(d.subtotal + d.tax - d.total) > 0.01) warnings.push('subtotal + tax does not reconcile to total - verify before posting');
            const breakdown: Record<string, number> = {};
            for (const l of items) if (typeof l.qty === 'number' && typeof l.unit_price === 'number') {
                const acct = routeCategory(l.category || '');
                breakdown[acct] = cents((breakdown[acct] || 0) + l.qty * l.unit_price);
            }
            const record = { vendorName: d.vendor_name || '', invoiceNo: d.invoice_no || '', invoiceDate: d.invoice_date || '', dueDate: d.due_date || '', total: typeof d.total === 'number' ? d.total : null, confidence: typeof d.confidence === 'number' ? d.confidence : 0, warningsCount: warnings.length, breakdown, lineTotal: sum, posted: false, locationId: locId, createdAt: Date.now() };
            const [id] = await db.add('invoices', [record]);
            if (id) {
                const ext = mimeType === 'image/png' ? 'png' : 'jpg';
                const [ok] = await storage.write([{ path: 'invoices/' + id + '.' + ext, content: img, contentType: mimeType }]);
                if (!ok) console.warn('invoice image archive failed for ' + id);
            }
            return json({ id, extracted: { ...d, warnings }, attempts: result.attempts });
        } catch (err) {
            const rpcError = err as { statusCode?: number; responseText?: string };
            if (rpcError && rpcError.statusCode != null && rpcError.responseText != null) return error('AI extract failed (' + rpcError.statusCode + '): ' + rpcError.responseText, 502);
            console.error('invoice scan failed', err);
            return error('AI extract failed', 500);
        }
    }],
    'GET /api/invoices': [async ({ query }) => {
        const { locId, defId } = await resolveLoc(query.location);
        const items = (await listAll('invoices')).filter((i) => inLoc(i, locId, defId));
        items.sort((a, b) => ((b.createdAt as number) || 0) - ((a.createdAt as number) || 0));
        return json({ invoices: items.slice(0, 20) });
    }],
    'POST /api/invoices/post': [async ({ body }) => {
        const { id, ack } = (body || {}) as { id?: string; ack?: boolean };
        if (ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!id) return error('id is required', 400);
        const { locId, defId } = await resolveLoc((body as Record<string, any>)?.location_id);
        const [inv] = await db.get('invoices', [id]);
        if (!inv || !inLoc(inv, locId, defId)) return error('invoice not found', 404);
        if (inv.posted) return error('invoice already posted', 409);
        const breakdown = (inv.breakdown || {}) as Record<string, number>;
        const amounts = Object.entries(breakdown).filter(([, v]) => v > 0);
        if (amounts.length === 0) return error('this scan has no priced line items to post - rescan the invoice', 422);
        const total = cents(amounts.reduce((s, [, v]) => s + v, 0));
        const journalNo = 'AP-' + (inv.invoiceNo || id);
        const posted = await postEntry({
            journalNo, entryDate: (typeof inv.invoiceDate === 'string' && DATE_RE.test(inv.invoiceDate)) ? inv.invoiceDate : new Date().toISOString().slice(0, 10),
            description: 'Vendor invoice ' + (inv.vendorName || 'unknown') + (inv.invoiceNo ? ' #' + inv.invoiceNo : ''), source: 'ap_scan',
            lines: [...amounts.map(([accountName, amount]) => ({ accountName, debit: cents(amount), credit: 0 })), { accountName: 'Accounts Payable', debit: 0, credit: total }]
        }, locId, defId);
        if (!posted.ok) return error(posted.message || 'posting failed', 422);
        await db.update('invoices', [{ id, record: { ...inv, posted: true, journalNo } }]);
        return json({ posted: true, journalNo, total });
    }],
    'POST /api/ledger/daily-sales': [async ({ body }) => {
        const b = (body || {}) as { ack?: boolean; business_date?: string; food_sales?: number; beverage_sales?: number; sales_tax?: number; cc_tips?: number; cash_collected?: number; processing_fees?: number; location_id?: string };
        if (b.ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        const date = b.business_date || '';
        if (!DATE_RE.test(date)) return error('business_date must be YYYY-MM-DD', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? cents(v) : 0);
        const food = n(b.food_sales), bev = n(b.beverage_sales), tax = n(b.sales_tax), tips = n(b.cc_tips), cash = n(b.cash_collected), fees = n(b.processing_fees);
        const collected = cents(food + bev + tax + tips);
        if (collected <= 0) return error('nothing collected - all amounts zero', 422);
        const cardGross = cents(collected - cash);
        if (cardGross < 0) return error('cash collected exceeds total collected', 422);
        if (fees > cardGross) return error('processing fees exceed card collections', 422);
        const lines: JLine[] = [
            ...(cash > 0 ? [{ accountName: 'Cash Drawer', debit: cash, credit: 0 }] : []),
            ...(cardGross > 0 ? [{ accountName: 'Other Tender Clearing', debit: cents(cardGross - fees), credit: 0 }] : []),
            ...(fees > 0 ? [{ accountName: 'POS and Software Fees', debit: fees, credit: 0 }] : []),
            ...(food > 0 ? [{ accountName: 'Food Sales', debit: 0, credit: food }] : []),
            ...(bev > 0 ? [{ accountName: 'Beverage Sales', debit: 0, credit: bev }] : []),
            ...(tax > 0 ? [{ accountName: 'Sales Tax Payable - CO', debit: 0, credit: tax }] : []),
            ...(tips > 0 ? [{ accountName: 'Tips Payable', debit: 0, credit: tips }] : [])
        ];
        const posted = await postEntry({ journalNo: 'DS-' + date, entryDate: date, description: 'Daily sales summary', source: 'daily_sales', lines }, locId, defId);
        if (!posted.ok) return error(posted.message || 'posting failed', 422);
        return json({ posted: true, journalNo: 'DS-' + date, collected });
    }],
    'GET /api/ledger/accounts': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const { locId, defId } = await resolveLoc(query.location);
        const rows = await accountBalances(from, to, locId, defId);
        const totalDebits = cents(rows.reduce((s, r) => s + r.debits, 0));
        const totalCredits = cents(rows.reduce((s, r) => s + r.credits, 0));
        return json({ accounts: rows, totals: { debits: totalDebits, credits: totalCredits }, inBalance: Math.abs(totalDebits - totalCredits) < 0.01 });
    }],
    'GET /api/reports/profit-loss': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const { locId, defId } = await resolveLoc(query.location);
        const rows = await accountBalances(from, to, locId, defId);
        return json({ from, to, ...plFrom(rows) });
    }],
    'GET /api/reports/balance-sheet': [async ({ query }) => {
        const asOf = query.as_of && DATE_RE.test(query.as_of) ? query.as_of : new Date().toISOString().slice(0, 10);
        const { locId, defId } = await resolveLoc(query.location);
        const rows = await accountBalances('0000-01-01', asOf, locId, defId);
        const sum = (rs: typeof rows) => cents(rs.reduce((s, r) => s + r.balance, 0));
        const nonzero = (rs: typeof rows) => rs.filter((r) => r.balance !== 0);
        const assets = nonzero(rows.filter((r) => r.type === 'asset'));
        const liabilities = nonzero(rows.filter((r) => r.type === 'liability'));
        const equity = nonzero(rows.filter((r) => r.type === 'equity'));
        const netIncomeToDate = cents(sum(rows.filter((r) => r.type === 'revenue')) - sum(rows.filter((r) => r.type === 'cogs')) - sum(rows.filter((r) => r.type === 'expense')));
        const totalAssets = sum(assets), totalLiabilities = sum(liabilities), totalEquity = cents(sum(equity) + netIncomeToDate);
        return json({ asOf, assets, liabilities, equity, netIncomeToDate, totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, liabilitiesAndEquity: cents(totalLiabilities + totalEquity) }, balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 });
    }],
    'POST /api/bank/import': [async ({ body }) => {
        const { csv, ack } = (body || {}) as { csv?: string; ack?: boolean };
        if (ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!csv || typeof csv !== 'string') return error('csv is required', 400);
        const { locId, defId } = await resolveLoc((body as Record<string, any>)?.location_id);
        const rows = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (rows.length === 0) return error('empty file', 422);
        if (rows[0].trim().toLowerCase() !== 'date,description,amount') return error('header must be exactly: date,description,amount', 422);
        const existing = (await listAll('bank_lines')).filter((x) => inLoc(x, locId, defId));
        const seen = new Set(existing.map((x) => x.txnDate + '|' + x.description + '|' + x.amount));
        let depositsMatched = 0, checksMatched = 0, queuedForReview = 0, duplicates = 0, badRows = 0;
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',');
            if (cols.length < 3) { badRows++; continue; }
            const txnDate = cols[0].trim();
            const amount = Number(cols[cols.length - 1].trim());
            const description = cols.slice(1, cols.length - 1).join(',').trim();
            if (!DATE_RE.test(txnDate) || !Number.isFinite(amount) || amount === 0 || !description) { badRows++; continue; }
            const amt = cents(amount);
            const key = txnDate + '|' + description + '|' + amt;
            if (seen.has(key)) { duplicates++; continue; }
            seen.add(key);
            if (amt < 0) {
                const m = /check\s*#?\s*(\d+)/i.exec(description);
                if (m) {
                    const reg = await db.list('checks', { filter: { checkNumber: m[1] } });
                    const ck = reg.items.filter((c) => inLoc(c, locId, defId)).find((c) => c.status === 'outstanding' || c.status === 'amount_mismatch');
                    if (ck) {
                        const newStatus = Math.abs(cents(Number(ck.writtenAmount)) - cents(Math.abs(amt))) < 0.005 ? 'cleared' : 'amount_mismatch';
                        await db.update('checks', [{ id: String(ck.id), record: { ...ck, status: newStatus, clearedDate: txnDate, clearedAmount: cents(Math.abs(amt)) } }]);
                        await db.add('bank_lines', [{ txnDate, description, amount: amt, status: 'check_matched', matchedCheck: String(ck.checkNumber), locationId: locId, createdAt: Date.now() }]);
                        checksMatched++;
                        continue;
                    }
                }
            }
            const [id] = await db.add('bank_lines', [{ txnDate, description, amount: amt, status: 'review', locationId: locId, createdAt: Date.now() }]);
            if (!id) { badRows++; continue; }
            const clearing = amt > 0 ? routeDeposit(description) : null;
            if (clearing) {
                const posted = await postEntry({ journalNo: 'BK-' + id, entryDate: txnDate, description: 'Bank deposit match: ' + description, source: 'bank_import', lines: [{ accountName: 'Cash - General', debit: amt, credit: 0 }, { accountName: clearing, debit: 0, credit: amt }] }, locId, defId);
                if (posted.ok) {
                    await db.update('bank_lines', [{ id, record: { txnDate, description, amount: amt, status: 'matched', matchedAccount: clearing, journalNo: 'BK-' + id, locationId: locId, createdAt: Date.now() } }]);
                    depositsMatched++;
                    continue;
                }
            }
            queuedForReview++;
        }
        return json({ depositsMatched, checksMatched, queuedForReview, duplicates, badRows });
    }],
    'GET /api/bank/queue': [async ({ query }) => {
        const { locId, defId } = await resolveLoc(query.location);
        const all = (await listAll('bank_lines')).filter((x) => inLoc(x, locId, defId));
        const queue = all.filter((x) => x.status === 'review').sort((a, b) => (String(a.txnDate) < String(b.txnDate) ? -1 : 1));
        const accounts = await ensureCoa();
        const parents = new Set(accounts.filter((a) => a.parentAccountNo).map((a) => a.parentAccountNo));
        const postable = accounts.filter((a) => a.active && !parents.has(a.accountNo)).map((a) => ({ accountNo: a.accountNo, name: a.name, type: a.type })).sort((x, y) => (x.accountNo < y.accountNo ? -1 : 1));
        return json({ queue, accounts: postable });
    }],
    'POST /api/bank/categorize': [async ({ body }) => {
        const { id, accountName, ack } = (body || {}) as { id?: string; accountName?: string; ack?: boolean };
        if (ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!id || !accountName) return error('id and accountName are required', 400);
        const { locId, defId } = await resolveLoc((body as Record<string, any>)?.location_id);
        const [line] = await db.get('bank_lines', [id]);
        if (!line || !inLoc(line, locId, defId)) return error('bank line not found', 404);
        if (line.status !== 'review') return error('line already handled', 409);
        const amt = cents(Math.abs(Number(line.amount)));
        const isDeposit = Number(line.amount) > 0;
        const jl: JLine[] = isDeposit
            ? [{ accountName: 'Cash - General', debit: amt, credit: 0 }, { accountName, debit: 0, credit: amt }]
            : [{ accountName, debit: amt, credit: 0 }, { accountName: 'Cash - General', debit: 0, credit: amt }];
        const posted = await postEntry({ journalNo: 'BK-' + id, entryDate: String(line.txnDate), description: (isDeposit ? 'Bank deposit: ' : 'Bank expense: ') + line.description, source: 'bank_import', lines: jl }, locId, defId);
        if (!posted.ok) return error(posted.message || 'posting failed', 422);
        await db.update('bank_lines', [{ id, record: { ...line, status: 'posted', matchedAccount: accountName, journalNo: 'BK-' + id } }]);
        return json({ posted: true, journalNo: 'BK-' + id });
    }],
    'POST /api/bank/ignore': [async ({ body }) => {
        const { id } = (body || {}) as { id?: string };
        if (!id) return error('id is required', 400);
        const { locId, defId } = await resolveLoc((body as Record<string, any>)?.location_id);
        const [line] = await db.get('bank_lines', [id]);
        if (!line || !inLoc(line, locId, defId)) return error('bank line not found', 404);
        if (line.status !== 'review') return error('line already handled', 409);
        await db.update('bank_lines', [{ id, record: { ...line, status: 'ignored' } }]);
        return json({ ignored: true });
    }],
    'GET /api/ledger/journal': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const { locId, defId } = await resolveLoc(query.location);
        const entries = await locEntries(locId, defId);
        const inRange = entries
            .filter((e) => String(e.entryDate) >= from && String(e.entryDate) <= to)
            .sort((a, b) => (String(a.entryDate) < String(b.entryDate) ? -1 : String(a.entryDate) > String(b.entryDate) ? 1 : String(a.journalNo) < String(b.journalNo) ? -1 : 1));
        return json({ from, to, count: inRange.length, entries: inRange.map((e) => ({ journalNo: e.journalNo, entryDate: e.entryDate, description: e.description, source: e.source, lines: e.lines })) });
    }],
    'GET /api/ap/aging': [async ({ query }) => {
        const asOf = query.as_of && DATE_RE.test(query.as_of) ? query.as_of : new Date().toISOString().slice(0, 10);
        const { locId, defId } = await resolveLoc(query.location);
        const invs = (await listAll('invoices')).filter((i) => inLoc(i, locId, defId));
        const unpaid = invs.filter((i) => i.posted && !i.paid);
        const BINS = [{ label: '0-15 days', min: 0, max: 15 }, { label: '16-30 days', min: 16, max: 30 }, { label: '31+ days', min: 31, max: Infinity }];
        const bins = BINS.map((b) => ({ label: b.label, invoices: [] as Array<Record<string, any>>, total: 0 }));
        let total = 0;
        for (const i of unpaid) {
            const invDate = typeof i.invoiceDate === 'string' && DATE_RE.test(i.invoiceDate) ? i.invoiceDate : asOf;
            const daysOld = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(invDate)) / 86400000));
            const amount = cents(typeof i.total === 'number' ? i.total : Number(i.lineTotal) || 0);
            const inv = { id: i.id, invoiceNo: i.invoiceNo || '', vendor: i.vendorName || 'Unknown vendor', invoiceDate: invDate, dueDate: i.dueDate || '', amount, daysOld, pastDue: typeof i.dueDate === 'string' && DATE_RE.test(String(i.dueDate)) && String(i.dueDate) < asOf };
            const idx = BINS.findIndex((b) => daysOld >= b.min && daysOld <= b.max);
            const bin = bins[idx < 0 ? 0 : idx];
            bin.invoices.push(inv); bin.total = cents(bin.total + amount); total = cents(total + amount);
        }
        return json({ asOf, bins, total });
    }],
    'POST /api/ap/pay': [async ({ body }) => {
        const b = (body || {}) as { id?: string; payment_date?: string; check_number?: string; ack?: boolean; location_id?: string };
        if (b.ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!b.id) return error('id is required', 400);
        if (!b.payment_date || !DATE_RE.test(b.payment_date)) return error('payment_date must be YYYY-MM-DD', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        const [inv] = await db.get('invoices', [b.id]);
        if (!inv || !inLoc(inv, locId, defId)) return error('invoice not found', 404);
        if (!inv.posted) return error('invoice not posted to the books yet', 409);
        if (inv.paid) return error('invoice already paid', 409);
        const amount = cents(typeof inv.total === 'number' ? inv.total : Number(inv.lineTotal) || 0);
        if (amount <= 0) return error('invoice has no amount to pay', 422);
        const checkNumber = (b.check_number || '').trim();
        if (checkNumber) {
            const dup = await db.list('checks', { filter: { checkNumber } });
            if (dup.items.some((c) => inLoc(c, locId, defId))) return error('check number already registered', 409);
        }
        const method = checkNumber ? 'Check #' + checkNumber : 'EFT/ACH';
        const posted = await postEntry({ journalNo: 'AP-PAY-' + (inv.invoiceNo || b.id), entryDate: b.payment_date, description: 'Payment to ' + (inv.vendorName || 'vendor') + (inv.invoiceNo ? ' for invoice #' + inv.invoiceNo : '') + ' (' + method + ')', source: 'ap_payment', lines: [{ accountName: 'Accounts Payable', debit: amount, credit: 0 }, { accountName: 'Cash - General', debit: 0, credit: amount }] }, locId, defId);
        if (!posted.ok) return error(posted.message || 'posting failed', 422);
        await db.update('invoices', [{ id: b.id, record: { ...inv, paid: true, paidDate: b.payment_date, paymentCheckNo: checkNumber || null } }]);
        if (checkNumber) await db.add('checks', [{ checkNumber, checkDate: b.payment_date, payee: inv.vendorName || 'vendor', writtenAmount: amount, memo: inv.invoiceNo ? 'AP invoice ' + inv.invoiceNo : 'AP payment', status: 'outstanding', locationId: locId, createdAt: Date.now() }]);
        return json({ paid: true, invoiceNo: inv.invoiceNo || '', vendor: inv.vendorName || '', amount, paymentDate: b.payment_date, method });
    }],
    'GET /api/checks/register': [async ({ query }) => {
        const STATUSES = ['outstanding', 'cleared', 'amount_mismatch', 'void'];
        const status = query.status;
        if (status !== undefined && !STATUSES.includes(status)) return error('status must be one of ' + STATUSES.join('|'), 400);
        const { locId, defId } = await resolveLoc(query.location);
        const all = (await listAll('checks')).filter((c) => inLoc(c, locId, defId));
        const checks = all.filter((c) => !status || c.status === status).map((c) => ({ id: c.id, checkNumber: c.checkNumber, checkDate: c.checkDate, payee: c.payee, writtenAmount: Number(c.writtenAmount), memo: c.memo || '', status: c.status, clearedDate: c.clearedDate || null, clearedAmount: c.clearedAmount == null ? null : Number(c.clearedAmount) })).sort((a, b) => (String(a.checkDate) < String(b.checkDate) ? -1 : 1));
        return json({ checks });
    }],
    'POST /api/checks/register': [async ({ body }) => {
        const b = (body || {}) as { check_number?: string; status?: string; location_id?: string };
        if (!b.check_number || !['void', 'outstanding'].includes(b.status || '')) return error('check_number required; status must be void or outstanding', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        const found = await db.list('checks', { filter: { checkNumber: b.check_number } });
        const c = found.items.find((x) => inLoc(x, locId, defId));
        if (!c) return error('check_not_found', 404);
        await db.update('checks', [{ id: String(c.id), record: { ...c, status: b.status } }]);
        return json({ checkNumber: b.check_number, status: b.status });
    }],
    'POST /api/delivery/import': [async ({ body }) => {
        const b = (body || {}) as { csv?: string; ack?: boolean; location_id?: string };
        if (b.ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!b.csv || typeof b.csv !== 'string') return error('csv is required', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        const parsed = parseDeliveryCsv(b.csv);
        if (!parsed.ok) return error('strict_validation_failed: ' + parsed.errors.map((e) => 'line ' + e.line + ': ' + e.message).join('; '), 422);
        const existing = (await listAll('delivery_statements')).filter((s) => inLoc(s, locId, defId));
        const have = new Set(existing.map((s) => s.platform + '/' + s.periodStart + '/' + s.periodEnd));
        for (const s of parsed.statements) {
            if (have.has(s.platform + '/' + s.periodStart + '/' + s.periodEnd)) {
                return error('statement already imported for ' + s.platform + ' ' + s.periodStart + ' to ' + s.periodEnd, 409);
            }
        }
        let entriesPosted = 0;
        for (const s of parsed.statements) {
            const posted = await postEntry(buildDeliveryEntry(s), locId, defId);
            if (!posted.ok) return error(posted.message || 'posting failed for ' + s.platform + ' ' + s.periodEnd, 422);
            entriesPosted++;
            await db.add('delivery_statements', [{
                platform: s.platform, periodStart: s.periodStart, periodEnd: s.periodEnd,
                grossSales: cents(s.grossSales), commissions: cents(s.commissions), marketingFees: cents(s.marketingFees),
                refunds: cents(s.refunds), driverTips: cents(s.driverTips), netPayout: cents(s.netPayout),
                locationId: locId, createdAt: Date.now()
            }]);
        }
        return json({ imported: parsed.statements.length, entriesPosted });
    }],
    'GET /api/delivery/statements': [async ({ query }) => {
        const { locId, defId } = await resolveLoc(query.location);
        const rows = (await listAll('delivery_statements')).filter((s) => inLoc(s, locId, defId));
        rows.sort((a, b) => (String(a.periodEnd) < String(b.periodEnd) ? 1 : -1));
        return json({
            statements: rows.map((r) => ({
                platform: r.platform, periodStart: r.periodStart, periodEnd: r.periodEnd,
                grossSales: Number(r.grossSales), commissions: Number(r.commissions), marketingFees: Number(r.marketingFees),
                refunds: Number(r.refunds), driverTips: Number(r.driverTips), netPayout: Number(r.netPayout),
                effectiveRatePct: Number(r.grossSales) > 0 ? cents(((Number(r.commissions) + Number(r.marketingFees)) / Number(r.grossSales)) * 100) : null
            }))
        });
    }],
    'POST /api/payroll/import': [async ({ body }) => {
        const b = (body || {}) as { csv?: string; ack?: boolean; location_id?: string };
        if (b.ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!b.csv || typeof b.csv !== 'string') return error('csv is required', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        const parsed = parsePayrollCsv(b.csv);
        if (!parsed.ok) return error('strict_validation_failed: ' + parsed.errors.map((e) => 'line ' + e.line + ': ' + e.message).join('; '), 422);
        const entries = parsed.runs.flatMap(buildPayrollEntries);
        let entriesPosted = 0, entriesSkipped = 0;
        for (const e of entries) {
            const posted = await postEntry(e, locId, defId);
            if (posted.ok) entriesPosted++;
            else if ((posted.message || '').includes('already posted')) entriesSkipped++;
            else return error(posted.message || 'posting failed for ' + e.journalNo, 422);
        }
        return json({ runs: parsed.runs.length, entriesPosted, entriesSkipped });
    }],
    'GET /api/compliance/events': [async ({ query }) => {
        const { locId, defId } = await resolveLoc(query.location);
        const includeFiled = query.include_filed === 'true';
        const today = new Date();
        const todayIso = today.toISOString().slice(0, 10);
        const entries = await locEntries(locId, defId);
        const liabBalance = (name: string, asOf: string) => cents(entries
            .filter((e) => String(e.entryDate) <= asOf)
            .reduce((s, e) => s + ((e.lines || []) as JLine[])
                .filter((l) => l.accountName === name)
                .reduce((ss, l) => ss + (Number(l.credit) || 0) - (Number(l.debit) || 0), 0), 0));
        const overrides = (await listAll('compliance_events')).filter((o) => inLoc(o, locId, defId));
        const filedSet = new Set(overrides.filter((o) => o.status === 'FILED').map((o) => o.taxType + '|' + o.periodEnd));
        const events: Array<Record<string, any>> = [];
        for (const s of COMPLIANCE_SCHEDULES) {
            for (const periodEnd of periodEnds(s.cadence, today)) {
                const due = dueDateFor(s.due, periodEnd);
                const amount = liabBalance(s.liabilityAccount, periodEnd);
                const daysRemaining = Math.floor((Date.parse(due) - Date.parse(todayIso)) / 86400000);
                let status = 'UPCOMING';
                if (filedSet.has(s.taxType + '|' + periodEnd)) status = 'FILED';
                else if (daysRemaining < 0) status = amount === 0 ? 'FILED' : 'OVERDUE';
                else if (daysRemaining <= ALERT_THRESHOLD_DAYS) status = 'DUE_SOON';
                events.push({ taxType: s.taxType, form: s.form, periodEnd, dueDate: due, estimatedAmount: amount, status, daysRemaining, liabilityAccount: s.liabilityAccount });
            }
        }
        events.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.taxType < b.taxType ? -1 : 1));
        const visible = events.filter((ev) => (includeFiled || ev.status !== 'FILED') && (ev.status === 'OVERDUE' || ev.daysRemaining <= 120));
        return json({ asOf: todayIso, overdue: visible.filter((e) => e.status === 'OVERDUE'), events: visible });
    }],
    'POST /api/compliance/update': [async ({ body }) => {
        const b = (body || {}) as { tax_type?: string; period_end?: string; status?: string; location_id?: string };
        const status = b.status || 'FILED';
        if (!b.tax_type || !COMPLIANCE_SCHEDULES.some((s) => s.taxType === b.tax_type)) return error('tax_type must be one of ' + COMPLIANCE_SCHEDULES.map((s) => s.taxType).join('|'), 400);
        if (!b.period_end || !DATE_RE.test(b.period_end)) return error('period_end must be YYYY-MM-DD', 400);
        if (!['FILED', 'UPCOMING'].includes(status)) return error('status must be FILED or UPCOMING', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        const overrides = (await listAll('compliance_events')).filter((o) => inLoc(o, locId, defId) && o.taxType === b.tax_type && o.periodEnd === b.period_end);
        if (status === 'FILED') {
            if (overrides.length === 0) await db.add('compliance_events', [{ taxType: b.tax_type, periodEnd: b.period_end, status: 'FILED', locationId: locId, createdAt: Date.now() }]);
            else await db.update('compliance_events', [{ id: String(overrides[0].id), record: { ...overrides[0], status: 'FILED' } }]);
        } else {
            for (const o of overrides) await db.update('compliance_events', [{ id: String(o.id), record: { ...o, status: 'UPCOMING' } }]);
        }
        return json({ taxType: b.tax_type, periodEnd: b.period_end, status });
    }],
    'POST /api/pos/daily-summary': [async ({ body }) => {
        const b = (body || {}) as { csv?: string; ack?: boolean; location_id?: string };
        if (b.ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!b.csv || typeof b.csv !== 'string') return error('csv is required', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        // Resolve active vertical profile for account routing
        const locs = await listAll('locations');
        const loc = locs.find((l) => String(l.id) === locId);
        const profileId = (loc && loc.verticalProfile) || 'restaurant';
        const parsed = parsePosSummaryCsv(b.csv);
        if (!parsed.ok) return error('strict_validation_failed: ' + parsed.errors.map((e) => 'line ' + e.line + ': ' + e.message).join('; '), 422);
        let entriesPosted = 0, entriesSkipped = 0;
        for (const row of parsed.rows) {
            const entry = buildPosSummaryEntry(row, profileId);
            const posted = await postEntry(entry, locId, defId);
            if (posted.ok) entriesPosted++;
            else if ((posted.message || '').includes('already posted')) entriesSkipped++;
            else return error(posted.message || 'posting failed for ' + entry.journalNo, 422);
        }
        return json({ days: parsed.rows.length, entriesPosted, entriesSkipped });
    }],
    'GET /api/pos/summaries': [async ({ query }) => {
        const { locId, defId } = await resolveLoc(query.location);
        const entries = await locEntries(locId, defId);
        const summaries = entries.filter((e) => e.source === 'pos_summary').sort((a, b) => (String(a.entryDate) > String(b.entryDate) ? -1 : 1));
        return json({ summaries: summaries.slice(0, 60).map((e) => ({ journalNo: e.journalNo, date: e.entryDate, description: e.description })) });
    }],
    'GET /api/inventory/categories': [async ({ query }) => {
        const { locId } = await resolveLoc(query.location);
        const locs = await listAll('locations');
        const loc = locs.find((l) => String(l.id) === locId);
        const profileId = (loc && loc.verticalProfile) || 'restaurant';
        const cats = INVENTORY_CATEGORIES_BY_VERTICAL[profileId] || INVENTORY_CATEGORIES_BY_VERTICAL.restaurant;
        return json({ profileId, categories: cats });
    }],
    'POST /api/inventory/count': [async ({ body }) => {
        const b = (body || {}) as Record<string, any>;
        if (b.ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!b.count_date || !DATE_RE.test(b.count_date)) return error('count_date must be YYYY-MM-DD', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        // Resolve active vertical profile for category routing
        const locs = await listAll('locations');
        const loc = locs.find((l) => String(l.id) === locId);
        const profileId = (loc && loc.verticalProfile) || 'restaurant';
        const categories = INVENTORY_CATEGORIES_BY_VERTICAL[profileId] || INVENTORY_CATEGORIES_BY_VERTICAL.restaurant;
        const existing = (await listAll('inventory_counts')).filter((c) => inLoc(c, locId, defId) && c.countDate === b.count_date);
        if (existing.length > 0) return error('count already recorded for this date', 409);
        const items: Array<{ inventoryAccount: string; adjustmentAccount: string; ledgerBalance: number; physicalCount: number }> = [];
        const variances: Record<string, number> = {};
        const asOf = b.count_date;
        const balances = await accountBalances('0000-01-01', asOf, locId, defId);
        for (const cat of categories) {
            const raw = (b as Record<string, any>)[cat.key + '_count'];
            if (raw === undefined || raw === null) continue;
            const physical = cents(Number(raw));
            if (!Number.isFinite(physical) || physical < 0) return error(cat.key + '_count must be a nonnegative number', 400);
            const acctRow = balances.find((r) => r.name === cat.inventoryAccount);
            const ledgerBalance = acctRow ? acctRow.balance : 0;
            items.push({ ...cat, ledgerBalance, physicalCount: physical });
            variances[cat.key] = cents(ledgerBalance - physical);
        }
        if (items.length === 0) return error('at least one count (food_count, beverage_count, or paper_count) is required', 400);
        const entry = buildInventoryEntry(b.count_date, items);
        if (entry) {
            const posted = await postEntry(entry, locId, defId);
            if (!posted.ok) return error(posted.message || 'posting failed', 422);
        }
        await db.add('inventory_counts', [{ countDate: b.count_date, variances, adjusted: entry !== null, locationId: locId, createdAt: Date.now() }]);
        return json({ countDate: b.count_date, adjusted: entry !== null, variances });
    }],
    'GET /api/inventory/counts': [async ({ query }) => {
        const { locId, defId } = await resolveLoc(query.location);
        const counts = (await listAll('inventory_counts')).filter((c) => inLoc(c, locId, defId));
        counts.sort((a, b) => (String(a.countDate) > String(b.countDate) ? -1 : 1));
        return json({ counts: counts.slice(0, 30).map((c) => ({ countDate: c.countDate, variances: c.variances || {}, adjusted: c.adjusted })) });
    }],
    'GET /api/export/qbo-journal': [async ({ query }) => {
        if (query.ack !== 'true') return error('disclaimer_acknowledgement_required: You are exporting business records assembled by an autonomous pipeline. Verify totals before accounting use.', 428);
        const month = query.month;
        if (typeof month !== 'string' || !MONTH_RE.test(month)) return error('QuickBooks exports are one month at a time. Pass ?month=YYYY-MM.', 400);
        const { locId, defId } = await resolveLoc(query.location);
        const entries = await entriesForMonth(month, locId, defId);
        if (entries.length === 0) return error('no ledger entries for ' + month, 404);
        const lineCount = entries.reduce((n, e) => n + ((e.lines || []) as JLine[]).length, 0);
        if (lineCount > 1000) return error('QBO journal imports cap at 1,000 lines (this month has ' + lineCount + '); split the month or export IIF.', 422);
        const accounts = await ensureCoa();
        return json({ filename: 'qbo-journal-' + month + '.csv', mimeType: 'text/csv', lines: lineCount, content: toQboJournalCsv(entries, accounts) });
    }],
    'GET /api/export/iif': [async ({ query }) => {
        if (query.ack !== 'true') return error('disclaimer_acknowledgement_required: You are exporting business records assembled by an autonomous pipeline. Verify totals before accounting use.', 428);
        const month = query.month;
        if (typeof month !== 'string' || !MONTH_RE.test(month)) return error('QuickBooks exports are one month at a time. Pass ?month=YYYY-MM.', 400);
        const { locId, defId } = await resolveLoc(query.location);
        const entries = await entriesForMonth(month, locId, defId);
        if (entries.length === 0) return error('no ledger entries for ' + month, 404);
        return json({ filename: 'journal-' + month + '.iif', mimeType: 'text/plain', content: toIif(entries) });
    }],
    'GET /api/daybook': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const { locId, defId } = await resolveLoc(query.location);
        const rows = await accountBalances('0000-01-01', to, locId, defId);
        const period = await accountBalances(from, to, locId, defId);
        const pl = plFrom(period);
        const cash = cents(rows.filter((r) => r.name === 'Cash - General' || r.name === 'Cash Drawer').reduce((s, r) => s + r.balance, 0));
        const ap = rows.find((r) => r.name === 'Accounts Payable');
        const invs = (await listAll('invoices')).filter((i) => inLoc(i, locId, defId));
        // Compute vertical-specific KPIs
        const locs = await listAll('locations');
        const loc = locs.find((l) => String(l.id) === locId);
        const profileId = (loc && loc.verticalProfile) || 'restaurant';
        const profile = VERTICALS[profileId] || VERTICALS.restaurant;
        const verticalKpis = computeVerticalKpis(period, profile);
        return json({ from, to, cash, apBalance: ap ? ap.balance : 0, totals: pl.totals, kpis: pl.kpis, verticalKpis, profileId, profileLabel: profile.label, scans: invs.length, unposted: invs.filter((i) => !i.posted).length });
    }],

    // ── Multi-vertical profile management ──
    'GET /api/verticals': [async () => {
        return json({ verticals: Object.values(VERTICALS).map((v) => ({ id: v.id, label: v.label, description: v.description, accountCount: v.coa.length, kpis: v.kpiDefs.map((k) => k.label) })) });
    }],
    'GET /api/verticals/active': [async ({ query }) => {
        const { locId, defId } = await resolveLoc(query.location);
        const locs = await listAll('locations');
        const loc = locs.find((l) => String(l.id) === locId);
        const profileId = (loc && loc.verticalProfile) || 'restaurant';
        const profile = VERTICALS[profileId] || VERTICALS.restaurant;
        return json({ profileId: profile.id, label: profile.label, description: profile.description, kpiDefs: profile.kpiDefs });
    }],
    'POST /api/verticals/set': [async ({ body }) => {
        const b = (body || {}) as { profile_id?: string; location_id?: string };
        if (!b.profile_id || !VERTICALS[b.profile_id]) return error('profile_id must be one of: ' + Object.keys(VERTICALS).join(', '), 400);
        const { locId } = await resolveLoc(b.location_id);
        const locs = await listAll('locations');
        const loc = locs.find((l) => String(l.id) === locId);
        if (!loc) return error('location not found', 404);
        await db.update('locations', [{ id: locId, record: { ...loc, verticalProfile: b.profile_id } }]);
        // Re-seed COA if switching profiles and accounts table is empty or needs new accounts
        const profile = VERTICALS[b.profile_id];
        const existing = await listAll('accounts');
        const existingNames = new Set(existing.map((a) => String(a.name).toLowerCase()));
        const newAccounts = profile.coa.filter(([, name]) => !existingNames.has(name.toLowerCase())).map(([accountNo, name, type, qbType, parent]) => ({ accountNo, name, type, qbType, parentAccountNo: parent || null, active: true }));
        if (newAccounts.length > 0) await db.add('accounts', newAccounts);
        return json({ profileId: b.profile_id, label: profile.label, newAccountsAdded: newAccounts.length });
    }],

    // ── Reconciliation dashboard ──
    'GET /api/reconciliation': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const { locId, defId } = await resolveLoc(query.location);
        // Bank totals (from imported bank lines)
        const bankLines = (await listAll('bank_lines')).filter((x) => inLoc(x, locId, defId) && String(x.txnDate) >= from && String(x.txnDate) <= to);
        const bankDeposits = cents(bankLines.filter((x) => Number(x.amount) > 0).reduce((s, x) => s + Number(x.amount), 0));
        const bankWithdrawals = cents(bankLines.filter((x) => Number(x.amount) < 0).reduce((s, x) => s + Math.abs(Number(x.amount)), 0));
        const bankNet = cents(bankDeposits - bankWithdrawals);
        // Books totals (ledger cash accounts)
        const balances = await accountBalances(from, to, locId, defId);
        const booksCash = cents(balances.filter((r) => r.name === 'Cash - General' || r.name === 'Cash Drawer').reduce((s, r) => s + r.balance, 0));
        const booksClearing = cents(balances.filter((r) => r.name.includes('Clearing')).reduce((s, r) => s + r.balance, 0));
        // POS totals (from pos_summary entries)
        const entries = await locEntries(locId, defId);
        const posEntries = entries.filter((e) => (e.source === 'pos_summary' || e.source === 'daily_sales') && String(e.entryDate) >= from && String(e.entryDate) <= to);
        const posRevenue = cents(posEntries.reduce((s, e) => {
            const lines = (e.lines || []) as JLine[];
            return s + lines.filter((l) => l.credit > 0 && (l.accountName.includes('Sales') || l.accountName.includes('Revenue'))).reduce((ls, l) => ls + l.credit, 0);
        }, 0));
        const posCash = cents(posEntries.reduce((s, e) => {
            const lines = (e.lines || []) as JLine[];
            return s + lines.filter((l) => l.debit > 0 && (l.accountName === 'Cash Drawer')).reduce((ls, l) => ls + l.debit, 0);
        }, 0));
        const posCards = cents(posEntries.reduce((s, e) => {
            const lines = (e.lines || []) as JLine[];
            return s + lines.filter((l) => l.debit > 0 && l.accountName.includes('Clearing')).reduce((ls, l) => ls + l.debit, 0);
        }, 0));
        // Outstanding checks
        const checks = (await listAll('checks')).filter((c) => inLoc(c, locId, defId) && c.status === 'outstanding');
        const outstandingChecks = cents(checks.reduce((s, c) => s + Number(c.writtenAmount || 0), 0));
        // Mismatches
        const cashMismatch = cents(posCash - bankLines.filter((x) => Number(x.amount) > 0 && /cash|safe|night/i.test(x.description || '')).reduce((s, x) => s + Number(x.amount), 0));
        const cardMismatch = cents(posCards - bankLines.filter((x) => Number(x.amount) > 0 && /card|merchant|settlement|visa|mc|amex|discover|toast|clover|square/i.test(x.description || '')).reduce((s, x) => s + Number(x.amount), 0));
        return json({
            period: { from, to },
            bank: { deposits: bankDeposits, withdrawals: bankWithdrawals, net: bankNet, lineCount: bankLines.length },
            books: { cashBalance: booksCash, clearingBalance: booksClearing },
            pos: { revenue: posRevenue, cashCollected: posCash, cardCollected: posCards, dayCount: posEntries.length },
            outstanding: { checks: outstandingChecks, checkCount: checks.length },
            mismatches: { cash: cashMismatch, card: cardMismatch, total: cents(Math.abs(cashMismatch) + Math.abs(cardMismatch)) },
            status: Math.abs(cashMismatch) + Math.abs(cardMismatch) < 0.01 ? 'RECONCILED' : 'DISCREPANCIES_FOUND'
        });
    }],

    // ── AI Guide conversational assistant ──
    'POST /api/guide/ask': [async ({ body }) => {
        const b = (body || {}) as { question?: string; location_id?: string; conversation_history?: Array<{ role: string; text: string }> };
        if (!b.question || typeof b.question !== 'string' || b.question.trim().length === 0) return error('question is required', 400);
        const { locId, defId } = await resolveLoc(b.location_id);
        // Gather live context for the AI
        const today = new Date().toISOString().slice(0, 10);
        const monthStart = today.slice(0, 8) + '01';
        const balances = await accountBalances(monthStart, today, locId, defId);
        const pl = plFrom(balances);
        const allBal = await accountBalances('0000-01-01', today, locId, defId);
        const cash = cents(allBal.filter((r) => r.name === 'Cash - General' || r.name === 'Cash Drawer').reduce((s, r) => s + r.balance, 0));
        const ap = allBal.find((r) => r.name === 'Accounts Payable');
        const bankQueue = (await listAll('bank_lines')).filter((x) => inLoc(x, locId, defId) && x.status === 'review').length;
        const invCounts = (await listAll('inventory_counts')).filter((c) => inLoc(c, locId, defId));
        const lastCount = invCounts.sort((a, b) => (String(a.countDate) > String(b.countDate) ? -1 : 1))[0];
        const locs = await listAll('locations');
        const loc = locs.find((l) => String(l.id) === locId);
        const profileId = (loc && loc.verticalProfile) || 'restaurant';
        const profile = VERTICALS[profileId] || VERTICALS.restaurant;
        const verticalKpis = computeVerticalKpis(balances, profile);
        const context = [
            'Business type: ' + profile.label,
            'Today: ' + today,
            'MTD Revenue: $' + (pl.totals.revenue || 0).toFixed(2),
            'MTD COGS: $' + (pl.totals.cogs || 0).toFixed(2),
            'MTD Gross Profit: $' + (pl.totals.grossProfit || 0).toFixed(2),
            'MTD Net Income: $' + (pl.totals.netIncome || 0).toFixed(2),
            'Cash on hand: $' + cash.toFixed(2),
            'Accounts Payable: $' + (ap ? ap.balance : 0).toFixed(2),
            'Bank lines awaiting review: ' + bankQueue,
            'Industry KPIs: ' + verticalKpis.map((k) => k.label + ': ' + (k.value != null ? k.value.toFixed(1) + '%' : 'N/A') + (k.warning ? ' [WARNING]' : '')).join(', '),
            lastCount ? 'Last inventory count: ' + lastCount.countDate + ' variances: ' + JSON.stringify(lastCount.variances) : 'No inventory counts recorded yet'
        ].join('\n');
        // Build multi-turn message history
        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: 'You are the 1st Bookkeeper-In-A-Box financial assistant for a ' + profile.label + ' business. You have access to the user\'s live ledger data below. Answer questions about their financial health, explain variances, suggest actions, and guide them through bookkeeping workflows. Be concise, specific, and reference actual numbers. Never guess amounts you do not have. If you cannot answer from the data provided, say so.\n\nAfter your answer, ALWAYS provide exactly 3 suggested follow-up questions the user might want to ask next, formatted as a JSON array on a new line starting with "SUGGESTIONS:" — e.g. SUGGESTIONS:["What is my food cost trend?","How much do I owe vendors?","Should I count inventory?"]\n\nLIVE LEDGER CONTEXT:\n' + context }
        ];
        // Include conversation history for multi-turn context (last 8 exchanges max)
        const history = Array.isArray(b.conversation_history) ? b.conversation_history.slice(-16) : [];
        for (const msg of history) {
            messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.text });
        }
        messages.push({ role: 'user', content: b.question.trim() });
        try {
            const result = await ai.chat({ messages });
            const raw = result.message || result.content || 'I could not generate a response. Please try rephrasing your question.';
            // Parse suggestions from the response
            let answer = raw;
            let suggestions: string[] = [];
            const sugMatch = raw.match(/SUGGESTIONS:\s*(\[.*?\])/s);
            if (sugMatch) {
                answer = raw.replace(/SUGGESTIONS:\s*\[.*?\]/s, '').trim();
                try { suggestions = JSON.parse(sugMatch[1]); } catch { suggestions = []; }
            }
            return json({ answer, suggestions });
        } catch (err) {
            console.error('AI guide chat failed', err);
            return json({ answer: 'I\'m having trouble connecting to the AI service right now. Here\'s what I can tell you from the numbers: MTD revenue is $' + (pl.totals.revenue || 0).toFixed(2) + ', net income is $' + (pl.totals.netIncome || 0).toFixed(2) + ', and you have $' + cash.toFixed(2) + ' cash on hand.', suggestions: ['What are my KPIs?', 'How much cash do I have?', 'Do I have any overdue bills?'] });
        }
    }],

    // ── Enhanced bank CSV import (multi-format support) ──
    'POST /api/bank/import-auto': [async ({ body }) => {
        const { csv, ack } = (body || {}) as { csv?: string; ack?: boolean; location_id?: string };
        if (ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!csv || typeof csv !== 'string') return error('csv is required', 400);
        const { locId, defId } = await resolveLoc((body as Record<string, any>)?.location_id);
        const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) return error('empty file', 422);
        // Auto-detect format from header
        const header = lines[0].trim().toLowerCase();
        let parsedRows: Array<{ txnDate: string; description: string; amount: number; fee?: number }> = [];
        if (header === 'date,description,amount') {
            // Simple 3-column format (existing)
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length < 3) continue;
                const txnDate = cols[0].trim();
                const amount = Number(cols[cols.length - 1].trim());
                const description = cols.slice(1, cols.length - 1).join(',').trim();
                if (DATE_RE.test(txnDate) && Number.isFinite(amount) && amount !== 0 && description) {
                    parsedRows.push({ txnDate, description, amount: cents(amount) });
                }
            }
        } else if (header.includes('date') && header.includes('description') && header.includes('amount') && header.includes('fee')) {
            // Extended format: date,description,amount,fee_amount[,bank_account_id]
            const hCols = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
            const dateIdx = hCols.indexOf('date') >= 0 ? hCols.indexOf('date') : hCols.findIndex((c) => c.includes('date'));
            const descIdx = hCols.indexOf('description') >= 0 ? hCols.indexOf('description') : hCols.findIndex((c) => c.includes('desc'));
            const amtIdx = hCols.indexOf('amount') >= 0 ? hCols.indexOf('amount') : hCols.findIndex((c) => c.includes('amount'));
            const feeIdx = hCols.findIndex((c) => c.includes('fee'));
            if (dateIdx < 0 || descIdx < 0 || amtIdx < 0) return error('could not locate date/description/amount columns in header', 422);
            for (let i = 1; i < lines.length; i++) {
                const cols = splitCsvLine(lines[i]).map((c) => c.trim());
                const txnDate = cols[dateIdx] || '';
                const description = cols[descIdx] || '';
                const amount = Number(cols[amtIdx] || '0');
                const fee = feeIdx >= 0 ? Number(cols[feeIdx] || '0') : 0;
                if (DATE_RE.test(txnDate) && Number.isFinite(amount) && amount !== 0 && description) {
                    parsedRows.push({ txnDate, description, amount: cents(amount), fee: cents(fee) });
                }
            }
        } else if (header.includes('date') && (header.includes('debit') || header.includes('credit'))) {
            // Wells Fargo / Chase style: Date, Description, Debit, Credit (or Amount)
            const hCols = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
            const dateIdx = hCols.findIndex((c) => c.includes('date'));
            const descIdx = hCols.findIndex((c) => c.includes('desc') || c.includes('memo') || c.includes('narrative'));
            const debitIdx = hCols.findIndex((c) => c === 'debit' || c === 'debits' || c === 'withdrawal');
            const creditIdx = hCols.findIndex((c) => c === 'credit' || c === 'credits' || c === 'deposit');
            if (dateIdx < 0 || descIdx < 0) return error('could not locate date/description columns in header', 422);
            for (let i = 1; i < lines.length; i++) {
                const cols = splitCsvLine(lines[i]).map((c) => c.trim());
                const txnDate = cols[dateIdx] || '';
                const description = cols[descIdx] || '';
                let amount = 0;
                if (debitIdx >= 0 && cols[debitIdx]) amount = -Math.abs(Number(cols[debitIdx]));
                else if (creditIdx >= 0 && cols[creditIdx]) amount = Math.abs(Number(cols[creditIdx]));
                // Normalize MM/DD/YYYY to YYYY-MM-DD
                let normalizedDate = txnDate;
                const mdyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(txnDate);
                if (mdyMatch) normalizedDate = mdyMatch[3] + '-' + mdyMatch[1].padStart(2, '0') + '-' + mdyMatch[2].padStart(2, '0');
                if (DATE_RE.test(normalizedDate) && Number.isFinite(amount) && amount !== 0 && description) {
                    parsedRows.push({ txnDate: normalizedDate, description, amount: cents(amount) });
                }
            }
        } else {
            return error('unrecognized bank CSV format. Supported: (1) date,description,amount (2) date,description,amount,fee_amount (3) Date,Description,Debit,Credit (Wells Fargo/Chase style)', 422);
        }
        if (parsedRows.length === 0) return error('no valid rows found after parsing', 422);
        // Process rows using existing bank import logic
        const existing = (await listAll('bank_lines')).filter((x) => inLoc(x, locId, defId));
        const seen = new Set(existing.map((x) => x.txnDate + '|' + x.description + '|' + x.amount));
        let depositsMatched = 0, checksMatched = 0, queuedForReview = 0, duplicates = 0, feesPosted = 0;
        for (const row of parsedRows) {
            const key = row.txnDate + '|' + row.description + '|' + row.amount;
            if (seen.has(key)) { duplicates++; continue; }
            seen.add(key);
            // Handle fees as separate expense entries
            if (row.fee && row.fee > 0) {
                const feeEntry: JEntry = { journalNo: 'BK-FEE-' + row.txnDate + '-' + feesPosted, entryDate: row.txnDate, description: 'Bank fee: ' + row.description, source: 'bank_import', lines: [{ accountName: 'POS and Software Fees', debit: row.fee, credit: 0 }, { accountName: 'Cash - General', debit: 0, credit: row.fee }] };
                await postEntry(feeEntry, locId, defId);
                feesPosted++;
            }
            if (row.amount < 0) {
                const m = /check\s*#?\s*(\d+)/i.exec(row.description);
                if (m) {
                    const reg = await db.list('checks', { filter: { checkNumber: m[1] } });
                    const ck = reg.items.filter((c) => inLoc(c, locId, defId)).find((c) => c.status === 'outstanding' || c.status === 'amount_mismatch');
                    if (ck) {
                        const newStatus = Math.abs(cents(Number(ck.writtenAmount)) - cents(Math.abs(row.amount))) < 0.005 ? 'cleared' : 'amount_mismatch';
                        await db.update('checks', [{ id: String(ck.id), record: { ...ck, status: newStatus, clearedDate: row.txnDate, clearedAmount: cents(Math.abs(row.amount)) } }]);
                        await db.add('bank_lines', [{ txnDate: row.txnDate, description: row.description, amount: row.amount, status: 'check_matched', matchedCheck: String(ck.checkNumber), locationId: locId, createdAt: Date.now() }]);
                        checksMatched++;
                        continue;
                    }
                }
            }
            const [id] = await db.add('bank_lines', [{ txnDate: row.txnDate, description: row.description, amount: row.amount, status: 'review', locationId: locId, createdAt: Date.now() }]);
            if (!id) continue;
            const clearing = row.amount > 0 ? routeDeposit(row.description) : null;
            if (clearing) {
                const posted = await postEntry({ journalNo: 'BK-' + id, entryDate: row.txnDate, description: 'Bank deposit match: ' + row.description, source: 'bank_import', lines: [{ accountName: 'Cash - General', debit: row.amount, credit: 0 }, { accountName: clearing, debit: 0, credit: row.amount }] }, locId, defId);
                if (posted.ok) {
                    await db.update('bank_lines', [{ id, record: { txnDate: row.txnDate, description: row.description, amount: row.amount, status: 'matched', matchedAccount: clearing, journalNo: 'BK-' + id, locationId: locId, createdAt: Date.now() } }]);
                    depositsMatched++;
                    continue;
                }
            }
            queuedForReview++;
        }
        return json({ format: header.includes('fee') ? 'extended' : header.includes('debit') || header.includes('credit') ? 'debit_credit' : 'simple', rowsParsed: parsedRows.length, depositsMatched, checksMatched, queuedForReview, duplicates, feesPosted });
    }]
});
