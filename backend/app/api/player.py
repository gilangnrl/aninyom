"""Player Streaming Resolution API Routes."""

import json
import logging
import re
import urllib.parse
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..cache import cache
from ..database import db
from ..providers.base import ProviderError, StreamRequest
from ..providers.registry import provider_order, resolve_stream

logger = logging.getLogger("aninyom.api.player")
router = APIRouter(prefix="/api/player", tags=["Player"])

CACHE_VERSION = "v4"

_LANG_NAMES = {
    "english": "en",
    "indonesian": "id",
    "bahasa indonesia": "id",
    "japanese": "ja",
    "arabic": "ar",
    "spanish": "es",
    "portuguese": "pt",
    "brazilian portuguese": "pt-br",
    "french": "fr",
    "german": "de",
    "italian": "it",
    "russian": "ru",
    "korean": "ko",
    "chinese": "zh",
    "thai": "th",
    "vietnamese": "vi",
    "turkish": "tr",
    "polish": "pl",
    "hindi": "hi",
}

_ISO3_TO_2 = {
    "eng": "en",
    "ind": "id",
    "jpn": "ja",
    "ara": "ar",
    "spa": "es",
    "por": "pt",
    "fre": "fr",
    "fra": "fr",
    "ger": "de",
    "deu": "de",
    "ita": "it",
    "rus": "ru",
    "kor": "ko",
    "chi": "zh",
    "zho": "zh",
    "tha": "th",
    "vie": "vi",
    "tur": "tr",
    "pol": "pl",
    "hin": "hi",
}


def _normalize_track_language(track: Dict[str, str]) -> str:
    """Resolve a track's language, trusting explicit codes over label guessing."""
    raw = str(track.get("lang") or track.get("language") or "").strip().lower()
    raw = raw.replace("_", "-")
    label = str(track.get("label") or "").strip().lower()
    combined = f"{raw} {label}"

    if re.fullmatch(r"[a-z]{2}", raw):
        return raw
    if re.fullmatch(r"[a-z]{3}", raw):
        return _ISO3_TO_2.get(raw, "")
    if re.fullmatch(r"[a-z]{2}-[a-z]{2,}", raw):
        return raw.split("-", 1)[0]

    for name, code in _LANG_NAMES.items():
        if re.search(rf"\b{re.escape(name)}\b", combined):
            return code

    # Do not invent a code from an arbitrary label ("Signs" -> "si").
    return ""


def _rank_subtitle(track: Dict[str, str]) -> tuple:
    """Prefer default tracks, then non-forced tracks."""
    return (
        0 if track.get("default") else 1,
        0 if not track.get("forced") else 1,
    )


def _subtitle_url(episode_id: str, lang_key: str, src_url: str, referer: str) -> str:
    return (
        f"/api/subtitles/{episode_id}/{lang_key}.vtt"
        f"?src_url={urllib.parse.quote(src_url, safe='')}"
        f"&ref={urllib.parse.quote(referer, safe='')}"
    )


def _proxy_subtitle_url(src_url: str, referer: str, lang: str = "") -> str:
    proxied = (
        f"/api/subtitles/proxy?url={urllib.parse.quote(src_url, safe='')}"
        f"&ref={urllib.parse.quote(referer, safe='')}"
    )
    if lang:
        proxied += f"&lang={urllib.parse.quote(lang, safe='')}"
    return proxied


def _build_subtitle_tracks(
    raw_tracks: List[Dict[str, str]], episode_id: str, referer: str
) -> List[Dict[str, object]]:
    """Build the player's subtitle list from provider tracks."""
    en_tracks = sorted(
        (t for t in raw_tracks if _normalize_track_language(t) == "en"),
        key=_rank_subtitle,
    )
    id_tracks = sorted(
        (t for t in raw_tracks if _normalize_track_language(t) == "id"),
        key=_rank_subtitle,
    )

    en_track_url = str(en_tracks[0].get("file") or "") if en_tracks else ""
    id_track_url = str(id_tracks[0].get("file") or "") if id_tracks else ""

    # Indonesian falls back to an AI translation of the English source.
    id_sub_url = ""
    if id_track_url:
        id_sub_url = _proxy_subtitle_url(id_track_url, referer, "id")
    elif en_track_url:
        id_sub_url = _subtitle_url(episode_id, "id", en_track_url, referer)

    dual_src = en_track_url or id_track_url
    dual_sub_url = _subtitle_url(episode_id, "dual_id_en", dual_src, referer) if dual_src else ""
    en_sub_url = _subtitle_url(episode_id, "en", en_track_url, referer) if en_track_url else ""
    en_ai_sub_url = (
        _subtitle_url(episode_id, "en_ai", id_track_url, referer) if id_track_url else ""
    )

    formatted: List[Dict[str, object]] = [
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

    # Every other language the provider offered, proxied as-is.
    for track in raw_tracks:
        file_url = str(track.get("file") or "")
        if not file_url:
            continue
        lang = _normalize_track_language(track)
        if lang in ("en", "id"):
            continue
        formatted.append(
            {
                "lang": lang or "unknown",
                "label": track.get("label") or "Unknown",
                "url": _proxy_subtitle_url(file_url, referer, lang),
                "default": False,
            }
        )

    return [track for track in formatted if track.get("url")]


def _raw_tracks(result) -> List[Dict[str, str]]:
    return [
        {
            "file": track.url,
            "lang": track.lang,
            "label": track.label,
            "default": track.default,
            "forced": track.forced,
            "format": track.format,
        }
        for track in result.subtitles
    ]


@router.get("/stream/{episode_id}")
async def get_stream_data(
    episode_id: str,
    mode: str = Query("sub", description="sub or dub"),
    title: Optional[str] = Query(None, description="Anime title for non-HiAnime providers"),
    title_alt: Optional[str] = Query(None, description="Alternate anime title"),
    episode: Optional[int] = Query(None, description="Episode number"),
    anilist_id: Optional[int] = Query(None, description="AniList id"),
):
    """Resolve stream URL, quality variants, intro/outro timestamps, and subtitles."""
    mode_str = "dub" if str(mode).lower() == "dub" else "sub"

    # Version the cache and tag it with the provider order, so changing
    # PROVIDER_ORDER is not masked by entries resolved by another provider.
    order_tag = "-".join(provider_order())
    cache_mode = f"{mode_str}_{CACHE_VERSION}_{order_tag}"
    cache_key = f"stream:{CACHE_VERSION}:{order_tag}:{episode_id}:{mode_str}"
    fast_cached = await cache.get(cache_key)
    if fast_cached:
        fast_cached["cached"] = True
        return fast_cached

    # 2. Check Database stream_cache
    try:
        now = datetime.now(timezone.utc).isoformat()
        cached = await db.fetchrow(
            "SELECT master_m3u8_url, subtitles, headers, expires_at FROM stream_cache "
            "WHERE hianime_episode_id = ? AND server_type = ? AND expires_at > ?",
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
                "audio_tracks": headers_data.get("audio_tracks", []),
                "intro": headers_data.get("intro", {"start": 0, "end": 0}),
                "outro": headers_data.get("outro", {"start": 0, "end": 0}),
                "provider": headers_data.get("provider", ""),
                "server": headers_data.get("server", ""),
                "available_modes": headers_data.get("available_modes", []),
                "cached": True,
            }
    except Exception as e:
        logger.warning("Cache lookup error for %s: %s", episode_id, e)

    # 3. Resolve through the provider registry with mode fallback
    request = StreamRequest(
        episode_id=episode_id,
        mode=mode_str,
        title=title,
        title_alt=title_alt,
        episode_number=episode,
        anilist_id=anilist_id,
    )
    try:
        result = await resolve_stream(request)
    except ProviderError as e:
        if mode_str == "sub":
            logger.error("All providers failed for %s: %s", episode_id, e)
            raise HTTPException(status_code=502, detail=f"Failed to resolve stream: {e}")
        logger.warning(
            "Dubbed stream unavailable for %s (%s). Falling back to sub.", episode_id, e
        )
        request.mode = "sub"
        try:
            result = await resolve_stream(request)
        except ProviderError as e2:
            logger.error("All providers failed for %s: %s", episode_id, e2)
            raise HTTPException(status_code=502, detail=f"Failed to resolve stream: {e2}")

    master_url = result.master_url
    referer = result.referer
    formatted_tracks = _build_subtitle_tracks(_raw_tracks(result), episode_id, referer)

    proxied_url = f"/api/player/video?url={urllib.parse.quote(master_url, safe='')}"
    if referer:
        proxied_url += f"&ref={urllib.parse.quote(referer, safe='')}"

    audio_tracks = [asdict(track) for track in result.audio_tracks]

    # 4. Store in cache (valid for 3 hours)
    try:
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        headers_payload = {
            "referer": referer,
            "intro": result.intro,
            "outro": result.outro,
            "provider": result.provider,
            "server": result.server,
            "audio_tracks": audio_tracks,
            "available_modes": result.available_modes,
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
        "audio_tracks": audio_tracks,
        "intro": result.intro,
        "outro": result.outro,
        "provider": result.provider,
        "server": result.server,
        "available_modes": result.available_modes,
        "cached": False,
    }

    # Save to Redis cache (3 hours TTL)
    await cache.set(cache_key, result_payload, ttl=10800)

    return result_payload
