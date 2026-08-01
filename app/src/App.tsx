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
                    <p className='text-sm mt-1 opacity-80'>New: A/P aging, the check register, and the in-app Guide are live. Delivery reconciliation and payroll journals are next — with a human approval on every posting.</p>
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
                    {sum && <span className='text-sm text-[#8a5f22]'>{sum.depositsMatched} deposit{sum.depositsMatched === 1 ? '' : 's'} auto-matched · {sum.queuedForReview} for review · {sum.duplicates} duplicate{sum.duplicates === 1 ? '' : 's'} skipped{sum.checksMatched ? ' · ' + sum.checksMatched + ' check' + (sum.checksMatched === 1 ? '' : 's') + ' cleared' : ''}{sum.badRows ? ' · ' + sum.badRows + ' bad row' + (sum.badRows === 1 ? '' : 's') : ''}</span>}
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
                        <p className='text-xs opacity-60 mb-2'>{jr.count} entr{jr.count === 1 ? 'y' : 'ies'} — every posting, line by line.</p>
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

const tagCls = (s: string) => s === 'cleared' ? 'border-[#b68235] text-[#8a5f22]' : s === 'amount_mismatch' ? 'border-red-700 text-red-700' : s === 'void' ? 'border-[#e0ddd8] opacity-50' : 'border-[#e0ddd8] text-[#767268]';

function Ap() {
    const [aging, setAging] = useState<Record<string, any> | null>(null);
    const [checks, setChecks] = useState<Array<Record<string, any>>>([]);
    const [filter, setFilter] = useState('');
    const [payFor, setPayFor] = useState<Record<string, any> | null>(null);
    const [payDate, setPayDate] = useState(iso(new Date()));
    const [payCheck, setPayCheck] = useState('');
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    function refresh() {
        api.get('/api/ap/aging').then((r) => setAging(r.data)).catch(() => {});
        api.get('/api/checks/register' + (filter ? '?status=' + filter : '')).then((r) => setChecks(r.data.checks || [])).catch(() => {});
    }
    useEffect(refresh, [filter]);

    async function pay() {
        if (!payFor || busy) return;
        if (!window.confirm('Record this payment? This books a payment you already made through your bank or by check - nothing is filed and no money moves. Verify the figures first.')) return;
        setBusy(true); setErr(''); setMsg('');
        try {
            const r = await api.post('/api/ap/pay', { ack: true, id: payFor.id, payment_date: payDate, check_number: payCheck.trim() || undefined });
            setMsg('Recorded: ' + (r.data.vendor || 'vendor') + (r.data.invoiceNo ? ' #' + r.data.invoiceNo : '') + ' - ' + money(r.data.amount) + ' via ' + r.data.method + (payCheck.trim() ? '. The check is now outstanding in the register.' : ''));
            setPayFor(null); setPayCheck('');
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Payment failed'); }
        finally { setBusy(false); }
    }
    async function setStatus(checkNumber: string, status: string) {
        setErr('');
        try { await api.post('/api/checks/register', { check_number: checkNumber, status }); refresh(); }
        catch (e) { setErr((e as { message?: string }).message || 'Update failed'); }
    }

    const rows: Array<Record<string, any>> = aging ? (aging.bins as Array<Record<string, any>>).flatMap((b) => b.invoices as Array<Record<string, any>>) : [];
    const outstandingTotal = checks.filter((c) => c.status === 'outstanding').reduce((s, c) => s + (Number(c.writtenAmount) || 0), 0);

    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section>
                <div className='flex items-baseline justify-between flex-wrap gap-2 mb-2'>
                    <h2 className='text-lg'>Accounts payable <span className='text-sm opacity-60'>· {aging ? money(aging.total) + ' unpaid' : '…'}</span></h2>
                </div>
                <div className='grid gap-4 sm:grid-cols-3 mb-3'>
                    {aging && (aging.bins as Array<Record<string, any>>).map((b) => (
                        <div key={b.label} className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>{b.label}</div><div className='text-2xl tabular-nums mt-1'>{money(b.total)}</div><div className='text-xs opacity-60'>{(b.invoices as Array<unknown>).length} invoice{(b.invoices as Array<unknown>).length === 1 ? '' : 's'}</div></div>
                    ))}
                </div>
                {rows.length === 0 ? <p className='text-sm opacity-60'>Nothing unpaid. Invoices land here when you post a scan from the Invoice Scanner.</p> : (
                    <ul className='divide-y divide-[#e0ddd8] border border-[#e0ddd8] rounded bg-white/60'>
                        {rows.map((i) => (
                            <li key={i.id} className='px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center gap-2'>
                                <span className='flex-1 min-w-0'>{i.vendor} {i.invoiceNo ? '#' + i.invoiceNo : ''}{i.pastDue ? <span className='ml-2 text-[11px] text-red-700 border border-red-700 rounded-full px-2'>past due</span> : null}</span>
                                <span className='tabular-nums opacity-60 shrink-0'>{i.invoiceDate} · {i.daysOld}d{i.dueDate ? ' · due ' + i.dueDate : ''}</span>
                                <span className='tabular-nums shrink-0'>{money(i.amount)}</span>
                                <button onClick={() => { setPayFor(i); setMsg(''); }} className={btnOn + ' !px-3 !py-1 shrink-0'}>Record payment</button>
                            </li>
                        ))}
                    </ul>
                )}
                {payFor && (
                    <div className='border border-[#b68235] rounded p-4 bg-[#b68235]/5 mt-3 flex items-end gap-3 flex-wrap'>
                        <span className='text-sm'>Pay {payFor.vendor} {payFor.invoiceNo ? '#' + payFor.invoiceNo : ''} · <span className='tabular-nums'>{money(payFor.amount)}</span></span>
                        <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>Payment date</span><input type='date' value={payDate} onChange={(e) => setPayDate(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm' /></label>
                        <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>Check # (blank = EFT/ACH)</span><input value={payCheck} onChange={(e) => setPayCheck(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm w-32' /></label>
                        <button onClick={pay} disabled={busy} className={busy ? btnOff : btnOn}><Send size={15} />{busy ? 'Recording…' : 'Record'}</button>
                        <button onClick={() => setPayFor(null)} className={btnOff + ' !cursor-pointer hover:bg-white'}>Cancel</button>
                    </div>
                )}
                <div className='mt-2 flex gap-3 flex-wrap'>
                    {msg && <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1'><Check size={15} />{msg}</span>}
                    {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
                </div>
            </section>
            <section>
                <div className='flex items-baseline justify-between flex-wrap gap-2 mb-2'>
                    <h2 className='text-lg'>Check register <span className='text-sm opacity-60'>· outstanding {money(outstandingTotal)}</span></h2>
                    <select value={filter} onChange={(e) => setFilter(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1 text-xs bg-white'>
                        <option value=''>All statuses</option><option value='outstanding'>Outstanding</option><option value='cleared'>Cleared</option><option value='amount_mismatch'>Amount mismatch</option><option value='void'>Void</option>
                    </select>
                </div>
                <p className='text-xs opacity-60 mb-2'>Checks appear here when you record a check payment above. Importing bank activity with a matching Check #123 withdrawal clears them automatically; a different cleared amount flags a mismatch.</p>
                {checks.length === 0 ? <p className='text-sm opacity-60'>No checks{filter ? ' with this status' : ' yet'}.</p> : (
                    <ul className='divide-y divide-[#e0ddd8] border border-[#e0ddd8] rounded bg-white/60'>
                        {checks.map((c) => (
                            <li key={c.id} className='px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center gap-2'>
                                <span className='tabular-nums shrink-0'>#{c.checkNumber}</span>
                                <span className='tabular-nums opacity-60 shrink-0'>{c.checkDate}</span>
                                <span className='flex-1 min-w-0'>{c.payee}{c.memo ? <span className='opacity-60'> · {c.memo}</span> : null}</span>
                                <span className={'text-[11px] border rounded-full px-2 shrink-0 ' + tagCls(String(c.status))}>{String(c.status).replace('_', ' ')}</span>
                                <span className='tabular-nums shrink-0'>{money(Number(c.writtenAmount))}</span>
                                {(c.status === 'outstanding' || c.status === 'amount_mismatch') && <button onClick={() => setStatus(String(c.checkNumber), 'void')} className={btnOff + ' !px-3 !py-1 !cursor-pointer hover:bg-white shrink-0'}>Void</button>}
                                {c.status === 'void' && <button onClick={() => setStatus(String(c.checkNumber), 'outstanding')} className={btnOff + ' !px-3 !py-1 !cursor-pointer hover:bg-white shrink-0'}>Reopen</button>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </main>
    );
}

const GUIDE_KB: Array<{ keys: string[]; a: string }> = [
    { keys: ['bank', 'statement', 'import'], a: 'Bank CSV is exactly three columns: date,description,amount (dates YYYY-MM-DD; deposits positive, spending negative). Card settlements, delivery payouts, and cash deposits auto-match to clearing accounts; a withdrawal like CHECK #1041 clears a matching outstanding check; everything else waits in the review queue for you to categorize.' },
    { keys: ['scan', 'invoice', 'photo', 'ocr'], a: 'On the Invoice Scanner tab, photograph a supplier invoice and the AI extracts the line items - amounts it cannot read are flagged, never guessed. Review, then Post to books to record it as Accounts Payable.' },
    { keys: ['aging', 'bill', 'vendor', 'payable', 'a/p', 'ap ', 'pay'], a: 'A/P & Checks bins unpaid posted invoices 0-15 / 16-30 / 31+ days by invoice date. Record payment books the payment (debit Accounts Payable, credit Cash) - this app never moves money. Paying by check also registers the check as outstanding.' },
    { keys: ['check', 'register', 'void', 'outstanding', 'clear'], a: 'The check register tracks every check: outstanding, cleared, amount mismatch, or void. Import bank activity containing Check #123 withdrawals and matching outstanding checks clear automatically; mismatched amounts are flagged.' },
    { keys: ['daily', 'sales', 'post', 'daybook'], a: 'Post each day of sales on the Daybook tab: food, beverage, tax, tips, cash, and processing fees become one balanced journal entry. That feeds cash, the P&L, and prime cost.' },
    { keys: ['p&l', 'profit', 'report', 'balance sheet', 'trial', 'journal', 'print'], a: 'Reports covers P&L, Balance Sheet, Trial Balance, and the General Journal. Use Print for a clean paper copy. The Balance Sheet self-checks: assets must equal liabilities + equity.' },
    { keys: ['prime', 'kpi', 'food cost', 'labor'], a: 'Prime cost = COGS + labor as a percent of revenue; the industry warning line is 65%. Food and beverage cost percentages compare each cost to its own sales line.' },
    { keys: ['money', 'move', 'file', 'safe'], a: 'Recording only: this system never moves money and never files anything. Every posting needs your explicit confirmation, and AI-read amounts are flagged when uncertain - never guessed.' }
];

function Guide({ view }: { view: string }) {
    const [open, setOpen] = useState(false);
    const [steps, setSteps] = useState<Array<{ done: boolean; label: string; hash: string }> | null>(null);
    const [q, setQ] = useState('');
    const [a, setA] = useState('');
    useEffect(() => {
        if (!open || steps) return;
        const today = new Date();
        const from = iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
        const settle = (p: Promise<{ data: Record<string, any> }>) => p.then((r) => r.data).catch(() => null);
        Promise.all([
            settle(api.get('/api/daybook?from=' + from + '&to=' + iso(today))),
            settle(api.get('/api/bank/queue')),
            settle(api.get('/api/ap/aging')),
            settle(api.get('/api/reports/balance-sheet?as_of=' + iso(today)))
        ]).then(([d, b, ap, bs]) => {
            const qn = b && b.queue ? (b.queue as Array<unknown>).length : 0;
            const un = d ? Number(d.unposted) || 0 : 0;
            setSteps([
                { done: !!(d && d.totals && d.totals.revenue > 0), label: 'Post daily sales (this month)', hash: '#/daybook' },
                { done: un === 0, label: un > 0 ? 'Post scanned invoices (' + un + ' waiting)' : 'Post scanned invoices', hash: '#/scanner' },
                { done: qn === 0, label: qn > 0 ? 'Clear the bank review queue (' + qn + ')' : 'Clear the bank review queue', hash: '#/bank' },
                { done: !!(ap && !((ap.bins || []) as Array<Record<string, any>>).some((x) => ((x.invoices || []) as Array<Record<string, any>>).some((i) => i.pastDue))), label: 'No bills past due', hash: '#/ap' },
                { done: !!(bs && bs.balanced), label: 'Books in balance', hash: '#/reports' }
            ]);
        });
    }, [open]);
    const tips: Record<string, string> = {
        bank: 'Import a statement, then work the review queue to zero - unrecognized lines are parked, never posted.',
        ap: 'Watch the 31+ day bin. Recording a check payment also adds it to the register as outstanding.',
        reports: 'Pick a period, then Print gives you a clean paper copy.',
        scanner: 'Photograph the whole invoice in good light; blurry amounts come back flagged, never guessed.',
        daybook: 'One balanced journal entry per business day - post it after close.',
        home: 'Work left to right: Daybook, Bank, A/P, Reports. Open me anytime for the closing checklist.'
    };
    function ask(e: { preventDefault: () => void }) {
        e.preventDefault();
        const s = q.trim().toLowerCase();
        if (!s) return;
        const hit = GUIDE_KB.find((k) => k.keys.some((key) => s.includes(key)));
        setA(hit ? hit.a : 'No note on that yet. Try: bank import, invoice scanning, aging, check register, daily sales, reports, or prime cost.');
    }
    const next = steps ? steps.find((s) => !s.done) : null;
    return (
        <>
            <button onClick={() => setOpen(!open)} aria-expanded={open} className='fixed right-5 bottom-5 z-40 border border-[#b68235] text-[#8a5f22] bg-[#fbfaf9] rounded-full px-4 py-2 text-sm shadow-md hover:bg-[#b68235]/10'>✦ Guide</button>
            {open && (
                <div className='fixed right-5 bottom-16 z-40 w-80 max-w-[calc(100vw-40px)] max-h-[70vh] overflow-y-auto bg-[#fbfaf9] border border-[#e0ddd8] rounded-lg shadow-lg p-4 flex flex-col gap-3'>
                    <div><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Bookkeeper guide</div><h3 className='text-lg'>Where you are in the flow</h3></div>
                    {tips[view] && <p className='text-xs opacity-70'>{tips[view]}</p>}
                    <div>
                        {!steps ? <p className='text-xs opacity-60'>Checking your books…</p> : steps.map((s) => (
                            <div key={s.label} className='flex items-center gap-2 py-1.5 border-b border-[#e0ddd8] last:border-b-0 text-sm'>
                                <span className={'w-2 h-2 rounded-full border border-[#b68235] shrink-0 ' + (s.done ? 'bg-[#b68235]' : '')}></span>
                                <span className={s.done ? 'opacity-50 line-through' : ''}>{s.label}</span>
                                {!s.done && <a href={s.hash} className='ml-auto text-xs text-[#8a5f22] shrink-0'>go →</a>}
                            </div>
                        ))}
                        {steps && (next ? <p className='text-sm mt-2'><strong>Next up:</strong> {next.label} <a href={next.hash} className='text-[#8a5f22]'>open →</a></p> : <p className='text-sm mt-2'>All clear - the books are closed up. ✦</p>)}
                    </div>
                    <form onSubmit={ask} className='flex gap-2'>
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='e.g. bank CSV, prime cost…' aria-label='Ask the guide' className='flex-1 border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm' />
                        <button type='submit' className={btnOn + ' !px-3 !py-1'}>Ask</button>
                    </form>
                    {a && <p className='text-sm'>{a}</p>}
                </div>
            )}
        </>
    );
}

function App() {
    const fromHash = () => {
        const h = window.location.hash;
        if (h === '#/scanner') return 'scanner';
        if (h === '#/daybook') return 'daybook';
        if (h === '#/bank') return 'bank';
        if (h === '#/ap') return 'ap';
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
                    <button className={tab(view === 'ap')} onClick={() => go('ap')} aria-current={view === 'ap' ? 'page' : undefined}>A/P &amp; Checks</button>
                    <button className={tab(view === 'reports')} onClick={() => go('reports')} aria-current={view === 'reports' ? 'page' : undefined}>Reports</button>
                    <button className={tab(view === 'scanner')} onClick={() => go('scanner')} aria-current={view === 'scanner' ? 'page' : undefined}>Invoice Scanner</button>
                </nav>
            </header>
            {view === 'home' ? <Home go={go} scanCount={scanCount} /> : view === 'daybook' ? <Daybook /> : view === 'bank' ? <Bank /> : view === 'ap' ? <Ap /> : view === 'reports' ? <Reports /> : <Scanner />}
            <Guide view={view} />
        </div>
    );
}

export default App;
