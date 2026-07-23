-- Accounts Payable subledger (roadmap phase 1.2). Supplier invoices are
-- registered per location; expense_breakdown records the rule-routed account
-- split as {account name: amount}. Ledger postings are separate journal
-- entries (AP-<invoice_no> on registration, AP-PAY-<invoice_no> on payment),
-- so the subledger never carries balances of its own — the ledger stays the
-- single source of truth.
CREATE TABLE vendor_invoices (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  invoice_no TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid
  due_date TEXT NOT NULL,
  paid_date TEXT,
  payment_check_no TEXT,
  expense_breakdown JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (location_id, invoice_no)
);
CREATE INDEX idx_vendor_invoices_location ON vendor_invoices(location_id);
CREATE INDEX idx_vendor_invoices_status ON vendor_invoices(location_id, status);
