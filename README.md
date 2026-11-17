# Ozon AI Analytics

Private, read-only analytics workspace for an Ozon Seller account.

## Safety first

- Analytics only: never create or modify products, prices, stock, orders, promotions, campaigns, reviews, chats, or returns.
- Credentials stay server-side in environment variables. Never commit `.env`, API keys, or screenshots containing credentials.
- Ozon uses HTTP POST for some read operations. HTTP verb alone is not a safety boundary: each supported operation must be explicitly allowlisted after checking current official Ozon API documentation.
- No Seller API operations are enabled in this starter scaffold. Only the local health endpoint is available until read-only methods are reviewed and implemented.
- Never expose the API key to a browser or frontend.

## Stack

- Python 3.12+
- FastAPI
- httpx
- pydantic-settings

## Local setup

1. Create a virtual environment.
2. Install dependencies: `pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and fill in credentials locally. Never commit `.env`.
4. Start the API: `uvicorn app.main:app --reload`
5. Open `/health` to verify the service.

## Configuration

- `OZON_CLIENT_ID`: Seller API Client-Id.
- `OZON_API_KEY`: Seller API key. Keep it secret.
- `OZON_API_BASE_URL`: defaults to Ozon's Seller API host.

Catalog pagination helper is implemented in `app/ozon/catalog.py` and covered by tests. It is not connected to live Ozon requests yet: the current official role-mapping page lists `/v2/product/list` under `Admin read only`, but that endpoint was superseded by `/v3/product/list`. We must confirm that the current `/v3/product/list` method is available to this key before adding it to the client's allowlist. The code intentionally keeps `READ_ONLY_OPERATIONS` empty until that permission check is resolved. The helper reads `result.items` and follows `result.last_id`; it does not rely on the deprecated `total` field.

The next integration milestone is to verify the current read-only permissions and exact request/response schema against https://dev.ozon.ru/, then enable only the confirmed catalog operation.

## Project status

Milestone 1: secure project scaffold. No live Ozon requests are made yet.
