"""Google sign-in.

A signed-in user gets a sync account keyed by their Google `sub`, so the existing sync
endpoints work unchanged. The browser holds only a random session token in an httpOnly
cookie; the database stores its SHA-256 hash.
"""

import logging
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..config import GOOGLE_CLIENT_ID
from ..database import db
from .sync import (
    SESSION_COOKIE,
    delete_account_rows,
    format_ts,
    hash_code,
    hash_session,
    require_account,
    utc_now,
)

logger = logging.getLogger("aninyom.api.auth")
router = APIRouter(prefix="/api/auth", tags=["Auth"])

SESSION_TTL = timedelta(days=30)


class CredentialPayload(BaseModel):
    credential: str = Field(min_length=1, max_length=4096)


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=True, samesite="lax")


async def _find_user(request: Request) -> Optional[dict]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return await db.fetchrow(
        """SELECT u.name, u.email, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?""",
        hash_session(token),
        format_ts(utc_now()),
    )


@router.get("/config")
async def auth_config():
    return {"google_client_id": GOOGLE_CLIENT_ID or None}


@router.post("/google")
async def sign_in_with_google(payload: CredentialPayload, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        claims = await run_in_threadpool(
            id_token.verify_oauth2_token,
            payload.credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    now = format_ts(utc_now())
    code_hash = hash_code("google:" + claims["sub"])
    email = claims.get("email")
    name = claims.get("name")
    picture = claims.get("picture")
    try:
        await db.execute(
            """INSERT INTO sync_accounts (code_hash, created_at, last_seen_at) VALUES (?, ?, ?)
               ON CONFLICT (code_hash) DO NOTHING""",
            code_hash,
            now,
            now,
        )
        await db.execute(
            """INSERT INTO users (id, code_hash, email, name, picture, created_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (code_hash) DO UPDATE SET
                   email = excluded.email,
                   name = excluded.name,
                   picture = excluded.picture,
                   last_seen_at = excluded.last_seen_at""",
            secrets.token_urlsafe(16),
            code_hash,
            email,
            name,
            picture,
            now,
            now,
        )
        user = await db.fetchrow("SELECT id FROM users WHERE code_hash = ?", code_hash)
        token = secrets.token_urlsafe(32)
        await db.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            hash_session(token),
            user["id"],
            now,
            format_ts(utc_now() + SESSION_TTL),
        )
    except Exception as e:
        logger.error("Failed creating Google session: %s", e)
        raise HTTPException(status_code=500, detail="Failed to sign in")

    _set_session_cookie(response, token)
    return {"name": name, "email": email, "picture": picture}


@router.get("/me")
async def current_user(request: Request):
    user = await _find_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


@router.post("/logout")
async def sign_out(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.execute("DELETE FROM sessions WHERE token_hash = ?", hash_session(token))
    _clear_session_cookie(response)
    return {"status": "signed_out"}


@router.delete("/account")
async def delete_account(response: Response, code_hash: str = Depends(require_account)):
    """Delete the signed-in account and all synced data. Local data on the device is kept."""
    try:
        await delete_account_rows(code_hash)
    except Exception as e:
        logger.error("Failed deleting account: %s", e)
        raise HTTPException(status_code=500, detail="Failed to delete account")
    _clear_session_cookie(response)
    return {"status": "deleted"}
