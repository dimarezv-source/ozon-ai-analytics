"""Persistent database-backed login throttling; stores only a keyed digest."""
from __future__ import annotations

from app.persistence import _connect


def ensure_login_throttle_schema() -> None:
    with _connect() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS auth_login_attempts (
                attempt_key TEXT PRIMARY KEY,
                attempts INTEGER NOT NULL DEFAULT 0,
                window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"""
        )


def is_limited(key: str) -> bool:
    with _connect() as connection:
        row = connection.execute(
            """SELECT attempts FROM auth_login_attempts
               WHERE attempt_key = %s
                 AND window_started_at > NOW() - INTERVAL '15 minutes'""",
            (key,),
        ).fetchone()
    return bool(row and row["attempts"] >= 8)


def record_failure(key: str) -> None:
    with _connect() as connection:
        connection.execute(
            """INSERT INTO auth_login_attempts
                   (attempt_key, attempts, window_started_at, updated_at)
               VALUES (%s, 1, NOW(), NOW())
               ON CONFLICT (attempt_key) DO UPDATE SET
                 attempts = CASE
                   WHEN auth_login_attempts.window_started_at <= NOW() - INTERVAL '15 minutes'
                   THEN 1 ELSE auth_login_attempts.attempts + 1 END,
                 window_started_at = CASE
                   WHEN auth_login_attempts.window_started_at <= NOW() - INTERVAL '15 minutes'
                   THEN NOW() ELSE auth_login_attempts.window_started_at END,
                 updated_at = NOW()""",
            (key,),
        )


def clear_failures(key: str) -> None:
    with _connect() as connection:
        connection.execute("DELETE FROM auth_login_attempts WHERE attempt_key = %s", (key,))
