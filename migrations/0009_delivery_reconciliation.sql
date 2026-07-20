-- Third-party delivery reconciliation (roadmap phase 1.4). Weekly payout
-- statements from DoorDash/UberEats/Grubhub are recorded per location and
-- posted to the ledger. Payouts debit a dedicated clearing account — the
-- deposit typically lands in the bank days later, where bank matching
-- (phase 1.5) clears it into Cash.
CREATE TABLE delivery_statements (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  platform TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_sales NUMERIC(14,2) NOT NULL,
  commissions NUMERIC(14,2) NOT NULL,
  marketing_fees NUMERIC(14,2) NOT NULL,
  refunds NUMERIC(14,2) NOT NULL,
  driver_tips NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payout NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (location_id, platform, period_start, period_end)
);
CREATE INDEX idx_delivery_statements_location ON delivery_statements(location_id);

-- Accounts for the delivery flow, template + every existing org:
--   1025 Delivery Payout Clearing (asset)  — payouts in transit
--   4300 Delivery Sales (revenue)          — gross marketplace sales
--   6240 Delivery Commissions & Fees       — platform commission expense
INSERT INTO accounts (organization_id, account_no, name, type, qb_type, active, parent_account_no, tax_line)
SELECT o.org_id, v.account_no, v.name, v.type, v.qb_type, true, NULL, v.tax_line
FROM (VALUES
  ('1025', 'Delivery Payout Clearing', 'asset', 'Other Current Asset', 'Form 1120-S, Sch L, Line 6'),
  ('4300', 'Delivery Sales', 'revenue', 'Income', 'Form 1120-S, Line 1a'),
  ('6240', 'Delivery Commissions & Fees', 'expense', 'Expense', 'Form 1120-S, Line 19')
) AS v(account_no, name, type, qb_type, tax_line)
CROSS JOIN (
  SELECT id AS org_id FROM organizations
  UNION ALL SELECT NULL::BIGINT
) AS o;
