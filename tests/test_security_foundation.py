import hashlib
import pytest
from cryptography.fernet import Fernet
from app.config import get_settings
from app.security import CredentialEncryptionNotConfigured, encrypt_ozon_api_key, decrypt_ozon_api_key, hash_session_token, verify_csrf_token

@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()

def test_ozon_key_encryption_round_trip(monkeypatch):
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY",Fernet.generate_key().decode())
    plain="private-ozon-key"
    cipher=encrypt_ozon_api_key(plain)
    assert plain.encode() not in cipher
    assert decrypt_ozon_api_key(cipher)==plain

def test_encryption_fails_closed_without_key(monkeypatch):
    monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY",raising=False)
    with pytest.raises(CredentialEncryptionNotConfigured): encrypt_ozon_api_key("secret")

def test_invalid_encryption_key_fails_closed(monkeypatch):
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY","not-valid")
    with pytest.raises(CredentialEncryptionNotConfigured): encrypt_ozon_api_key("secret")

def test_session_hash_and_csrf_verification():
    assert hash_session_token("s"*64)!="s".encode()*64
    csrf="random-csrf-token"
    assert verify_csrf_token(csrf,hashlib.sha256(csrf.encode()).digest())
    assert not verify_csrf_token("wrong",hashlib.sha256(csrf.encode()).digest())

def test_short_session_token_rejected():
    with pytest.raises(ValueError): hash_session_token("short")
