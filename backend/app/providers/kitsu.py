"""Kitsu metadata provider (https://kitsu.app/api/edge).

Kitsu is the last-resort metadata source *and* the id resolver for the whole
failover chain: it is the only free, credential-free source reachable
independently of AniList that exposes AniList <-> MyAnimeList id mappings.  That
mapping is what keeps the Jikan provider usable while AniList is down.

All public functions return the normalized dict shape produced by
``providers.anilist._normalize_media`` so the API and frontend stay unchanged.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

from ..config import KITSU_BASE, METADATA_UA

logger = logging.getLogger("aninyom.providers.kitsu")

# Kitsu hard-caps page[limit] at 20.
MAX_PER_PAGE = 20
# Per-item mapping lookups run in parallel; keep the burst small and polite.
_MAPPING_CONCURRENCY = 8

_HEADERS = {
    "Accept": "application/vnd.api+json",
    "User-Agent": METADATA_UA,
}

# Kitsu subtype -> AniList format enum.
_FORMAT_MAP = {
    "tv": "TV",
    "movie": "MOVIE",
    "ova": "OVA",
    "ona": "ONA",
    "special": "SPECIAL",
    "music": "MUSIC",
}

# Kitsu status -> AniList status enum.
_STATUS_MAP = {
    "current": "RELEASING",
    "finished": "FINISHED",
    "upcoming": "NOT_YET_RELEASED",
    "tba": "NOT_YET_RELEASED",
    "unreleased": "NOT_YET_RELEASED",
}

# AniList status tokens accepted by search, mapped to Kitsu filters.
_STATUS_FILTERS = {
    "RELEASING": "current",
    "FINISHED": "finished",
    "NOT_YET_RELEASED": "upcoming",
}


class KitsuError(RuntimeError):
    """Raised when Kitsu cannot satisfy a metadata request."""


async def _get(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    # Short connect budget so a stalled host cannot dominate request latency.
    timeout = httpx.Timeout(12.0, connect=4.0)
    async with httpx.AsyncClient(timeout=timeout, headers=_HEADERS) as client:
        resp = await client.get(f"{KITSU_BASE}{path}", params=params or {})
        resp.raise_for_status()
        return resp.json()


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _to_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _rating(value: Any) -> int:
    """Kitsu ratings are percentage strings ("88.92"); AniList uses 0-100 ints."""
    try:
        return round(float(value))
    except (TypeError, ValueError):
        return 0


def _season_from_month(month: Optional[int]) -> str:
    """Map a calendar month to its anime season."""
    if not month:
        return ""
    if month in (1, 2, 3):
        return "WINTER"
    if month in (4, 5, 6):
        return "SPRING"
    if month in (7, 8, 9):
        return "SUMMER"
    return "FALL"


def _date_parts(value: Any) -> Optional[Dict[str, int]]:
    raw = _text(value)
    if not raw:
        return None
    parts = raw.split("-")
    if not parts or not parts[0].isdigit():
        return None
    result: Dict[str, int] = {"year": int(parts[0])}
    if len(parts) > 1 and parts[1].isdigit():
        result["month"] = int(parts[1])
    if len(parts) > 2 and parts[2].isdigit():
        result["day"] = int(parts[2])
    return result


def _normalize(
    resource: Dict[str, Any], mapping: Optional[Dict[str, int]] = None
) -> Dict[str, Any]:
    """Convert one Kitsu anime resource into the AniList-shaped payload."""
    attrs = resource.get("attributes") or {}
    titles = attrs.get("titles") or {}
    poster = attrs.get("posterImage") or {}
    cover = attrs.get("coverImage") or {}
    mapping = mapping or {}

    romaji = _text(titles.get("en_jp")) or _text(attrs.get("canonicalTitle"))
    english = _text(titles.get("en")) or romaji

    genres = [
        name
        for name in (
            _text((category.get("attributes") or {}).get("title"))
            for category in resource.get("_categories") or []
        )
        if name
    ]

    youtube_id = _text(attrs.get("youtubeVideoId"))

    start_date = _date_parts(attrs.get("startDate"))
    season_year = _to_int(attrs.get("seasonYear")) or (start_date or {}).get("year", 0)

    return {
        "anilist_id": mapping.get("anilist"),
        "mal_id": mapping.get("mal"),
        "title_romaji": romaji,
        "title_english": english,
        "title_native": _text(titles.get("ja_jp")),
        "synopsis_en": _text(attrs.get("synopsis")) or _text(attrs.get("description")),
        "cover_image_large": _text(poster.get("medium")) or _text(poster.get("large")),
        "cover_image_extra_large": _text(poster.get("large")) or _text(poster.get("original")),
        "banner_image": _text(cover.get("large")) or _text(cover.get("original")),
        "format": _FORMAT_MAP.get(_text(attrs.get("subtype")).lower(), "TV"),
        "status": _STATUS_MAP.get(_text(attrs.get("status")).lower(), "FINISHED"),
        "episodes_count": _to_int(attrs.get("episodeCount")) or 0,
        "duration_per_ep": _to_int(attrs.get("episodeLength")) or 24,
        "season": _text(attrs.get("season")).upper()
        or _season_from_month((start_date or {}).get("month")),
        "season_year": season_year,
        "average_score": _rating(attrs.get("averageRating")),
        "genres": genres,
        "studios": [],
        "next_airing": None,
        "trailer": {"id": youtube_id, "site": "youtube"} if youtube_id else None,
        "relations": [],
        "start_date": start_date,
    }


async def mappings_for(kitsu_id: Any) -> Dict[str, int]:
    """Return ``{"anilist": id, "mal": id}`` for one Kitsu anime id."""
    payload = await _get(f"/anime/{kitsu_id}/mappings")
    result: Dict[str, int] = {}
    for item in payload.get("data") or []:
        attrs = item.get("attributes") or {}
        external_id = _to_int(attrs.get("externalId"))
        if external_id is None:
            continue
        site = _text(attrs.get("externalSite"))
        if site == "anilist/anime":
            result["anilist"] = external_id
        elif site == "myanimelist/anime":
            result["mal"] = external_id
    return result


async def _attach_mappings(resources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Resolve AniList/MAL ids for a page of Kitsu resources, in parallel."""
    if not resources:
        return []

    semaphore = asyncio.Semaphore(_MAPPING_CONCURRENCY)

    async def _one(resource: Dict[str, Any]) -> Dict[str, Any]:
        async with semaphore:
            try:
                mapping = await mappings_for(resource.get("id"))
            except Exception as exc:  # pragma: no cover - best effort
                logger.debug("Kitsu mapping lookup failed for %s: %s", resource.get("id"), exc)
                mapping = {}
        return _normalize(resource, mapping)

    return list(await asyncio.gather(*(_one(resource) for resource in resources)))


def _attach_categories(
    resources: List[Dict[str, Any]], payload: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Attach genre names using each resource's ``categories`` relationship.

    ``include=categories`` returns the category objects in ``included``; the
    per-resource ``relationships.categories.data[*].id`` list says which of
    them belong to which anime.
    """
    names = {
        _text(item.get("id")): _text((item.get("attributes") or {}).get("title"))
        for item in payload.get("included") or []
        if item.get("type") == "categories"
    }
    enriched: List[Dict[str, Any]] = []
    for resource in resources:
        linked = ((resource.get("relationships") or {}).get("categories") or {}).get("data") or []
        resource = dict(resource)
        resource["_categories"] = [
            {"attributes": {"title": names.get(_text(link.get("id")), "")}}
            for link in linked
            if names.get(_text(link.get("id")))
        ]
        enriched.append(resource)
    return enriched


async def _collection(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    payload = await _get("/anime", {**params, "include": "categories"})
    resources = _attach_categories(payload.get("data") or [], payload)
    return await _attach_mappings(resources)


async def mal_id_from_anilist(anilist_id: int) -> Optional[int]:
    """AniList id -> MyAnimeList id.

    This is the bridge that keeps the Jikan provider usable while AniList
    itself is unavailable.  Kitsu indexes mappings by external id, so one
    request finds the owning Kitsu entry, and a second reads its MAL mapping.
    """
    payload = await _get(
        "/mappings",
        {
            "filter[externalSite]": "anilist/anime",
            "filter[externalId]": str(anilist_id),
            "include": "item",
        },
    )
    entries = payload.get("data") or []
    if not entries:
        return None

    relationship = (entries[0].get("relationships") or {}).get("item") or {}
    # ``relationships.item.data.id`` is the owning anime; fall back to the
    # included resource when only links are present.
    kitsu_id = _text(((relationship.get("data") or {}).get("id")))
    if not kitsu_id:
        included = next(
            (item for item in payload.get("included") or [] if item.get("type") == "anime"), None
        )
        kitsu_id = _text((included or {}).get("id"))
    if not kitsu_id:
        return None

    mapping = await mappings_for(kitsu_id)
    return mapping.get("mal")


async def get_trending(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    limit = min(per_page, MAX_PER_PAGE)
    return await _collection(
        {
            "page[limit]": limit,
            "page[offset]": max(0, (page - 1) * limit),
            "filter[status]": "current",
            "sort": "-userCount",
        }
    )


async def get_popular(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    limit = min(per_page, MAX_PER_PAGE)
    return await _collection(
        {
            "page[limit]": min(per_page, MAX_PER_PAGE),
            "page[offset]": max(0, (page - 1) * min(per_page, MAX_PER_PAGE)),
            "sort": "-userCount",
        }
    )


async def get_seasonal(
    season: Optional[str] = None,
    year: Optional[int] = None,
    page: int = 1,
    per_page: int = 20,
) -> List[Dict[str, Any]]:
    limit = min(per_page, MAX_PER_PAGE)
    params: Dict[str, Any] = {
        "page[limit]": limit,
        "page[offset]": max(0, (page - 1) * limit),
        "sort": "-userCount",
    }
    if year:
        params["filter[seasonYear]"] = str(year)
    if season and _text(season):
        params["filter[season]"] = _text(season).lower()
    return await _collection(params)


async def get_upcoming(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    limit = min(per_page, MAX_PER_PAGE)
    return await _collection(
        {
            "page[limit]": limit,
            "page[offset]": max(0, (page - 1) * limit),
            "filter[status]": "upcoming",
            "sort": "-userCount",
        }
    )


async def get_recent_releases(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    """Approximate recent releases with currently-airing titles.

    Kitsu exposes no public episode-schedule endpoint equivalent to AniList's
    ``airingSchedules``, so ongoing shows stand in.  ``airing_at`` is 0 because
    Kitsu provides no broadcast timestamp.
    """
    results = await get_trending(page=page, per_page=per_page)
    return [
        {
            "airing_id": item.get("anilist_id") or index,
            "airing_at": 0,
            "episode": 0,
            "media": item,
        }
        for index, item in enumerate(results)
    ]


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
    limit = min(per_page, MAX_PER_PAGE)
    params: Dict[str, Any] = {
        "page[limit]": limit,
        "page[offset]": max(0, (page - 1) * limit),
    }
    if search and search.strip():
        params["filter[text]"] = search.strip()
    if status and status.strip().upper() in _STATUS_FILTERS:
        params["filter[status]"] = _STATUS_FILTERS[status.strip().upper()]
    if year:
        params["filter[seasonYear]"] = str(year)
    subtype = (format or "").strip().lower()
    if subtype in _FORMAT_MAP:
        params["filter[subtype]"] = subtype

    sort_key = (sort or ["POPULARITY_DESC"])[0] if sort else "POPULARITY_DESC"
    params["sort"] = "-averageRating" if sort_key == "SCORE_DESC" else "-userCount"

    return await _collection(params)


async def get_anime_details(anilist_id: int) -> Optional[Dict[str, Any]]:
    """Resolve an AniList id to its Kitsu entry, then load the details."""
    payload = await _get(
        "/mappings",
        {
            "filter[externalSite]": "anilist/anime",
            "filter[externalId]": str(anilist_id),
            "include": "item",
        },
    )
    entries = payload.get("data") or []
    if not entries:
        return None

    relationship = (entries[0].get("relationships") or {}).get("item") or {}
    kitsu_id = _text(((relationship.get("data") or {}).get("id")))
    source = next((i for i in payload.get("included") or [] if i.get("type") == "anime"), None)
    if not kitsu_id and source:
        kitsu_id = _text(source.get("id"))
    if not kitsu_id:
        return None

    resource = await _get(
        f"/anime/{kitsu_id}",
        {"include": "mappings,categories"},
    )
    data = resource.get("data")
    if not data:
        return None

    categories = [i for i in resource.get("included") or [] if i.get("type") == "categories"]
    data = dict(data)
    data["_categories"] = categories

    mapping: Dict[str, int] = {"anilist": anilist_id}
    for item in resource.get("included") or []:
        if item.get("type") != "mappings":
            continue
        attrs = item.get("attributes") or {}
        if _text(attrs.get("externalSite")) == "myanimelist/anime":
            mal = _to_int(attrs.get("externalId"))
            if mal is not None:
                mapping["mal"] = mal
    return _normalize(data, mapping)
