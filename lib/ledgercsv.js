/**
 * CSV-first ledger I/O.
 *
 * Ingest: the universal restaurant journal CSV —
 *   date,journal_no,account_name,description,debit,credit,category_tag,source
 * Every row is one journal-entry line; rows sharing a journal_no form one
 * entry and must balance.
 *
 * Export Tier 1: QBO's native journal-entry import format (Settings →
 * Import Data → Journal Entries; up to 1,000 lines) —
 *   Journal No.,Journal Date,Account Name,Description,Debits,Credits
 * Export Tier 2: IIF for QuickBooks Desktop (TRNS/SPL/ENDTRNS, type GENERAL).
 */
import { splitCsvLine } from 'lib/contract.js';

export const JOURNAL_CSV_HEADER = 'date,journal_no,account_name,description,debit,credit,category_tag,source';

function esc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** MM/DD/YYYY from YYYY-MM-DD (QBO + IIF date format). */
function usDate(iso) {
  const [y, m, d] = iso.split('-');
  return m + '/' + d + '/' + y;
}

/**
 * Parse the universal journal CSV into entries grouped by journal_no.
 * Returns { ok:true, entries } or { ok:false, errors:[{line, message}] }.
 */
export function parseJournalCsv(csv) {
  const errors = [];
  const rawLines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return { ok: false, errors: [{ line: 0, message: 'empty_file' }] };

  const header = rawLines[0].trim();
  if (header !== JOURNAL_CSV_HEADER) {
    return { ok: false, errors: [{ line: 1, message: 'header_mismatch: expected "' + JOURNAL_CSV_HEADER + '"' }] };
  }

  const byJournal = new Map();
  for (let i = 1; i < rawLines.length; i++) {
    const cols = splitCsvLine(rawLines[i]).map((c) => c.trim());
    if (cols.length !== 8) {
      errors.push({ line: i + 1, message: 'column_count_mismatch: expected 8, got ' + cols.length });
      continue;
    }
    const [date, journalNo, accountName, description, debitRaw, creditRaw, categoryTag, source] = cols;
    if (!journalNo) { errors.push({ line: i + 1, message: 'journal_no required' }); continue; }
    const debit = debitRaw === '' ? 0 : Number(debitRaw);
    const credit = creditRaw === '' ? 0 : Number(creditRaw);
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      errors.push({ line: i + 1, message: 'debit/credit must be numeric' });
      continue;
    }
    if (!byJournal.has(journalNo)) {
      byJournal.set(journalNo, { journalNo, date, description, source: source || 'manual', lines: [] });
    }
    const entry = byJournal.get(journalNo);
    if (entry.date !== date) errors.push({ line: i + 1, message: 'journal ' + journalNo + ' has conflicting dates' });
    entry.lines.push({ accountName, description, debit, credit, categoryTag: categoryTag || null });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entries: [...byJournal.values()] };
}

/** Serialize ledger entries to the universal journal CSV. */
export function toJournalCsv(entries) {
  const lines = [JOURNAL_CSV_HEADER];
  for (const e of entries) {
    for (const l of e.lines) {
      lines.push([
        e.date, e.journalNo, esc(l.accountName), esc(l.description),
        l.debit > 0 ? l.debit.toFixed(2) : '', l.credit > 0 ? l.credit.toFixed(2) : '',
        l.categoryTag ?? '', e.source ?? '',
      ].join(','));
    }
  }
  return lines.join('\n') + '\n';
}

/** Tier 1 — QBO journal-entry import CSV. */
export function toQboJournalCsv(entries) {
  const lines = ['Journal No.,Journal Date,Account Name,Description,Debits,Credits'];
  for (const e of entries) {
    for (const l of e.lines) {
      lines.push([
        esc(e.journalNo), usDate(e.date), esc(l.accountName), esc(l.description || e.description),
        l.debit > 0 ? l.debit.toFixed(2) : '', l.credit > 0 ? l.credit.toFixed(2) : '',
      ].join(','));
    }
  }
  return lines.join('\n') + '\n';
}

/** Count of exportable lines (QBO caps journal imports at 1,000 lines). */
export function qboLineCount(entries) {
  return entries.reduce((n, e) => n + e.lines.length, 0);
}

/**
 * Tier 2 — IIF export for QuickBooks Desktop. Each journal becomes a
 * TRNS/SPL.../ENDTRNS block of type GENERAL; debits positive, credits
 * negative. Tab-delimited per the IIF spec.
 */
export function toIif(entries) {
  const out = [
    '!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
    '!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
    '!ENDTRNS',
  ];
  for (const e of entries) {
    e.lines.forEach((l, i) => {
      const amount = l.debit > 0 ? l.debit : -l.credit;
      const memo = (l.description || e.description || '').replace(/\t/g, ' ');
      out.push([
        i === 0 ? 'TRNS' : 'SPL', 'GENERAL', usDate(e.date),
        l.accountName.replace(/\t/g, ' '), amount.toFixed(2), memo,
      ].join('\t'));
    });
    out.push('ENDTRNS');
  }
  return out.join('\n') + '\n';
}
