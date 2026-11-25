# Ozon AI Analytics

Read-only analytics workspace for Ozon Seller accounts, with tenant-scoped workspaces and per-store credentials.

## Safety

- The integration uses only explicitly allowlisted read-only Ozon Seller API methods.
- It never changes products, prices, stock, orders, promotions, campaigns, reviews, chats, or returns.
- Seller API credentials are stored only as GitHub Actions repository secrets. Never commit `.env`, API keys, or screenshots containing credentials.
- Reports and raw JSON are uploaded as private GitHub Actions artifacts and retained for 7 days.

## Required GitHub secrets

In **Settings → Secrets and variables → Actions**, configure:

- `OZON_CLIENT_ID`
- `OZON_API_KEY`

The API key must have read access to the relevant catalog, finance, FBO posting, FBS posting, and Returns read-only methods. Do not grant write permissions for this project.

## Catalog export

1. Open **Actions → Ozon read-only catalog export → Run workflow**.
2. Open the completed run. The Summary page shows the Markdown report.
3. Download the `ozon-catalog-and-report` artifact for raw JSON and report (7-day retention).

The export reads product IDs from `/v3/product/list`, then enriches them through `/v3/product/info/list` in batches.

## Price and commission export (FBS)

The catalog workflow also requests `/v5/product/info/prices` for the seller's current products. It exports the raw price and commission fields returned by Ozon, including FBS-specific commission fields when available. The workflow is read-only and does not change prices or stocks. If Ozon rejects the method because of API-key role permissions, check that the key has access to this informational method; do not grant write permissions.

## Finance export

1. Open **Actions → Ozon read-only finance export → Run workflow**.
2. Choose the number of completed UTC days to export (1–365; default 7).
3. The Summary contains the finance report; the `ozon-finance-and-report` artifact contains raw JSON and Markdown.
4. The export uses `/v1/finance/accrual/types` and `/v1/finance/accrual/by-day`. It does not use the retired `/v3/finance/transaction/list` endpoint.

The report deliberately does not label accrual totals as profit. Product purchase costs must be entered separately, and fee types/returns must be interpreted before calculating SKU profitability.

## Orders and postings export

1. Open **Actions → Ozon read-only orders export → Run workflow**.
2. Choose the number of completed UTC days to export (1–365; default 7).
3. The workflow reads FBO via `/v3/posting/fbo/list` and FBS via `/v4/posting/fbs/list`, using cursor pagination.
4. The Summary shows posting statuses, delivered posting counts, delivered units, and an item-price GMV estimate. The `ozon-orders-and-report` artifact contains raw JSON and Markdown (7-day retention).

Important interpretation:

- A posting is not the same as a unique order: one order can contain multiple postings.
- The report counts an item as delivered only when the posting's current status is `delivered`.
- GMV is estimated from item prices in posting responses. It is not seller payout, net revenue, or profit.
- Delivered postings may later be returned/refunded. Returns and refunds require a separate reconciliation.
- Finance accruals remain the source for settlements and fees. Orders and finance must be reconciled before profitability is calculated.

## Returns export

1. Open **Actions → Ozon read-only returns export → Run workflow**.
2. Choose the logistic return date window (1–365 completed UTC days; default 31).
3. The workflow reads FBO and FBS returns through `/v1/returns/list`, paginating with `last_id`. It queries `logistic_return_date` and `visual_status_change_moment` in separate requests and deduplicates records by return ID.
4. The Summary groups return records by scheme, return type, visual status, reason, and SKU. The `ozon-returns-and-report` artifact contains raw JSON and Markdown (7-day retention).

The returns window covers either the logistics return date or a visual status change, not the original order date. Product-price value is not a confirmed refund or seller loss; reconcile return records with finance accruals before deducting anything from sales.

## Combined sales reconciliation

For the first end-to-end sales estimate, use **Actions → Ozon read-only sales reconciliation → Run workflow**.

- Select the posting cohort window (1–365 completed UTC days; default 31).
- The workflow fetches FBO and FBS postings for that cohort, then fetches return events and visual status changes for the last 365 days.
- It matches returns to delivered posting lines by posting number and SKU.
- It subtracts matched `Cancellation`, `FullReturn`, `PartialReturn`, and `ClientReturn` quantities. Unknown and unmatched records remain visible and are not silently deducted.
- The `ozon-sales-reconciliation` artifact contains both raw exports and the SKU-level report (7-day retention).

The net units and net GMV are still estimates from current posting/return snapshots and original item prices. Recent orders can receive returns later. Reconcile the report with finance accruals before treating it as actual net revenue or profit.

## Live inventory monitoring

The hosted dashboard includes a separate read-only inventory panel. It reads current stock records through `/v4/product/info/stocks`, with cursor pagination. Available quantity is calculated as `present - reserved`; FBO and FBS are shown separately. The panel can estimate days of stock from delivered units in the selected sales period, but this is a simple historical-rate indicator, not a demand forecast. No stock update methods are allowlisted or called.

The stock endpoint may require the **Admin read-only** Seller API role. If the inventory panel reports an access error while the catalog still loads, check the key's read-only role access to this informational method; do not grant write permissions.

## Local development

- Python 3.12+
- Install dependencies: `pip install -r requirements.txt`
- Fetch catalog: `python scripts/fetch_catalog.py` (requires `OZON_CLIENT_ID` and `OZON_API_KEY`).
- Fetch postings: `python scripts/fetch_postings.py` (requires the same environment variables; optional `SALES_DAYS`, 1–31).
- Build posting report: `python scripts/build_postings_report.py`
- Run tests: `python -m unittest discover -s tests -v`
- Start the API: `uvicorn app.main:app --reload`
- Open `/health` to verify the service.

## Hosted dashboard (Render)

A Render Blueprint is provided in `render.yaml`. To deploy the private dashboard:

1. Open [Render Blueprints](https://dashboard.render.com/blueprints), connect the GitHub account that can access this private repository, and create a Blueprint from `dimarezv-source/ozon-ai-analytics`.
2. Render reads `render.yaml` and prompts for `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY`, and `BOOTSTRAP_TOKEN`. For `DATABASE_URL`, use the Internal Database URL from the existing `ozon-ai-analytics-db` PostgreSQL instance. Generate a fresh Fernet key for `CREDENTIAL_ENCRYPTION_KEY` and a separate random token of at least 24 characters for `BOOTSTRAP_TOKEN`; enter both directly in Render and never commit or paste them into chat. Ozon credentials are connected per store inside the authenticated workspace and encrypted at rest; the web service no longer requires global `OZON_CLIENT_ID` / `OZON_API_KEY` values. These values remain GitHub Actions secrets only for the separate manual export workflows.
3. When the service deploys, open `https://<your-render-service>.onrender.com/dashboard` and enter the dashboard login/password in the browser's HTTP Basic Authentication prompt. Then create the first workspace owner in the in-dashboard workspace gate using the `BOOTSTRAP_TOKEN`, email, and a strong password. After bootstrap, connect each Ozon store with a read-only API key; the key is encrypted server-side. `/health` is available for service health checks.
4. The free Render instance is suitable for a trial, not uninterrupted production use: it can spin down after 15 minutes without traffic and may take about a minute to wake. Set `DATABASE_URL` on the web service to the PostgreSQL database's **Internal Database URL** from the Render database page (keep it secret). The app creates the cost-settings table automatically on first use. If `DATABASE_URL` is absent, cost assumptions continue to work in browser local storage only. The current database is on Render's free plan and has an expiry date; upgrade or recreate it before expiry to avoid losing persisted settings.

The hosted dashboard reads Ozon data only after a valid tenant session and explicit store selection. Every Ozon-backed analytics request rechecks that the selected active store belongs to the authenticated tenant and builds its client from that store's server-side credentials. Missing sessions, foreign/inactive stores, or unavailable credential encryption fail closed; global Ozon credentials are not used as a fallback. Product purchase cost, packaging, advertising, transit, other expenses, and optional tax assumptions are stored by tenant in PostgreSQL when `DATABASE_URL` is configured; clearing browser storage does not delete the PostgreSQL copy. The current cost-settings table is tenant-scoped, not yet store-scoped, so multiple stores in one tenant share SKU cost assumptions.

The dashboard's date-range sales endpoint reads delivered FBO/FBS postings for a selected UTC date range and returns an SKU-level breakdown (units, estimated GMV, and share of period GMV). Its GMV is an item-price estimate before returns, deductions, and finance reconciliation; it must not be treated as seller payout or net profit. Returns and finance are still available through separate manual GitHub Actions reports and are not yet reconciled into the live dashboard.

The workspace now has database-backed user sessions, tenant membership checks, encrypted per-store API-key storage, and a selected-store dashboard gate. The legacy dashboard Basic Auth remains as an outer gate for the static shell; the workspace session is the authorization boundary for analytics. The current Render free plan is a prototype environment, not a paid multi-tenant deployment. OAuth private-app connection, per-store cost-settings partitioning, billing, production monitoring, and a production hosting plan remain follow-up work.

## Project status

- Read-only catalog export and product detail enrichment: implemented; live catalog list verified.
- Read-only finance accrual export: implemented; the latest diagnostic run returned a valid empty `accruals` list for the tested period.
- Read-only FBO/FBS posting export and delivered-product report: implemented; awaiting first live run under the seller account.
- Read-only unified FBO/FBS returns export and SKU report: implemented; awaiting first live run and confirmation of API-key permissions.
- Combined delivered-posting and 365-day return reconciliation: implemented with SKU-level net-unit/GMV estimates; awaiting first live run.
- Tenant/store analytics isolation: implemented on the feature branch and under CI review; not deployed until PR review/merge.
- SKU profitability: not yet calculated; requires reconciliation of delivered postings, finance accruals, returns/refunds, and product purchase costs.

All exports are manual GitHub Actions workflows. They do not run in the background or on a schedule.

## Catalog intelligence

The authenticated catalog audit works without sales history. It reports card completeness, structural SEO, Ozon content rating and price index when the Seller API key has access, plus Ozon product-search metrics and actual query phrases when those analytics are available.

The separate **search opportunity** score ranks products only against the seller's own catalog. It combines relative search-user volume with average search position and view conversion when present. Missing metrics are excluded and the remaining weights are normalized. Products without positive search-user data are left unscored. This score is a prioritization aid, not marketplace-wide demand, competitor share, or a sales forecast.

Search analytics coverage depends on Ozon's subscription and API permissions. The dashboard and CSV export explicitly show missing fields rather than inventing values.
