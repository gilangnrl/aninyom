"""User API Routes.
Manages seconds-level watch progress, bookmarks, and global settings.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..database import db

logger = logging.getLogger("aninyom.api.user")
router = APIRouter(prefix="/api/user", tags=["User"])


class HistoryPayload(BaseModel):
    anime_id: int
    episode_number: int
    progress_seconds: float
    total_seconds: float
    completed: Optional[bool] = False
    title_romaji: Optional[str] = None
    title_english: Optional[str] = None
    cover_image: Optional[str] = None


class BookmarkPayload(BaseModel):
    anime_id: int
    status: str  # 'watching', 'plan_to_watch', 'completed', 'dropped', 'favorite'
    title_romaji: Optional[str] = None
    title_english: Optional[str] = None
    cover_image: Optional[str] = None
    score: Optional[int] = None


class SettingPayload(BaseModel):
    key: str
    value: str


async def _ensure_anime_exists(
    anime_id: int,
    title_romaji: Optional[str] = None,
    title_english: Optional[str] = None,
    cover_image: Optional[str] = None,
    score: Optional[int] = None,
):
    """Ensure anime record exists in local DB so foreign key constraints are satisfied."""
    try:
        existing = await db.fetchrow("SELECT id FROM anime WHERE anilist_id = ?", anime_id)
        if not existing:
            await db.execute(
                """INSERT INTO anime (anilist_id, title_romaji, title_english, cover_image_large, average_score)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (anilist_id) DO NOTHING""",
                anime_id,
                title_romaji or f"Anime #{anime_id}",
                title_english or title_romaji or f"Anime #{anime_id}",
                cover_image or "",
                score or 0,
            )
        row = await db.fetchrow("SELECT id FROM anime WHERE anilist_id = ?", anime_id)
        return row["id"] if row else None
    except Exception as e:
        logger.warning("Error ensuring anime exists: %s", e)
        return None


@router.get("/history")
async def get_watch_history(limit: int = Query(30, ge=1, le=100)):
    """Retrieve watch history sorted by most recently watched."""
    try:
        rows = await db.fetch(
            """SELECT h.id, h.anime_id, a.anilist_id, a.title_romaji, a.title_english,
                      a.cover_image_large, a.banner_image, h.episode_number,
                      h.progress_seconds, h.total_seconds, h.completed, h.last_watched_at
               FROM watch_history h
               JOIN anime a ON h.anime_id = a.id
               ORDER BY h.last_watched_at DESC
               LIMIT ?""",
            limit,
        )
        return rows
    except Exception as e:
        logger.error("Failed fetching watch history: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch history")


@router.post("/history")
async def save_watch_history(payload: HistoryPayload):
    """Save or update seconds-level watch progress for an episode."""
    local_anime_id = await _ensure_anime_exists(
        payload.anime_id,
        title_romaji=payload.title_romaji,
        title_english=payload.title_english,
        cover_image=payload.cover_image,
    )
    if not local_anime_id:
        raise HTTPException(status_code=500, detail="Failed to initialize anime record")

    try:
        await db.execute(
            """INSERT INTO watch_history (anime_id, episode_number, progress_seconds, total_seconds, completed, last_watched_at)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT (anime_id, episode_number) DO UPDATE SET
               progress_seconds = excluded.progress_seconds,
               total_seconds = excluded.total_seconds,
               completed = excluded.completed,
               last_watched_at = CURRENT_TIMESTAMP""",
            local_anime_id,
            payload.episode_number,
            payload.progress_seconds,
            payload.total_seconds,
            payload.completed
            or (
                payload.progress_seconds / payload.total_seconds > 0.9
                if payload.total_seconds > 0
                else False
            ),
        )
        return {"status": "success", "progress_seconds": payload.progress_seconds}
    except Exception as e:
        logger.error("Failed saving watch history: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save progress")


@router.get("/bookmarks")
async def get_bookmarks(status: Optional[str] = Query(None)):
    """Retrieve bookmarked anime, optionally filtered by status."""
    try:
        if status:
            rows = await db.fetch(
                """SELECT b.id, a.anilist_id, a.title_romaji, a.title_english,
                          a.cover_image_large, a.banner_image, a.average_score, b.status, b.updated_at
                   FROM bookmarks b
                   JOIN anime a ON b.anime_id = a.id
                   WHERE b.status = ?
                   ORDER BY b.updated_at DESC""",
                status,
            )
        else:
            rows = await db.fetch(
                """SELECT b.id, a.anilist_id, a.title_romaji, a.title_english,
                          a.cover_image_large, a.banner_image, a.average_score, b.status, b.updated_at
                   FROM bookmarks b
                   JOIN anime a ON b.anime_id = a.id
                   ORDER BY b.updated_at DESC"""
            )
        return rows
    except Exception as e:
        logger.error("Failed fetching bookmarks: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch bookmarks")


@router.post("/bookmarks")
async def set_bookmark(payload: BookmarkPayload):
    """Add or update an anime bookmark status."""
    if payload.status not in ("watching", "plan_to_watch", "completed", "dropped", "favorite"):
        raise HTTPException(status_code=400, detail="Invalid bookmark status")

    local_anime_id = await _ensure_anime_exists(
        payload.anime_id,
        title_romaji=payload.title_romaji,
        title_english=payload.title_english,
        cover_image=payload.cover_image,
        score=payload.score,
    )
    if not local_anime_id:
        raise HTTPException(status_code=500, detail="Failed to initialize anime record")

    try:
        await db.execute(
            """INSERT INTO bookmarks (anime_id, status, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT (anime_id) DO UPDATE SET
               status = excluded.status,
               updated_at = CURRENT_TIMESTAMP""",
            local_anime_id,
            payload.status,
        )
        return {"status": "success", "bookmark": payload.status}
    except Exception as e:
        logger.error("Failed saving bookmark: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save bookmark")


@router.delete("/bookmarks/{anime_id}")
async def remove_bookmark(anime_id: int):
    """Remove a bookmark by AniList ID."""
    try:
        row = await db.fetchrow("SELECT id FROM anime WHERE anilist_id = ?", anime_id)
        if row:
            await db.execute("DELETE FROM bookmarks WHERE anime_id = ?", row["id"])
        return {"status": "success"}
    except Exception as e:
        logger.error("Failed removing bookmark: %s", e)
        raise HTTPException(status_code=500, detail="Failed to remove bookmark")


@router.get("/settings")
async def get_settings():
    """Retrieve all configuration settings."""
    try:
        rows = await db.fetch("SELECT key, value FROM settings")
        return {r["key"]: r["value"] for r in rows}
    except Exception as e:
        logger.error("Failed fetching settings: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch settings")


@router.post("/settings")
async def update_setting(payload: SettingPayload):
    """Update a specific configuration setting."""
    try:
        await db.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT (key) DO UPDATE SET
               value = excluded.value,
               updated_at = CURRENT_TIMESTAMP""",
            payload.key,
            payload.value,
        )
        return {"status": "success", "key": payload.key, "value": payload.value}
    except Exception as e:
        logger.error("Failed saving setting: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save setting")
