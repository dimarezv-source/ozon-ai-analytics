import pytest

from app.ozon.client import OzonReadOnlyClient, READ_ONLY_OPERATIONS


def test_read_only_allowlist_starts_empty() -> None:
    assert READ_ONLY_OPERATIONS == {}


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
