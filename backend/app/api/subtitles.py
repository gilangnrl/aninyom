"""Subtitle API Routes.
Serves on-demand translated Indonesian, original English, and Dual-subtitles WebVTT.
"""

import logging
from typing import Optional

from curl_cffi import requests as creq
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from ..config import HI_UA
from ..database import db
from ..subtitle.translator import (
    build_dual_vtt,
    build_vtt,
    parse_vtt,
    translate_cues_gtx,
)

logger = logging.getLogger("aninyom.api.subtitles")
router = APIRouter(prefix="/api/subtitles", tags=["Subtitles"])

HEADERS = {
    "User-Agent": HI_UA,
    "Referer": "https://megaplay.buzz/",
    "Accept": "*/*",
}


class LexiconEntry(BaseModel):
    source_term: str
    id_term: str
    category: Optional[str] = "general"
    notes: Optional[str] = None


async def _fetch_vtt(src_url: str, referer: Optional[str] = None) -> str:
    """Fetch raw WebVTT content with correct Referer header."""
    headers = {"User-Agent": HI_UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    elif "dramahot" in src_url or "zoko" in src_url:
        headers["Referer"] = "https://zokoanime.video/"
    else:
        headers["Referer"] = "https://megaplay.buzz/"

    try:
        r = creq.get(src_url, headers=headers, impersonate="chrome124", timeout=10)
        if r.status_code == 200:
            return r.text
    except Exception as e:
        logger.error("Failed fetching VTT from %s: %s", src_url, e)
    raise HTTPException(status_code=502, detail="Failed to fetch source subtitle track")


@router.get("/proxy")
async def proxy_subtitle(
    url: str = Query(..., description="Target subtitle VTT URL"),
    ref: Optional[str] = Query(None, description="Upstream referer"),
):
    """Proxy third-party WebVTT subtitles with proper upstream Referer header and CORS."""
    content = await _fetch_vtt(url, referer=ref)
    return Response(
        content=content,
        media_type="text/vtt",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
    )


@router.get("/{episode_id}/{lang_file}")
async def get_subtitle(
    episode_id: str,
    lang_file: str,
    src_url: Optional[str] = Query(None, description="Source subtitle VTT URL"),
    ref: Optional[str] = Query(None, description="Upstream referer"),
    raw: bool = Query(False, description="Whether to serve src_url directly without translation"),
):
    """Serve WebVTT subtitles: id.vtt, en.vtt, or dual_id_en.vtt."""
    lang_key = lang_file.replace(".vtt", "")

    # 1. English original or Raw requested track
    if lang_key == "en" or raw:
        if not src_url:
            raise HTTPException(status_code=400, detail="src_url is required")
        vtt_content = await _fetch_vtt(src_url, referer=ref)
        return Response(
            content=vtt_content,
            media_type="text/vtt",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
        )

    # 2. Check cached translation
    try:
        cached = await db.fetchrow(
            "SELECT vtt_content FROM subtitle_cache WHERE hianime_episode_id = ? AND lang_code = ? AND tier = 'gtx'",
            episode_id,
            lang_key,
        )
        if cached:
            vtt_str = cached["vtt_content"] or ""
            # Verify dual subtitles have both id and en cues
            if lang_key in ("dual_id_en", "dual") and (
                "<c.id>" not in vtt_str or "<c.en>" not in vtt_str
            ):
                logger.info("Invalid dual subtitle in cache for %s, regenerating...", episode_id)
            else:
                return Response(
                    content=vtt_str,
                    media_type="text/vtt",
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=86400",
                    },
                )
    except Exception as e:
        logger.warning("Subtitle cache lookup failed: %s", e)

    if not src_url:
        raise HTTPException(status_code=400, detail="src_url is required to generate translation")

    # Fetch the selected source track to translate.
    source_raw = await _fetch_vtt(src_url, referer=ref)
    source_cues = parse_vtt(source_raw)

    if not source_cues:
        raise HTTPException(status_code=500, detail="Failed to parse source subtitle cues")

    if lang_key == "en_ai":
        cues_en = await translate_cues_gtx(source_cues, src_lang="id", tgt_lang="en")
        en_vtt = build_vtt(cues_en)
        try:
            await db.execute(
                """INSERT INTO subtitle_cache (hianime_episode_id, lang_code, tier, vtt_content)
                   VALUES (?, 'en_ai', 'gtx', ?)
                   ON CONFLICT (hianime_episode_id, lang_code, tier) DO UPDATE SET vtt_content = excluded.vtt_content""",
                episode_id,
                en_vtt,
            )
        except Exception as e:
            logger.warning("Failed saving AI English subtitle cache: %s", e)
        return Response(
            content=en_vtt,
            media_type="text/vtt",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
        )

    # 3. Indonesian translation
    cues_en = source_cues
    cues_id = await translate_cues_gtx(cues_en, src_lang="en", tgt_lang="id")
    id_vtt = build_vtt(cues_id)

    # Save Indonesian to cache
    try:
        await db.execute(
            """INSERT INTO subtitle_cache (hianime_episode_id, lang_code, tier, vtt_content)
               VALUES (?, 'id', 'gtx', ?)
               ON CONFLICT (hianime_episode_id, lang_code, tier) DO UPDATE SET vtt_content = excluded.vtt_content""",
            episode_id,
            id_vtt,
        )
    except Exception as e:
        logger.warning("Failed saving id subtitle cache: %s", e)

    if lang_key == "id":
        return Response(
            content=id_vtt,
            media_type="text/vtt",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
        )

    # 4. Dual subtitles (ID + EN)
    if lang_key in ("dual_id_en", "dual"):
        dual_vtt = build_dual_vtt(cues_id, cues_en)
        try:
            await db.execute(
                """INSERT INTO subtitle_cache (hianime_episode_id, lang_code, tier, vtt_content)
                   VALUES (?, 'dual_id_en', 'gtx', ?)
                   ON CONFLICT (hianime_episode_id, lang_code, tier) DO UPDATE SET vtt_content = excluded.vtt_content""",
                episode_id,
                dual_vtt,
            )
        except Exception as e:
            logger.warning("Failed saving dual subtitle cache: %s", e)

        return Response(
            content=dual_vtt,
            media_type="text/vtt",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
        )

    raise HTTPException(status_code=404, detail="Unsupported subtitle language")


@router.get("/lexicon/list")
async def list_lexicon():
    """List all registered Indonesian anime lexicon terms."""
    try:
        return await db.fetch(
            "SELECT id, source_term, id_term, category, notes FROM anime_lexicon ORDER BY source_term ASC"
        )
    except Exception as e:
        logger.error("Failed fetching lexicon: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch lexicon")


@router.post("/lexicon/entry")
async def add_or_update_lexicon(entry: LexiconEntry):
    """Add or update an Indonesian fansub translation term."""
    try:
        await db.execute(
            """INSERT INTO anime_lexicon (source_term, id_term, category, notes)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (source_term) DO UPDATE SET
               id_term = excluded.id_term,
               category = excluded.category,
               notes = excluded.notes""",
            entry.source_term.lower().strip(),
            entry.id_term.strip(),
            entry.category or "general",
            entry.notes or "",
        )
        return {"status": "success", "term": entry.source_term}
    except Exception as e:
        logger.error("Failed saving lexicon entry: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save lexicon entry")
