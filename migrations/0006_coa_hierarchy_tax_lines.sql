-- COA hierarchy + tax-line mapping (Phase 1, step 1 of the roadmap).
--
-- parent_account_no: children roll up to a parent account for KPI display
-- and single-line tax reporting. Parent accounts become structural once they
-- have children — the app layer rejects new postings to them (historical
-- postings on 'Beverage Cost' remain and are included in rollups).
--
-- tax_line: informational default mapping of each account to its S-corp
-- return line (Form 1120-S / 1125-A / Schedule L). Feeds the year-end
-- tax-package export. Defaults assume an S-corp filer; a tax professional
-- should review before filing. Partnership/sole-prop variants come later.
ALTER TABLE accounts ADD COLUMN parent_account_no TEXT;
ALTER TABLE accounts ADD COLUMN tax_line TEXT;

-- Beverage COGS granularity: 'Beverage Cost' (5100) becomes the parent of
-- five operational sub-accounts, mirroring how bar programs actually track
-- margin. Inserted into the shared template (organization_id NULL) AND every
-- existing organization's COA copy, matching the 0005 template model.
INSERT INTO accounts (organization_id, account_no, name, type, qb_type, active, parent_account_no, tax_line)
SELECT o.org_id, v.account_no, v.name, 'cogs', 'Cost of Goods Sold', true, '5100',
       'Form 1120-S, Line 2 / Form 1125-A, Line 2'
FROM (VALUES
  ('5110', 'Beverage Cost - Draught Beer'),
  ('5120', 'Beverage Cost - Packaged & Retail'),
  ('5130', 'Beverage Cost - Fountain Soda'),
  ('5140', 'Beverage Cost - Wine'),
  ('5150', 'Beverage Cost - Spirits & Liquor')
) AS v(account_no, name)
CROSS JOIN (
  SELECT id AS org_id FROM organizations
  UNION ALL SELECT NULL::BIGINT
) AS o;

-- Paper & packaging is a real COGS line for restaurants that the template
-- lacked (to-go boxes, cups, napkins). No parent — it stands alone like the
-- food-cost accounts.
INSERT INTO accounts (organization_id, account_no, name, type, qb_type, active, parent_account_no, tax_line)
SELECT o.org_id, '5200', 'Paper & Packaging Cost', 'cogs', 'Cost of Goods Sold', true, NULL,
       'Form 1120-S, Line 2 / Form 1125-A, Line 2'
FROM (
  SELECT id AS org_id FROM organizations
  UNION ALL SELECT NULL::BIGINT
) AS o;

-- Tax-line defaults for the existing template accounts and every org copy
-- (matched by name, which is unique per organization).
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 1'  WHERE name IN ('Cash - General', 'Cash Drawer');
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 6'  WHERE name IN
  ('Visa Clearing Account', 'Mastercard Clearing Account', 'Amex Clearing Account',
   'Discover Clearing Account', 'Other Tender Clearing', 'Prepaid Expenses');
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 3'  WHERE name IN ('Inventory - Food', 'Inventory - Beverage');
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 10b' WHERE name = 'Equipment';
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 16' WHERE name = 'Accounts Payable';
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 18' WHERE name IN
  ('Sales Tax Payable - CO', 'Tips Payable', 'Gift Card Liability', 'Wages Payable',
   'Federal Payroll Taxes Payable', 'CO Income Tax Withholding Payable',
   'FAMLI Premiums Payable', 'SUI Payable - CO', 'FUTA Payable');
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 22' WHERE name = 'Owner Equity';
UPDATE accounts SET tax_line = 'Form 1120-S, Sch L, Line 24' WHERE name = 'Retained Earnings';
UPDATE accounts SET tax_line = 'Form 1120-S, Line 1a'        WHERE type = 'revenue' AND tax_line IS NULL;
UPDATE accounts SET tax_line = 'Form 1120-S, Line 2 / Form 1125-A, Line 2' WHERE type = 'cogs' AND tax_line IS NULL;
UPDATE accounts SET tax_line = 'Form 1120-S, Line 8 / Form 1125-A, Line 3' WHERE name = 'Wages and Salaries';
UPDATE accounts SET tax_line = 'Form 1120-S, Line 12'        WHERE name = 'Payroll Taxes';
UPDATE accounts SET tax_line = 'Form 1120-S, Line 11'        WHERE name = 'Rent';
UPDATE accounts SET tax_line = 'Form 1120-S, Line 9'         WHERE name = 'Repairs and Maintenance';
UPDATE accounts SET tax_line = 'Form 1120-S, Line 16'        WHERE name = 'Marketing';
UPDATE accounts SET tax_line = 'Form 1120-S, Line 19'        WHERE type = 'expense' AND tax_line IS NULL;
