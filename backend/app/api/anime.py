"""Anime Catalog & Discovery API Routes."""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..cache import cache
from ..database import db
from ..providers import metadata
from ..scrapers import hianime

logger = logging.getLogger("aninyom.api.anime")
router = APIRouter(prefix="/api/anime", tags=["Anime"])


def _unavailable(action: str) -> HTTPException:
    """Failover exhausted and nothing cached: report 503, not a server bug."""
    logger.error("Metadata unavailable for %s: every provider failed", action)
    return HTTPException(
        status_code=503,
        detail=(
            "Anime metadata is temporarily unavailable because all upstream "
            "providers are down. Please try again in a few minutes."
        ),
    )


@router.get("/trending")


async def get_trending(page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=50)):
    """Get currently trending anime."""
    try:
        data = await metadata.get_trending(page=page, per_page=per_page)
        return data
    except Exception as e:
        logger.error("Failed fetching trending: %s", e)
        raise _unavailable("trending") from e


@router.get("/popular")


async def get_popular(page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=50)):
    """Get all-time popular anime."""
    try:
        data = await metadata.get_popular(page=page, per_page=per_page)
        return data
    except Exception as e:
        logger.error("Failed fetching popular: %s", e)
        raise _unavailable("popular") from e


@router.get("/seasonal")


async def get_seasonal(
    season: Optional[str] = Query(None, description="WINTER, SPRING, SUMMER, FALL"),
    year: Optional[int] = Query(None, description="Year, e.g. 2026"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Get seasonal anime."""
    if not season or not year:
        cur_season, cur_year = metadata.get_current_season_year()
        season = season or cur_season
        year = year or cur_year

    try:
        data = await metadata.get_seasonal(season=season, year=year, page=page, per_page=per_page)
        return data
    except Exception as e:
        logger.error("Failed fetching seasonal: %s", e)
        raise _unavailable("seasonal") from e


@router.get("/recent")


async def get_recent_releases(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Get recently broadcast anime episodes."""
    try:
        data = await metadata.get_recent_releases(page=page, per_page=per_page)
        return data
    except Exception as e:
        logger.error("Failed fetching recent releases: %s", e)
        raise _unavailable("recent releases") from e


@router.get("/upcoming")


async def get_upcoming(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Get real upcoming anime seasons and premieres from AniList."""
    try:
        data = await metadata.get_upcoming(page=page, per_page=per_page)
        return data
    except Exception as e:
        logger.error("Failed fetching upcoming: %s", e)
        raise _unavailable("upcoming anime") from e


@router.get("/search")


async def search_anime(
    q: Optional[str] = Query(None, description="Search query"),
    genre: Optional[str] = Query(None, description="Genre filter"),
    format: Optional[str] = Query(None, description="TV, MOVIE, OVA, ONA, SPECIAL"),
    sort: Optional[str] = Query(
        None, description="trending, popular, recent, latest, score, title, or AniList sort enum"
    ),
    season: Optional[str] = Query(None, description="WINTER, SPRING, SUMMER, FALL"),
    year: Optional[int] = Query(None, description="Year, e.g. 2026"),
    status: Optional[str] = Query(None, description="RELEASING, FINISHED, NOT_YET_RELEASED"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Search anime catalog by query, genre, format, season, year, status, and sort."""
    sort_list: Optional[List[str]] = None
    target_status = status

    if sort:
        s_lower = sort.strip().lower()
        if s_lower in ("trending", "trending_desc"):
            sort_list = ["TRENDING_DESC"]
        elif s_lower in ("popular", "popularity", "popularity_desc"):
            sort_list = ["POPULARITY_DESC"]
        elif s_lower in ("recent", "airing", "latest", "start_date", "start_date_desc"):
            sort_list = ["START_DATE_DESC"]
            if not target_status:
                target_status = "RELEASING"
        elif s_lower in ("score", "rating", "score_desc"):
            sort_list = ["SCORE_DESC"]
        elif s_lower in ("updated", "updated_at", "updated_at_desc"):
            sort_list = ["UPDATED_AT_DESC"]
        elif s_lower in ("title", "title_romaji"):
            sort_list = ["TITLE_ROMAJI"]
        elif s_lower in ("upcoming",):
            sort_list = ["POPULARITY_DESC"]
            if not target_status:
                target_status = "NOT_YET_RELEASED"
        else:
            sort_list = [sort.strip().upper()]

    try:
        results = await metadata.search_anime(
            search=q,
            genre=genre,
            format=format,
            sort=sort_list,
            season=season,
            year=year,
            status=target_status,
            page=page,
            per_page=per_page,
        )
        return results
    except Exception as e:
        logger.error("Search failed: %s", e)
        raise _unavailable("search") from e


@router.get("/{anilist_id}")


async def get_anime_details(anilist_id: int):
    """Get detailed anime information by AniList ID."""
    try:
        media = await metadata.get_anime_details(anilist_id)
        if not media:
            # ``None`` means every provider failed or had no such id.  Report an
            # outage as such instead of claiming the anime does not exist.
            if not metadata.any_provider_healthy():
                raise _unavailable("anime details")
            raise HTTPException(status_code=404, detail="Anime not found")
        return media
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed fetching anime details %s: %s", anilist_id, e)
        raise _unavailable("anime details") from e


@router.get("/{anilist_id}/episodes")


async def get_anime_episodes(anilist_id: int, title: Optional[str] = Query(None)):
    """Fetch episode list for an anime, mapping AniList title to HiAnime."""
    # 1. Fetch details to get all possible title candidates
    details = await metadata.get_anime_details(anilist_id)
    candidates = []
    if title:
        candidates.append(title.strip())

    if details:
        romaji = (details.get("title_romaji") or "").strip()
        english = (details.get("title_english") or "").strip()
        if english and english not in candidates:
            candidates.append(english)
        if romaji and romaji not in candidates:
            candidates.append(romaji)

    if not candidates:
        raise HTTPException(status_code=400, detail="Title is required to map episodes")

    cache_key = f"hianime:episodes:{anilist_id}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    # Build search query variations (stripping sub-titles, season indicators, extra labels)
    import re

    search_queries: List[str] = []
    for cand in candidates:
        if cand not in search_queries:
            search_queries.append(cand)
        # Strip colon subtitles: "Frieren: Beyond Journey's End" -> "Frieren"
        if ":" in cand:
            base_col = cand.split(":")[0].strip()
            if len(base_col) > 3 and base_col not in search_queries:
                search_queries.append(base_col)
        # Strip dash subtitles: "Bleach: Thousand-Year Blood War - The Conflict"
        if " - " in cand:
            base_dash = cand.split(" - ")[0].strip()
            if len(base_dash) > 3 and base_dash not in search_queries:
                search_queries.append(base_dash)
        # Strip season indicators: "Season 2", "2nd Season", "Part 2", "(TV)"
        cleaned = re.sub(
            r"\b(Season\s+\d+|2nd\s+Season|3rd\s+Season|\d+th\s+Season|Part\s+\d+|\(TV\)|Cour\s+\d+)\b",
            "",
            cand,
            flags=re.IGNORECASE,
        ).strip()
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if len(cleaned) > 3 and cleaned not in search_queries:
            search_queries.append(cleaned)

    try:
        results = []
        for q in search_queries:
            try:
                found = hianime.search_anime(q, limit=5)
                if found:
                    results = found
                    break
            except Exception as se:
                logger.debug("HiAnime search failed for '%s': %s", q, se)

        if not results:
            return {"episodes": [], "hianime_id": None, "title": candidates[0]}

        # Select first matching result
        target = results[0]
        hianime_id = target["id"]
        episodes = hianime.get_episodes(hianime_id)

        episodes_payload = {
            "hianime_id": hianime_id,
            "title": target["title"],
            "episodes": episodes,
        }
        return episodes_payload
    except Exception as e:
        logger.error("Failed fetching episodes for anilist_id %s: %s", anilist_id, e)
        raise HTTPException(status_code=500, detail="Failed to fetch episodes")
