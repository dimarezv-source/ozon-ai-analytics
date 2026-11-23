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
from app.security import hash_session_token, verify_csrf_token

router = APIRouter(prefix="/api/auth", tags=["authentication"])
SESSION_COOKIE = "ozon_user_session"
CSRF_COOKIE = "ozon_user_csrf"
SESSION_TTL = timedelta(hours=12)


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
async def login(payload: LoginPayload) -> JSONResponse:
    _ensure_schema()
    try:
        user = get_user_for_login(payload.email)
    except ValueError:
        user = None
    # A constant-time dummy Argon2 verification keeps unknown-user timing closer
    # to the normal password path; no account existence details are returned.
    if user is None:
        verify_password("$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHQxMjM0NTY3OA$" + "A" * 43, payload.password)
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not verify_password(user["password_hash"], payload.password):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
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
