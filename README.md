# Ozon AI Analytics

Private, read-only analytics workspace for an Ozon Seller account.

## Safety

- The integration only calls the informational `POST /v3/product/list` endpoint.
- It never changes products, prices, stock, orders, promotions, campaigns, reviews, chats, or returns.
- Seller API credentials are stored only as GitHub Actions repository secrets. Never commit `.env`, API keys, or screenshots containing credentials.
- The catalog export is uploaded as a private GitHub Actions artifact and retained for 7 days.

## First live catalog export (phone-friendly)

1. Open the repository **Settings → Secrets and variables → Actions**.
2. Create two **Repository secrets**:
   - `OZON_CLIENT_ID` — the Seller API Client-Id.
   - `OZON_API_KEY` — the Seller API key.
3. The key must have permission to read products. If Ozon returns HTTP 403, check the key's role in Seller API settings; do not replace it with a write-enabled key just to make the request pass.
4. Open **Actions → Ozon read-only catalog export → Run workflow**.
5. When the run finishes successfully, open the run and download the `ozon-catalog` artifact.
6. Upload `ozon-products.json` into this ChatGPT conversation. I can then analyze the catalog, identify products with missing data, and prepare the next analytics step.

The workflow is manual only. It does not run in the background or on a schedule.

## Local development

- Python 3.12+
- Install dependencies: `pip install -r requirements.txt`
- Copy `.env.example` to `.env` only for local development; never commit it.
- Start the API: `uvicorn app.main:app --reload`
- Open `/health` to verify the service.

## Project status

- Secure FastAPI starter and Ozon read-only client: present.
- Catalog pagination helper and tests: present.
- Manual GitHub Actions catalog export: present.
- Live account connection: pending repository secrets and a successful manual workflow run.
- Sales, finance, returns, fees, and profitability analysis: next milestones after the catalog export is available.

The product list endpoint is documented in Ozon's Seller API materials. Ozon's role-mapping page is updated periodically, so access is ultimately confirmed by the actual account key when the read-only request is run.
