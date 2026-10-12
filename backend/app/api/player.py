"""Player Streaming Resolution API Routes."""

import json
import logging
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..cache import cache
from ..database import db
from ..scrapers import hianime

logger = logging.getLogger("aninyom.api.player")
router = APIRouter(prefix="/api/player", tags=["Player"])


def _normalize_track_language(track: dict) -> str:
    language = (
        str(track.get("lang") or track.get("language") or "").strip().lower().replace("_", "-")
    )
    label = str(track.get("label") or "").strip().lower()
    combined = f"{language} {label}"
    if language in {"en", "eng", "english"} or language.startswith("en-") or "english" in combined:
        return "en"
    if (
        language in {"id", "ind", "indonesian"}
        or language.startswith("id-")
        or any(word in combined for word in ("indonesia", "bahasa"))
    ):
        return "id"
    return language.split("-", 1)[0][:2]


@router.get("/stream/{episode_id}")
async def get_stream_data(episode_id: str, mode: str = Query("sub", description="sub or dub")):
    """Resolve stream URL, quality variants, intro/outro timestamps, and subtitle endpoints."""
    mode_str = str(mode) if isinstance(mode, str) else "sub"

    # Version the cache so clients receive the current subtitle-track schema.
    cache_mode = f"{mode_str}_v2"
    cache_key = f"stream:v2:{episode_id}:{mode_str}"
    fast_cached = await cache.get(cache_key)
    if fast_cached:
        fast_cached["cached"] = True
        return fast_cached

    # 2. Check Database stream_cache
    try:
        now = datetime.now(timezone.utc).isoformat()
        cached = await db.fetchrow(
            "SELECT master_m3u8_url, subtitles, headers, expires_at FROM stream_cache WHERE hianime_episode_id = ? AND server_type = ? AND expires_at > ?",
            episode_id,
            cache_mode,
            now,
        )
        if cached:
            subtitles_raw = cached["subtitles"]
            tracks = (
                json.loads(subtitles_raw)
                if isinstance(subtitles_raw, str)
                else (subtitles_raw or [])
            )
            master_url = cached["master_m3u8_url"]
            headers_data = (
                json.loads(cached["headers"])
                if isinstance(cached["headers"], str)
                else (cached["headers"] or {})
            )
            referer = headers_data.get("referer", "")

            proxied_url = f"/api/player/video?url={urllib.parse.quote(master_url, safe='')}"
            if referer:
                proxied_url += f"&ref={urllib.parse.quote(referer, safe='')}"

            return {
                "proxied_url": proxied_url,
                "master_url": master_url,
                "tracks": tracks,
                "intro": headers_data.get("intro", {"start": 0, "end": 0}),
                "outro": headers_data.get("outro", {"start": 0, "end": 0}),
                "cached": True,
            }
    except Exception as e:
        logger.warning("Cache lookup error for %s: %s", episode_id, e)

    # 2. Extract stream via scraper with mode fallback
    try:
        data = hianime.extract_stream(episode_id, mode=mode_str)
    except Exception as e:
        logger.warning(
            "Primary mode extraction error for %s (%s): %s. Attempting fallback mode...",
            episode_id,
            mode_str,
            e,
        )
        alt_mode = "dub" if mode_str == "sub" else "sub"
        try:
            data = hianime.extract_stream(episode_id, mode=alt_mode)
        except Exception as e2:
            logger.error("All extraction modes failed for %s: %s / %s", episode_id, e, e2)
            raise HTTPException(status_code=502, detail=f"Failed to resolve stream: {e}")

    master_url = data["master_url"]
    referer = data["referer"]
    raw_tracks = data.get("tracks", [])

    # Find english and indonesian subtitle sources if present
    en_track_url = ""
    id_track_url = ""
    for t in raw_tracks:
        lang = _normalize_track_language(t)
        track_url = t.get("file") or t.get("src") or t.get("url") or ""
        if not en_track_url and lang == "en":
            en_track_url = track_url
        if not id_track_url and lang == "id":
            id_track_url = track_url

    # Build standardized subtitle list with bilingual Indonesian and Dual options
    id_sub_url = ""
    if id_track_url:
        id_sub_url = f"/api/subtitles/proxy?url={urllib.parse.quote(id_track_url, safe='')}&ref={urllib.parse.quote(referer, safe='')}"
    elif en_track_url:
        id_sub_url = f"/api/subtitles/{episode_id}/id.vtt?src_url={urllib.parse.quote(en_track_url, safe='')}&ref={urllib.parse.quote(referer, safe='')}"

    dual_src = en_track_url or id_track_url
    dual_sub_url = (
        f"/api/subtitles/{episode_id}/dual_id_en.vtt?src_url={urllib.parse.quote(dual_src, safe='')}&ref={urllib.parse.quote(referer, safe='')}"
        if dual_src
        else ""
    )

    en_sub_url = (
        f"/api/subtitles/{episode_id}/en.vtt?src_url={urllib.parse.quote(en_track_url, safe='')}&ref={urllib.parse.quote(referer, safe='')}"
        if en_track_url
        else ""
    )
    en_ai_sub_url = (
        f"/api/subtitles/{episode_id}/en_ai.vtt?src_url={urllib.parse.quote(id_track_url, safe='')}&ref={urllib.parse.quote(referer, safe='')}"
        if id_track_url
        else ""
    )

    formatted_tracks = [
        {
            "lang": "id",
            "label": "Indonesian (Native)" if id_track_url else "Indonesian (AI Fansub)",
            "url": id_sub_url,
            "default": True,
        },
        {
            "lang": "dual",
            "label": "Dual Subtitle (ID + EN)",
            "url": dual_sub_url,
            "default": False,
        },
        {
            "lang": "en",
            "label": "English (Source)",
            "url": en_sub_url,
            "default": False,
        },
        {
            "lang": "en-ai",
            "label": "English (AI translation)",
            "url": en_ai_sub_url,
            "default": False,
        },
    ]

    # Append any remaining raw tracks proxied through backend
    for t in raw_tracks:
        t_file = t.get("file", "")
        if not t_file:
            continue
        lang = _normalize_track_language(t)
        if lang not in ("en", "id"):
            proxied_sub = f"/api/subtitles/proxy?url={urllib.parse.quote(t_file, safe='')}&ref={urllib.parse.quote(referer, safe='')}"
            formatted_tracks.append(
                {
                    "lang": lang or "unknown",
                    "label": t.get("label", "Unknown"),
                    "url": proxied_sub,
                    "default": False,
                }
            )

    # Filter out empty URLs
    formatted_tracks = [t for t in formatted_tracks if t.get("url")]

    proxied_url = f"/api/player/video?url={urllib.parse.quote(master_url, safe='')}"
    if referer:
        proxied_url += f"&ref={urllib.parse.quote(referer, safe='')}"

    # 3. Store in cache (valid for 3 hours)
    try:
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        headers_payload = {
            "referer": referer,
            "intro": data.get("intro", {}),
            "outro": data.get("outro", {}),
        }
        await db.execute(
            """INSERT INTO stream_cache (hianime_episode_id, server_type, master_m3u8_url, subtitles, headers, expires_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (hianime_episode_id, server_type) DO UPDATE SET
               master_m3u8_url = excluded.master_m3u8_url,
               subtitles = excluded.subtitles,
               headers = excluded.headers,
               expires_at = excluded.expires_at""",
            episode_id,
            cache_mode,
            master_url,
            formatted_tracks,
            headers_payload,
            expires_at,
        )
    except Exception as e:
        logger.warning("Failed saving stream cache: %s", e)

    result_payload = {
        "proxied_url": proxied_url,
        "master_url": master_url,
        "tracks": formatted_tracks,
        "intro": data.get("intro", {"start": 0, "end": 0}),
        "outro": data.get("outro", {"start": 0, "end": 0}),
        "cached": False,
    }

    # Save to Redis cache (3 hours TTL)
    await cache.set(cache_key, result_payload, ttl=10800)

    return result_payload
