import pytest

from app.ozon.client import OzonReadOnlyClient, READ_ONLY_OPERATIONS


def test_allowlist_contains_only_reviewed_read_only_operations() -> None:
    expected_paths = {
        "product_list": "/v3/product/list",
        "product_info_list": "/v3/product/info/list",
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
