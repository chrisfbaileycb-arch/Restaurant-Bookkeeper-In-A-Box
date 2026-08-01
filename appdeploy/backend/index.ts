import { router, json, error, db, storage, ai } from '@appdeploy/sdk';

const DISCLAIMER = 'Automated extraction by an AI agent. Figures are read from the document, not verified: never post them to your books without review. Amounts the AI cannot read are left blank, never guessed. This tool records data only and never moves money. By acknowledging, you accept responsibility for verifying results before accounting use.';
const POST_DISCLAIMER = 'You are posting to your books. Entries are recorded in this app\'s ledger only; nothing is filed and no money moves. Verify every figure first.';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Chart of accounts (ported from the production 48-account template) ──
type Acct = { accountNo: string; name: string; type: string; qbType: string; parentAccountNo: string | null };
const COA: Array<[string, string, string, string, (string | null)?]> = [
    ['1000', 'Cash - General', 'asset', 'Bank'], ['1010', 'Cash Drawer', 'asset', 'Bank'],
    ['1020', 'Visa Clearing Account', 'asset', 'Other Current Asset'], ['1021', 'Mastercard Clearing Account', 'asset', 'Other Current Asset'],
    ['1022', 'Amex Clearing Account', 'asset', 'Other Current Asset'], ['1023', 'Discover Clearing Account', 'asset', 'Other Current Asset'],
    ['1024', 'Other Tender Clearing', 'asset', 'Other Current Asset'], ['1025', 'Delivery Payout Clearing', 'asset', 'Other Current Asset'],
    ['1100', 'Inventory - Food', 'asset', 'Other Current Asset'], ['1110', 'Inventory - Beverage', 'asset', 'Other Current Asset'],
    ['1120', 'Inventory - Paper & Packaging', 'asset', 'Other Current Asset'], ['1200', 'Prepaid Expenses', 'asset', 'Other Current Asset'],
    ['1500', 'Equipment', 'asset', 'Fixed Asset'],
    ['2000', 'Accounts Payable', 'liability', 'Accounts Payable'], ['2100', 'Sales Tax Payable - CO', 'liability', 'Other Current Liability'],
    ['2110', 'Tips Payable', 'liability', 'Other Current Liability'], ['2120', 'Gift Card Liability', 'liability', 'Other Current Liability'],
    ['2200', 'Wages Payable', 'liability', 'Other Current Liability'], ['2210', 'Federal Payroll Taxes Payable', 'liability', 'Other Current Liability'],
    ['2220', 'CO Income Tax Withholding Payable', 'liability', 'Other Current Liability'], ['2230', 'FAMLI Premiums Payable', 'liability', 'Other Current Liability'],
    ['2240', 'SUI Payable - CO', 'liability', 'Other Current Liability'], ['2250', 'FUTA Payable', 'liability', 'Other Current Liability'],
    ['3000', 'Owner Equity', 'equity', 'Equity'], ['3100', 'Retained Earnings', 'equity', 'Equity'],
    ['4000', 'Food Sales', 'revenue', 'Income'], ['4100', 'Beverage Sales', 'revenue', 'Income'],
    ['4200', 'Catering Sales', 'revenue', 'Income'], ['4300', 'Delivery Sales', 'revenue', 'Income'], ['4900', 'Other Income', 'revenue', 'Income'],
    ['5000', 'Food Cost - Meat', 'cogs', 'Cost of Goods Sold'], ['5010', 'Food Cost - Produce', 'cogs', 'Cost of Goods Sold'],
    ['5020', 'Food Cost - Dairy', 'cogs', 'Cost of Goods Sold'], ['5030', 'Food Cost - Dry Goods', 'cogs', 'Cost of Goods Sold'],
    ['5040', 'Food Cost - Inventory Adjustment', 'cogs', 'Cost of Goods Sold'],
    ['5100', 'Beverage Cost', 'cogs', 'Cost of Goods Sold'],
    ['5110', 'Beverage Cost - Draught Beer', 'cogs', 'Cost of Goods Sold', '5100'], ['5120', 'Beverage Cost - Packaged & Retail', 'cogs', 'Cost of Goods Sold', '5100'],
    ['5130', 'Beverage Cost - Fountain Soda', 'cogs', 'Cost of Goods Sold', '5100'], ['5140', 'Beverage Cost - Wine', 'cogs', 'Cost of Goods Sold', '5100'],
    ['5150', 'Beverage Cost - Spirits & Liquor', 'cogs', 'Cost of Goods Sold', '5100'], ['5160', 'Beverage Cost - Inventory Adjustment', 'cogs', 'Cost of Goods Sold', '5100'],
    ['5200', 'Paper & Packaging Cost', 'cogs', 'Cost of Goods Sold'],
    ['6000', 'Wages and Salaries', 'expense', 'Expense'], ['6001', 'Wages - Kitchen (BOH)', 'expense', 'Expense', '6000'],
    ['6002', 'Wages - Service (FOH)', 'expense', 'Expense', '6000'], ['6010', 'Payroll Taxes', 'expense', 'Expense'],
    ['6100', 'Rent', 'expense', 'Expense'], ['6110', 'Utilities', 'expense', 'Expense'], ['6120', 'Insurance', 'expense', 'Expense'],
    ['6200', 'Marketing', 'expense', 'Expense'], ['6210', 'Repairs and Maintenance', 'expense', 'Expense'],
    ['6220', 'Supplies', 'expense', 'Expense'], ['6230', 'POS and Software Fees', 'expense', 'Expense'],
    ['6240', 'Delivery Commissions & Fees', 'expense', 'Expense'], ['6250', 'Cash Over/Short', 'expense', 'Expense'],
    ['6900', 'Miscellaneous Expense', 'expense', 'Expense']
];

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

async function postEntry(entry: JEntry): Promise<{ ok: boolean; message?: string }> {
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
    if (existing.items.length > 0) return { ok: false, message: 'journal ' + entry.journalNo + ' already posted' };
    const [id] = await db.add('journal_entries', [{ ...entry, createdAt: Date.now() }]);
    if (!id) return { ok: false, message: 'failed to save journal entry' };
    return { ok: true };
}

async function accountBalances(from: string, to: string) {
    const accounts = await ensureCoa();
    const entries = await listAll('journal_entries');
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
    'POST /api/invoices/scan': [async ({ body }) => {
        const { image: img, mimeType, ack } = (body || {}) as { image?: string; mimeType?: string; ack?: boolean };
        if (ack !== true) return error('disclaimer_acknowledgement_required: ' + DISCLAIMER, 428);
        if (!img || !mimeType) return error('image and mimeType are required', 400);
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
            const record = { vendorName: d.vendor_name || '', invoiceNo: d.invoice_no || '', invoiceDate: d.invoice_date || '', dueDate: d.due_date || '', total: typeof d.total === 'number' ? d.total : null, confidence: typeof d.confidence === 'number' ? d.confidence : 0, warningsCount: warnings.length, breakdown, lineTotal: sum, posted: false, createdAt: Date.now() };
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
    'GET /api/invoices': [async () => {
        const { items } = await db.list('invoices', { limit: 50 });
        items.sort((a, b) => ((b.createdAt as number) || 0) - ((a.createdAt as number) || 0));
        return json({ invoices: items.slice(0, 20) });
    }],
    'POST /api/invoices/post': [async ({ body }) => {
        const { id, ack } = (body || {}) as { id?: string; ack?: boolean };
        if (ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        if (!id) return error('id is required', 400);
        const [inv] = await db.get('invoices', [id]);
        if (!inv) return error('invoice not found', 404);
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
        });
        if (!posted.ok) return error(posted.message || 'posting failed', 422);
        await db.update('invoices', [{ id, record: { ...inv, posted: true, journalNo } }]);
        return json({ posted: true, journalNo, total });
    }],
    'POST /api/ledger/daily-sales': [async ({ body }) => {
        const b = (body || {}) as { ack?: boolean; business_date?: string; food_sales?: number; beverage_sales?: number; sales_tax?: number; cc_tips?: number; cash_collected?: number; processing_fees?: number };
        if (b.ack !== true) return error('disclaimer_acknowledgement_required: ' + POST_DISCLAIMER, 428);
        const date = b.business_date || '';
        if (!DATE_RE.test(date)) return error('business_date must be YYYY-MM-DD', 400);
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
        const posted = await postEntry({ journalNo: 'DS-' + date, entryDate: date, description: 'Daily sales summary', source: 'daily_sales', lines });
        if (!posted.ok) return error(posted.message || 'posting failed', 422);
        return json({ posted: true, journalNo: 'DS-' + date, collected });
    }],
    'GET /api/ledger/accounts': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const rows = await accountBalances(from, to);
        const totalDebits = cents(rows.reduce((s, r) => s + r.debits, 0));
        const totalCredits = cents(rows.reduce((s, r) => s + r.credits, 0));
        return json({ accounts: rows, totals: { debits: totalDebits, credits: totalCredits }, inBalance: Math.abs(totalDebits - totalCredits) < 0.01 });
    }],
    'GET /api/reports/profit-loss': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const rows = await accountBalances(from, to);
        return json({ from, to, ...plFrom(rows) });
    }],
    'GET /api/reports/balance-sheet': [async ({ query }) => {
        const asOf = query.as_of && DATE_RE.test(query.as_of) ? query.as_of : new Date().toISOString().slice(0, 10);
        const rows = await accountBalances('0000-01-01', asOf);
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
        const rows = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (rows.length === 0) return error('empty file', 422);
        if (rows[0].trim().toLowerCase() !== 'date,description,amount') return error('header must be exactly: date,description,amount', 422);
        const existing = await listAll('bank_lines');
        const seen = new Set(existing.map((x) => x.txnDate + '|' + x.description + '|' + x.amount));
        let depositsMatched = 0, queuedForReview = 0, duplicates = 0, badRows = 0;
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
            const [id] = await db.add('bank_lines', [{ txnDate, description, amount: amt, status: 'review', createdAt: Date.now() }]);
            if (!id) { badRows++; continue; }
            const clearing = amt > 0 ? routeDeposit(description) : null;
            if (clearing) {
                const posted = await postEntry({ journalNo: 'BK-' + id, entryDate: txnDate, description: 'Bank deposit match: ' + description, source: 'bank_import', lines: [{ accountName: 'Cash - General', debit: amt, credit: 0 }, { accountName: clearing, debit: 0, credit: amt }] });
                if (posted.ok) {
                    await db.update('bank_lines', [{ id, record: { txnDate, description, amount: amt, status: 'matched', matchedAccount: clearing, journalNo: 'BK-' + id, createdAt: Date.now() } }]);
                    depositsMatched++;
                    continue;
                }
            }
            queuedForReview++;
        }
        return json({ depositsMatched, queuedForReview, duplicates, badRows });
    }],
    'GET /api/bank/queue': [async () => {
        const all = await listAll('bank_lines');
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
        const [line] = await db.get('bank_lines', [id]);
        if (!line) return error('bank line not found', 404);
        if (line.status !== 'review') return error('line already handled', 409);
        const amt = cents(Math.abs(Number(line.amount)));
        const isDeposit = Number(line.amount) > 0;
        const jl: JLine[] = isDeposit
            ? [{ accountName: 'Cash - General', debit: amt, credit: 0 }, { accountName, debit: 0, credit: amt }]
            : [{ accountName, debit: amt, credit: 0 }, { accountName: 'Cash - General', debit: 0, credit: amt }];
        const posted = await postEntry({ journalNo: 'BK-' + id, entryDate: String(line.txnDate), description: (isDeposit ? 'Bank deposit: ' : 'Bank expense: ') + line.description, source: 'bank_import', lines: jl });
        if (!posted.ok) return error(posted.message || 'posting failed', 422);
        await db.update('bank_lines', [{ id, record: { ...line, status: 'posted', matchedAccount: accountName, journalNo: 'BK-' + id } }]);
        return json({ posted: true, journalNo: 'BK-' + id });
    }],
    'POST /api/bank/ignore': [async ({ body }) => {
        const { id } = (body || {}) as { id?: string };
        if (!id) return error('id is required', 400);
        const [line] = await db.get('bank_lines', [id]);
        if (!line) return error('bank line not found', 404);
        if (line.status !== 'review') return error('line already handled', 409);
        await db.update('bank_lines', [{ id, record: { ...line, status: 'ignored' } }]);
        return json({ ignored: true });
    }],
    'GET /api/ledger/journal': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const entries = await listAll('journal_entries');
        const inRange = entries
            .filter((e) => String(e.entryDate) >= from && String(e.entryDate) <= to)
            .sort((a, b) => (String(a.entryDate) < String(b.entryDate) ? -1 : String(a.entryDate) > String(b.entryDate) ? 1 : String(a.journalNo) < String(b.journalNo) ? -1 : 1));
        return json({ from, to, count: inRange.length, entries: inRange.map((e) => ({ journalNo: e.journalNo, entryDate: e.entryDate, description: e.description, source: e.source, lines: e.lines })) });
    }],
    'GET /api/daybook': [async ({ query }) => {
        const from = query.from && DATE_RE.test(query.from) ? query.from : '0000-01-01';
        const to = query.to && DATE_RE.test(query.to) ? query.to : '9999-12-31';
        const rows = await accountBalances('0000-01-01', to);
        const period = await accountBalances(from, to);
        const pl = plFrom(period);
        const cash = cents(rows.filter((r) => r.name === 'Cash - General' || r.name === 'Cash Drawer').reduce((s, r) => s + r.balance, 0));
        const ap = rows.find((r) => r.name === 'Accounts Payable');
        const { items: invs } = await db.list('invoices', { limit: 50 });
        return json({ from, to, cash, apBalance: ap ? ap.balance : 0, totals: pl.totals, kpis: pl.kpis, scans: invs.length, unposted: invs.filter((i) => !i.posted).length });
    }]
});
