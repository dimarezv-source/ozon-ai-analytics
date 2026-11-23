"""Credential encryption and session/CSRF primitives."""
from __future__ import annotations
import hashlib
import hmac
from cryptography.fernet import Fernet, InvalidToken
from app.config import get_settings

class CredentialEncryptionNotConfigured(RuntimeError):
    pass

def _fernet() -> Fernet:
    key=(get_settings().credential_encryption_key or "").strip()
    if not key:
        raise CredentialEncryptionNotConfigured("CREDENTIAL_ENCRYPTION_KEY is required before storing Ozon credentials.")
    try: return Fernet(key.encode("ascii"))
    except (ValueError,UnicodeError): raise CredentialEncryptionNotConfigured("CREDENTIAL_ENCRYPTION_KEY must be a valid Fernet key.") from None

def encrypt_ozon_api_key(api_key: str) -> bytes:
    if not isinstance(api_key,str) or not api_key or len(api_key)>4096: raise ValueError("Invalid Ozon API key.")
    return _fernet().encrypt(api_key.encode("utf-8"))

def decrypt_ozon_api_key(ciphertext: bytes) -> str:
    try: return _fernet().decrypt(ciphertext).decode("utf-8")
    except (InvalidToken,UnicodeError,TypeError): raise ValueError("Could not decrypt stored Ozon credentials.") from None

def hash_session_token(token: str) -> bytes:
    if not isinstance(token,str) or len(token)<32: raise ValueError("Invalid session token.")
    return hashlib.sha256(token.encode("utf-8")).digest()

def verify_csrf_token(provided: str, expected_hash: bytes) -> bool:
    if not isinstance(provided,str) or not provided or len(provided)>512: return False
    return hmac.compare_digest(hashlib.sha256(provided.encode("utf-8")).digest(),expected_hash)
