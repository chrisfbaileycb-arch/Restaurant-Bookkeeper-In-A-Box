/**
 * Shared operator-console runtime — helpers, workspace nav, the 428
 * ack-disclaimer flow, and the in-app Guide assistant. No build step, no
 * external calls: everything talks to this app's own /api endpoints.
 */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => d.toISOString().slice(0, 10);
const money = (n, dp = 2) => (n < 0 ? '−' : '') + '$' +
  Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// ── fetch wrapper: 402 → paywall, 401/409 → onboarding, else throw ─────────
let gated = false;
function gate(kind, j) {
  const g = $('gate');
  if (!g || gated) return;
  gated = true;
  g.hidden = false;
  if (kind === 'subscription') {
    g.innerHTML = '<div class="kicker">Subscription required</div>' +
      '<p style="margin:6px 0 10px;">This screen reads your ledger, which needs an active subscription' +
      (j && j.price ? ' — ' + esc(j.price.amount) + ' ' + esc(j.price.currency) + '/' + esc(j.price.interval) : '') + '.</p>' +
      (j && j.checkoutUrl ? '<a class="btn btn-primary" href="' + esc(j.checkoutUrl) + '">Subscribe</a>'
        : '<span class="muted">Contact the owner for access.</span>');
  } else {
    g.innerHTML = '<div class="kicker">Welcome</div><p style="margin:6px 0 0;">' +
      esc((j && j.message) || 'Sign in, then create your organization on the Ledger tab to get started.') +
      '</p><p style="margin:8px 0 0;"><a class="btn" href="/ledger.html">Open Ledger setup →</a></p>';
  }
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 402) { gate('subscription', await r.json().catch(() => ({}))); throw new Error('402'); }
  if (r.status === 401 || r.status === 409) { gate('onboarding', await r.json().catch(() => ({}))); throw new Error('auth'); }
  return r;
}

// ── 428 ack-disclaimer flow (Operational Legal Layer) ──────────────────────
// High-stakes endpoints refuse with 428 + the disclaimer payload until the
// caller re-submits with the ack header. acks{} remembers per-action consent.
const acks = {};
async function callWithAck(action, mountId, doFetch) {
  const res = await doFetch(acks[action] ? { 'x-expoproxy-ack': acks[action] } : {});
  if (res && res.status === 428) {
    const payload = await res.json();
    // Resolve with the retried response once the operator consents, so the
    // caller's result handling runs on the post-ack attempt too.
    return new Promise((resolve) => {
      const box = $(mountId);
      box.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'disclaimer';
      const strong = document.createElement('strong');
      strong.textContent = payload.disclaimer.title;
      const p = document.createElement('p');
      p.textContent = payload.disclaimer.text;
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'I acknowledge — proceed';
      btn.onclick = () => {
        acks[action] = payload.requiredAckValue;
        box.innerHTML = '';
        resolve(callWithAck(action, mountId, doFetch));
      };
      div.append(strong, p, btn);
      box.append(div);
    });
  }
  return res;
}

/** Render a strict-validation error list (422 payloads) into a mount. */
function showErrors(mountId, payload) {
  const box = $(mountId);
  const items = (payload.errors || payload.issues || []).map((e) =>
    '<li>' + (e.line !== undefined ? 'line ' + esc(e.line) + ': ' : '') + esc(e.message || e) + '</li>').join('');
  box.innerHTML = '<div class="error-box"><strong>' + esc(payload.error || 'Request failed') + '</strong>' +
    (items ? '<ul style="margin:6px 0 0 18px; padding:0;">' + items + '</ul>' : '') + '</div>';
  box.hidden = false;
}

// ── workspace picker in the nav (same behavior as the Daybook) ─────────────
async function initWorkspace() {
  const pick = $('locationPicker');
  if (!pick) return null;
  let me;
  try {
    const r = await api('/api/org/me');
    if (!r.ok) throw new Error('me');
    me = await r.json();
  } catch { return null; }
  if (me.locations && me.locations.length > 1) {
    pick.hidden = false;
    pick.innerHTML = me.locations.map((l) =>
      '<option value="' + esc(l.id) + '"' + (l.id === me.activeLocation.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('');
    pick.onchange = async () => {
      await fetch('/api/org/switch', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locationId: Number(pick.value) }),
      });
      location.reload();
    };
  }
  document.querySelectorAll('[data-location-name]').forEach((n) => { n.textContent = me.activeLocation.name; });
  return me;
}

// ── the Guide: an in-app assistant that walks operators through the flow ───
// Rule-based and fully local — it reads live workbook state from this app's
// own API and answers questions from a built-in knowledge base. No data
// leaves the app.
const GUIDE_KB = [
  { keys: ['bank', 'feed', 'statement', 'unmatched'],
    a: 'Bank feed CSV header: <code>txn_date,description,amount,fee_amount,bank_account_id</code>. Positive amounts are deposits (auto-matched to clearing accounts by description), negative are withdrawals ("Check #123" routes to the check matcher). Rows the rules can\'t identify are parked in the Unmatched queue and never posted — post those by hand on the Ledger tab, then re-import.' },
  { keys: ['cleared', 'clearing check', 'micr'],
    a: 'Cleared-checks CSV header: <code>check_number,cleared_date,cleared_amount,description,routing_number,account_number_last4,bank_account_id</code>. Import it on the Bank tab; matching against the check register runs automatically (cleared / amount_mismatch / missing_from_register).' },
  { keys: ['register', 'outstanding', 'void'],
    a: 'The Check Register (A/P tab) lists every check by status: outstanding, cleared, amount_mismatch, void. Use the row actions to void a check or reopen it to outstanding. Register CSV imports live on the Ledger tab: <code>check_number,check_date,payee,written_amount,memo,bank_account_id</code>.' },
  { keys: ['aging', 'bill', 'invoice', 'vendor', 'payable', 'a/p', 'ap '],
    a: 'A/P aging bins unpaid vendor invoices 0–15 / 16–30 / 31+ days by invoice date. Import invoices via the AP CSV (<code>invoice_no,invoice_date,vendor,due_date,item_description,qty,unit_price,category</code>). "Record payment" marks an invoice paid and posts the journal — this app records payments, it never moves money.' },
  { keys: ['p&l', 'profit', 'loss', 'income'],
    a: 'The P&L (Reports tab) covers an inclusive date range and includes restaurant KPIs: food cost %, beverage cost %, labor %, and prime cost against the 65% industry line. Use Print for a paper copy or the CSV button for a download.' },
  { keys: ['balance sheet', 'balanced', 'assets'],
    a: 'The Balance Sheet (Reports tab) is as-of a single date and self-checks: assets must equal liabilities + equity (including net income to date). If it shows "out of balance", review recent journal imports on the Ledger tab.' },
  { keys: ['prime cost', 'kpi', 'food cost', 'labor'],
    a: 'Prime cost = COGS + labor (wages + payroll taxes) as a percent of revenue. Industry warning line is 65% — stay under it. Food cost % and beverage cost % compare each cost rollup to its own sales line.' },
  { keys: ['pos', 'daily sales', 'summary', 'import sales'],
    a: 'POS sales come in on the Imports tab (16-column transaction CSV, all-or-nothing validation), or as daily summaries. Post them to the ledger with "Post daily sales" on the Ledger tab — that\'s what feeds the reports.' },
  { keys: ['quickbooks', 'qbo', 'iif', 'export'],
    a: 'QuickBooks is optional. The Ledger tab exports a QBO journal-entry CSV (Settings → Import Data → Journal Entries) or IIF for QB Desktop — one month at a time, because QBO rejects larger imports.' },
  { keys: ['disclaimer', 'acknowledge', '428', 'ack'],
    a: 'High-stakes actions (imports, exports, payments) pause once per session to show a disclaimer — the API refuses to act until you acknowledge it. Click "I acknowledge — proceed" and the action re-submits automatically.' },
  { keys: ['plan', 'price', 'subscription', 'location'],
    a: 'Plans: Single (1 location, $149/mo), Group (up to 3, $249/mo), Premium Group (4–7, $499/mo). Every screen operates on the ACTIVE location — switch it from the picker in the top bar.' },
  { keys: ['reconcil'],
    a: 'Bank reconciliation: starting bank balance − outstanding checks ± mismatch corrections = reconciled cash, compared to the ledger cash balance. Run it from the Ledger tab (section 4) after importing your bank statement here.' },
];

const GUIDE_TIPS = {
  bank: 'Import your bank statement below, then work the Unmatched queue to zero — unmatched rows are parked, never posted.',
  reports: 'Pick a period, run the report, then use Print for a clean paper copy — the nav and controls stay off the page.',
  ap: 'Watch the 31+ day bin and past-due tags. Recording a check payment also adds it to the register as outstanding.',
};

function initGuide(pageKey) {
  const fab = document.createElement('button');
  fab.id = 'guideFab';
  fab.textContent = '✦ Guide';
  fab.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.id = 'guidePanel';
  panel.hidden = true;
  panel.innerHTML =
    '<div><div class="kicker">Bookkeeper guide</div><h3>Where you are in the flow</h3></div>' +
    (GUIDE_TIPS[pageKey] ? '<p class="muted" style="margin:0; font-size:13px;">' + GUIDE_TIPS[pageKey] + '</p>' : '') +
    '<div id="guideSteps"><p class="muted" style="font-size:13px;">Checking your books…</p></div>' +
    '<div><div class="kicker">Ask the guide</div>' +
    '<form class="guide-ask" id="guideForm" style="margin-top:6px;">' +
    '<input id="guideQ" type="text" placeholder="e.g. bank CSV format, prime cost…" aria-label="Ask the guide">' +
    '<button class="btn btn-sm" type="submit">Ask</button></form>' +
    '<div id="guideAnswer" style="margin-top:8px;"></div></div>';
  document.body.append(fab, panel);

  let loaded = false;
  fab.onclick = () => {
    panel.hidden = !panel.hidden;
    fab.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden && !loaded) { loaded = true; guideSteps(); }
  };

  panel.querySelector('#guideForm').onsubmit = (e) => {
    e.preventDefault();
    const q = panel.querySelector('#guideQ').value.trim().toLowerCase();
    const out = panel.querySelector('#guideAnswer');
    if (!q) return;
    const hit = GUIDE_KB.find((k) => k.keys.some((key) => q.includes(key)));
    out.innerHTML = hit
      ? hit.a
      : 'No note on that yet. Try asking about: bank feed, cleared checks, register, aging, P&amp;L, balance sheet, prime cost, POS import, QuickBooks, plans, or reconciliation.';
  };
}

// Live next-best-action checklist: the same signals the Daybook uses, each
// linking to the tab where the work happens.
async function guideSteps() {
  const mount = document.querySelector('#guideSteps');
  const settle = (p) => p.then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [imp, bank, ap, bs] = await Promise.all([
    settle(fetch('/api/import/status')),
    settle(fetch('/api/bank/feed')),
    settle(fetch('/api/ap/aging')),
    settle(fetch('/api/reports/balance-sheet?as_of=' + iso(new Date()))),
  ]);
  if (!imp && !bank && !ap && !bs) {
    mount.innerHTML = '<p class="muted" style="font-size:13px;">Sign in with an active workspace and the guide tracks your closing steps here.</p>';
    return;
  }
  const week = 7 * 86400000;
  const now = Date.now();
  const steps = [
    { done: !!(imp && (imp.validatedThisWeek || (imp.lastImportAt && now - new Date(imp.lastImportAt) < week))),
      label: 'Import POS sales (this week)', href: '/console.html' },
    { done: !!(bank && bank.unmatched && bank.unmatched.length === 0),
      label: bank && bank.unmatched && bank.unmatched.length
        ? 'Clear the bank queue (' + bank.unmatched.length + ' unmatched)' : 'Clear the bank queue',
      href: '/bank.html' },
    { done: !!(ap && ap.bins && !ap.bins.some((b) => b.invoices.some((i) => i.pastDue))),
      label: 'No bills past due', href: '/ap.html' },
    { done: !!(bs && bs.balanced), label: 'Books in balance', href: '/reports.html' },
  ];
  const next = steps.find((s) => !s.done);
  mount.innerHTML = steps.map((s) =>
    '<div class="step' + (s.done ? ' done' : '') + '"><span class="dot"></span><span>' + esc(s.label) + '</span>' +
    (s.done ? '' : '<a href="' + s.href + '">go →</a>') + '</div>').join('') +
    (next
      ? '<p style="margin:10px 0 0; font-size:13px;"><strong>Next up:</strong> ' + esc(next.label) + ' <a href="' + next.href + '" style="color:var(--color-accent-700);">open →</a></p>'
      : '<p style="margin:10px 0 0; font-size:13px;">All clear — the books are closed up. ✦</p>');
}
