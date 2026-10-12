"""AniList GraphQL Provider.
Fetches rich anime metadata, seasonal schedules, and catalog listings.
"""

import datetime
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

from ..config import ANILIST_GRAPHQL_URL

logger = logging.getLogger("aninyom.providers.anilist")

ANIME_FRAGMENT = """
fragment AnimeFields on Media {
    id
    idMal
    title {
        romaji
        english
        native
    }
    description(asHtml: false)
    coverImage {
        large
        extraLarge
        color
    }
    bannerImage
    format
    status
    episodes
    duration
    season
    seasonYear
    averageScore
    genres
    trending
    popularity
    nextAiringEpisode {
        airingAt
        timeUntilAiring
        episode
    }
}
"""

TRENDING_QUERY = (
    """
query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        pageInfo {
            hasNextPage
            total
        }
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
            ...AnimeFields
        }
    }
}
"""
    + ANIME_FRAGMENT
)

POPULAR_QUERY = (
    """
query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        pageInfo {
            hasNextPage
            total
        }
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
            ...AnimeFields
        }
    }
}
"""
    + ANIME_FRAGMENT
)

SEASONAL_QUERY = (
    """
query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        pageInfo {
            hasNextPage
            total
        }
        media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, isAdult: false) {
            ...AnimeFields
        }
    }
}
"""
    + ANIME_FRAGMENT
)

UPCOMING_QUERY = (
    """
query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        pageInfo {
            hasNextPage
            total
        }
        media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) {
            ...AnimeFields
            startDate {
                year
                month
                day
            }
        }
    }
}
"""
    + ANIME_FRAGMENT
)

RECENT_RELEASES_QUERY = (
    """
query ($airingAt_lesser: Int, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        pageInfo {
            hasNextPage
            total
        }
        airingSchedules(airingAt_lesser: $airingAt_lesser, sort: TIME_DESC) {
            id
            airingAt
            episode
            media {
                isAdult
                ...AnimeFields
            }
        }
    }
}
"""
    + ANIME_FRAGMENT
)

SEARCH_QUERY = (
    """
query ($search: String, $genre: String, $format: MediaFormat, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $status: MediaStatus, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        pageInfo {
            hasNextPage
            total
        }
        media(type: ANIME, search: $search, genre: $genre, format: $format, sort: $sort, season: $season, seasonYear: $seasonYear, status: $status, isAdult: false) {
            ...AnimeFields
        }
    }
}
"""
    + ANIME_FRAGMENT
)

ANIME_DETAIL_QUERY = (
    """
query ($id: Int) {
    Media(id: $id, type: ANIME) {
        ...AnimeFields
        trailer {
            id
            site
        }
        studios(isMain: true) {
            nodes {
                name
            }
        }
        relations {
            edges {
                relationType
                node {
                    id
                    title {
                        romaji
                        english
                    }
                    coverImage {
                        large
                    }
                    format
                    status
                }
            }
        }
    }
}
"""
    + ANIME_FRAGMENT
)


async def _post_graphql(query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            ANILIST_GRAPHQL_URL,
            json={"query": query, "variables": variables},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        if "errors" in data:
            logger.error("GraphQL errors: %s", data["errors"])
            raise RuntimeError(data["errors"][0]["message"])
        return data.get("data", {})


def _normalize_media(media: Dict[str, Any]) -> Dict[str, Any]:
    titles = media.get("title") or {}
    cover = media.get("coverImage") or {}
    studios = (
        [s.get("name") for s in media.get("studios", {}).get("nodes", [])]
        if "studios" in media
        else []
    )

    return {
        "anilist_id": media.get("id"),
        "mal_id": media.get("idMal"),
        "title_romaji": titles.get("romaji") or "",
        "title_english": titles.get("english") or titles.get("romaji") or "",
        "title_native": titles.get("native") or "",
        "synopsis_en": media.get("description") or "",
        "cover_image_large": cover.get("large") or "",
        "cover_image_extra_large": cover.get("extraLarge") or cover.get("large") or "",
        "banner_image": media.get("bannerImage") or cover.get("extraLarge") or "",
        "format": media.get("format") or "TV",
        "status": media.get("status") or "FINISHED",
        "episodes_count": media.get("episodes") or 0,
        "duration_per_ep": media.get("duration") or 24,
        "season": media.get("season") or "",
        "season_year": media.get("seasonYear") or 0,
        "average_score": media.get("averageScore") or 0,
        "genres": media.get("genres") or [],
        "studios": studios,
        "next_airing": media.get("nextAiringEpisode"),
        "trailer": media.get("trailer"),
        "relations": media.get("relations", {}).get("edges", []),
        "start_date": media.get("startDate"),
    }


async def get_trending(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    data = await _post_graphql(TRENDING_QUERY, {"page": page, "perPage": per_page})
    media_list = data.get("Page", {}).get("media", [])
    return [_normalize_media(m) for m in media_list]


def get_current_season_year() -> Tuple[str, int]:
    now = datetime.datetime.now(datetime.timezone.utc)
    month = now.month
    year = now.year
    if month in (1, 2, 3):
        season = "WINTER"
    elif month in (4, 5, 6):
        season = "SPRING"
    elif month in (7, 8, 9):
        season = "SUMMER"
    else:
        season = "FALL"
    return season, year


async def get_popular(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    data = await _post_graphql(POPULAR_QUERY, {"page": page, "perPage": per_page})
    media_list = data.get("Page", {}).get("media", [])
    return [_normalize_media(m) for m in media_list]


async def get_seasonal(
    season: Optional[str] = None, year: Optional[int] = None, page: int = 1, per_page: int = 20
) -> List[Dict[str, Any]]:
    if not season or not year:
        cur_season, cur_year = get_current_season_year()
        season = season or cur_season
        year = year or cur_year
    data = await _post_graphql(
        SEASONAL_QUERY, {"season": season, "seasonYear": year, "page": page, "perPage": per_page}
    )
    media_list = data.get("Page", {}).get("media", [])
    return [_normalize_media(m) for m in media_list]


async def get_upcoming(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    data = await _post_graphql(UPCOMING_QUERY, {"page": page, "perPage": per_page})
    media_list = data.get("Page", {}).get("media", [])
    return [_normalize_media(m) for m in media_list]


async def get_recent_releases(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    import time

    now = int(time.time())
    data = await _post_graphql(
        RECENT_RELEASES_QUERY,
        {"airingAt_lesser": now, "page": page, "perPage": per_page},
    )
    schedules = data.get("Page", {}).get("airingSchedules", [])
    results = []
    for s in schedules:
        media = s.get("media")
        if not media or media.get("isAdult"):
            continue
        normalized = _normalize_media(media)
        results.append(
            {
                "airing_id": s.get("id"),
                "airing_at": s.get("airingAt"),
                "episode": s.get("episode"),
                "media": normalized,
            }
        )
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
    clean_search = search.strip() if search and search.strip() else None
    clean_genre = genre.strip() if genre and genre.strip() else None
    clean_format = format.strip() if format and format.strip() else None
    clean_season = season.strip().upper() if season and season.strip() else None
    clean_status = status.strip().upper() if status and status.strip() else None

    # AniList requires sort without SEARCH_MATCH when search is not provided
    if clean_search:
        effective_sort = sort or ["SEARCH_MATCH"]
    else:
        effective_sort = [s for s in (sort or ["POPULARITY_DESC"]) if s != "SEARCH_MATCH"]
        if not effective_sort:
            effective_sort = ["POPULARITY_DESC"]

    variables: Dict[str, Any] = {
        "page": page,
        "perPage": per_page,
        "sort": effective_sort,
    }
    if clean_search:
        variables["search"] = clean_search
    if clean_genre:
        variables["genre"] = clean_genre
    if clean_format:
        variables["format"] = clean_format
    if clean_season:
        variables["season"] = clean_season
    if year:
        variables["seasonYear"] = year
    if clean_status:
        variables["status"] = clean_status

    data = await _post_graphql(SEARCH_QUERY, variables)
    media_list = data.get("Page", {}).get("media", [])
    return [_normalize_media(m) for m in media_list]


async def get_anime_details(anilist_id: int) -> Optional[Dict[str, Any]]:
    data = await _post_graphql(ANIME_DETAIL_QUERY, {"id": anilist_id})
    media = data.get("Media")
    if not media:
        return None
    return _normalize_media(media)
