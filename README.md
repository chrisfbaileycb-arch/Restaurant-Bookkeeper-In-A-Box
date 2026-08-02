# 1st Bookkeeper-In-A-Box

**Specialized Ledger Intelligence** — part of the **Signal Holdings / Expo Proxy** portfolio.

Built for Restaurants, Salons & Barbershops, Tattoo Studios, Auto Repair & Service Businesses. *(Expanding to your industry soon)*

A standalone, double-entry bookkeeping platform with multi-vertical industry
profiles: CSV-first ingestion from any POS (no API keys needed), a true ledger
with industry-specific chart of accounts, print-ready financial reports,
Colorado + federal tax compliance tracking, bank reconciliation with multi-format
CSV support, an AI-powered conversational bookkeeper assistant, and
QuickBooks-optional export bridges. One app, one login, multiple isolated
location workspaces — each with its own industry profile.

**Live deployment:** the production instance runs on
[AppDeploy](https://dashboard.appdeploy.ai) at
`invoice-scanner-restaurant-bookkeeper-f35e4x.v2.appdeploy.ai`. This
repository is the version-controlled source of truth for that app: the
canonical product code lives in **`app/`** and is deployed to AppDeploy.

## Repository layout

| Layer | What it is |
|---|---|
| **`app/`** | **The product (canonical).** React + Vite + Tailwind frontend (`app/src/`) and AppDeploy SDK backend (`app/backend/index.ts`): multi-location workspaces, Daybook, POS Import (Toast/Clover/Square), Bank import with multi-format auto-detection and check clearing, A/P aging + check register, delivery reconciliation, payroll journals, physical inventory with variance posting, printable Reports with the enhanced QBO bridge (department/category breakdowns), the CO + federal compliance calendar, AI Invoice Scanner, Reconciliation Dashboard (Bank vs Books vs POS), multi-vertical industry profiles (Restaurant, Salon, Tattoo, Auto Repair), AI conversational bookkeeper assistant, and Settings. Deployed to AppDeploy. |
| `api/`, `lib/`, `migrations/`, `public/`, `hatchable.toml` | **Legacy (Hatchable engine).** The earlier multi-tenant Postgres implementation. All of its bookkeeping modules have been ported to `app/`; what remains here as reference only is the POS 16-column CSV contract, the org_user auth model, and Stripe billing. Not deployed. |

### Legacy engine reference (Hatchable era — superseded by `app/`)

### Multi-tenant model

- **organization** → the customer account (restaurant group), owns the plan
- **location** → one restaurant; an autonomous bookkeeping workspace
- **org_user** → a login; may access one or more locations
- **workspace** → the user's active location context; switching it rescopes every query

All location-scoped tables carry `organization_id` + `location_id`.
Isolation is enforced through a single chokepoint (`lib/tenant.js
getContext()`): every data-layer function requires the workspace context and
filters on both tenant ids. There is no unscoped query path. (The schema is
RLS-ready if migrated to raw Postgres/Supabase.)

### Plans (enforced at location creation)

| Plan | Locations | Price |
|---|---|---|
| Single | 1 | $149/mo |
| Group | up to 3 | $249/mo |
| Premium Group | 4–7 | $499/mo |

### Modules

1. **POS import** — strict all-or-nothing CSV validation (16-column
   NormalizedTransaction contract), prototype-pollution sanitization,
   idempotent per-location dedup, weekly cadence watchdog.
2. **Ledger** — double-entry journal with balance validation, 48-account
   restaurant COA template copied per organization (hierarchical beverage
   COGS sub-accounts + per-account 1120-S tax-line mapping), one-click
   daily-sales posting from the POS store.
3. **Reports** — P&L (with food/beverage-cost KPIs), Balance Sheet (with
   integrity check), COGS summary, trial balance. JSON + CSV.
4. **QuickBooks bridge (optional)** — Tier 1: QBO journal-entry CSV
   (native import template, 1,000-line cap enforced). Tier 2: IIF for
   QB Desktop. Month-scoped: QBO rejects imports larger than ~1 month.
5. **Compliance calendar** — CO DR 0100 / DR 1094 / FAMLI / UITR-1 and
   federal 941/940 deadlines as first-class events per location. Estimated
   amounts pull from ledger liability balances — no tax rates are hardcoded.
   Daily cron refresh.
6. **Check reconciliation** — check register vs. cleared checks (bank CSV;
   phone/MICR scan is phase 2 — schema already carries routing/last4/image
   columns). Statuses: `outstanding`, `amount_mismatch`,
   `missing_from_register`. Reconciliation summary: starting balance −
   outstanding ± corrections = reconciled cash balance, tied to the
   location's ledger cash account.
7. **Billing** — subscription paywall on operator routes; Stripe webhook
   activation; admin comp/grant override.
8. **AP subledger** — supplier invoice CSV import with rule-based line
   categorization to COGS accounts, automatic AP journal posting, aging
   report (0-15/16-30/31+), and payment recording (books only — no money
   movement) with check-register integration.
9. **Payroll journal import** — records pay runs executed by the operator's
   third-party payroll service (never moves money): BOH/FOH wage split,
   employer taxes, withholding liabilities that feed the compliance
   calendar, provider-remitted tax handling, and prime-cost KPIs
   (COGS + labor vs the 65% threshold) on the P&L.
10. **Delivery reconciliation** — DoorDash/UberEats/Grubhub payout
    statements with an enforced reconciliation identity; posts gross sales,
    commissions, marketing fees, and refunds (contra-revenue), with payouts
    held in a clearing account until bank matching clears them. Tracks each
    platform's effective take rate.
11. **Bank feed matching** — full statement import: deposits keyword-matched
    to clearing accounts (card settlements with merchant-fee isolation,
    delivery payouts, safe drops) and posted to cash; check withdrawals
    routed into the check matcher; unidentified rows parked unmatched for
    review — never auto-posted.
12. **Physical inventory** — periodic counts with ledger-vs-physical
    variances posted to dedicated COGS adjustment accounts (shrink/waste
    stays visible separately from purchases). Comparative period P&L
    included.
13. **POS daily summaries** — Toast/Clover/Square day-end normalizer with
    real category splits (no hardcoded ratios), cash drawer over/short from
    actual safe-drop counts, processing-fee isolation, and card collections
    held in clearing for bank matching.

## Configuration (environment variables — never committed)

| Variable | Purpose |
|---|---|
| `STRIPE_PAYMENT_LINK` | Hosted checkout URL shown to unsubscribed users |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/api/billing/webhook` signatures |
| `BILLING_PRICE_USD` | Display price override (default 149) |
| `QBO_CLEARING_*` | Optional clearing-account name overrides |

All secrets live in the deployment platform's environment configuration.
The codebase contains **no** hardcoded secrets, tokens, or local paths.

## Runtime note

This code targets the Hatchable runtime: routes import the platform SDK
(`import { db, admin, webhooks } from 'hatchable'`) and rely on its
file-based routing, auth tiers (`export const access`), and migration
runner. To run elsewhere, adapt the SDK gateway calls (`db.query` → `pg`,
etc.) and the auth layer — the ledger/matching/report logic in `lib/` is
portable as-is.

## License

Proprietary — © Signal F. All rights reserved.
