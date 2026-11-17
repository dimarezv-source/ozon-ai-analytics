# Ozon AI Analytics

Private, read-only analytics workspace for an Ozon Seller account.

## Safety

- The integration uses only read-only product information endpoints and finance accrual endpoints: `/v3/product/list`, `/v3/product/info/list`, `/v1/finance/accrual/types`, and `/v1/finance/accrual/by-day`.
- It never changes products, prices, stock, orders, promotions, campaigns, reviews, chats, or returns.
- Seller API credentials are stored only as GitHub Actions repository secrets. Never commit `.env`, API keys, or screenshots containing credentials.
- The catalog and report are uploaded as private GitHub Actions artifacts and retained for 7 days.

## Run a catalog export

1. In **Settings → Secrets and variables → Actions**, create Repository secrets `OZON_CLIENT_ID` and `OZON_API_KEY`.
2. Open **Actions → Ozon read-only catalog export → Run workflow**.
3. Open the completed run. The **Summary** page shows the Markdown report; no ChatGPT file upload is required.
4. The `ozon-catalog-and-report` artifact is available for backup (7-day retention).

## What the report contains

- Product count, archived count, missing offer IDs/names, and status distribution.
- Product IDs, offer IDs, names, and any price/stock fields returned by the detail endpoint.
- The export first reads product IDs from `/v3/product/list`, then enriches them through `/v3/product/info/list` in batches.

Important: a field is included only when Ozon returns it. Sales, commissions, logistics fees, and profitability require additional read-only endpoints and validated calculations.

## Finance export\n\n1. Open **Actions → Ozon read-only finance export → Run workflow**.\n2. Choose the number of completed UTC days to export (1–31; default 7).\n3. The Summary contains the finance report; the `ozon-finance-and-report` artifact contains the raw JSON and Markdown report (7-day retention).\n4. The export uses the current `/v1/finance/accrual/types` and `/v1/finance/accrual/by-day` endpoints. The old `/v3/finance/transaction/list` endpoint is not used.\n\nThe report deliberately does not label accrual totals as profit. Product purchase costs must be entered separately, and fee types/returns must be interpreted before calculating SKU profitability.\n\n## Local development

- Python 3.12+
- Install dependencies: `pip install -r requirements.txt`
- Fetch catalog: `python scripts/fetch_catalog.py` (requires `OZON_CLIENT_ID` and `OZON_API_KEY` environment variables).
- Build report: `python scripts/build_report.py`
- Start the API: `uvicorn app.main:app --reload`
- Open `/health` to verify the service.

## Project status

- Secure FastAPI starter, Ozon read-only client, catalog pagination helper, and tests: present.
- Manual GitHub Actions catalog export and Markdown report: present.\n- Manual read-only finance accrual export and report: added; awaiting first live run under the seller account.
- Product detail enrichment via `/v3/product/info/list`: added; verify by the next successful workflow run.
- Live account connection: catalog list endpoint verified; detailed endpoint pending verification under the account's API-key permissions.
- Sales, fee, returns, and profitability analysis: future milestones.

The workflow is manual only; it does not run in the background or on a schedule.
