# Ozon AI Analytics

Private, read-only analytics workspace for an Ozon Seller account.

## Safety

- The integration currently calls only the informational `POST /v3/product/list` endpoint.
- It never changes products, prices, stock, orders, promotions, campaigns, reviews, chats, or returns.
- Seller API credentials are stored only as GitHub Actions repository secrets. Never commit `.env`, API keys, or screenshots containing credentials.
- The catalog and report are uploaded as private GitHub Actions artifacts and retained for 7 days.

## First live catalog export (phone-friendly)

1. Open **Settings → Secrets and variables → Actions** and create Repository secrets `OZON_CLIENT_ID` and `OZON_API_KEY`.
2. The key must have permission to read products. If Ozon returns HTTP 403, check the key's role; do not replace it with a write-enabled key just to make the request pass.
3. Open **Actions → Ozon read-only catalog export → Run workflow**.
4. Open the completed run. The **Summary** page will show the generated Markdown report; no ChatGPT file upload is required.
5. The `ozon-catalog-and-report` artifact is also available for backup (7-day retention).

## What the first report contains

- Total products received, archived count, and missing offer IDs/names.
- Product status distribution.
- A compact sample of up to 50 products.

Important: `/v3/product/list` does not provide current selling prices, stock quantities, sales, fees, or profitability. Those require separate read-only API endpoints. They are not estimated or fabricated in this report.

## Local development

- Python 3.12+
- Install dependencies: `pip install -r requirements.txt`
- Fetch catalog: `python scripts/fetch_catalog.py` (requires `OZON_CLIENT_ID` and `OZON_API_KEY` environment variables).
- Build report: `python scripts/build_report.py`
- Start the API: `uvicorn app.main:app --reload`
- Open `/health` to verify the service.

## Project status

- Secure FastAPI starter and Ozon read-only client: present.
- Catalog pagination helper and tests: present.
- Manual GitHub Actions catalog export and Markdown summary: present after workflow run.
- Live account connection: verify by a successful manual workflow run.
- Price, stock, sales, fee, returns, and profitability analysis: next milestones after validating the relevant read-only API methods and permissions.

The workflow is manual only; it does not run in the background or on a schedule.
