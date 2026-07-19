-- Part 6: check reconciliation. Tenant-scoped from day one.
-- Register = checks the location wrote. Cleared = bank activity (CSV now;
-- phone/MICR scan is phase 2 — routing/account_last4/image_ref columns are
-- already here for it).
CREATE TABLE check_register (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT,
  location_id BIGINT,
  bank_account_id TEXT NOT NULL DEFAULT 'primary',
  check_number TEXT NOT NULL,
  check_date TEXT NOT NULL,
  payee TEXT NOT NULL,
  written_amount NUMERIC(14,2) NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'outstanding', -- outstanding | cleared | amount_mismatch | void
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (location_id, bank_account_id, check_number)
);

CREATE INDEX idx_check_register_status ON check_register(location_id, status);

CREATE TABLE cleared_checks (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT,
  location_id BIGINT,
  bank_account_id TEXT NOT NULL DEFAULT 'primary',
  check_number TEXT NOT NULL DEFAULT '',
  cleared_date TEXT NOT NULL,
  cleared_amount NUMERIC(14,2) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  routing_number TEXT,
  account_number_last4 TEXT,
  image_ref TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched', -- matched | amount_mismatch | missing_from_register | unmatched
  matched_register_id BIGINT REFERENCES check_register(id),
  imported_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (location_id, bank_account_id, check_number, cleared_date, cleared_amount)
);

CREATE INDEX idx_cleared_checks_status ON cleared_checks(location_id, match_status);
