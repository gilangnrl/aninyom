"""Sync API Routes.

Anonymous, code-based sync of watchlist, watch history and settings across devices.
The server never sees a user account: a random sync code is the only credential, and
only its SHA-256 hash is stored.
"""

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, BeforeValidator, Field

from ..database import db

logger = logging.getLogger("aninyom.api.sync")
router = APIRouter(prefix="/api/sync", tags=["Sync"])

CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/1, I/L/O
CODE_LENGTH = 16  # shown as XXXX-XXXX-XXXX-XXXX (~79 bits)
MAX_BOOKMARKS = 2000
MAX_HISTORY = 30
MAX_SETTINGS = 50
MAX_CLOCK_SKEW = timedelta(minutes=5)

BookmarkStatus = Literal[
    "watching", "plan_to_watch", "completed", "dropped", "favorite", "removed"
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def format_ts(dt: datetime) -> str:
    """Canonical timestamp, same shape as JavaScript's Date.toISOString()."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def normalize_ts(value: str) -> str:
    """Parse a client timestamp and store it in one sortable format.

    Text comparison is used for last-writer-wins, so every value must share the same shape.
    Timestamps far in the future are clamped to now so they cannot block future updates.
    """
    if not isinstance(value, str):
        raise ValueError("timestamp must be a string")
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = utc_now()
    if dt > now + MAX_CLOCK_SKEW:
        dt = now
    return format_ts(dt)


Timestamp = Annotated[str, BeforeValidator(normalize_ts)]


class BookmarkRecord(BaseModel):
    anilist_id: int = Field(gt=0)
    status: BookmarkStatus
    title_romaji: Optional[str] = Field(None, max_length=300)
    title_english: Optional[str] = Field(None, max_length=300)
    cover_image_large: Optional[str] = Field(None, max_length=500)
    average_score: Optional[int] = None
    updated_at: Timestamp


class HistoryRecord(BaseModel):
    anilist_id: int = Field(gt=0)
    episode_number: int = Field(gt=0)
    title_romaji: Optional[str] = Field(None, max_length=300)
    title_english: Optional[str] = Field(None, max_length=300)
    cover_image: Optional[str] = Field(None, max_length=500)
    progress_seconds: float = Field(ge=0)
    total_seconds: float = Field(ge=0)
    completed: bool = False
    last_watched_at: Timestamp


class SettingRecord(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    value: str = Field(max_length=1000)
    updated_at: Timestamp


class SyncStatePayload(BaseModel):
    bookmarks: List[BookmarkRecord] = Field(default_factory=list, max_length=MAX_BOOKMARKS)
    history: List[HistoryRecord] = Field(default_factory=list, max_length=MAX_HISTORY)
    settings: List[SettingRecord] = Field(default_factory=list, max_length=MAX_SETTINGS)


def generate_code() -> str:
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    return "-".join(raw[i : i + 4] for i in range(0, CODE_LENGTH, 4))


def normalize_code(raw: Optional[str]) -> Optional[str]:
    cleaned = re.sub(r"[\s-]", "", raw or "").upper()
    if len(cleaned) != CODE_LENGTH or any(c not in CODE_ALPHABET for c in cleaned):
        return None
    return cleaned


def hash_code(normalized: str) -> str:
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


SESSION_COOKIE = "aninyom_session"


def hash_session(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def require_account(request: Request, x_sync_code: Optional[str] = Header(None)) -> str:
    """Resolve the sync account from a Google session cookie or an anonymous sync code."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        now = format_ts(utc_now())
        session = await db.fetchrow(
            """SELECT u.code_hash FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ? AND s.expires_at > ?""",
            hash_session(token),
            now,
        )
        if session:
            await db.execute(
                "UPDATE sync_accounts SET last_seen_at = ? WHERE code_hash = ?",
                now,
                session["code_hash"],
            )
            return session["code_hash"]

    normalized = normalize_code(x_sync_code)
    if normalized is None:
        raise HTTPException(status_code=401, detail="Invalid sync code")
    code_hash = hash_code(normalized)
    row = await db.fetchrow("SELECT code_hash FROM sync_accounts WHERE code_hash = ?", code_hash)
    if not row:
        raise HTTPException(status_code=401, detail="Invalid sync code")
    await db.execute(
        "UPDATE sync_accounts SET last_seen_at = ? WHERE code_hash = ?",
        format_ts(utc_now()),
        code_hash,
    )
    return code_hash


async def delete_account_rows(code_hash: str) -> None:
    """Remove an account and all its synced rows.

    Explicit deletes are used instead of FK cascades because SQLite only enforces
    foreign keys per connection. Maintenance reuses this helper.
    """
    await db.execute("DELETE FROM sync_bookmarks WHERE code_hash = ?", code_hash)
    await db.execute("DELETE FROM sync_history WHERE code_hash = ?", code_hash)
    await db.execute("DELETE FROM sync_settings WHERE code_hash = ?", code_hash)
    await db.execute(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE code_hash = ?)",
        code_hash,
    )
    await db.execute("DELETE FROM users WHERE code_hash = ?", code_hash)
    await db.execute("DELETE FROM sync_accounts WHERE code_hash = ?", code_hash)


async def load_state(code_hash: str) -> Dict[str, list]:
    # Tombstones (status = "removed") are returned too, so deletions reach other devices.
    bookmarks = await db.fetch(
        """SELECT anilist_id, status, title_romaji, title_english, cover_image_large,
                  average_score, updated_at
           FROM sync_bookmarks WHERE code_hash = ?""",
        code_hash,
    )
    history = await db.fetch(
        """SELECT anilist_id, episode_number, title_romaji, title_english, cover_image,
                  progress_seconds, total_seconds, completed, last_watched_at
           FROM sync_history WHERE code_hash = ?
           ORDER BY last_watched_at DESC LIMIT ?""",
        code_hash,
        MAX_HISTORY,
    )
    settings = await db.fetch(
        "SELECT key, value, updated_at FROM sync_settings WHERE code_hash = ?",
        code_hash,
    )
    for row in history:
        row["completed"] = bool(row["completed"])
    return {"bookmarks": bookmarks, "history": history, "settings": settings}


BOOKMARK_UPSERT = """
    INSERT INTO sync_bookmarks (code_hash, anilist_id, status, title_romaji, title_english,
                                cover_image_large, average_score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (code_hash, anilist_id) DO UPDATE SET
        status = excluded.status,
        title_romaji = excluded.title_romaji,
        title_english = excluded.title_english,
        cover_image_large = excluded.cover_image_large,
        average_score = excluded.average_score,
        updated_at = excluded.updated_at
    WHERE excluded.updated_at > sync_bookmarks.updated_at
"""

HISTORY_UPSERT = """
    INSERT INTO sync_history (code_hash, anilist_id, episode_number, title_romaji, title_english,
                              cover_image, progress_seconds, total_seconds, completed, last_watched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (code_hash, anilist_id, episode_number) DO UPDATE SET
        title_romaji = excluded.title_romaji,
        title_english = excluded.title_english,
        cover_image = excluded.cover_image,
        progress_seconds = excluded.progress_seconds,
        total_seconds = excluded.total_seconds,
        completed = excluded.completed,
        last_watched_at = excluded.last_watched_at
    WHERE excluded.last_watched_at > sync_history.last_watched_at
"""

SETTING_UPSERT = """
    INSERT INTO sync_settings (code_hash, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (code_hash, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    WHERE excluded.updated_at > sync_settings.updated_at
"""

HISTORY_TRIM = """
    DELETE FROM sync_history WHERE code_hash = ? AND (anilist_id, episode_number) NOT IN (
        SELECT anilist_id, episode_number FROM sync_history
        WHERE code_hash = ? ORDER BY last_watched_at DESC LIMIT ?
    )
"""


@router.post("/create")
async def create_account():
    """Create an anonymous sync account. The code is returned once and never stored in plain text."""
    code = generate_code()
    try:
        now = format_ts(utc_now())
        await db.execute(
            "INSERT INTO sync_accounts (code_hash, created_at, last_seen_at) VALUES (?, ?, ?)",
            hash_code(code.replace("-", "")),
            now,
            now,
        )
    except Exception as e:
        logger.error("Failed creating sync account: %s", e)
        raise HTTPException(status_code=500, detail="Failed to create sync code")
    return {"code": code}


@router.get("/state")
async def get_state(code_hash: str = Depends(require_account)):
    try:
        return await load_state(code_hash)
    except Exception as e:
        logger.error("Failed loading sync state: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load synced data")


@router.put("/state")
async def put_state(payload: SyncStatePayload, code_hash: str = Depends(require_account)):
    """Merge the client's state into the account. Newer timestamps win per record."""
    try:
        await db.execute_many(
            BOOKMARK_UPSERT,
            [
                (
                    code_hash,
                    b.anilist_id,
                    b.status,
                    b.title_romaji,
                    b.title_english,
                    b.cover_image_large,
                    b.average_score,
                    b.updated_at,
                )
                for b in payload.bookmarks
            ],
        )
        await db.execute_many(
            HISTORY_UPSERT,
            [
                (
                    code_hash,
                    h.anilist_id,
                    h.episode_number,
                    h.title_romaji,
                    h.title_english,
                    h.cover_image,
                    h.progress_seconds,
                    h.total_seconds,
                    h.completed,
                    h.last_watched_at,
                )
                for h in payload.history
            ],
        )
        await db.execute_many(
            SETTING_UPSERT,
            [(code_hash, s.key, s.value, s.updated_at) for s in payload.settings],
        )
        await db.execute(HISTORY_TRIM, code_hash, code_hash, MAX_HISTORY)
        return await load_state(code_hash)
    except Exception as e:
        logger.error("Failed saving sync state: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save synced data")


@router.delete("/account")
async def delete_account(code_hash: str = Depends(require_account)):
    """Delete all server-side data for this code. Local data on the device is kept."""
    try:
        await delete_account_rows(code_hash)
    except Exception as e:
        logger.error("Failed deleting sync account: %s", e)
        raise HTTPException(status_code=500, detail="Failed to delete synced data")
    return {"status": "deleted"}
