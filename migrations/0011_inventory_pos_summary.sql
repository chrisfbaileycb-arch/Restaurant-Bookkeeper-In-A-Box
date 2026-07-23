-- Physical inventory counts + POS daily-summary support (roadmap 1.6-1.7).
--
-- inventory_counts stores each physical count with the variances that were
-- posted, one row per location per count date. The corrective journal
-- (INV-<date>) posts count variances to dedicated adjustment accounts so
-- operational purchases stay separate from shrink/waste corrections.
CREATE TABLE inventory_counts (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  count_date TEXT NOT NULL,
  food_count NUMERIC(14,2),
  beverage_count NUMERIC(14,2),
  paper_count NUMERIC(14,2),
  food_variance NUMERIC(14,2) NOT NULL DEFAULT 0,
  beverage_variance NUMERIC(14,2) NOT NULL DEFAULT 0,
  paper_variance NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (location_id, count_date)
);
CREATE INDEX idx_inventory_counts_location ON inventory_counts(location_id);

-- Accounts for template + every existing org:
--   1120 Inventory - Paper & Packaging (asset; 1100/1110 already exist)
--   5040 Food Cost - Inventory Adjustment
--   5160 Beverage Cost - Inventory Adjustment (child of Beverage Cost)
--   6250 Cash Over/Short (POS daily-summary drawer variances)
INSERT INTO accounts (organization_id, account_no, name, type, qb_type, active, parent_account_no, tax_line)
SELECT o.org_id, v.account_no, v.name, v.type, v.qb_type, true, v.parent_account_no, v.tax_line
FROM (VALUES
  ('1120', 'Inventory - Paper & Packaging', 'asset', 'Other Current Asset', NULL, 'Form 1120-S, Sch L, Line 3'),
  ('5040', 'Food Cost - Inventory Adjustment', 'cogs', 'Cost of Goods Sold', NULL, 'Form 1120-S, Line 2 / Form 1125-A, Line 2'),
  ('5160', 'Beverage Cost - Inventory Adjustment', 'cogs', 'Cost of Goods Sold', '5100', 'Form 1120-S, Line 2 / Form 1125-A, Line 2'),
  ('6250', 'Cash Over/Short', 'expense', 'Expense', NULL, 'Form 1120-S, Line 19')
) AS v(account_no, name, type, qb_type, parent_account_no, tax_line)
CROSS JOIN (
  SELECT id AS org_id FROM organizations
  UNION ALL SELECT NULL::BIGINT
) AS o;
