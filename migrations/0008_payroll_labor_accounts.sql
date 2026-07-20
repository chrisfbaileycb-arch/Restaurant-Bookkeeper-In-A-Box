-- Payroll labor split (roadmap phase 1.3). 'Wages and Salaries' (6000)
-- becomes a roll-up parent — same pattern as 'Beverage Cost' in 0006 — with
-- kitchen/service children so labor cost and prime cost can be tracked the
-- way restaurants actually manage them (BOH vs FOH). Historical postings on
-- 6000 remain and are included in rollups; new postings go to the children.
INSERT INTO accounts (organization_id, account_no, name, type, qb_type, active, parent_account_no, tax_line)
SELECT o.org_id, v.account_no, v.name, 'expense', 'Expense', true, '6000',
       'Form 1120-S, Line 8 / Form 1125-A, Line 3'
FROM (VALUES
  ('6001', 'Wages - Kitchen (BOH)'),
  ('6002', 'Wages - Service (FOH)')
) AS v(account_no, name)
CROSS JOIN (
  SELECT id AS org_id FROM organizations
  UNION ALL SELECT NULL::BIGINT
) AS o;
