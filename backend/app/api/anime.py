"""Anime Catalog & Discovery API Routes."""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..cache import cache
from ..database import db
from ..providers import anilist
from ..scrapers import hianime

logger = logging.getLogger("aninyom.api.anime")
router = APIRouter(prefix="/api/anime", tags=["Anime"])


@router.get("/trending")
async def get_trending(page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=50)):
    """Get currently trending anime."""
    cache_key = f"anilist:trending:{page}:{per_page}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        data = await anilist.get_trending(page=page, per_page=per_page)
        await cache.set(cache_key, data, ttl=1800)
        return data
    except Exception as e:
        logger.error("Failed fetching trending: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch trending anime")


@router.get("/popular")
async def get_popular(page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=50)):
    """Get all-time popular anime."""
    cache_key = f"anilist:popular:{page}:{per_page}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        data = await anilist.get_popular(page=page, per_page=per_page)
        await cache.set(cache_key, data, ttl=3600)
        return data
    except Exception as e:
        logger.error("Failed fetching popular: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch popular anime")


@router.get("/seasonal")
async def get_seasonal(
    season: Optional[str] = Query(None, description="WINTER, SPRING, SUMMER, FALL"),
    year: Optional[int] = Query(None, description="Year, e.g. 2026"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Get seasonal anime."""
    if not season or not year:
        cur_season, cur_year = anilist.get_current_season_year()
        season = season or cur_season
        year = year or cur_year

    cache_key = f"anilist:seasonal:{season}:{year}:{page}:{per_page}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        data = await anilist.get_seasonal(season=season, year=year, page=page, per_page=per_page)
        await cache.set(cache_key, data, ttl=7200)
        return data
    except Exception as e:
        logger.error("Failed fetching seasonal: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch seasonal anime")


@router.get("/recent")
async def get_recent_releases(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Get recently broadcast anime episodes."""
    cache_key = f"anilist:recent:{page}:{per_page}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        data = await anilist.get_recent_releases(page=page, per_page=per_page)
        await cache.set(cache_key, data, ttl=600)
        return data
    except Exception as e:
        logger.error("Failed fetching recent releases: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch recent releases")


@router.get("/upcoming")
async def get_upcoming(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Get real upcoming anime seasons and premieres from AniList."""
    cache_key = f"anilist:upcoming:{page}:{per_page}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        data = await anilist.get_upcoming(page=page, per_page=per_page)
        await cache.set(cache_key, data, ttl=7200)
        return data
    except Exception as e:
        logger.error("Failed fetching upcoming: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch upcoming anime")


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

    cache_key = f"anilist:search:{q}:{genre}:{format}:{sort}:{season}:{year}:{target_status}:{page}:{per_page}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        results = await anilist.search_anime_anilist(
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
        await cache.set(cache_key, results, ttl=600)
        return results
    except Exception as e:
        logger.error("Search failed: %s", e)
        raise HTTPException(status_code=500, detail="Search failed")


@router.get("/{anilist_id}")
async def get_anime_details(anilist_id: int):
    """Get detailed anime information by AniList ID."""
    cache_key = f"anilist:details:{anilist_id}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        media = await anilist.get_anime_details(anilist_id)
        if not media:
            raise HTTPException(status_code=404, detail="Anime not found")
        await cache.set(cache_key, media, ttl=86400)
        return media
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed fetching anime details %s: %s", anilist_id, e)
        raise HTTPException(status_code=500, detail="Failed to fetch anime details")


@router.get("/{anilist_id}/episodes")
async def get_anime_episodes(anilist_id: int, title: Optional[str] = Query(None)):
    """Fetch episode list for an anime, mapping AniList title to HiAnime."""
    # 1. Fetch details to get all possible title candidates
    details = await anilist.get_anime_details(anilist_id)
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
        await cache.set(cache_key, episodes_payload, ttl=1800)
        return episodes_payload
    except Exception as e:
        logger.error("Failed fetching episodes for anilist_id %s: %s", anilist_id, e)
        raise HTTPException(status_code=500, detail=f"Failed to fetch episodes: {e}")
