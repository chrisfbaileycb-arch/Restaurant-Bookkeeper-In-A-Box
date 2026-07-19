-- Canonical NormalizedTransaction store. business_date and ts are TEXT on
-- purpose: the data contract is string-typed (YYYY-MM-DD / ISO 8601) and TEXT
-- guarantees exact round-trip through CSV export with no timezone drift.
CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  source_pos TEXT NOT NULL,
  business_date TEXT NOT NULL,
  ts TEXT NOT NULL,
  gross_sales NUMERIC(12,2) NOT NULL,
  net_sales NUMERIC(12,2) NOT NULL,
  discounts_applied NUMERIC(12,2) NOT NULL,
  adjustments NUMERIC(12,2) NOT NULL,
  taxes_collected NUMERIC(12,2) NOT NULL,
  tips NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL,
  auth_code TEXT NOT NULL DEFAULT 'N/A',
  customer_id TEXT NOT NULL DEFAULT '',
  modifiers_json JSONB NOT NULL DEFAULT '[]',
  postal_code TEXT,
  promo_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_date_method ON transactions(business_date, payment_method);

-- Single-row cadence-watchdog record: last successful import.
CREATE TABLE import_status (
  id INT PRIMARY KEY CHECK (id = 1),
  last_import_at TIMESTAMPTZ NOT NULL,
  last_week_of TEXT NOT NULL,
  imported INT NOT NULL
);
