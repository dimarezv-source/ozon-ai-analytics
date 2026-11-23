from app.auth import (
    hash_password,
    new_csrf_token,
    new_session_token,
    password_hash_needs_upgrade,
    verify_password,
)


def test_password_hash_uses_argon2id_and_verifies() -> None:
    password = "correct horse battery staple"
    hashed = hash_password(password)

    assert hashed.startswith("$argon2id$")
    assert hashed != password
    assert verify_password(hashed, password)
    assert not verify_password(hashed, "incorrect password")


def test_password_hash_rejects_short_or_invalid_input() -> None:
    import pytest

    with pytest.raises(ValueError):
        hash_password("short")
    with pytest.raises(ValueError):
        hash_password("")


def test_password_verification_fails_closed_for_malformed_hash() -> None:
    assert not verify_password("not-a-hash", "some password")
    assert not verify_password("", "some password")


def test_opaque_tokens_have_sufficient_entropy_and_are_distinct() -> None:
    session_a, session_b = new_session_token(), new_session_token()
    csrf_a, csrf_b = new_csrf_token(), new_csrf_token()

    assert len(session_a) >= 64
    assert len(csrf_a) >= 40
    assert session_a != session_b
    assert csrf_a != csrf_b
    assert password_hash_needs_upgrade(hash_password("correct horse battery staple")) is False
