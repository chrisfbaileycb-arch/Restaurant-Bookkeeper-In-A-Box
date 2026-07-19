-- Double-entry ledger core. entry_date/period dates are TEXT (ISO) to match
-- the app's string-typed contract style; ISO strings compare correctly.
CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  account_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, -- asset | liability | equity | revenue | cogs | expense
  qb_type TEXT,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE journal_entries (
  id BIGSERIAL PRIMARY KEY,
  journal_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE journal_lines (
  id BIGSERIAL PRIMARY KEY,
  journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id),
  account_id BIGINT NOT NULL REFERENCES accounts(id),
  description TEXT NOT NULL DEFAULT '',
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  category_tag TEXT
);

CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);

-- Compliance deadlines as first-class data. estimated_amount is refreshed
-- from the mapped liability account's ledger balance — never from hardcoded
-- tax rates.
CREATE TABLE compliance_events (
  id BIGSERIAL PRIMARY KEY,
  tax_type TEXT NOT NULL,
  form_number TEXT NOT NULL,
  period_end TEXT NOT NULL,
  due_date TEXT NOT NULL,
  estimated_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UPCOMING', -- UPCOMING | DUE_SOON | OVERDUE | FILED
  alert_threshold_days INT NOT NULL DEFAULT 10,
  liability_account TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (tax_type, period_end)
);

-- Restaurant chart of accounts seed. account_no ranges follow convention:
-- 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx COGS, 6xxx expenses.
-- Clearing-account names deliberately match the POS tender map used by the
-- QuickBooks sales-receipt export so daily-sales posting maps one-to-one.
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1000', 'Cash - General', 'asset', 'Bank');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1010', 'Cash Drawer', 'asset', 'Bank');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1020', 'Visa Clearing Account', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1021', 'Mastercard Clearing Account', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1022', 'Amex Clearing Account', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1023', 'Discover Clearing Account', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1024', 'Other Tender Clearing', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1100', 'Inventory - Food', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1110', 'Inventory - Beverage', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1200', 'Prepaid Expenses', 'asset', 'Other Current Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('1500', 'Equipment', 'asset', 'Fixed Asset');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2000', 'Accounts Payable', 'liability', 'Accounts Payable');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2100', 'Sales Tax Payable - CO', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2110', 'Tips Payable', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2120', 'Gift Card Liability', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2200', 'Wages Payable', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2210', 'Federal Payroll Taxes Payable', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2220', 'CO Income Tax Withholding Payable', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2230', 'FAMLI Premiums Payable', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2240', 'SUI Payable - CO', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('2250', 'FUTA Payable', 'liability', 'Other Current Liability');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('3000', 'Owner Equity', 'equity', 'Equity');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('3100', 'Retained Earnings', 'equity', 'Equity');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('4000', 'Food Sales', 'revenue', 'Income');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('4100', 'Beverage Sales', 'revenue', 'Income');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('4200', 'Catering Sales', 'revenue', 'Income');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('4900', 'Other Income', 'revenue', 'Income');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('5000', 'Food Cost - Meat', 'cogs', 'Cost of Goods Sold');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('5010', 'Food Cost - Produce', 'cogs', 'Cost of Goods Sold');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('5020', 'Food Cost - Dairy', 'cogs', 'Cost of Goods Sold');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('5030', 'Food Cost - Dry Goods', 'cogs', 'Cost of Goods Sold');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('5100', 'Beverage Cost', 'cogs', 'Cost of Goods Sold');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6000', 'Wages and Salaries', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6010', 'Payroll Taxes', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6100', 'Rent', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6110', 'Utilities', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6120', 'Insurance', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6200', 'Marketing', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6210', 'Repairs and Maintenance', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6220', 'Supplies', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6230', 'POS and Software Fees', 'expense', 'Expense');
INSERT INTO accounts (account_no, name, type, qb_type) VALUES ('6900', 'Miscellaneous Expense', 'expense', 'Expense');
