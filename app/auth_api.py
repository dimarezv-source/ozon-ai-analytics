"""HTTP API for first-owner bootstrap and database-backed user sessions.

The legacy dashboard login remains active until every analytics route is tenant/store
scoped. These endpoints deliberately do not grant access to legacy analytics routes.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth import hash_password, new_csrf_token, new_session_token, verify_password
from app.config import get_settings
from app.identity import (
    IdentityNotFound, create_first_tenant_owner, create_session,
    get_user_for_login, revoke_session,
)
from app.persistence import _connect
from app.persistence_schema import migrate_tenant_foundation
from app.login_throttle import ensure_login_throttle_schema, is_limited, record_failure, clear_failures
from app.security import hash_session_token, verify_csrf_token, CredentialEncryptionNotConfigured
from app.identity import load_session
from app.store_repository import create_store, list_stores, deactivate_store, StoreAccessDenied
from app.ozon.client import OzonReadOnlyClient

router = APIRouter(prefix="/api/auth", tags=["authentication"])
SESSION_COOKIE = "ozon_user_session"
CSRF_COOKIE = "ozon_user_csrf"
SESSION_TTL = timedelta(hours=12)
_DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing-only")


class BootstrapPayload(BaseModel):
    bootstrap_token: str = Field(min_length=24, max_length=512)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=12, max_length=1024)
    tenant_name: str = Field(min_length=1, max_length=160)


class LoginPayload(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


def _ensure_schema() -> None:
    with _connect() as connection:
        migrate_tenant_foundation(connection)
    ensure_login_throttle_schema()


def _set_session(response: JSONResponse, token: str, csrf: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, max_age=int(SESSION_TTL.total_seconds()),
        httponly=True, secure=True, samesite="strict", path="/",
    )
    response.set_cookie(
        CSRF_COOKIE, csrf, max_age=int(SESSION_TTL.total_seconds()),
        httponly=False, secure=True, samesite="strict", path="/",
    )


def _issue_session(user: dict, membership: dict) -> JSONResponse:
    token, csrf = new_session_token(), new_csrf_token()
    expires = datetime.now(timezone.utc) + SESSION_TTL
    try:
        create_session(
            user["user_id"], membership["tenant_id"],
            hash_session_token(token), hashlib.sha256(csrf.encode("utf-8")).digest(),
            expires,
        )
    except IdentityNotFound:
        raise HTTPException(status_code=403, detail="Active membership required.") from None
    response = JSONResponse({
        "status": "ok",
        "user": {"email": user["email"]},
        "tenant": {"id": membership["tenant_id"], "name": membership["tenant_name"], "role": membership["role"]},
        "expires_at": expires.isoformat(),
        "analytics_access": "not_enabled_until_tenant_isolation_is_complete",
    })
    _set_session(response, token, csrf)
    return response


@router.get("/bootstrap/status")
async def bootstrap_status() -> dict:
    _ensure_schema()
    with _connect() as connection:
        row = connection.execute("SELECT EXISTS(SELECT 1 FROM users) AS has_users").fetchone()
    return {"bootstrap_available": not bool(row["has_users"]) and bool(get_settings().bootstrap_token)}


@router.post("/bootstrap")
async def bootstrap_owner(payload: BootstrapPayload) -> JSONResponse:
    configured = (get_settings().bootstrap_token or "").strip()
    if not configured or not hmac.compare_digest(payload.bootstrap_token, configured):
        raise HTTPException(status_code=403, detail="Bootstrap is unavailable or token is invalid.")
    try:
        _ensure_schema()
        password_hash = hash_password(payload.password)
        created = create_first_tenant_owner(payload.email, password_hash, payload.tenant_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except RuntimeError as exc:
        if "already initialized" in str(exc):
            raise HTTPException(status_code=409, detail="The first account has already been created.") from None
        raise HTTPException(status_code=503, detail="Account storage is unavailable.") from None
    user = {"user_id": created["user_id"], "email": created["email"]}
    membership = {
        "tenant_id": created["tenant_id"], "tenant_name": payload.tenant_name.strip(), "role": "owner",
    }
    return _issue_session(user, membership)


@router.post("/login")
async def login(payload: LoginPayload, request: Request) -> JSONResponse:
    _ensure_schema()
    address = request.client.host if request.client else "unknown"
    attempt_key = hashlib.sha256(f"{address}|{payload.email.strip().casefold()[:254]}".encode("utf-8")).hexdigest()
    if is_limited(attempt_key):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again in 15 minutes.")
    try:
        user = get_user_for_login(payload.email)
    except ValueError:
        user = None
    # A constant-time dummy Argon2 verification keeps unknown-user timing closer
    # to the normal password path; no account existence details are returned.
    if user is None:
        verify_password(_DUMMY_PASSWORD_HASH, payload.password)
        record_failure(attempt_key)
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not verify_password(user["password_hash"], payload.password):
        record_failure(attempt_key)
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    clear_failures(attempt_key)
    if not user["memberships"]:
        raise HTTPException(status_code=403, detail="No active workspace membership.")
    return _issue_session(user, user["memberships"][0])


@router.post("/logout")
async def logout(request: Request) -> JSONResponse:
    token = request.cookies.get(SESSION_COOKIE)
    csrf = request.headers.get("x-csrf-token", "")
    csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
    if not token or not csrf_cookie or not hmac.compare_digest(csrf, csrf_cookie):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")
    _ensure_schema()
    # The CSRF cookie is also checked against the hash stored with this session.
    with _connect() as connection:
        row = connection.execute(
            "SELECT csrf_token_hash FROM user_sessions WHERE token_hash = %s AND revoked_at IS NULL",
            (hash_session_token(token),),
        ).fetchone()
    if row is None or not verify_csrf_token(csrf, row["csrf_token_hash"]):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")
    revoke_session(hash_session_token(token))
    response = JSONResponse({"status": "ok"})
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=True, httponly=False, samesite="strict")
    return response


class StorePayload(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    client_id: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=1, max_length=4096)


def _current_user_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")
    _ensure_schema()
    session = load_session(hash_session_token(token))
    if session is None:
        raise HTTPException(status_code=401, detail="Session expired or revoked.")
    return session


def _require_csrf(request: Request, session: dict) -> None:
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get("x-csrf-token", "")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")
    if not verify_csrf_token(header, session["csrf_token_hash"]):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")


@router.get("/me")
async def current_user(request: Request) -> dict:
    session = _current_user_session(request)
    return {
        "user": {"email": session["email"]},
        "tenant": {"id": session["tenant_id"], "name": session["tenant_name"], "role": session["role"]},
        "session_id": session["session_id"],
    }


@router.get("/stores")
async def get_stores(request: Request) -> dict:
    session = _current_user_session(request)
    return {"stores": list_stores(session["user_id"], session["tenant_id"])}


@router.post("/stores")
async def connect_store(payload: StorePayload, request: Request) -> JSONResponse:
    session = _current_user_session(request)
    _require_csrf(request, session)
    if session["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only workspace owners and admins can connect stores.")
    settings = get_settings()
    try:
        client = OzonReadOnlyClient(payload.client_id.strip(), payload.api_key, settings.ozon_api_base_url)
        # Credential check uses only the allowlisted read-only product listing API.
        await client.execute("product_list", {"filter": {"visibility": "ALL"}, "last_id": "", "limit": 1})
    except Exception:
        raise HTTPException(status_code=400, detail="Ozon did not accept these credentials or the read-only check failed.") from None
    try:
        store = create_store(
            session["user_id"], session["tenant_id"], payload.name,
            payload.client_id, payload.api_key,
        )
    except CredentialEncryptionNotConfigured:
        raise HTTPException(status_code=503, detail="Server-side credential encryption is not configured.") from None
    except StoreAccessDenied:
        raise HTTPException(status_code=403, detail="Store connection is not permitted.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return JSONResponse({"status": "connected", "store": store}, status_code=201)


@router.delete("/stores/{store_id}")
async def disconnect_store(store_id: str, request: Request) -> dict:
    session = _current_user_session(request)
    _require_csrf(request, session)
    try:
        changed = deactivate_store(session["user_id"], session["tenant_id"], store_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if not changed:
        raise HTTPException(status_code=404, detail="Store not found or action not permitted.")
    return {"status": "disconnected"}
