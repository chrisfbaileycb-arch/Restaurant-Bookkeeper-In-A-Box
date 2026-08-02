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

// Active location: chosen in the header picker, persisted locally; every
// request carries it so the backend scopes data to that location's books.
const activeLoc = localStorage.getItem('rb_location') || '';
const lq = (path: string) => path + (path.includes('?') ? '&' : '?') + 'location=' + encodeURIComponent(activeLoc);
const lapi = {
    get: (path: string) => api.get(lq(path)),
    post: (path: string, body: Record<string, any>) => api.post(path, activeLoc ? { ...body, location_id: activeLoc } : body)
};

function download(filename: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function Home({ go, scanCount }: { go: (v: string) => void; scanCount: number }) {
    return (
        <main className='max-w-3xl mx-auto px-6 py-10 flex flex-col gap-8'>
            <section className='text-center flex flex-col items-center gap-3 py-6'>
                <Crate size={56} />
                <h2 className='text-3xl'>1st Bookkeeper-In-A-Box</h2>
                <p className='text-xs font-semibold text-[#8a5f22] tracking-wide mt-1'>Specialized Ledger Intelligence</p>
                <p className='text-sm opacity-70 max-w-xl mt-2'>Built for Restaurants, Salons &amp; Barbershops, Tattoo Studios, Auto Repair &amp; Service Businesses. <span className='italic'>(Expanding to your industry soon)</span></p>
                <p className='text-sm opacity-70 max-w-xl'>One clean, reconciled ledger from your POS, vendor invoices, payroll reports, and bank feed — without the bloat of generic accounting software. Recording only: this system never moves money.</p>
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
                    <div className='text-[11px] tracking-widest uppercase font-semibold text-[#8a5f22]'>The whole box</div>
                    <p className='text-sm mt-1 opacity-80'>Every module is live: bank matching with check clearing, A/P &amp; the check register, delivery reconciliation, payroll journals, printable reports with the QuickBooks bridge, and the compliance calendar. Run more than one location? Switch or add from the picker in the header — each keeps its own isolated books with its own industry profile.</p>
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
        lapi.get('/api/daybook?from=' + monthStart + '&to=' + iso(today)).then((r) => setData(r.data)).catch(() => {});
        lapi.get('/api/reports/profit-loss?from=' + monthStart + '&to=' + iso(today)).then((r) => setPl(r.data)).catch(() => {});
    }
    useEffect(refresh, []);

    async function postDay() {
        if (!ack || busy) return;
        setBusy(true); setMsg(''); setErr('');
        try {
            const num = (s: string) => (s.trim() === '' ? 0 : Number(s));
            const r = await lapi.post('/api/ledger/daily-sales', { ack: true, business_date: form.business_date, food_sales: num(form.food_sales), beverage_sales: num(form.beverage_sales), sales_tax: num(form.sales_tax), cc_tips: num(form.cc_tips), cash_collected: num(form.cash_collected), processing_fees: num(form.processing_fees) });
            setMsg('Posted ' + r.data.journalNo + ' — ' + money(r.data.collected) + ' collected.');
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Posting failed'); }
        finally { setBusy(false); }
    }

    const kpis = data ? data.kpis : null;
    const verticalKpis: Array<{ key: string; label: string; value: number | null; warning: boolean }> = data?.verticalKpis || [];
    const fields: Array<[keyof typeof form, string]> = [['business_date', 'Business date'], ['food_sales', 'Food sales'], ['beverage_sales', 'Beverage sales'], ['sales_tax', 'Sales tax collected'], ['cc_tips', 'Card tips'], ['cash_collected', 'Cash collected'], ['processing_fees', 'Processing fees']];
    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <div className='flex items-baseline justify-between flex-wrap gap-2'>
                <h2 className='text-xl'>Daybook <span className='text-sm opacity-60'>· month to date</span></h2>
                {data?.profileLabel && <span className='text-xs bg-[#b68235]/10 text-[#8a5f22] rounded px-2 py-0.5'>{data.profileLabel}</span>}
                {data && data.unposted > 0 && <a href='#/scanner' className='text-sm text-[#8a5f22]'>{data.unposted} scanned invoice{data.unposted > 1 ? 's' : ''} not yet posted →</a>}
            </div>
            <section className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Cash on hand</div><div className='text-2xl tabular-nums mt-1'>{data ? money(data.cash) : '—'}</div></div>
                <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Revenue · MTD</div><div className='text-2xl tabular-nums mt-1'>{data ? money(data.totals.revenue) : '—'}</div></div>
                <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>Net income · MTD</div><div className='text-2xl tabular-nums mt-1'>{data ? money(data.totals.netIncome) : '—'}</div></div>
                {verticalKpis.map((kpi) => (
                    <div key={kpi.key} className={'border rounded p-4 bg-white/60 ' + (kpi.warning ? 'border-red-400' : 'border-[#e0ddd8]')}>
                        <div className='text-[11px] tracking-widest uppercase font-semibold' style={{ color: kpi.warning ? '#b91c1c' : '#8a5f22' }}>{kpi.label}</div>
                        <div className='text-2xl tabular-nums mt-1'>{kpi.value != null ? kpi.value.toFixed(1) + '%' : '—'}</div>
                        {kpi.warning && <div className='text-xs text-red-700 mt-0.5'>Above threshold</div>}
                    </div>
                ))}
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

    function refresh() { lapi.get('/api/bank/queue').then((r) => { setQueue(r.data.queue || []); setAccounts(r.data.accounts || []); }).catch(() => {}); }
    useEffect(refresh, []);

    async function importCsv() {
        if (!ack || busy || !csv.trim()) return;
        setBusy(true); setErr(''); setSum(null);
        try {
            const r = await lapi.post('/api/bank/import-auto', { ack: true, csv });
            setSum(r.data); setCsv('');
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Import failed'); }
        finally { setBusy(false); }
    }
    async function postLine(id: string) {
        const accountName = picks[id];
        if (!accountName) { setErr('Pick an account for that line first.'); return; }
        setErr('');
        try { await lapi.post('/api/bank/categorize', { ack: true, id, accountName }); refresh(); }
        catch (e) { setErr((e as { message?: string }).message || 'Posting failed'); }
    }
    async function ignoreLine(id: string) {
        try { await lapi.post('/api/bank/ignore', { id }); refresh(); }
        catch (e) { setErr((e as { message?: string }).message || 'Ignore failed'); }
    }

    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='border border-[#b68235] rounded p-4 bg-[#b68235]/5'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>Import bank activity</div>
                <p className='text-sm'>Download a CSV from your bank and paste it here. Supported formats: <span className='tabular-nums'>date,description,amount</span> (simple) &middot; <span className='tabular-nums'>date,description,amount,fee_amount</span> (extended) &middot; Wells Fargo/Chase style with Debit/Credit columns. Dates can be YYYY-MM-DD or MM/DD/YYYY. Card settlements, delivery payouts, and cash deposits auto-match to clearing; CHECK #1041 clears outstanding checks; fees post separately; everything else waits below for you to categorize. Re-imports skip duplicates.</p>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'date,description,amount\n2026-08-01,SYSCO DENVER PAYMENT,-1240.55\n2026-08-01,SQUARE INC DES:250801,1897.22\n\n— or Wells Fargo style: —\nDate,Description,Debit,Credit\n08/01/2026,SYSCO DENVER,1240.55,\n08/01/2026,SQUARE INC,,1897.22'} className='w-full mt-3 border border-[#e0ddd8] rounded p-2 text-xs font-mono bg-white min-h-[120px]' />
                <label className='flex items-center gap-2 mt-2 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    I have verified this export against my bank statement
                </label>
                <div className='flex items-center gap-3 mt-3 flex-wrap'>
                    <button onClick={importCsv} disabled={!ack || busy || !csv.trim()} className={ack && !busy && csv.trim() ? btnOn : btnOff}>{busy ? 'Importing…' : 'Import'}</button>
                    {sum && <span className='text-sm text-[#8a5f22]'>Format: {sum.format || 'simple'} · {sum.depositsMatched} deposit{sum.depositsMatched === 1 ? '' : 's'} auto-matched · {sum.queuedForReview} for review · {sum.duplicates} duplicate{sum.duplicates === 1 ? '' : 's'} skipped{sum.checksMatched ? ' · ' + sum.checksMatched + ' check' + (sum.checksMatched === 1 ? '' : 's') + ' cleared' : ''}{sum.feesPosted ? ' · ' + sum.feesPosted + ' fee' + (sum.feesPosted === 1 ? '' : 's') + ' posted' : ''}</span>}
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

// ── Delivery reconciliation ──
function Delivery() {
    const [csv, setCsv] = useState('');
    const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [stmts, setStmts] = useState<Array<Record<string, any>>>([]);

    function refresh() { lapi.get('/api/delivery/statements').then((r) => setStmts(r.data.statements || [])).catch(() => {}); }
    useEffect(refresh, []);

    async function importCsv() {
        if (!ack || busy || !csv.trim()) return;
        setBusy(true); setErr(''); setMsg('');
        try {
            const r = await lapi.post('/api/delivery/import', { ack: true, csv });
            setMsg(r.data.imported + ' statement' + (r.data.imported === 1 ? '' : 's') + ' reconciled and posted to the ledger.');
            setCsv(''); refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Import failed'); }
        finally { setBusy(false); }
    }

    return (
        <main className='max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='border border-[#b68235] rounded p-4 bg-[#b68235]/5'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>Import delivery payout statements</div>
                <p className='text-sm'>One row per platform payout period, exactly as the platform reports it: <span className='tabular-nums'>platform,period_start,period_end,gross_sales,commissions,marketing_fees,refunds,driver_tips,net_payout</span>. The reconciliation identity is enforced — net payout must equal gross − commissions − marketing − refunds, or the file is rejected. Driver tips are pass-through and recorded for reference only. Each statement posts one journal entry; bank matching later clears the payout from clearing into cash.</p>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'platform,period_start,period_end,gross_sales,commissions,marketing_fees,refunds,driver_tips,net_payout\nDoorDash,2026-07-21,2026-07-27,2140.50,428.10,64.22,35.00,180.00,1613.18'} className='w-full mt-3 border border-[#e0ddd8] rounded p-2 text-xs font-mono bg-white min-h-[110px]' />
                <label className='flex items-center gap-2 mt-2 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    These figures match the platform&apos;s own statement
                </label>
                <div className='flex items-center gap-3 mt-3 flex-wrap'>
                    <button onClick={importCsv} disabled={!ack || busy || !csv.trim()} className={ack && !busy && csv.trim() ? btnOn : btnOff}>{busy ? 'Importing…' : 'Reconcile + post'}</button>
                    {msg && <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1'><Check size={15} />{msg}</span>}
                    {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
                </div>
            </section>
            <section>
                <h2 className='text-lg mb-2'>Imported statements <span className='text-sm opacity-60'>· newest first</span></h2>
                {stmts.length === 0 ? <p className='text-sm opacity-60'>No statements yet — DoorDash, Uber Eats, and Grubhub payout periods land here once imported.</p> : (
                    <div className='overflow-x-auto border border-[#e0ddd8] rounded bg-white/60'>
                        <table className='text-sm w-full min-w-[720px]'>
                            <thead><tr className='text-left text-[11px] uppercase tracking-wide opacity-60'><th className='px-3 py-2'>Platform</th><th>Period</th><th className='text-right'>Gross</th><th className='text-right'>Commissions</th><th className='text-right'>Marketing</th><th className='text-right'>Refunds</th><th className='text-right'>Driver tips</th><th className='text-right pr-3'>Net payout</th><th className='text-right pr-3'>Eff. rate</th></tr></thead>
                            <tbody>
                                {stmts.map((s, i) => (
                                    <tr key={i} className='border-t border-[#e0ddd8]'>
                                        <td className='px-3 py-2'>{s.platform}</td>
                                        <td className='tabular-nums opacity-70'>{s.periodStart} → {s.periodEnd}</td>
                                        <td className='tabular-nums text-right'>{money(s.grossSales)}</td>
                                        <td className='tabular-nums text-right'>{money(s.commissions)}</td>
                                        <td className='tabular-nums text-right'>{money(s.marketingFees)}</td>
                                        <td className='tabular-nums text-right'>{money(s.refunds)}</td>
                                        <td className='tabular-nums text-right opacity-70'>{money(s.driverTips)}</td>
                                        <td className='tabular-nums text-right pr-3 text-[#8a5f22]'>{money(s.netPayout)}</td>
                                        <td className='tabular-nums text-right pr-3'>{s.effectiveRatePct == null ? '—' : s.effectiveRatePct.toFixed(1) + '%'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </main>
    );
}

// ── Payroll journal import ──
function Payroll() {
    const [csv, setCsv] = useState('');
    const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');

    async function importCsv() {
        if (!ack || busy || !csv.trim()) return;
        setBusy(true); setErr(''); setMsg('');
        try {
            const r = await lapi.post('/api/payroll/import', { ack: true, csv });
            setMsg(r.data.runs + ' pay run' + (r.data.runs === 1 ? '' : 's') + ': ' + r.data.entriesPosted + ' journal entr' + (r.data.entriesPosted === 1 ? 'y' : 'ies') + ' posted' + (r.data.entriesSkipped ? ', ' + r.data.entriesSkipped + ' already on the books (skipped)' : '') + '.');
            setCsv('');
        } catch (e) { setErr((e as { message?: string }).message || 'Import failed'); }
        finally { setBusy(false); }
    }

    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='border border-[#b68235] rounded p-4 bg-[#b68235]/5'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>Import payroll journal</div>
                <p className='text-sm'>Recording only: payroll is executed by your provider (Gusto, ADP, Paychex) — this books what the provider reports. One row per pay run: <span className='tabular-nums break-all'>pay_date,boh_gross,foh_gross,employer_fed_taxes,employer_futa,employer_sui_co,employer_famli,fed_withholding,co_withholding,employee_famli,net_pay_sweep,provider_remits_taxes</span>. Net pay must reconcile to gross minus employee withholdings. With <span className='tabular-nums'>provider_remits_taxes=true</span> a second entry sweeps the tax liabilities (full-service providers remit for you); with <span className='tabular-nums'>false</span> the liabilities stay on the books and feed the compliance calendar.</p>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'pay_date,boh_gross,foh_gross,employer_fed_taxes,employer_futa,employer_sui_co,employer_famli,fed_withholding,co_withholding,employee_famli,net_pay_sweep,provider_remits_taxes\n2026-07-31,8200.00,6400.00,1116.90,87.60,248.20,65.70,1752.00,642.00,65.70,12140.30,true'} className='w-full mt-3 border border-[#e0ddd8] rounded p-2 text-xs font-mono bg-white min-h-[110px]' />
                <label className='flex items-center gap-2 mt-2 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    These figures match my provider&apos;s pay-run summary
                </label>
                <div className='flex items-center gap-3 mt-3 flex-wrap'>
                    <button onClick={importCsv} disabled={!ack || busy || !csv.trim()} className={ack && !busy && csv.trim() ? btnOn : btnOff}><Send size={15} />{busy ? 'Posting…' : 'Post payroll journal'}</button>
                    {msg && <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1'><Check size={15} />{msg}</span>}
                    {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
                </div>
            </section>
            <section className='border border-[#e0ddd8] rounded bg-white/40 p-4 text-sm opacity-80'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>What gets posted</div>
                <p>Each run books wages to Kitchen (BOH) and Service (FOH), employer taxes to Payroll Taxes, and credits the payable accounts — Federal Payroll Taxes, FUTA, SUI (CO), FAMLI, CO Withholding — plus the net-pay cash sweep. Labor lands in prime cost on the Daybook and Reports immediately; open the General Journal on the Reports tab to see every line.</p>
            </section>
        </main>
    );
}

// ── Compliance calendar ──
const STATUS_STYLE: Record<string, string> = {
    OVERDUE: 'border-red-700 text-red-700',
    DUE_SOON: 'border-[#b68235] text-[#8a5f22]',
    UPCOMING: 'border-[#e0ddd8] text-[#767268]',
    FILED: 'border-[#e0ddd8] opacity-50'
};

function Compliance() {
    const [data, setData] = useState<Record<string, any> | null>(null);
    const [showFiled, setShowFiled] = useState(false);
    const [err, setErr] = useState('');

    function refresh(inclFiled: boolean) {
        lapi.get('/api/compliance/events' + (inclFiled ? '?include_filed=true' : '')).then((r) => setData(r.data)).catch(() => {});
    }
    useEffect(() => { refresh(showFiled); }, [showFiled]);

    async function setStatus(ev: Record<string, any>, status: string) {
        setErr('');
        try { await lapi.post('/api/compliance/update', { tax_type: ev.taxType, period_end: ev.periodEnd, status }); refresh(showFiled); }
        catch (e) { setErr((e as { message?: string }).message || 'Update failed'); }
    }

    const events: Array<Record<string, any>> = data ? data.events : [];
    const overdue = data ? (data.overdue || []).length : 0;
    return (
        <main className='max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <div className='flex items-baseline justify-between flex-wrap gap-2'>
                <div>
                    <h2 className='text-xl'>Compliance calendar</h2>
                    <p className='text-sm opacity-70 mt-1'>Colorado + federal filing deadlines. Estimated amounts come live from this location&apos;s liability balances as of each period end — no tax rates are hardcoded. Zero-balance overdue periods file themselves. This calendar tracks and reminds; it never files anything for you.</p>
                </div>
                <label className='text-xs flex items-center gap-2 cursor-pointer shrink-0'>
                    <input type='checkbox' checked={showFiled} onChange={(e) => setShowFiled(e.target.checked)} className='accent-[#b68235]' />
                    Show filed
                </label>
            </div>
            {overdue > 0 && <div className='border border-red-700 rounded p-3 bg-red-700/5 text-sm text-red-700'>{overdue} filing{overdue === 1 ? '' : 's'} overdue with a balance on the books — handle these first.</div>}
            {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
            {!data ? <p className='text-sm opacity-60'>Loading deadlines…</p> : events.length === 0 ? <p className='text-sm opacity-60'>Nothing due in the next 120 days.</p> : (
                <div className='overflow-x-auto border border-[#e0ddd8] rounded bg-white/60'>
                    <table className='text-sm w-full min-w-[680px]'>
                        <thead><tr className='text-left text-[11px] uppercase tracking-wide opacity-60'><th className='px-3 py-2'>Form</th><th>Filing</th><th>Period end</th><th>Due</th><th className='text-right'>Est. amount</th><th>Days</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            {events.map((ev) => (
                                <tr key={ev.taxType + ev.periodEnd} className='border-t border-[#e0ddd8]'>
                                    <td className='px-3 py-2'>{ev.form}</td>
                                    <td className='opacity-70'>{ev.taxType.replace(/_/g, ' ')}</td>
                                    <td className='tabular-nums'>{ev.periodEnd}</td>
                                    <td className='tabular-nums'>{ev.dueDate}</td>
                                    <td className='tabular-nums text-right'>{money(ev.estimatedAmount)}</td>
                                    <td className='tabular-nums'>{ev.daysRemaining < 0 ? Math.abs(ev.daysRemaining) + 'd late' : ev.daysRemaining + 'd'}</td>
                                    <td><span className={'text-[11px] border rounded-full px-2 ' + (STATUS_STYLE[ev.status] || STATUS_STYLE.UPCOMING)}>{ev.status.replace('_', ' ')}</span></td>
                                    <td className='pr-3 text-right'>
                                        {ev.status !== 'FILED'
                                            ? <button onClick={() => setStatus(ev, 'FILED')} className={btnOn + ' !px-3 !py-1'}>Mark filed</button>
                                            : <button onClick={() => setStatus(ev, 'UPCOMING')} className={btnOff + ' !px-3 !py-1 !cursor-pointer hover:bg-white'}>Reopen</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
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
    const [qbMonth, setQbMonth] = useState(iso(today).slice(0, 7));
    const [qbMsg, setQbMsg] = useState('');
    const [qbErr, setQbErr] = useState('');

    function run() {
        lapi.get('/api/reports/profit-loss?from=' + from + '&to=' + to).then((r) => setPl(r.data)).catch(() => {});
        lapi.get('/api/reports/balance-sheet?as_of=' + asOf).then((r) => setBs(r.data)).catch(() => {});
        lapi.get('/api/ledger/accounts?from=' + from + '&to=' + to).then((r) => setTb(r.data)).catch(() => {});
        lapi.get('/api/ledger/journal?from=' + from + '&to=' + to).then((r) => setJr(r.data)).catch(() => {});
    }
    useEffect(run, []);

    async function exportQb(path: string) {
        if (!qbMonth) { setQbErr('Pick a month first — QuickBooks exports are one month at a time.'); return; }
        if (!window.confirm('Export ' + qbMonth + ' for QuickBooks? You are exporting business records assembled by an autonomous pipeline — verify totals against your POS before accounting use.')) return;
        setQbErr(''); setQbMsg('');
        try {
            const r = await lapi.get(path + '?month=' + qbMonth + '&ack=true');
            download(r.data.filename, r.data.content, r.data.mimeType || 'text/plain');
            setQbMsg('Downloaded ' + r.data.filename + (r.data.lines ? ' (' + r.data.lines + ' lines)' : '') + '.');
        } catch (e) { setQbErr((e as { message?: string }).message || 'Export failed'); }
    }

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
            <section className='border border-[#e0ddd8] rounded bg-white/60 p-4 flex flex-col gap-2'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>QuickBooks bridge · optional</div>
                <p className='text-sm opacity-80'>One month at a time — QBO rejects larger imports and caps journal files at 1,000 lines. The CSV imports via Settings → Import Data → Journal Entries; the IIF file is for QuickBooks Desktop.</p>
                <div className='flex items-end gap-3 flex-wrap'>
                    <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>Month</span><input type='month' value={qbMonth} onChange={(e) => setQbMonth(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm' /></label>
                    <button onClick={() => exportQb('/api/export/qbo-journal')} className={btnOn}>QBO journal CSV</button>
                    <button onClick={() => exportQb('/api/export/iif')} className={btnOn}>IIF (QB Desktop)</button>
                    {qbMsg && <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1'><Check size={15} />{qbMsg}</span>}
                    {qbErr && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{qbErr}</span>}
                </div>
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

    function refresh() { lapi.get('/api/invoices').then((r) => setHist(r.data.invoices || [])).catch(() => {}); }
    useEffect(() => {
        api.get('/api/disclaimer').then((r) => setDisc(r.data.disclaimer)).catch(() => setDisc('Automated AI extraction. Verify every figure before posting to your books. Records data only; never moves money.'));
        refresh();
    }, []);

    async function onFile(f: File | null) {
        if (!f || !ack || busy) return;
        setBusy(true); setErr(''); setRes(null); setCopied(false); setLastId(null); setPostedNo('');
        try {
            const prep = await image.resizeIfNeeded(f);
            const r = await lapi.post('/api/invoices/scan', { image: prep.data, mimeType: prep.mimeType, ack: true });
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
            const r = await lapi.post('/api/invoices/post', { id: lastId, ack: true });
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
        lapi.get('/api/ap/aging').then((r) => setAging(r.data)).catch(() => {});
        lapi.get('/api/checks/register' + (filter ? '?status=' + filter : '')).then((r) => setChecks(r.data.checks || [])).catch(() => {});
    }
    useEffect(refresh, [filter]);

    async function pay() {
        if (!payFor || busy) return;
        if (!window.confirm('Record this payment? This books a payment you already made through your bank or by check - nothing is filed and no money moves. Verify the figures first.')) return;
        setBusy(true); setErr(''); setMsg('');
        try {
            const r = await lapi.post('/api/ap/pay', { ack: true, id: payFor.id, payment_date: payDate, check_number: payCheck.trim() || undefined });
            setMsg('Recorded: ' + (r.data.vendor || 'vendor') + (r.data.invoiceNo ? ' #' + r.data.invoiceNo : '') + ' - ' + money(r.data.amount) + ' via ' + r.data.method + (payCheck.trim() ? '. The check is now outstanding in the register.' : ''));
            setPayFor(null); setPayCheck('');
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Payment failed'); }
        finally { setBusy(false); }
    }
    async function setStatus(checkNumber: string, status: string) {
        setErr('');
        try { await lapi.post('/api/checks/register', { check_number: checkNumber, status }); refresh(); }
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

// ── POS daily-summary import (copy-paste CSV from Toast/Clover/Square) ──
function PosSummary() {
    const [csv, setCsv] = useState('');
    const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [history, setHistory] = useState<Array<Record<string, any>>>([]);

    function refresh() { lapi.get('/api/pos/summaries').then((r) => setHistory(r.data.summaries || [])).catch(() => {}); }
    useEffect(refresh, []);

    async function importCsv() {
        if (!ack || busy || !csv.trim()) return;
        setBusy(true); setErr(''); setMsg('');
        try {
            const r = await lapi.post('/api/pos/daily-summary', { ack: true, csv });
            setMsg(r.data.days + ' day' + (r.data.days === 1 ? '' : 's') + ' imported: ' + r.data.entriesPosted + ' posted' + (r.data.entriesSkipped ? ', ' + r.data.entriesSkipped + ' already on books (skipped)' : '') + '.');
            setCsv(''); refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Import failed'); }
        finally { setBusy(false); }
    }

    return (
        <main className='max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='border border-[#b68235] rounded p-4 bg-[#b68235]/5'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>Import POS daily summaries</div>
                <p className='text-sm'>Copy-paste the daily summary CSV export from your POS system (Toast, Clover, Square, or Other). No API keys needed — just export the report and paste it here. One row per business date with real category splits. The header must be exactly:</p>
                <p className='text-xs font-mono mt-1 opacity-80 break-all'>source_pos,business_date,food_sales,beverage_sales,sales_tax,cc_tips,cash_drops,gift_cards,processing_fees,actual_cash_drop</p>
                <p className='text-sm mt-2'>The <span className='font-mono text-xs'>actual_cash_drop</span> column is optional (leave blank if you don&apos;t count the drawer). If present, the difference from expected cash posts to Cash Over/Short. Card collections debit Other Tender Clearing net of processing fees; the bank feed clears them later.</p>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'source_pos,business_date,food_sales,beverage_sales,sales_tax,cc_tips,cash_drops,gift_cards,processing_fees,actual_cash_drop\nToast,2026-08-01,4280.50,1120.00,378.04,620.00,1200.00,45.00,89.50,1195.00\nToast,2026-08-02,3950.00,980.00,345.10,540.00,1100.00,30.00,82.00,'} className='w-full mt-3 border border-[#e0ddd8] rounded p-2 text-xs font-mono bg-white min-h-[120px]' />
                <label className='flex items-center gap-2 mt-2 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    I have verified these figures against my POS daily reports
                </label>
                <div className='flex items-center gap-3 mt-3 flex-wrap'>
                    <button onClick={importCsv} disabled={!ack || busy || !csv.trim()} className={ack && !busy && csv.trim() ? btnOn : btnOff}><Send size={15} />{busy ? 'Posting…' : 'Import + post to books'}</button>
                    {msg && <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1'><Check size={15} />{msg}</span>}
                    {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
                </div>
            </section>
            <section>
                <h2 className='text-lg mb-2'>Posted summaries <span className='text-sm opacity-60'>· newest first</span></h2>
                {history.length === 0 ? <p className='text-sm opacity-60'>No POS summaries posted yet.</p> : (
                    <ul className='divide-y divide-[#e0ddd8] border border-[#e0ddd8] rounded bg-white/60'>
                        {history.map((h) => (
                            <li key={h.journalNo} className='px-4 py-2 text-sm flex justify-between gap-3'>
                                <span className='text-[#8a5f22]'>{h.journalNo}</span>
                                <span className='tabular-nums opacity-60'>{h.date}</span>
                                <span className='flex-1 min-w-0 opacity-70'>{h.description}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section className='border border-[#e0ddd8] rounded bg-white/40 p-4 text-sm opacity-80'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>How to get the CSV</div>
                <p><strong>Toast:</strong> Reports → Sales Summary → Export CSV. Rearrange columns to match the header above.</p>
                <p className='mt-1'><strong>Clover:</strong> Reports → Daily Summary → Download. Map columns to the format.</p>
                <p className='mt-1'><strong>Square:</strong> Sales → Reports → Daily Summary → Export. Adjust column order.</p>
                <p className='mt-1'>If your POS is not listed, use <span className='font-mono text-xs'>Other</span> as the source_pos value.</p>
            </section>
        </main>
    );
}

// ── Physical inventory count ──
function Inventory() {
    const [countDate, setCountDate] = useState(iso(new Date()));
    const [food, setFood] = useState('');
    const [bev, setBev] = useState('');
    const [paper, setPaper] = useState('');
    const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [history, setHistory] = useState<Array<Record<string, any>>>([]);

    function refresh() { lapi.get('/api/inventory/counts').then((r) => setHistory(r.data.counts || [])).catch(() => {}); }
    useEffect(refresh, []);

    async function submit() {
        if (!ack || busy) return;
        setBusy(true); setErr(''); setMsg('');
        try {
            const body: Record<string, any> = { ack: true, count_date: countDate };
            if (food.trim() !== '') body.food_count = Number(food);
            if (bev.trim() !== '') body.beverage_count = Number(bev);
            if (paper.trim() !== '') body.paper_count = Number(paper);
            const r = await lapi.post('/api/inventory/count', body);
            const v = r.data.variances || {};
            const parts = Object.entries(v).filter(([, val]) => (val as number) !== 0).map(([k, val]) => k + ': ' + (val as number > 0 ? '+' : '') + money(val as number));
            setMsg('Count recorded' + (r.data.adjusted ? ' — adjustment posted: ' + parts.join(', ') : ' — no variances, nothing to adjust.'));
            setFood(''); setBev(''); setPaper(''); setAck(false);
            refresh();
        } catch (e) { setErr((e as { message?: string }).message || 'Count failed'); }
        finally { setBusy(false); }
    }

    return (
        <main className='max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6'>
            <section className='border border-[#b68235] rounded p-4 bg-[#b68235]/5'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>Record physical inventory count</div>
                <p className='text-sm'>Count what is actually on the shelf. The system compares your count to the ledger balance (beginning inventory + purchases) and posts any variance to a dedicated COGS adjustment account. Shrink and waste stay visible separately from purchases. Leave a category blank to skip it.</p>
                <div className='grid gap-3 sm:grid-cols-4 mt-3'>
                    <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>Count date</span><input type='date' value={countDate} onChange={(e) => setCountDate(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm tabular-nums' /></label>
                    <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>Food inventory ($)</span><input type='number' step='0.01' min='0' value={food} onChange={(e) => setFood(e.target.value)} placeholder='e.g. 4200.00' className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm tabular-nums' /></label>
                    <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>Beverage inventory ($)</span><input type='number' step='0.01' min='0' value={bev} onChange={(e) => setBev(e.target.value)} placeholder='e.g. 1800.00' className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm tabular-nums' /></label>
                    <label className='text-xs flex flex-col gap-1'><span className='opacity-70'>Paper &amp; packaging ($)</span><input type='number' step='0.01' min='0' value={paper} onChange={(e) => setPaper(e.target.value)} placeholder='e.g. 350.00' className='border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm tabular-nums' /></label>
                </div>
                <label className='flex items-center gap-2 mt-3 text-sm cursor-pointer'>
                    <input type='checkbox' checked={ack} onChange={(e) => setAck(e.target.checked)} className='accent-[#b68235]' />
                    I have physically counted these items and verified the dollar values
                </label>
                <div className='flex items-center gap-3 mt-3 flex-wrap'>
                    <button onClick={submit} disabled={!ack || busy} className={ack && !busy ? btnOn : btnOff}><Send size={15} />{busy ? 'Recording…' : 'Record count'}</button>
                    {msg && <span className='text-sm text-[#8a5f22] inline-flex items-center gap-1'><Check size={15} />{msg}</span>}
                    {err && <span className='text-sm text-red-700 inline-flex items-center gap-1'><AlertTriangle size={14} />{err}</span>}
                </div>
            </section>
            <section>
                <h2 className='text-lg mb-2'>Count history <span className='text-sm opacity-60'>· newest first</span></h2>
                {history.length === 0 ? <p className='text-sm opacity-60'>No counts recorded yet.</p> : (
                    <div className='overflow-x-auto border border-[#e0ddd8] rounded bg-white/60'>
                        <table className='text-sm w-full min-w-[500px]'>
                            <thead><tr className='text-left text-[11px] uppercase tracking-wide opacity-60'><th className='px-3 py-2'>Date</th><th>Food var.</th><th>Bev. var.</th><th>Paper var.</th><th>Adjusted</th></tr></thead>
                            <tbody>
                                {history.map((c) => (
                                    <tr key={c.countDate} className='border-t border-[#e0ddd8]'>
                                        <td className='px-3 py-2 tabular-nums'>{c.countDate}</td>
                                        <td className='tabular-nums'>{c.variances?.food != null ? money(c.variances.food) : '—'}</td>
                                        <td className='tabular-nums'>{c.variances?.beverage != null ? money(c.variances.beverage) : '—'}</td>
                                        <td className='tabular-nums'>{c.variances?.paper != null ? money(c.variances.paper) : '—'}</td>
                                        <td>{c.adjusted ? '✓' : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
            <section className='border border-[#e0ddd8] rounded bg-white/40 p-4 text-sm opacity-80'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>How it works</div>
                <p>Positive variance means the ledger shows more than the shelf (product was used or lost — COGS goes up, inventory goes down). Negative variance means the shelf has more than expected (COGS goes down). The adjustment posts to dedicated accounts so operational purchases stay separate from shrink/waste corrections.</p>
            </section>
        </main>
    );
}

function Reconciliation() {
    const today = new Date();
    const monthStart = iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
    const [data, setData] = useState<Record<string, any> | null>(null);
    const [from, setFrom] = useState(monthStart);
    const [to, setTo] = useState(iso(today));
    const [err, setErr] = useState('');
    function load() {
        setErr('');
        lapi.get('/api/reconciliation?from=' + from + '&to=' + to).then((r) => setData(r.data)).catch((e) => setErr((e as { message?: string }).message || 'Failed to load'));
    }
    useEffect(load, []);
    const status = data?.status;
    const statusColor = status === 'RECONCILED' ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200';
    return (
        <main className='max-w-4xl mx-auto px-6 py-10 flex flex-col gap-6'>
            <h2 className='text-2xl'>Reconciliation Dashboard</h2>
            <p className='text-sm opacity-70'>Compare Bank vs. Books vs. POS Daily Summary totals to identify cash and tender mismatches.</p>
            <div className='flex gap-3 items-end flex-wrap'>
                <label className='flex flex-col text-xs'><span className='opacity-60 mb-1'>From</span><input type='date' value={from} onChange={(e) => setFrom(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 text-sm' /></label>
                <label className='flex flex-col text-xs'><span className='opacity-60 mb-1'>To</span><input type='date' value={to} onChange={(e) => setTo(e.target.value)} className='border border-[#e0ddd8] rounded px-2 py-1.5 text-sm' /></label>
                <button onClick={load} className={btnOn}>Reconcile</button>
            </div>
            {err && <p className='text-red-700 text-sm'>{err}</p>}
            {data && (
                <>
                    <div className={'border rounded p-3 text-center font-semibold text-sm ' + statusColor}>
                        {status === 'RECONCILED' ? '\u2713 All sources reconciled for this period' : '\u26A0 Discrepancies found \u2014 review below'}
                    </div>
                    <div className='grid gap-4 sm:grid-cols-3'>
                        <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'>
                            <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-2'>Bank Statement</div>
                            <p className='text-sm'>Deposits: <strong>{money(data.bank?.deposits)}</strong></p>
                            <p className='text-sm'>Withdrawals: <strong>{money(data.bank?.withdrawals)}</strong></p>
                            <p className='text-sm'>Net: <strong>{money(data.bank?.net)}</strong></p>
                            <p className='text-xs opacity-60 mt-1'>{data.bank?.lineCount} lines imported</p>
                        </div>
                        <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'>
                            <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-2'>Books (Ledger)</div>
                            <p className='text-sm'>Cash Balance: <strong>{money(data.books?.cashBalance)}</strong></p>
                            <p className='text-sm'>Clearing Balance: <strong>{money(data.books?.clearingBalance)}</strong></p>
                        </div>
                        <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'>
                            <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-2'>POS Summary</div>
                            <p className='text-sm'>Revenue: <strong>{money(data.pos?.revenue)}</strong></p>
                            <p className='text-sm'>Cash Collected: <strong>{money(data.pos?.cashCollected)}</strong></p>
                            <p className='text-sm'>Card Collected: <strong>{money(data.pos?.cardCollected)}</strong></p>
                            <p className='text-xs opacity-60 mt-1'>{data.pos?.dayCount} days posted</p>
                        </div>
                    </div>
                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div className='border border-[#e0ddd8] rounded p-4 bg-white/60'>
                            <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-2'>Outstanding Checks</div>
                            <p className='text-sm'>Total: <strong>{money(data.outstanding?.checks)}</strong> ({data.outstanding?.checkCount} checks)</p>
                        </div>
                        <div className={'border rounded p-4 ' + (data.mismatches?.total > 0 ? 'border-red-200 bg-red-50' : 'border-[#e0ddd8] bg-white/60')}>
                            <div className='text-[11px] tracking-widest uppercase font-semibold mb-2' style={{ color: data.mismatches?.total > 0 ? '#b91c1c' : '#8a5f22' }}>Mismatches</div>
                            <p className='text-sm'>Cash: <strong>{money(data.mismatches?.cash)}</strong></p>
                            <p className='text-sm'>Card: <strong>{money(data.mismatches?.card)}</strong></p>
                            <p className='text-sm font-semibold mt-1'>Total Variance: {money(data.mismatches?.total)}</p>
                        </div>
                    </div>
                </>
            )}
        </main>
    );
}

function Settings() {
    const [verticals, setVerticals] = useState<Array<Record<string, any>>>([]);
    const [active, setActive] = useState<Record<string, any> | null>(null);
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        lapi.get('/api/verticals').then((r) => setVerticals(r.data.verticals || [])).catch(() => {});
        lapi.get('/api/verticals/active').then((r) => setActive(r.data)).catch(() => {});
    }, []);
    async function switchProfile(id: string) {
        if (busy) return;
        setBusy(true); setMsg('');
        try {
            const r = await lapi.post('/api/verticals/set', { profile_id: id });
            setMsg('Switched to ' + r.data.label + (r.data.newAccountsAdded > 0 ? ' (' + r.data.newAccountsAdded + ' new accounts added)' : ''));
            setActive({ profileId: id, label: r.data.label });
        } catch (e) { setMsg((e as { message?: string }).message || 'Failed'); }
        finally { setBusy(false); }
    }
    return (
        <main className='max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6'>
            <h2 className='text-2xl'>Settings &amp; Industry Profile</h2>
            <p className='text-sm opacity-70'>Select the industry profile for this location. This configures your Chart of Accounts, KPI definitions, and category routing.</p>
            {active && <p className='text-sm'>Current profile: <strong>{active.label || active.profileId}</strong></p>}
            <div className='grid gap-4 sm:grid-cols-2'>
                {verticals.map((v) => (
                    <div key={v.id} className={'border rounded p-4 flex flex-col gap-2 ' + (active?.profileId === v.id ? 'border-[#b68235] bg-[#b68235]/5' : 'border-[#e0ddd8] bg-white/60')}>
                        <div className='text-sm font-semibold'>{v.label}</div>
                        <p className='text-xs opacity-70'>{v.description}</p>
                        <p className='text-xs opacity-60'>{v.accountCount} accounts &middot; KPIs: {(v.kpis || []).join(', ')}</p>
                        {active?.profileId !== v.id && <button onClick={() => switchProfile(v.id)} disabled={busy} className={btnOn + ' mt-auto self-start text-xs'}>Activate</button>}
                        {active?.profileId === v.id && <span className='text-xs text-[#8a5f22] font-semibold mt-auto'>\u2713 Active</span>}
                    </div>
                ))}
            </div>
            {msg && <p className='text-sm mt-2'>{msg}</p>}
            <section className='border border-[#e0ddd8] rounded bg-white/40 p-4 text-sm opacity-80 mt-4'>
                <div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold mb-1'>How profiles work</div>
                <p>Each industry profile provides a specialized Chart of Accounts and KPI definitions tuned to that business type. Switching profiles adds any missing accounts to your ledger without removing existing ones. Your posted entries are never affected.</p>
            </section>
        </main>
    );
}

const GUIDE_KB: Array<{ keys: string[]; a: string }> = [
    { keys: ['bank', 'statement'], a: 'Bank CSV is exactly three columns: date,description,amount (dates YYYY-MM-DD; deposits positive, spending negative). Card settlements, delivery payouts, and cash deposits auto-match to clearing accounts; a withdrawal like CHECK #1041 clears a matching outstanding check; everything else waits in the review queue for you to categorize.' },
    { keys: ['scan', 'invoice', 'photo', 'ocr'], a: 'On the Invoice Scanner tab, photograph a supplier invoice and the AI extracts the line items - amounts it cannot read are flagged, never guessed. Review, then Post to books to record it as Accounts Payable.' },
    { keys: ['aging', 'bill', 'vendor', 'payable', 'a/p', 'ap '], a: 'A/P & Checks bins unpaid posted invoices 0-15 / 16-30 / 31+ days by invoice date. Record payment books the payment (debit Accounts Payable, credit Cash) - this app never moves money. Paying by check also registers the check as outstanding.' },
    { keys: ['check', 'register', 'void', 'outstanding'], a: 'The check register tracks every check: outstanding, cleared, amount mismatch, or void. Import bank activity containing Check #123 withdrawals and matching outstanding checks clear automatically; mismatched amounts are flagged.' },
    { keys: ['delivery', 'doordash', 'uber', 'grubhub', 'payout'], a: 'The Delivery tab records platform payout statements. The identity net_payout = gross - commissions - marketing - refunds is enforced; each statement posts one journal entry, and the payout waits in Delivery Payout Clearing until the bank feed clears it. Driver tips are pass-through and never posted.' },
    { keys: ['payroll', 'wages', 'gusto', 'adp', 'paychex', 'pay run'], a: 'The Payroll tab records what your payroll provider reports - this app never runs payroll. Each run books BOH/FOH wages, employer taxes, and the payable accounts. provider_remits_taxes=true adds a remittance sweep; false leaves liabilities on the books, feeding the compliance calendar.' },
    { keys: ['compliance', 'deadline', 'tax', 'famli', 'dr 0100', 'dr 1094', 'uitr', '941', '940', 'filing'], a: 'The Compliance tab tracks CO + federal deadlines: DR 0100 (sales tax, monthly), DR 1094 (withholding, monthly), FAMLI and UITR-1 (quarterly), Form 941 (quarterly), Form 940 (annual). Estimated amounts come live from the liability balances on your books. Mark filed when you file; overdue periods with zero balance file themselves. It reminds - it never files for you.' },
    { keys: ['quickbooks', 'qbo', 'iif', 'export'], a: 'QuickBooks is optional. On the Reports tab, export a month as a QBO journal CSV (Settings > Import Data > Journal Entries; 1,000-line cap) or as IIF for QuickBooks Desktop. One month at a time - QBO rejects larger imports.' },
    { keys: ['location', 'restaurant', 'workspace', 'multi', 'switch'], a: 'Each location keeps its own isolated books - journal, bank queue, A/P, delivery, payroll, compliance, and reports are all scoped to the active location. Switch or add locations from the picker in the header; the page reloads into that location’s books.' },
    { keys: ['daily', 'sales', 'daybook'], a: 'Post each day of sales on the Daybook tab: food, beverage, tax, tips, cash, and processing fees become one balanced journal entry. That feeds cash, the P&L, and prime cost.' },
    { keys: ['p&l', 'profit', 'report', 'balance sheet', 'trial', 'journal', 'print'], a: 'Reports covers P&L, Balance Sheet, Trial Balance, and the General Journal. Use Print for a clean paper copy. The Balance Sheet self-checks: assets must equal liabilities + equity.' },
    { keys: ['prime', 'kpi', 'food cost', 'labor'], a: 'Prime cost = COGS + labor as a percent of revenue; the industry warning line is 65%. Food and beverage cost percentages compare each cost to its own sales line.' },
    { keys: ['money', 'move', 'file', 'safe'], a: 'Recording only: this system never moves money and never files anything. Every posting needs your explicit confirmation, and AI-read amounts are flagged when uncertain - never guessed.' },
    { keys: ['pos', 'toast', 'clover', 'square', 'daily summary', 'pos import'], a: 'The POS Import tab accepts daily summary CSVs from Toast, Clover, Square, or any POS. No API keys needed - just export the daily report and paste it. The header is: source_pos,business_date,food_sales,beverage_sales,sales_tax,cc_tips,cash_drops,gift_cards,processing_fees,actual_cash_drop. Each row posts a balanced journal entry splitting cash vs card, revenue by category, and liabilities.' },
    { keys: ['inventory', 'count', 'shrink', 'waste', 'shelf', 'physical'], a: 'The Inventory tab records physical counts. Enter the dollar value on the shelf for food, beverage, and/or paper. The system compares to the ledger balance (beginning inventory + purchases) and posts any variance to a dedicated COGS adjustment account. Positive variance = shrink/waste (COGS up); negative = shelf has more than expected (COGS down). Adjustments stay separate from operational purchases.' }
];

function Guide({ view }: { view: string }) {
    const [open, setOpen] = useState(false);
    const [steps, setSteps] = useState<Array<{ done: boolean; label: string; hash: string }> | null>(null);
    const [q, setQ] = useState('');
    const [a, setA] = useState('');
    const [thinking, setThinking] = useState(false);
    const [history, setHistory] = useState<Array<{ role: string; text: string }>>([]);
    useEffect(() => {
        if (!open || steps) return;
        const today = new Date();
        const from = iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
        const settle = (p: Promise<{ data: Record<string, any> }>) => p.then((r) => r.data).catch(() => null);
        Promise.all([
            settle(lapi.get('/api/daybook?from=' + from + '&to=' + iso(today))),
            settle(lapi.get('/api/bank/queue')),
            settle(lapi.get('/api/ap/aging')),
            settle(lapi.get('/api/compliance/events')),
            settle(lapi.get('/api/reports/balance-sheet?as_of=' + iso(today)))
        ]).then(([d, b, ap, comp, bs]) => {
            const qn = b && b.queue ? (b.queue as Array<unknown>).length : 0;
            const un = d ? Number(d.unposted) || 0 : 0;
            const od = comp && comp.overdue ? (comp.overdue as Array<unknown>).length : 0;
            setSteps([
                { done: !!(d && d.totals && d.totals.revenue > 0), label: 'Post daily sales (this month)', hash: '#/daybook' },
                { done: un === 0, label: un > 0 ? 'Post scanned invoices (' + un + ' waiting)' : 'Post scanned invoices', hash: '#/scanner' },
                { done: qn === 0, label: qn > 0 ? 'Clear the bank review queue (' + qn + ')' : 'Clear the bank review queue', hash: '#/bank' },
                { done: !!(ap && !((ap.bins || []) as Array<Record<string, any>>).some((x) => ((x.invoices || []) as Array<Record<string, any>>).some((i) => i.pastDue))), label: 'No bills past due', hash: '#/ap' },
                { done: od === 0, label: od > 0 ? 'Tax filings overdue (' + od + ')' : 'No tax deadlines overdue', hash: '#/compliance' },
                { done: !!(bs && bs.balanced), label: 'Books in balance', hash: '#/reports' }
            ]);
        });
    }, [open]);
    const tips: Record<string, string> = {
        bank: 'Import a statement, then work the review queue to zero - unrecognized lines are parked, never posted.',
        ap: 'Watch the 31+ day bin. Recording a check payment also adds it to the register as outstanding.',
        delivery: 'The payout identity is enforced on import - if a statement rejects, the platform\'s own math does not reconcile.',
        payroll: 'Import each pay run from your provider\'s report. Liabilities left on the books feed the compliance calendar.',
        compliance: 'Estimated amounts are live liability balances - post payroll and daily sales first, then trust these numbers.',
        reports: 'Pick a period, then Print gives you a clean paper copy. The QuickBooks bridge below exports one month at a time.',
        scanner: 'Photograph the whole invoice in good light; blurry amounts come back flagged, never guessed.',
        daybook: 'One balanced journal entry per business day - post it after close.',
        'pos-summary': 'Export the daily summary CSV from your POS (Toast, Clover, Square) and paste it here. No API keys needed - just the numbers from your daily report.',
        inventory: 'Count what is on the shelf and enter the dollar value. The system calculates the variance from the ledger and posts a COGS adjustment automatically.',
        reconciliation: 'This view compares Bank vs Books vs POS to find tender mismatches. Run it after importing both your bank statement and POS daily summaries.',
        settings: 'Choose your industry profile here. It configures the Chart of Accounts and KPIs for your business type.',
        home: 'Work left to right: Daybook, POS Import, Bank, A/P, Delivery, Payroll, Inventory, Reports, Compliance, Reconcile. Open me anytime for the closing checklist.'
    };
    const [suggestions, setSuggestions] = useState<string[]>([]);
    async function ask(e: { preventDefault: () => void }) {
        e.preventDefault();
        const s = q.trim();
        if (!s || thinking) return;
        const newHistory = [...history, { role: 'user', text: s }];
        setHistory(newHistory);
        setQ(''); setA(''); setThinking(true); setSuggestions([]);
        try {
            // Send conversation history for multi-turn context
            const r = await lapi.post('/api/guide/ask', { question: s, conversation_history: newHistory.slice(-16) });
            const answer = r.data.answer || 'I could not generate a response.';
            const sug: string[] = r.data.suggestions || [];
            setA(answer);
            setSuggestions(sug);
            setHistory((h) => [...h, { role: 'assistant', text: answer }]);
        } catch {
            // Fallback to local KB if AI is unavailable
            const lower = s.toLowerCase();
            const hit = GUIDE_KB.find((k) => k.keys.some((key) => lower.includes(key)));
            const fallback = hit ? hit.a : 'I could not reach the AI assistant right now. Try asking about: bank import, invoice scanning, aging, checks, delivery, payroll, compliance, QuickBooks, locations, daily sales, reports, reconciliation, or prime cost.';
            setA(fallback);
            setSuggestions(['What are my KPIs?', 'How much cash do I have?', 'Do I have any overdue bills?']);
            setHistory((h) => [...h, { role: 'assistant', text: fallback }]);
        } finally { setThinking(false); }
    }
    function askSuggestion(text: string) {
        setQ(text);
        // Auto-submit the suggestion
        const newHistory = [...history, { role: 'user', text }];
        setHistory(newHistory);
        setThinking(true); setSuggestions([]);
        lapi.post('/api/guide/ask', { question: text, conversation_history: newHistory.slice(-16) }).then((r) => {
            const answer = r.data.answer || 'I could not generate a response.';
            setA(answer); setSuggestions(r.data.suggestions || []);
            setHistory((h) => [...h, { role: 'assistant', text: answer }]);
        }).catch(() => {
            setA('I could not reach the AI assistant right now.');
            setSuggestions([]);
            setHistory((h) => [...h, { role: 'assistant', text: 'Connection failed.' }]);
        }).finally(() => { setThinking(false); setQ(''); });
    }
    const next = steps ? steps.find((s) => !s.done) : null;
    return (
        <>
            <button onClick={() => setOpen(!open)} aria-expanded={open} className='fixed right-5 bottom-5 z-40 border border-[#b68235] text-[#8a5f22] bg-[#fbfaf9] rounded-full px-4 py-2 text-sm shadow-md hover:bg-[#b68235]/10 flex items-center gap-2'><Send size={14} /> Ask Your Bookkeeper</button>
            {open && (
                <div className='fixed right-5 bottom-16 z-40 w-96 max-w-[calc(100vw-40px)] max-h-[80vh] overflow-y-auto bg-[#fbfaf9] border border-[#e0ddd8] rounded-lg shadow-lg p-4 flex flex-col gap-3'>
                    <div><div className='text-[11px] tracking-widest uppercase text-[#8a5f22] font-semibold'>AI Bookkeeper Assistant</div><h3 className='text-lg'>Ask me anything about your books</h3></div>
                    {tips[view] && <p className='text-xs opacity-70 italic'>{tips[view]}</p>}
                    <div>
                        {!steps ? <p className='text-xs opacity-60'>Checking your books\u2026</p> : steps.map((s) => (
                            <div key={s.label} className='flex items-center gap-2 py-1.5 border-b border-[#e0ddd8] last:border-b-0 text-sm'>
                                <span className={'w-2 h-2 rounded-full border border-[#b68235] shrink-0 ' + (s.done ? 'bg-[#b68235]' : '')}></span>
                                <span className={s.done ? 'opacity-50 line-through' : ''}>{s.label}</span>
                                {!s.done && <a href={s.hash} className='ml-auto text-xs text-[#8a5f22] shrink-0'>go \u2192</a>}
                            </div>
                        ))}
                        {steps && (next ? <p className='text-sm mt-2'><strong>Next up:</strong> {next.label} <a href={next.hash} className='text-[#8a5f22]'>open \u2192</a></p> : <p className='text-sm mt-2'>All clear - the books are closed up. \u2726</p>)}
                    </div>
                    {history.length > 0 && (
                        <div className='border-t border-[#e0ddd8] pt-2 flex flex-col gap-2 max-h-48 overflow-y-auto'>
                            {history.slice(-6).map((m, i) => (
                                <div key={i} className={'text-sm rounded px-2 py-1.5 ' + (m.role === 'user' ? 'bg-[#b68235]/10 text-right' : 'bg-white border border-[#e0ddd8]')}>
                                    {m.text}
                                </div>
                            ))}
                        </div>
                    )}
                    <form onSubmit={ask} className='flex gap-2'>
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={thinking ? 'Thinking\u2026' : 'Ask about your finances, KPIs, variances\u2026'} aria-label='Ask the bookkeeper' disabled={thinking} className='flex-1 border border-[#e0ddd8] rounded px-2 py-1.5 bg-white text-sm disabled:opacity-50' />
                        <button type='submit' disabled={thinking} className={thinking ? btnOff + ' !px-3 !py-1' : btnOn + ' !px-3 !py-1'}><Send size={14} /></button>
                    </form>
                    {suggestions.length > 0 && (
                        <div className='flex flex-wrap gap-1.5'>
                            {suggestions.map((s, i) => (
                                <button key={i} onClick={() => askSuggestion(s)} className='text-xs border border-[#b68235]/40 text-[#8a5f22] rounded-full px-2.5 py-1 hover:bg-[#b68235]/10 transition-colors'>{s}</button>
                            ))}
                        </div>
                    )}
                    {a && !history.length && <p className='text-sm'>{a}</p>}
                </div>
            )}
        </>
    );
}

// ── Getting Started Onboarding Wizard ──
function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
    const [step, setStep] = useState(1);
    const [businessName, setBusinessName] = useState('');
    const [selectedProfile, setSelectedProfile] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const profiles = [
        { id: 'restaurant', label: 'Restaurant & Food Service', icon: '\uD83C\uDF7D\uFE0F', desc: 'Full-service, fast-casual, food trucks, catering. Tracks food/bev COGS, prime cost, waste, and tip reconciliation.' },
        { id: 'salon', label: 'Salon & Barbershop', icon: '\u2702\uFE0F', desc: 'Hair salons, barbershops, nail studios, spas. Tracks booth rental, commission splits, retail product margins.' },
        { id: 'tattoo', label: 'Tattoo & Piercing Studio', icon: '\uD83C\uDFA8', desc: 'Tattoo parlors, piercing studios, body art. Tracks artist percentage splits, supply costs, aftercare retail.' },
        { id: 'auto_repair', label: 'Auto Repair & Service', icon: '\uD83D\uDD27', desc: 'Mechanical shops, tire shops, body shops. Tracks parts vs labor COGS, sublet repairs, warranty claims.' }
    ];

    async function finish() {
        if (!selectedProfile || !businessName.trim()) return;
        setBusy(true); setErr('');
        try {
            // Create the location with the business name and selected profile
            const r = await api.post('/api/locations', { name: businessName.trim() });
            const locId = String(r.data.id);
            localStorage.setItem('rb_location', locId);
            // Set the vertical profile
            await api.post('/api/verticals/set', { location_id: locId, profile_id: selectedProfile });
            // Mark onboarding complete
            localStorage.setItem('rb_onboarded', 'true');
            onComplete();
        } catch (e) {
            setErr((e as { message?: string }).message || 'Setup failed. Please try again.');
        } finally { setBusy(false); }
    }

    return (
        <div className='fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4'>
            <div className='bg-[#faf9f7] rounded-xl shadow-2xl max-w-lg w-full p-8 flex flex-col gap-6'>
                <div className='text-center'>
                    <Crate size={48} />
                    <h1 className='text-2xl mt-3'>Welcome to <strong>1st Bookkeeper-In-A-Box</strong></h1>
                    <p className='text-sm opacity-70 mt-1'>Specialized Ledger Intelligence \u2014 let\u2019s set up your books in 30 seconds.</p>
                </div>
                {step === 1 && (
                    <div className='flex flex-col gap-4'>
                        <label className='text-sm font-semibold'>What\u2019s your business name?</label>
                        <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder='e.g. Main Street Barbershop' className='border border-[#e0ddd8] rounded px-3 py-2 bg-white text-sm' autoFocus />
                        <button onClick={() => { if (businessName.trim()) setStep(2); }} disabled={!businessName.trim()} className={businessName.trim() ? btnOn : btnOff}>Next \u2192</button>
                    </div>
                )}
                {step === 2 && (
                    <div className='flex flex-col gap-4'>
                        <label className='text-sm font-semibold'>What type of business do you run?</label>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            {profiles.map((p) => (
                                <button key={p.id} onClick={() => setSelectedProfile(p.id)} className={'border rounded-lg p-3 text-left transition-all ' + (selectedProfile === p.id ? 'border-[#b68235] bg-[#b68235]/10 ring-2 ring-[#b68235]/30' : 'border-[#e0ddd8] hover:border-[#b68235]/50')}>
                                    <div className='text-lg'>{p.icon} <span className='text-sm font-semibold'>{p.label}</span></div>
                                    <p className='text-xs opacity-70 mt-1'>{p.desc}</p>
                                </button>
                            ))}
                        </div>
                        <div className='flex gap-3'>
                            <button onClick={() => setStep(1)} className='text-sm opacity-60 hover:opacity-100'>\u2190 Back</button>
                            <button onClick={() => { if (selectedProfile) setStep(3); }} disabled={!selectedProfile} className={selectedProfile ? btnOn + ' flex-1' : btnOff + ' flex-1'}>Next \u2192</button>
                        </div>
                    </div>
                )}
                {step === 3 && (
                    <div className='flex flex-col gap-4'>
                        <div className='border border-[#b68235] rounded-lg p-4 bg-[#b68235]/5'>
                            <div className='text-sm font-semibold'>Ready to go!</div>
                            <p className='text-sm mt-1'>We\u2019ll create <strong>{businessName}</strong> as a <strong>{profiles.find((p) => p.id === selectedProfile)?.label}</strong> with a pre-configured Chart of Accounts and industry-specific KPI dashboard.</p>
                            <p className='text-xs opacity-70 mt-2'>You can always change your profile later in Settings.</p>
                        </div>
                        {err && <p className='text-sm text-red-700'>{err}</p>}
                        <div className='flex gap-3'>
                            <button onClick={() => setStep(2)} className='text-sm opacity-60 hover:opacity-100'>\u2190 Back</button>
                            <button onClick={finish} disabled={busy} className={busy ? btnOff + ' flex-1' : btnOn + ' flex-1'}>{busy ? 'Setting up\u2026' : 'Launch my books \u2726'}</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function App() {
    const fromHash = () => {
        const h = window.location.hash;
        if (h === '#/scanner') return 'scanner';
        if (h === '#/daybook') return 'daybook';
        if (h === '#/pos-summary') return 'pos-summary';
        if (h === '#/bank') return 'bank';
        if (h === '#/ap') return 'ap';
        if (h === '#/delivery') return 'delivery';
        if (h === '#/payroll') return 'payroll';
        if (h === '#/inventory') return 'inventory';
        if (h === '#/compliance') return 'compliance';
        if (h === '#/reports') return 'reports';
        if (h === '#/reconciliation') return 'reconciliation';
        if (h === '#/settings') return 'settings';
        return 'home';
    };
    const [view, setView] = useState<string>(fromHash());
    const [scanCount, setScanCount] = useState(0);
    const [locs, setLocs] = useState<Array<Record<string, any>>>([]);
    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        const onHash = () => setView(fromHash());
        window.addEventListener('hashchange', onHash);
        lapi.get('/api/invoices').then((r) => setScanCount((r.data.invoices || []).length)).catch(() => {});
        api.get('/api/locations').then((r) => {
            const locations = r.data.locations || [];
            setLocs(locations);
            // Show onboarding if no locations exist and user hasn't dismissed it
            if (locations.length === 0 && !localStorage.getItem('rb_onboarded')) {
                setShowOnboarding(true);
            }
        }).catch(() => {});
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    async function switchLoc(v: string) {
        if (v === '__add') {
            const name = window.prompt('New location name:');
            if (!name || !name.trim()) return;
            try {
                const r = await api.post('/api/locations', { name: name.trim() });
                localStorage.setItem('rb_location', String(r.data.id));
                window.location.reload();
            } catch (e) { window.alert((e as { message?: string }).message || 'Could not create location'); }
            return;
        }
        localStorage.setItem('rb_location', v);
        window.location.reload();
    }

    const go = (v: string) => { window.location.hash = v === 'home' ? '#/' : '#/' + v; setView(v); };
    const tab = (active: boolean) => active ? 'text-sm text-[#8a5f22] border-b-2 border-[#b68235] pb-0.5' : 'text-sm opacity-70 hover:opacity-100 pb-0.5 border-b-2 border-transparent';
    const currentLoc = locs.some((l) => String(l.id) === activeLoc) ? activeLoc : String(locs.find((l) => l.isDefault)?.id ?? '');

    return (
        <div className='min-h-screen bg-[#f3f2f2] text-[#201f1d] font-serif'>
            <header className='border-b border-[#e0ddd8] bg-[#faf9f7] px-6 py-4 flex items-center gap-5 flex-wrap'>
                <button onClick={() => go('home')} className='flex items-center gap-3'>
                    <Crate size={30} />
                    <h1 className='text-2xl'>1st Bookkeeper<span className='text-[#b68235] text-sm'> / In-A-Box</span></h1>
                </button>
                {locs.length > 0 && (
                    <select value={currentLoc} onChange={(e) => switchLoc(e.target.value)} title='Active location' aria-label='Active location' className='border border-[#e0ddd8] rounded px-2 py-1.5 text-xs bg-white'>
                        {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        <option value='__add'>+ Add location…</option>
                    </select>
                )}
                <nav className='flex items-center gap-4 ml-auto flex-wrap'>
                    <button className={tab(view === 'home')} onClick={() => go('home')} aria-current={view === 'home' ? 'page' : undefined}>Home</button>
                    <button className={tab(view === 'daybook')} onClick={() => go('daybook')} aria-current={view === 'daybook' ? 'page' : undefined}>Daybook</button>
                    <button className={tab(view === 'pos-summary')} onClick={() => go('pos-summary')} aria-current={view === 'pos-summary' ? 'page' : undefined}>POS Import</button>
                    <button className={tab(view === 'bank')} onClick={() => go('bank')} aria-current={view === 'bank' ? 'page' : undefined}>Bank</button>
                    <button className={tab(view === 'ap')} onClick={() => go('ap')} aria-current={view === 'ap' ? 'page' : undefined}>A/P &amp; Checks</button>
                    <button className={tab(view === 'delivery')} onClick={() => go('delivery')} aria-current={view === 'delivery' ? 'page' : undefined}>Delivery</button>
                    <button className={tab(view === 'payroll')} onClick={() => go('payroll')} aria-current={view === 'payroll' ? 'page' : undefined}>Payroll</button>
                    <button className={tab(view === 'inventory')} onClick={() => go('inventory')} aria-current={view === 'inventory' ? 'page' : undefined}>Inventory</button>
                    <button className={tab(view === 'reports')} onClick={() => go('reports')} aria-current={view === 'reports' ? 'page' : undefined}>Reports</button>
                    <button className={tab(view === 'compliance')} onClick={() => go('compliance')} aria-current={view === 'compliance' ? 'page' : undefined}>Compliance</button>
                    <button className={tab(view === 'scanner')} onClick={() => go('scanner')} aria-current={view === 'scanner' ? 'page' : undefined}>Invoice Scanner</button>
                    <button className={tab(view === 'reconciliation')} onClick={() => go('reconciliation')} aria-current={view === 'reconciliation' ? 'page' : undefined}>Reconcile</button>
                    <button className={tab(view === 'settings')} onClick={() => go('settings')} aria-current={view === 'settings' ? 'page' : undefined}>Settings</button>
                </nav>
            </header>
            {view === 'home' ? <Home go={go} scanCount={scanCount} />
                : view === 'daybook' ? <Daybook />
                : view === 'pos-summary' ? <PosSummary />
                : view === 'bank' ? <Bank />
                : view === 'ap' ? <Ap />
                : view === 'delivery' ? <Delivery />
                : view === 'payroll' ? <Payroll />
                : view === 'inventory' ? <Inventory />
                : view === 'compliance' ? <Compliance />
                : view === 'reports' ? <Reports />
                : view === 'reconciliation' ? <Reconciliation />
                : view === 'settings' ? <Settings />
                : <Scanner />}
            <Guide view={view} />
            {showOnboarding && <OnboardingWizard onComplete={() => { setShowOnboarding(false); window.location.reload(); }} />}
        </div>
    );
}

export default App;
