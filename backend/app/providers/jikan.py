"""Jikan v4 metadata provider (https://docs.api.jikan.moe).

Jikan is the unofficial, credential-free MyAnimeList REST API and the primary
fallback when AniList is unavailable.  It is keyed by **MAL ids**, so callers
that only hold an AniList id must translate it first -- see
``providers.metadata._to_mal_id`` (Kitsu supplies that mapping).

Every function returns the normalized dict shape produced by
``providers.anilist._normalize_media`` so the API and frontend stay unchanged.

Rate limits: Jikan allows ~3 requests/second and ~60/minute per IP.  Page size
is capped at 25 (``max_results_per_page``).
"""

import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx

from ..config import JIKAN_BASE, METADATA_UA

logger = logging.getLogger("aninyom.providers.jikan")

MAX_PER_PAGE = 25

_HEADERS = {
    "Accept": "application/json",
    "User-Agent": METADATA_UA,
}

# Jikan type -> AniList format enum.
_FORMAT_MAP = {
    "tv": "TV",
    "movie": "MOVIE",
    "ova": "OVA",
    "ona": "ONA",
    "special": "SPECIAL",
    "music": "MUSIC",
}

# Jikan status -> AniList status enum.
_STATUS_MAP = {
    "currently airing": "RELEASING",
    "finished airing": "FINISHED",
    "not yet aired": "NOT_YET_RELEASED",
}

# AniList status tokens -> Jikan `status` filter values.
_STATUS_FILTERS = {
    "RELEASING": "airing",
    "FINISHED": "complete",
    "NOT_YET_RELEASED": "upcoming",
}

# AniList sort tokens -> (Jikan order_by, sort direction).
_SORT_MAP = {
    "TRENDING_DESC": ("members", "desc"),
    "POPULARITY_DESC": ("members", "desc"),
    "SCORE_DESC": ("score", "desc"),
    "START_DATE_DESC": ("start_date", "desc"),
    "TITLE_ROMAJI": ("title", "asc"),
}

_SEASON_MAP = {"WINTER": "winter", "SPRING": "spring", "SUMMER": "summer", "FALL": "fall"}

_DURATION_RE = re.compile(r"(\d+)\s*min", re.IGNORECASE)
_HOURS_RE = re.compile(r"(\d+)\s*hr", re.IGNORECASE)
_EPISODE_URL_RE = re.compile(r"/episode/(?P<number>\d+)")

# Connect budget in seconds.  Unreachable hosts fail here rather than hanging.
_CONNECT_TIMEOUT = 4.0


class JikanError(RuntimeError):
    """Raised when Jikan cannot satisfy a metadata request."""


# Jikan tolerates ~3 req/s; serialise calls with a tiny floor between them.
_last_call_at = 0.0
_MIN_INTERVAL = 0.34


async def _get(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    global _last_call_at

    # A dead/unreachable host must fail fast: the old 15s connect timeout made
    # every catalog request unusable while Jikan was down.
    timeout = httpx.Timeout(12.0, connect=_CONNECT_TIMEOUT)
    async with httpx.AsyncClient(timeout=timeout, headers=_HEADERS) as client:
        for attempt in range(3):
            elapsed = time.monotonic() - _last_call_at
            if elapsed < _MIN_INTERVAL:
                await asyncio.sleep(_MIN_INTERVAL - elapsed)
            _last_call_at = time.monotonic()

            resp = await client.get(f"{JIKAN_BASE}{path}", params=params or {})
            if resp.status_code in (429, 503) and attempt < 2:
                retry_after = resp.headers.get("retry-after")
                try:
                    delay = float(retry_after) if retry_after else 1.0 + attempt
                except ValueError:
                    delay = 1.0 + attempt
                logger.warning("Jikan %s on %s; retrying in %.1fs", resp.status_code, path, delay)
                await asyncio.sleep(delay)
                continue
            resp.raise_for_status()
            return resp.json()
    raise JikanError(f"Jikan request failed after retries: {path}")


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _to_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _score(value: Any) -> int:
    """Jikan scores are 0-10 floats; AniList uses 0-100 ints."""
    try:
        return round(float(value) * 10)
    except (TypeError, ValueError):
        return 0


def _duration_minutes(value: Any) -> int:
    raw = _text(value)
    hours = _HOURS_RE.search(raw)
    minutes = _DURATION_RE.search(raw)
    total = 0
    if hours:
        total += int(hours.group(1)) * 60
    if minutes:
        total += int(minutes.group(1))
    return total or 24


def _image_url(images: Dict[str, Any], size: str) -> str:
    jpg = (images or {}).get("jpg") or {}
    webp = (images or {}).get("webp") or {}
    return _text(jpg.get(size)) or _text(webp.get(size))


def _start_date(entry: Dict[str, Any]) -> Optional[Dict[str, int]]:
    """Prefer Jikan's pre-parsed ``aired.prop.from`` over string parsing."""
    prop = ((entry.get("aired") or {}).get("prop") or {}).get("from") or {}
    year = _to_int(prop.get("year"))
    if not year:
        return None
    result: Dict[str, int] = {"year": year}
    month = _to_int(prop.get("month"))
    day = _to_int(prop.get("day"))
    if month:
        result["month"] = month
    if day:
        result["day"] = day
    return result


def _names(items: Any) -> List[str]:
    return [
        name
        for name in (
            _text((item or {}).get("name")) for item in (items or []) if isinstance(item, dict)
        )
        if name
    ]


def _episode_number(episode: Dict[str, Any]) -> Optional[int]:
    """Extract the episode number from a ``/watch/episodes`` entry.

    Jikan exposes no numeric field, only a MAL URL ending in
    ``/anime/<mal_id>/episode/<n>``.
    """
    number = _to_int(episode.get("episode_number"))
    if number is not None:
        return number

    match = _EPISODE_URL_RE.search(_text(episode.get("url")))
    if match:
        return _to_int(match.group("number"))
    return _to_int(episode.get("title"))


def _normalize(entry: Dict[str, Any], anilist_id: Optional[int] = None) -> Dict[str, Any]:
    """Convert one Jikan anime object into the AniList-shaped payload."""
    titles = entry.get("titles") or []
    # ``title`` is the deprecated-but-always-present romaji value; ``titles``
    # carries the typed variants (Default/English/Japanese/Synonym).
    romaji = _text(entry.get("title"))
    if not romaji:
        for title in titles:
            if _text((title or {}).get("type")) == "Default":
                romaji = _text((title or {}).get("title"))
                break

    english = _text(entry.get("title_english"))
    if not english:
        for title in titles:
            if _text((title or {}).get("type")) == "English":
                english = _text((title or {}).get("title"))
                break
    english = english or romaji

    native = _text(entry.get("title_japanese"))
    if not native:
        for title in titles:
            if _text((title or {}).get("type")) == "Japanese":
                native = _text((title or {}).get("title"))
                break

    images = entry.get("images") or {}
    poster = _image_url(images, "large_image_url") or _image_url(images, "image_url")
    poster_hd = _image_url(images, "large_image_url") or poster

    trailer = entry.get("trailer") or {}
    youtube_id = _text(trailer.get("youtube_id"))
    year = _to_int(entry.get("year")) or (_start_date(entry) or {}).get("year", 0)

    return {
        "anilist_id": anilist_id,
        "mal_id": _to_int(entry.get("mal_id")),
        "title_romaji": romaji,
        "title_english": english,
        "title_native": native,
        "synopsis_en": _text(entry.get("synopsis")),
        "cover_image_large": poster,
        "cover_image_extra_large": poster_hd,
        "banner_image": poster_hd,
        "format": _FORMAT_MAP.get(_text(entry.get("type")).lower(), "TV"),
        "status": _STATUS_MAP.get(_text(entry.get("status")).lower(), "FINISHED"),
        "episodes_count": _to_int(entry.get("episodes")) or 0,
        "duration_per_ep": _duration_minutes(entry.get("duration")),
        "season": _text(entry.get("season")).upper(),
        "season_year": year or 0,
        "average_score": _score(entry.get("score")),
        "genres": _names(entry.get("genres")) + _names(entry.get("themes")),
        "studios": _names(entry.get("studios")),
        "next_airing": None,
        "trailer": {"id": youtube_id, "site": "youtube"} if youtube_id else None,
        "relations": [],
        "start_date": _start_date(entry),
    }


def _normalize_all(
    entries: List[Dict[str, Any]], anilist_ids: Optional[List[Optional[int]]] = None
):
    ids = anilist_ids or [None] * len(entries)
    return [_normalize(entry, ids[index]) for index, entry in enumerate(entries)]


async def get_trending(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    payload = await _get(
        "/top/anime",
        {
            "filter": "airing",
            "page": page,
            "limit": min(per_page, MAX_PER_PAGE),
            "sfw": "true",
        },
    )
    return _normalize_all(payload.get("data") or [])


async def get_popular(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    payload = await _get(
        "/top/anime",
        {
            "filter": "bypopularity",
            "page": page,
            "limit": min(per_page, MAX_PER_PAGE),
            "sfw": "true",
        },
    )
    return _normalize_all(payload.get("data") or [])


async def get_seasonal(
    season: Optional[str] = None,
    year: Optional[int] = None,
    page: int = 1,
    per_page: int = 20,
) -> List[Dict[str, Any]]:
    limit = min(per_page, MAX_PER_PAGE)
    season_token = _SEASON_MAP.get(_text(season).upper())
    if season_token and year:
        path = f"/seasons/{year}/{season_token}"
        params: Dict[str, Any] = {"page": page, "limit": limit, "sfw": "true"}
    else:
        path = "/seasons/now"
        params = {"page": page, "limit": limit, "sfw": "true"}
    payload = await _get(path, params)
    return _normalize_all(payload.get("data") or [])


async def get_upcoming(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    payload = await _get(
        "/seasons/upcoming",
        {
            "page": page,
            "limit": min(per_page, MAX_PER_PAGE),
            "sfw": "true",
        },
    )
    return _normalize_all(payload.get("data") or [])


async def get_recent_releases(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    """Recent episodes from ``/watch/episodes``.

    Each entry is the parent anime plus up to two recently added episodes.
    Jikan supplies no broadcast timestamp, so ``airing_at`` is ``0`` to mean
    "unknown" (callers must not render it as a date), and the episode number is
    parsed from the episode URL because there is no numeric field.
    """
    payload = await _get("/watch/episodes", {"page": page})
    results: List[Dict[str, Any]] = []

    for item in payload.get("data") or []:
        entry = item.get("entry") or {}
        episodes = item.get("episodes") or []
        if not episodes:
            continue

        number = None
        for episode in episodes:
            number = _episode_number(episode)
            if number is not None:
                break
        if number is None:
            continue

        results.append(
            {
                "airing_id": _to_int(episodes[0].get("mal_id")) or 0,
                "airing_at": 0,
                "episode": number,
                "media": _normalize(entry),
            }
        )

        if len(results) >= min(per_page, MAX_PER_PAGE):
            break

    return results


async def search_anime_anilist(
    search: Optional[str] = None,
    genre: Optional[str] = None,
    format: Optional[str] = None,
    sort: Optional[List[str]] = None,
    season: Optional[str] = None,
    year: Optional[int] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {
        "page": page,
        "limit": min(per_page, MAX_PER_PAGE),
        "sfw": "true",
    }
    if search and search.strip():
        params["q"] = search.strip()
    if genre and genre.strip():
        # Jikan filters genres by numeric id; names are not accepted here.
        logger.debug("Jikan ignores genre name filter: %s", genre)
    subtype = _FORMAT_MAP.get((format or "").strip().lower())
    if subtype:
        params["type"] = subtype.lower()
    if status and status.strip().upper() in _STATUS_FILTERS:
        params["status"] = _STATUS_FILTERS[status.strip().upper()]
    if year:
        params["start_date"] = str(year)
    if season and _text(season) and year:
        params["start_date"] = f"{year}-01-01"

    sort_key = (sort or ["POPULARITY_DESC"])[0] if sort else "POPULARITY_DESC"
    order_by, direction = _SORT_MAP.get(sort_key, ("members", "desc"))
    params["order_by"] = order_by
    params["sort"] = direction

    payload = await _get("/anime", params)
    return _normalize_all(payload.get("data") or [])


async def get_anime_details(
    mal_id: int, anilist_id: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """Load ``/anime/{mal_id}/full`` and shape it like ``Media`` details."""
    payload = await _get(f"/anime/{mal_id}/full")
    entry = payload.get("data")
    if not entry:
        return None

    normalized = _normalize(entry, anilist_id)

    relations: List[Dict[str, Any]] = []
    for group in entry.get("relations") or []:
        relation_type = _text(group.get("relation"))
        for node in group.get("entry") or []:
            relations.append(
                {
                    "relationType": relation_type,
                    "node": {
                        "id": None,
                        "title": {
                            "romaji": _text(node.get("name")),
                            "english": _text(node.get("name")),
                        },
                        "coverImage": {"large": ""},
                        "format": (_text(node.get("type")) or "TV").upper(),
                        "status": "FINISHED",
                    },
                }
            )
    normalized["relations"] = relations
    return normalized
