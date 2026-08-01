# AppDeploy app — source mirror

This directory mirrors the source of the production AppDeploy app
(`invoice-scanner-restaurant-bookkeeper-f35e4x.v2.appdeploy.ai`) — the
platform root of Restaurant Bookkeeper in a Box going forward.

**This repo is the hub.** Every change to the live app flows through here
first; deployments are made via the AppDeploy MCP (`deploy_app`) and this
mirror is updated in the same change. The platform injects its SDK
(`@appdeploy/sdk` backend, `@appdeploy/client` frontend) and the react-vite
template baseline (package.json, vite config, index.html shell) at deploy
time — only app-authored files are mirrored.

## Contents

| File | Role |
|---|---|
| `backend/index.ts` | The API: ledger core (48-account COA seeded on first use, double-entry posting with balance validation, roll-up parent protection, P&L/balance sheet computed from journal lines), invoice scan (`ai.extract` with no-guessing guardrails + reconciliation warnings), scan→books posting, daily-sales posting, daybook summary. All posting routes gate on a 428 informed-consent ack. |
| `src/App.tsx` | The SPA: Home landing, Daybook tab (KPIs, month-to-date P&L, daily-sales form), Invoice Scanner tab (scan → verify → post to books), hash routing. Classical design tokens. |
| `tests/tests.txt` | The AppDeploy e2e QA suite run on every deploy. |

## Data model (AppDeploy KV tables — not SQL)

- `accounts` — the chart of accounts, seeded from the 48-account template on
  first request; parent/child roll-ups preserved from migration 0006.
- `journal_entries` — one record per entry with lines embedded; idempotency
  via `journalNo` (DS-<date>, AP-<invoice>); balances computed by scanning
  entries in code (restaurant-scale, thousands of rows).
- `invoices` — scanner results with the category-routed expense breakdown
  and posted-state; images archived to storage.

The Hatchable-targeted engine in `/lib` + `/migrations` remains the richer
reference implementation (multi-tenant, AP aging, delivery, payroll, bank
feed, compliance); modules port from there into `backend/index.ts` as the
AppDeploy build-out continues.
