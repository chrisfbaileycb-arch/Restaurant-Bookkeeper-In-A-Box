import { useEffect, useState } from 'react';
import { api, image } from '@appdeploy/client';
import { ScanLine, AlertTriangle, Copy, Check, BookOpen, ArrowRight, Sparkles, Send } from 'lucide-react';

type Line = { description?: string; qty?: number | null; unit_price?: number | null; category?: string };
type Extracted = { vendor_name?: string; invoice_no?: string; invoice_date?: string; due_date?: string; subtotal?: number | null; tax?: number | null; total?: number | null; line_items: Line[]; confidence: number; warnings: string[] };

function csvEscape(v: string) { return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(x: Extracted) {
    const head = 'invoice_no,invoice_date,vendor,due_date,item_description,qty,unit_price,category';
    const rows = x.line_items.map((l) => [x.invoice_no || '', x.invoice_date || '', x.vendor_name || '', x.due_date || '', l.description || '', l.qty == null ? '' : String(l.qty), l.unit_price == null ? '' : String(l.unit_price), l.category || ''].map(csvEscape).join(','));
    return [head, ...rows].join('\n');
}
const money = (n?: number | null) => (n == null ? '—' : (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const iso = (d: Date) => d.toISOString().slice(0, 10);

const Crate = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox='0 0 34 34' fill='none' stroke='#b68235' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M17 3.2 30.5 10v14L17 30.8 3.5 24V10z'/><path d='M3.5 10 17 16.8 30.5 10'/><path d='M17 16.8V30.8'/><path d='M11 20.2v4.4M17 22.6v4.4M23 20.2v4.4'/></svg>
);
const btnOn = 'inline-flex items-center gap-2 border border-[#b68235] text-[#8a5f22] rounded px-4 py-2 text-sm cursor-pointer hover:bg-[#b68235]/10';
const btnOff = 'inline-flex items-center gap-2 border border-[#e0ddd8] text-[#9a968e] rounded px-4 py-2 text-sm cursor-not-allowed';

function Home({ go, scanCount }: { go: (v: string) => void; scanCount: number }) {
    return (
        <main className='max-w-3xl mx-auto px-6 py-10 flex flex-col gap-8'>
            <section className='text-center flex flex-col items-center gap-3 py-6'>
                <Crate size={56} />
                <h2 className='text-3xl'>Bookkeeping built for restaurants — nothing else.</h2>
                <p className='text-sm opacity-70 max-w-xl'>One clean, reconciled ledger from your POS, delivery platforms, vendor invoices, payroll reports, and bank feed — without the bloat of generic accounting software. Recording only: this system never moves money.</p>
            </section>
            <section className='grid gap-4 sm:grid-cols-2'>
                <button onClick={() => go('daybook')} className='text-left border border-[#e0ddd8] rounded p-5 bg-white/60 hover:shadow-md transition-shadow flex flex-col gap-2'>
                    <div className='flex items-center gap-2 text-[#8a5f22]'><BookOpen size={18} /><span className='text-[11px] tracking-widest uppercase font-semibold'>Daybook &amp; Ledger</span></div>
                    <p className='text-sm'>Your books, live: post daily sales, see the P&amp;L, prime cost, and cash — double-entry validated on every posting.</p>
                    <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1 mt-auto'>Open the Daybook <ArrowRight size={14} /></span>
                </button>
                <button onClick={() => go('scanner')} className='text-left border border-[#b68235] rounded p-5 bg-[#b68235]/5 hover:shadow-md transition-shadow flex flex-col gap-2'>
                    <div className='flex items-center gap-2 text-[#8a5f22]'><ScanLine size={18} /><span className='text-[11px] tracking-widest uppercase font-semibold'>Invoice Scanner</span></div>
                    <p className='text-sm'>Photograph a supplier invoice; AI extracts the line items — amounts it cannot read are flagged, never guessed — then post straight to your books.</p>
                    <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1 mt-auto'>Scan an invoice <ArrowRight size={14} />{scanCount > 0 ? <span className='opacity-60'>· {scanCount} scanned</span> : null}</span>
                </button>
            </section>
            <section className='border border-[#e0ddd8] rounded p-5 bg-white/40 flex items-start gap-3'>
                <Sparkles size={18} className='text-[#b68235] mt-0.5' />
                <div>
                    <div className='text-[11px] tracking-widest uppercase font-semibold text-[#8a5f22]'>Coming next</div>
                    <p className='text-sm mt-1 opacity-80'>Delivery reconciliation, payroll journals, bank matching, and the bookkeeper agent — with a human approval on every posting.</p>
                </div>
            </section>
        </main>
    );
}

function Daybook() {
    const today = new Date();
    const monthStart = iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
    const [data, setData] = useState<Record<string, any> | null>(null);
    const [pl, setPl] = useState<Record<string, any> | null>(null);
    const [ack, setAck] = useState(false);
    const [form, setForm] = useState({ business_date: iso(today), food_sales: '', beverage_sales: '', sales_tax: '', cc_tips: '', cash_collected: '', processing_fees: '' });
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    function refresh() {
        api.get('/api/daybook?from=' + monthStart + '&to=' + iso(today)).then((r) => setData(r.data)).catch(() => {});
        api.get('/api/reports/profit-loss?from=' + monthStart + '&to=' + iso(today)).then((r) => setPl(r.data)).catch(() => {});
    }
    useEffect(refresh, []);

    async function postDay() {
        if (!ack || busy) return;
        setBusy(true); setMsg(''); setErr('');
        try {
            const num = (s: string) => (s.trim() === '' ? 0 : Number(s));
            const r = await api.post('/api/ledger/daily-sales', { ack: true, business_date: form.business_date, food_sales: num(form.food_sales), beverage_sales: num(form.beverage_sales), sales_tax: num(form.sales_tax), cc_tips: num(form.cc_tips), cash_collected: num(form.cash_collected), processing_fees: num(form.processing_fees) });
            setMsg('Posted ' + r.data.journalNo + ' — ' + money(r.data.collected) + ' collected.');
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Posting failed'); }
        finally { setBusy(false); }
    }

    const kpis = data ? data.kpis : null;
    const fields: Array<[keyof typeof form, string]> = [['business_date', 'Business date'], ['food_sales', 'Food sales'], ['beverage_sales', 'Beverage sales'], ['sales_tax', 'Sales tax collected'], ['cc_tips', 'Card tips'], ['cash_collected', 'Cash collected'], ['processing_fees', 'Processing fees']];
    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <div className='flex items-baseline justify-between flex-wrap gap-2'>
                <h2 className='text-xl'>Daybook <span className='text-sm opacity-60'>· month to date</span></h2>
                {data && data.unposted > 0 && <a href='#/scanner' className='text-sm text-[#8a5f22]'>{data.unposted} scanned invoice{data.unposted > 1 ? 's' : ''} not yet posted →</a>}
            </div>
            <section className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Cash on hand</div><div className='text-2xl tabular-nums mt-1'>{data ? money(data.cash) : '—'}</div></div>
                <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Revenue · MTD</div><div className='text-2xl tabular-nums mt-1'>{data ? money(data.totals.revenue) : '—'}</div></div>
                <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Net income · MTD</div><div className='text-2xl tabular-nums mt-1'>{data ? money(data.totals.netIncome) : '—'}</div></div>
                <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Prime cost</div><div className='text-2xl tabular-nums mt-1'>{kpis && kpis.primeCostPct != null ? kpis.primeCostPct.toFixed(1) + '%' : '—'}</div><div className='text-xs opacity-60'>{kpis && kpis.primeCostStatus ? kpis.primeCostStatus : '65% line'}</div></div>
            </section>
            <section className='border border-[#e0ddd8] rounded bg-white/60 p-4'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-2'>Post daily sales</div>
                <div className='grid gap-3 sm:grid-cols-3'>
                    {fields.map(([k, label]) => (
                        <label key={k} className='text-xs flex flex-col gap-1'>
                            <span className='opacity-70'>{label}</span>
                            <input type={k === 'business_date' ? 'date' : 'number'} step='0.01' min='0' value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm tabular-nums' />
                        </label>
                    ))}
                </div>
                <label className='flex items-center gap-2 mt-3 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    I have verified these figures against the register
                </label>
                <div className='flex items-center gap-3 mt-3 flex-wrap'>
                    <button onClick={postDay} disabled={!ack || busy} className={ack && !busy ? btnOn : btnOff}><Send size={15} />{busy ? 'Posting…' : 'Post to books'}</button>
                    {msg && <span className='text-sm text-[#8a5f22]'>{msg}</span>}
                    {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
                </div>
            </section>
            {pl && (
                <section className='border border-[#e0ddd8] rounded bg-white/60 p-4'>
                    <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-2'>Profit &amp; loss · month to date</div>
                    {(['revenue', 'cogs', 'expenses'] as const).map((sec) => (pl[sec] || []).length > 0 && (
                        <div key={sec} className='mb-2'>
                            <div className='text-xs uppercase tracking-wide opacity-60'>{sec}</div>
                            {(pl[sec] as Array<Record<string, any>>).map((r) => (
                                <div key={r.accountNo} className='flex justify-between text-sm border-b border-[#e0ddd8]/60 py-1'><span>{r.name}</span><span className='tabular-nums'>{money(r.balance)}</span></div>
                            ))}
                        </div>
                    ))}
                    <div className='flex justify-between text-sm py-1 mt-1 border-t border-[#b68235]'><span>Net income</span><span className='tabular-nums text-[#8a5f22]'>{money(pl.totals.netIncome)}</span></div>
                </section>
            )}
        </main>
    );
}

function Bank() {
    const [csv, setCsv] = useState('');
    const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false);
    const [sum, setSum] = useState<Record<string, any> | null>(null);
    const [err, setErr] = useState('');
    const [queue, setQueue] = useState<Array<Record<string, any>>>([]);
    const [accounts, setAccounts] = useState<Array<Record<string, any>>>([]);
    const [picks, setPicks] = useState<Record<string, string>>({});

    function refresh() { api.get('/api/bank/queue').then((r) => { setQueue(r.data.queue || []); setAccounts(r.data.accounts || []); }).catch(() => {}); }
    useEffect(refresh, []);

    async function importCsv() {
        if (!ack || busy || !csv.trim()) return;
        setBusy(true); setErr(''); setSum(null);
        try {
            const r = await api.post('/api/bank/import', { ack: true, csv });
            setSum(r.data); setCsv('');
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Import failed'); }
        finally { setBusy(false); }
    }
    async function postLine(id: string) {
        const accountName = picks[id];
        if (!accountName) { setErr('Pick an account for that line first.'); return; }
        setErr('');
        try { await api.post('/api/bank/categorize', { ack: true, id, accountName }); refresh(); }
        catch (e) { setErr((e as { message?: string }).message || 'Posting failed'); }
    }
    async function ignoreLine(id: string) {
        try { await api.post('/api/bank/ignore', { id }); refresh(); }
        catch (e) { setErr((e as { message?: string }).message || 'Ignore failed'); }
    }

    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='border border-[#b68235] rounded p-4 bg-[#b68235]/5'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>Import bank activity</div>
                <p className='text-sm'>Download a CSV from your bank, arrange it to exactly three columns — <span className='tabular-nums'>date,description,amount</span> (dates YYYY-MM-DD; deposits positive, spending negative) — and paste it here. Card settlements, delivery payouts, and cash deposits auto-match to clearing; everything else waits below for you to categorize. Re-imports skip duplicates.</p>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'date,description,amount\n2026-08-01,SYSCO DENVER PAYMENT,-1240.55\n2026-08-01,SQUARE INC DES:250801,1897.22'} className='w-full mt-3 border border-[#e0ddd8] rounded p-2 text-xs font-mono bg-white min-h-[120px]' />
                <label className='flex items-center gap-2 mt-2 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    I have verified this export against my bank statement
                </label>
                <div className='flex items-center gap-3 mt-3 flex-wrap'>
                    <button onClick={importCsv} disabled={!ack || busy || !csv.trim()} className={ack && !busy && csv.trim() ? btnOn : btnOff}>{busy ? 'Importing…' : 'Import'}</button>
                    {sum && <span className='text-sm text-[#8a5f22]'>{sum.depositsMatched} deposit{sum.depositsMatched === 1 ? '' : 's'} auto-matched · {sum.queuedForReview} for review · {sum.duplicates} duplicate{sum.duplicates === 1 ? '' : 's'} skipped{sum.badRows ? ' · ' + sum.badRows + ' bad row' + (sum.badRows === 1 ? '' : 's') : ''}</span>}
                    {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
                </div>
            </section>
            <section>
                <h2 className='text-lg mb-2'>Review queue</h2>
                {queue.length === 0 ? <p className='text-sm opacity-60'>Nothing waiting — import a statement above and unrecognized lines land here.</p> : (
                    <ul className='divide-y divide-[#e0ddd8] border border-[#e0ddd8] rounded bg-white/60'>
                        {queue.map((q) => (
                            <li key={q.id} className='px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center gap-2'>
                                <span className='tabular-nums opacity-60 shrink-0'>{q.txnDate}</span>
                                <span className='flex-1 min-w-0'>{q.description}</span>
                                <span className={'tabular-nums shrink-0 ' + (Number(q.amount) < 0 ? '' : 'text-[#8a5f22]')}>{money(Number(q.amount))}</span>
                                <select value={picks[q.id] || ''} onChange={(e) => setPicks({ ...picks, [q.id]: e.target.value })} className='border border-[#e0ddd8] rounded px-2 py-1 text-xs bg-white max-w-[220px]'>
                                    <option value=''>Choose account…</option>
                                    {accounts.filter((a) => (Number(q.amount) < 0 ? a.type === 'expense' || a.type === 'cogs' || a.type === 'asset' || a.type === 'liability' : a.type === 'revenue' || a.type === 'asset' || a.type === 'liability' || a.type === 'equity')).map((a) => <option key={a.accountNo} value={a.name}>{a.accountNo} · {a.name}</option>)}
                                </select>
                                <span className='flex gap-2 shrink-0'>
                                    <button onClick={() => postLine(q.id)} className={btnOn + ' !px-3 !py-1'}>Post</button>
                                    <button onClick={() => ignoreLine(q.id)} className={btnOff + ' !px-3 !py-1 !cursor-pointer hover:bg-white'}>Ignore</button>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </main>
    );
}

function Reports() {
    const today = new Date();
    const mtdFrom = iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
    const [from, setFrom] = useState(mtdFrom);
    const [to, setTo] = useState(iso(today));
    const [asOf, setAsOf] = useState(iso(today));
    const [which, setWhich] = useState<'pl' | 'bs' | 'tb' | 'jr'>('pl');
    const [pl, setPl] = useState<Record<string, any> | null>(null);
    const [bs, setBs] = useState<Record<string, any> | null>(null);
    const [tb, setTb] = useState<Record<string, any> | null>(null);
    const [jr, setJr] = useState<Record<string, any> | null>(null);

    function run() {
        api.get('/api/reports/profit-loss?from=' + from + '&to=' + to).then((r) => setPl(r.data)).catch(() => {});
        api.get('/api/reports/balance-sheet?as_of=' + asOf).then((r) => setBs(r.data)).catch(() => {});
        api.get('/api/ledger/accounts?from=' + from + '&to=' + to).then((r) => setTb(r.data)).catch(() => {});
        api.get('/api/ledger/journal?from=' + from + '&to=' + to).then((r) => setJr(r.data)).catch(() => {});
    }
    useEffect(run, []);

    const Row = ({ name, val, strong }: { name: string; val: number; strong?: boolean }) => (
        <div className={'flex justify-between text-sm py-1 ' + (strong ? 'border-t border-[#b68235] text-[#8a5f22]' : 'border-b border-[#e0ddd8]/60')}><span>{name}</span><span className='tabular-nums'>{money(val)}</span></div>
    );

    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='flex items-end gap-3 flex-wrap'>
                <div className='flex gap-1 border border-[#e0ddd8] rounded overflow-hidden'>
                    {([['pl', 'Profit & Loss'], ['bs', 'Balance Sheet'], ['tb', 'Trial Balance'], ['jr', 'Journal']] as const).map(([k, label]) => (
                        <button key={k} onClick={() => setWhich(k)} className={'px-3 py-2 text-xs ' + (which === k ? 'bg-[#b68235]/10 text-[#8a5f22]' : 'opacity-70')}>{label}</button>
                    ))}
                </div>
                {which === 'bs' ? (
                    <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>As of</span><input type='date' value={asOf} onChange={(e) => setAsOf(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm' /></label>
                ) : (
                    <>
                        <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>From</span><input type='date' value={from} onChange={(e) => setFrom(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm' /></label>
                        <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>To</span><input type='date' value={to} onChange={(e) => setTo(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm' /></label>
                    </>
                )}
                <button onClick={run} className={btnOn}>Refresh</button>
                <button onClick={() => window.print()} className={btnOn}>Print</button>
            </section>
            <section className='print-area border border-[#e0ddd8] rounded bg-white p-6'>
                <div className='flex items-center gap-3 mb-4'>
                    <Crate size={26} />
                    <div>
                        <h2 className='text-lg leading-tight'>{which === 'pl' ? 'Profit & Loss' : which === 'bs' ? 'Balance Sheet' : which === 'tb' ? 'Trial Balance' : 'General Journal'}</h2>
                        <p className='text-xs opacity-60'>{which === 'bs' ? 'As of ' + asOf : from + ' → ' + to}</p>
                    </div>
                </div>
                {which === 'pl' && pl && (
                    <div>
                        {(['revenue', 'cogs', 'expenses'] as const).map((sec) => (pl[sec] || []).length > 0 && (
                            <div key={sec} className='mb-3'>
                                <div className='text-[11px] uppercase tracking-widest text-[#8a5f22] font-semibold mb-1'>{sec}</div>
                                {(pl[sec] as Array<Record<string, any>>).map((r) => <Row key={r.accountNo} name={r.accountNo + ' · ' + r.name} val={r.balance} />)}
                            </div>
                        ))}
                        <Row name='Gross profit' val={pl.totals.grossProfit} strong />
                        <Row name='Net income' val={pl.totals.netIncome} strong />
                        {pl.kpis && pl.kpis.primeCostPct != null && <p className='text-xs opacity-60 mt-2'>Food cost {pl.kpis.foodCostPct != null ? pl.kpis.foodCostPct.toFixed(1) + '%' : '—'} · Labor {pl.kpis.laborCostPct != null ? pl.kpis.laborCostPct.toFixed(1) + '%' : '—'} · Prime cost {pl.kpis.primeCostPct.toFixed(1)}% ({pl.kpis.primeCostStatus})</p>}
                    </div>
                )}
                {which === 'bs' && bs && (
                    <div>
                        {([['assets', 'Assets'], ['liabilities', 'Liabilities'], ['equity', 'Equity']] as const).map(([k, label]) => (
                            <div key={k} className='mb-3'>
                                <div className='text-[11px] uppercase tracking-widest text-[#8a5f22] font-semibold mb-1'>{label}</div>
                                {((bs[k] || []) as Array<Record<string, any>>).map((r) => <Row key={r.accountNo} name={r.accountNo + ' · ' + r.name} val={r.balance} />)}
                                {k === 'equity' && <Row name='Net income to date' val={bs.netIncomeToDate} />}
                            </div>
                        ))}
                        <Row name='Total assets' val={bs.totals.assets} strong />
                        <Row name='Liabilities + equity' val={bs.totals.liabilitiesAndEquity} strong />
                        <p className={'text-xs mt-2 ' + (bs.balanced ? 'text-[#8a5f22]' : 'text-red-700')}>{bs.balanced ? '✓ Books in balance' : '⚠ Balance check failed — review the ledger'}</p>
                    </div>
                )}
                {which === 'tb' && tb && (
                    <div>
                        {((tb.accounts || []) as Array<Record<string, any>>).filter((r) => r.debits !== 0 || r.credits !== 0).map((r) => (
                            <div key={r.accountNo} className='flex justify-between text-sm py-1 border-b border-[#e0ddd8]/60 gap-3'><span className='flex-1 min-w-0'>{r.accountNo} · {r.name}</span><span className='tabular-nums w-24 text-right'>{money(r.debits)}</span><span className='tabular-nums w-24 text-right'>{money(r.credits)}</span></div>
                        ))}
                        <div className='flex justify-between text-sm py-1 mt-1 border-t border-[#b68235] text-[#8a5f22] gap-3'><span className='flex-1'>Totals {tb.inBalance ? '· in balance ✓' : '· OUT OF BALANCE ⚠'}</span><span className='tabular-nums w-24 text-right'>{money(tb.totals.debits)}</span><span className='tabular-nums w-24 text-right'>{money(tb.totals.credits)}</span></div>
                    </div>
                )}
                {which === 'jr' && jr && (
                    <div>
                        <p className='text-xs opacity-60 mb-2'>{jr.count} entr{jr.count === 1 ? 'y' : 'ies'} — every posting, line by line. This is the detail an auditor asks for.</p>
                        {((jr.entries || []) as Array<Record<string, any>>).map((e) => (
                            <div key={e.journalNo} className='mb-3 border-b border-[#e0ddd8] pb-2'>
                                <div className='flex justify-between text-sm'><span>{e.entryDate} · <span className='text-[#8a5f22]'>{e.journalNo}</span> · {e.description}</span><span className='text-xs opacity-60'>{e.source}</span></div>
                                {((e.lines || []) as Array<Record<string, any>>).map((l, i) => (
                                    <div key={i} className='flex justify-between text-xs pl-4 py-0.5 gap-3'><span className='flex-1 min-w-0'>{l.accountName}</span><span className='tabular-nums w-24 text-right'>{Number(l.debit) > 0 ? money(Number(l.debit)) : ''}</span><span className='tabular-nums w-24 text-right'>{Number(l.credit) > 0 ? money(Number(l.credit)) : ''}</span></div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </main>
    );
}

function Scanner() {
    const [ack, setAck] = useState(false);
    const [disc, setDisc] = useState('');
    const [busy, setBusy] = useState(false);
    const [res, setRes] = useState<Extracted | null>(null);
    const [lastId, setLastId] = useState<string | null>(null);
    const [postedNo, setPostedNo] = useState('');
    const [err, setErr] = useState('');
    const [hist, setHist] = useState<Array<Record<string, any>>>([]);
    const [copied, setCopied] = useState(false);

    function refresh() { api.get('/api/invoices').then((r) => setHist(r.data.invoices || [])).catch(() => {}); }
    useEffect(() => {
        api.get('/api/disclaimer').then((r) => setDisc(r.data.disclaimer)).catch(() => setDisc('Automated AI extraction. Verify every figure before posting to your books. Records data only; never moves money.'));
        refresh();
    }, []);

    async function onFile(f: File | null) {
        if (!f || !ack || busy) return;
        setBusy(true); setErr(''); setRes(null); setCopied(false); setLastId(null); setPostedNo('');
        try {
            const prep = await image.resizeIfNeeded(f);
            const r = await api.post('/api/invoices/scan', { image: prep.data, mimeType: prep.mimeType, ack: true });
            setRes(r.data.extracted as Extracted);
            setLastId(r.data.id || null);
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Scan failed — try a clearer photo.'); }
        finally { setBusy(false); }
    }

    async function copyCsv() { if (!res) return; await navigator.clipboard.writeText(toCsv(res)); setCopied(true); setTimeout(() => setCopied(false), 2000); }

    async function postToBooks() {
        if (!lastId || postedNo) return;
        if (!window.confirm('Post this invoice to your books? Verify every figure first — posting records a journal entry in the ledger. Nothing is filed and no money moves.')) return;
        try {
            const r = await api.post('/api/invoices/post', { id: lastId, ack: true });
            setPostedNo(r.data.journalNo);
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Posting failed'); }
    }

    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='border border-[#b68235] rounded p-4 bg-[#b68235]/5'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>Before you scan</div>
                <p className='text-sm'>{disc || 'Loading disclaimer…'}</p>
                <label className='flex items-center gap-2 mt-3 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    I understand and accept
                </label>
            </section>
            <section className='flex items-center gap-3 flex-wrap'>
                <label className={ack && !busy ? btnOn : btnOff}>
                    <ScanLine size={16} />
                    {busy ? 'Scanning…' : 'Choose invoice photo'}
                    <input type='file' accept='image/*' className='hidden' disabled={!ack || busy} onChange={(e) => onFile(e.target.files && e.target.files[0])} />
                </label>
                {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
            </section>
            {res && (
                <section className='border border-[#e0ddd8] rounded bg-white/70 p-4 flex flex-col gap-3'>
                    <div className='flex justify-between items-baseline flex-wrap gap-2'>
                        <h2 className='text-lg'>{res.vendor_name || 'Unknown vendor'} {res.invoice_no ? '#' + res.invoice_no : ''}</h2>
                        <span className='text-xs opacity-60'>confidence {Math.round((res.confidence || 0) * 100)}%</span>
                    </div>
                    <div className='text-sm flex gap-4 flex-wrap tabular-nums'>
                        <span>Date: {res.invoice_date || '—'}</span><span>Due: {res.due_date || '—'}</span>
                        <span>Subtotal: {money(res.subtotal)}</span><span>Tax: {money(res.tax)}</span><span>Total: {money(res.total)}</span>
                    </div>
                    {res.warnings.length > 0 && (
                        <ul className='text-sm text-[#8a5f22] border-l-2 border-[#b68235] pl-3'>
                            {res.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                        </ul>
                    )}
                    <table className='text-sm w-full'>
                        <thead><tr className='text-left text-xs uppercase tracking-wide opacity-60'><th className='py-1'>Item</th><th>Qty</th><th>Unit</th><th>Category</th></tr></thead>
                        <tbody>{res.line_items.map((l, i) => <tr key={i} className='border-t border-[#e0ddd8]'><td className='py-1'>{l.description || '—'}</td><td className='tabular-nums'>{l.qty == null ? '—' : l.qty}</td><td className='tabular-nums'>{l.unit_price == null ? '—' : money(l.unit_price)}</td><td>{l.category || '—'}</td></tr>)}</tbody>
                    </table>
                    <div className='flex gap-3 flex-wrap'>
                        <button onClick={copyCsv} className={btnOn}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy AP import CSV'}</button>
                        {lastId && (postedNo
                            ? <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1 self-center'><Check size={15} /> Posted as {postedNo}</span>
                            : <button onClick={postToBooks} className={btnOn}><Send size={16} />Post to books</button>)}
                    </div>
                </section>
            )}
            <section>
                <h2 className='text-lg mb-2'>Recent scans</h2>
                {hist.length === 0 ? <p className='text-sm opacity-60'>No scans yet.</p> : (
                    <ul className='divide-y divide-[#e0ddd8] border border-[#e0ddd8] rounded bg-white/60'>
                        {hist.map((h) => (
                            <li key={h.id} className='px-4 py-2 text-sm flex justify-between gap-3'>
                                <span>{h.vendorName || 'Unknown vendor'} {h.invoiceNo ? '#' + h.invoiceNo : ''}{h.posted ? <span className='ml-2 text-[11px] text-[#8a5f22] border border-[#b68235] rounded-full px-2'>posted</span> : null}</span>
                                <span className='tabular-nums'>{money(h.total)}{h.warningsCount ? ' · ' + h.warningsCount + ' ⚠' : ''}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </main>
    );
}

function App() {
    const fromHash = () => {
        const h = window.location.hash;
        if (h === '#/scanner') return 'scanner';
        if (h === '#/daybook') return 'daybook';
        if (h === '#/bank') return 'bank';
        if (h === '#/reports') return 'reports';
        return 'home';
    };
    const [view, setView] = useState<string>(fromHash());
    const [scanCount, setScanCount] = useState(0);

    useEffect(() => {
        const onHash = () => setView(fromHash());
        window.addEventListener('hashchange', onHash);
        api.get('/api/invoices').then((r) => setScanCount((r.data.invoices || []).length)).catch(() => {});
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    const go = (v: string) => { window.location.hash = v === 'home' ? '#/' : '#/' + v; setView(v); };
    const tab = (active: boolean) => active ? 'text-sm text-[#8a5f22] border-b-2 border-[#b68235] pb-0.5' : 'text-sm opacity-70 hover:opacity-100 pb-0.5 border-b-2 border-transparent';

    return (
        <div className='min-h-screen bg-[#f3f2f2] text-[#201f1d] font-serif'>
            <header className='border-b border-[#e0ddd8] bg-[#faf9f7] px-6 py-4 flex items-center gap-6 flex-wrap'>
                <button onClick={() => go('home')} className='flex items-center gap-3'>
                    <Crate size={30} />
                    <h1 className='text-2xl'>Restaurant Bookkeeper <span className='text-[#b68235] text-sm'>/ in a box</span></h1>
                </button>
                <nav className='flex items-center gap-5 ml-auto'>
                    <button className={tab(view === 'home')} onClick={() => go('home')} aria-current={view === 'home' ? 'page' : undefined}>Home</button>
                    <button className={tab(view === 'daybook')} onClick={() => go('daybook')} aria-current={view === 'daybook' ? 'page' : undefined}>Daybook</button>
                    <button className={tab(view === 'bank')} onClick={() => go('bank')} aria-current={view === 'bank' ? 'page' : undefined}>Bank</button>
                    <button className={tab(view === 'reports')} onClick={() => go('reports')} aria-current={view === 'reports' ? 'page' : undefined}>Reports</button>
                    <button className={tab(view === 'scanner')} onClick={() => go('scanner')} aria-current={view === 'scanner' ? 'page' : undefined}>Invoice Scanner</button>
                </nav>
            </header>
            {view === 'home' ? <Home go={go} scanCount={scanCount} /> : view === 'daybook' ? <Daybook /> : view === 'bank' ? <Bank /> : view === 'reports' ? <Reports /> : <Scanner />}
        </div>
    );
}

export default App;
