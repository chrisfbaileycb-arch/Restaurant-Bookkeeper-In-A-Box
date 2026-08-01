# Session handoff — read this first

Continuing work on **Restaurant Bookkeeper in a Box**. This repo is the hub:
every change lands here first; deployments are builds of it.

## The live app

- Platform: **AppDeploy** (via the AppDeploy MCP connector)
- app_id: `invoice-scanner-restaurant-bookkeeper-f35e4x`
- URL: https://invoice-scanner-restaurant-bookkeeper-f35e4x.v2.appdeploy.ai/
- Features declared on deploy: `api, database, storage, ai.ocr, ai.extract`
- This `appdeploy/` folder mirrors the app's authored sources
  (`backend/index.ts`, `src/App.tsx`, `src/index.css`, `tests/tests.txt`).
  The platform injects its SDK + react-vite template baseline.

## Immediate next steps (in order)

1. **Deploy the staged sources in this folder** — branch
   `claude/appdeploy-app-mirror` (PR #8) carries a Bank tab (CSV import,
   deposit auto-match, expense review queue) and a Reports tab (printable
   P&L, balance sheet, trial balance, general journal) that are staged but
   NOT yet live. Ship `backend/index.ts` + `src/App.tsx` as full-content
   file updates, `src/index.css` print block and the tests/tests.txt tab
   expectation via diffs, poll `get_app_status` to `ready`, then merge PR #8.
2. **Add user login** (AppDeploy `auth` feature; scope every record by
   `ownerId`) — REQUIRED before real financial data goes in; the app is
   currently unauthenticated.
3. Port remaining modules from the reference engine in `/lib` +
   `/migrations` (Hatchable-targeted; richer implementation): check
   reconciliation → compliance calendar (CO deadlines) → AP aging →
   delivery reconciler → payroll journal recording → QBO export.

## Standing decisions

- AppDeploy is the platform root; Hatchable is retired (do not link to it).
- GitHub is the hub — mirror every deployed change back into this folder.
- Recording only: the product never moves money; payroll execution is out
  of scope (journal recording only).
- Every posting route gates on a 428 informed-consent ack.
- Owner context: preparing books for a city audit — Reports (especially the
  General Journal) and Bank import are the priority path.
- Full product roadmap: `research/restaurant-bookkeeper-roadmap.md` in the
  `chrisfbaileycb-arch/ECC` repo.
