-- Bank feed lines (roadmap phase 1.5). Full bank statement rows imported
-- per location: deposits are keyword-matched to clearing accounts and posted
-- (Cash debit, clearing credit, merchant fees isolated); check withdrawals
-- route into the existing cleared-checks matcher; everything else stays
-- 'unmatched' for manual review and is never posted. The unique constraint
-- makes statement re-imports dedupe silently, like cleared checks.
CREATE TABLE bank_feed_lines (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  bank_account_id TEXT NOT NULL DEFAULT 'primary',
  txn_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'unmatched', -- matched_deposit | check_routed | unmatched
  matched_account TEXT,
  journal_no TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (location_id, bank_account_id, txn_date, description, amount)
);
CREATE INDEX idx_bank_feed_lines_location ON bank_feed_lines(location_id);
CREATE INDEX idx_bank_feed_lines_status ON bank_feed_lines(location_id, match_status);
