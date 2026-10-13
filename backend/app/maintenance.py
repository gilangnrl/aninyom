"""Periodic cleanup so server storage stays bounded.

Runs once at startup and then every 24 hours from the FastAPI lifespan.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .api.sync import delete_account_rows, format_ts
from .database import db

logger = logging.getLogger("aninyom.maintenance")

RUN_INTERVAL_SECONDS = 24 * 60 * 60
SYNC_ACCOUNT_TTL = timedelta(days=180)  # inactive sync codes are deleted
TOMBSTONE_TTL = timedelta(days=180)  # "removed" bookmarks older than this are dropped
SUBTITLE_CACHE_TTL = timedelta(
    days=30
)  # subtitle_cache has no expiry column, so it uses created_at


def _stream_cache_cutoff(now: datetime) -> Any:
    # Postgres timestamptz needs a datetime. SQLite stores player.py's isoformat() text.
    return now if db.is_postgres else now.isoformat()


def _subtitle_cache_cutoff(cutoff: datetime) -> Any:
    # Postgres TIMESTAMPTZ needs a datetime. SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS".
    return cutoff if db.is_postgres else cutoff.strftime("%Y-%m-%d %H:%M:%S")


async def cleanup_once() -> None:
    now = datetime.now(timezone.utc)

    stale_accounts = await db.fetch(
        "SELECT code_hash FROM sync_accounts WHERE last_seen_at < ?",
        format_ts(now - SYNC_ACCOUNT_TTL),
    )
    for row in stale_accounts:
        await delete_account_rows(row["code_hash"])

    await db.execute("DELETE FROM sessions WHERE expires_at < ?", format_ts(now))
    await db.execute(
        "DELETE FROM sync_bookmarks WHERE status = 'removed' AND updated_at < ?",
        format_ts(now - TOMBSTONE_TTL),
    )
    await db.execute(
        "DELETE FROM stream_cache WHERE expires_at < ?",
        _stream_cache_cutoff(now),
    )
    await db.execute(
        "DELETE FROM subtitle_cache WHERE created_at < ?",
        _subtitle_cache_cutoff(now - SUBTITLE_CACHE_TTL),
    )

    if not db.is_postgres:
        # SQLite keeps freed pages in the file. VACUUM shrinks it so the disk actually gets space back.
        await db.execute("VACUUM")

    logger.info("Maintenance done: removed %d inactive sync account(s)", len(stale_accounts))


async def run_forever() -> None:
    while True:
        try:
            await cleanup_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Maintenance run failed")
        await asyncio.sleep(RUN_INTERVAL_SECONDS)
