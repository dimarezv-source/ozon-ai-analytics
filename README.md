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

The first integration milestone is to verify available read methods against https://dev.ozon.ru/ and add only explicitly approved analytics, catalog, and report methods.

## Project status

Milestone 1: secure project scaffold. No live Ozon requests are made yet.
