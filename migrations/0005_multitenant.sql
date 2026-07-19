-- Multi-unit model: one app, one login, multiple isolated location
-- workspaces. organization = customer account; location = one restaurant;
-- org_users = logins; user_locations = per-location access grants.
CREATE TABLE organizations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'single', -- single | group | premium_group
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE org_users (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'owner',
  active_location_id BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE user_locations (
  org_user_id BIGINT NOT NULL REFERENCES org_users(id),
  location_id BIGINT NOT NULL REFERENCES locations(id),
  PRIMARY KEY (org_user_id, location_id)
);

-- Per-location cadence watchdog (replaces the single-row import_status).
CREATE TABLE location_import_status (
  organization_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  last_import_at TIMESTAMPTZ NOT NULL,
  last_week_of TEXT NOT NULL,
  imported INT NOT NULL,
  PRIMARY KEY (location_id)
);

-- Tenant columns on every location-scoped table. Uniqueness becomes
-- per-location so different locations can reuse journal numbers, check
-- numbers, and POS transaction ids. Legacy pre-tenant rows keep NULL ids
-- and are invisible to scoped queries.
ALTER TABLE transactions ADD COLUMN organization_id BIGINT;
ALTER TABLE transactions ADD COLUMN location_id BIGINT;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_id_key;
CREATE UNIQUE INDEX uq_transactions_loc_txid ON transactions (location_id, transaction_id);
CREATE INDEX idx_transactions_location ON transactions(location_id);

-- Chart of accounts: rows with organization_id NULL are the shared
-- restaurant template; each new organization gets its own copy so the
-- structure stays standardized while locations post independently.
ALTER TABLE accounts ADD COLUMN organization_id BIGINT;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_no_key;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_name_key;
CREATE UNIQUE INDEX uq_accounts_org_name ON accounts (organization_id, name);

ALTER TABLE journal_entries ADD COLUMN organization_id BIGINT;
ALTER TABLE journal_entries ADD COLUMN location_id BIGINT;
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_journal_no_key;
CREATE UNIQUE INDEX uq_journal_entries_loc_no ON journal_entries (location_id, journal_no);
CREATE INDEX idx_journal_entries_location ON journal_entries(location_id);

ALTER TABLE compliance_events ADD COLUMN organization_id BIGINT;
ALTER TABLE compliance_events ADD COLUMN location_id BIGINT;
ALTER TABLE compliance_events DROP CONSTRAINT IF EXISTS compliance_events_tax_type_period_end_key;
CREATE UNIQUE INDEX uq_compliance_loc_tax_period ON compliance_events (location_id, tax_type, period_end);
