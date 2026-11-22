import pytest

from app.ozon.client import OzonReadOnlyClient, READ_ONLY_OPERATIONS


def test_allowlist_contains_only_reviewed_read_only_operations() -> None:
    expected_paths = {
        "product_list": "/v3/product/list",
        "product_info_list": "/v3/product/info/list",
        "product_info_prices": "/v5/product/info/prices",
        "product_info_stocks": "/v4/product/info/stocks",
        "finance_accrual_types": "/v1/finance/accrual/types",
        "finance_accrual_by_day": "/v1/finance/accrual/by-day",
        "finance_accrual_postings": "/v1/finance/accrual/postings",
        "posting_fbo_list": "/v3/posting/fbo/list",
        "posting_fbs_list": "/v4/posting/fbs/list",
        "returns_list": "/v1/returns/list",
    }
    assert set(READ_ONLY_OPERATIONS) == set(expected_paths)
    for name, path in expected_paths.items():
        assert READ_ONLY_OPERATIONS[name].path == path
        assert READ_ONLY_OPERATIONS[name].http_method == "POST"


def test_client_rejects_unapproved_operation_before_network_access() -> None:
    client = OzonReadOnlyClient("client-id", "secret", "https://api-seller.ozon.ru")

    with pytest.raises(ValueError, match="not allowlisted"):
        import asyncio

        asyncio.run(client.execute("product_archive"))


@pytest.mark.parametrize(
    "base_url",
    [
        "http://api-seller.ozon.ru",
        "https://example.com",
        "https://api-seller.ozon.ru.attacker.example",
        "https://user:pass@api-seller.ozon.ru",
        "https://api-seller.ozon.ru/proxy",
    ],
)
def test_client_rejects_untrusted_base_url(base_url: str) -> None:
    with pytest.raises(ValueError, match="approved HTTPS Ozon host"):
        OzonReadOnlyClient("client-id", "secret", base_url)


def test_client_retries_rate_limit_and_honors_retry_after(monkeypatch) -> None:
    import asyncio

    calls = []
    delays = []

    class FakeResponse:
        def __init__(self, status_code, headers=None, body=None):
            self.status_code = status_code
            self.headers = headers or {}
            self.body = body or {}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return self.body

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def request(self, *args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                return FakeResponse(429, {"Retry-After": "2"})
            return FakeResponse(200, body={"status": "ok"})

    async def fake_sleep(delay):
        delays.append(delay)

    monkeypatch.setattr("app.ozon.client.httpx.AsyncClient", FakeAsyncClient)
    monkeypatch.setattr("app.ozon.client.asyncio.sleep", fake_sleep)

    client = OzonReadOnlyClient("client-id", "secret", "https://api-seller.ozon.ru")
    result = asyncio.run(client.execute("finance_accrual_postings", {"posting_numbers": ["P-1"]}))

    assert result == {"status": "ok"}
    assert len(calls) == 2
    assert delays == [2.0]


def test_client_uses_backoff_when_retry_after_is_missing(monkeypatch) -> None:
    import asyncio

    calls = []
    delays = []

    class FakeResponse:
        status_code = 429
        headers = {}

        def raise_for_status(self):
            raise RuntimeError("HTTP 429")

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def request(self, *args, **kwargs):
            calls.append(1)
            if len(calls) < 3:
                return FakeResponse()
            response = FakeResponse()
            response.status_code = 200
            response.json = lambda: {"status": "ok"}
            response.raise_for_status = lambda: None
            return response

    async def fake_sleep(delay):
        delays.append(delay)

    monkeypatch.setattr("app.ozon.client.httpx.AsyncClient", FakeAsyncClient)
    monkeypatch.setattr("app.ozon.client.asyncio.sleep", fake_sleep)

    client = OzonReadOnlyClient("client-id", "secret", "https://api-seller.ozon.ru")
    result = asyncio.run(client.execute("finance_accrual_types"))

    assert result == {"status": "ok"}
    assert delays == [1.0, 2.0]
