"""Subtitle API Routes.
Serves on-demand translated Indonesian, original English, and Dual-subtitles WebVTT.
"""

import asyncio
import hashlib
import logging
import re
from typing import Optional

from curl_cffi import requests as creq
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from ..config import HI_UA
from ..database import db
from ..subtitle.formats import to_vtt
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

EMPTY_VTT = "WEBVTT\n\n"
_TAG_RE = re.compile(r"<[^>]+>")

# Languages whose subtitles are expected to be written in Latin script.
_LATIN_LANGS = {
    "en",
    "id",
    "es",
    "fr",
    "de",
    "it",
    "pt",
    "pl",
    "tr",
    "vi",
    "nl",
    "sv",
    "no",
    "da",
    "fi",
    "cs",
    "ro",
    "hu",
}


class LexiconEntry(BaseModel):
    source_term: str
    id_term: str
    category: Optional[str] = "general"
    notes: Optional[str] = None


def _latin_ratio(text: str) -> float:
    """Share of letters that belong to the Latin script."""
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return 1.0
    latin = sum(1 for char in letters if ord(char) < 0x0250)
    return latin / len(letters)


def _cache_lang(lang_key: str, src_url: str) -> str:
    """Cache key that includes the source URL, so provider swaps never collide."""
    digest = hashlib.sha256(src_url.encode("utf-8")).hexdigest()[:16]
    return f"{lang_key}@{digest}"


def _script_matches(vtt_text: str, lang: Optional[str]) -> bool:
    """Reject a track whose script contradicts its declared language."""
    language = (lang or "").strip().lower()
    if not language:
        return True

    ratio = _latin_ratio(_TAG_RE.sub("", vtt_text))
    if language in _LATIN_LANGS:
        return ratio >= 0.25
    if language in {"ar", "fa", "ur"}:
        return ratio <= 0.75
    if language in {"ru", "uk", "bg"}:
        return ratio <= 0.9
    return True


async def _fetch_raw(src_url: str, referer: Optional[str] = None) -> str:
    """Fetch raw subtitle bytes with the correct upstream Referer header."""
    headers = {"User-Agent": HI_UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    elif "dramahot" in src_url or "zoko" in src_url:
        headers["Referer"] = "https://zokoanime.video/"
    else:
        headers["Referer"] = "https://megaplay.buzz/"

    try:
        response = await asyncio.to_thread(
            creq.get, src_url, headers=headers, impersonate="chrome124", timeout=15
        )
        if response.status_code == 200:
            return response.text
        logger.warning("Subtitle source %s returned HTTP %s", src_url, response.status_code)
    except Exception as e:
        logger.error("Failed fetching subtitle from %s: %s", src_url, e)

    raise HTTPException(status_code=502, detail="Failed to fetch source subtitle track")


async def _fetch_vtt(src_url: str, referer: Optional[str] = None) -> str:
    """Fetch a subtitle track and normalize ASS/SRT payloads to WebVTT."""
    raw = await _fetch_raw(src_url, referer)
    return to_vtt(src_url, raw)


@router.get("/proxy")
async def proxy_subtitle(
    url: str = Query(..., description="Target subtitle VTT URL"),
    ref: Optional[str] = Query(None, description="Upstream referer"),
    lang: Optional[str] = Query(None, description="Declared language of the track"),
):
    """Proxy third-party subtitles, converting ASS/SRT to WebVTT."""
    content = await _fetch_vtt(url, referer=ref)
    if not _script_matches(content, lang):
        logger.warning("Rejecting %s track with mismatched script: %s", lang, url)
        content = EMPTY_VTT
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

        # A track labelled English must actually be Latin script. Returning an
        # empty document is better than leaking another language into the UI.
        if lang_key == "en" and not _script_matches(vtt_content, "en"):
            logger.warning("Rejecting non-Latin English subtitle track: %s", src_url)
            vtt_content = EMPTY_VTT

        return Response(
            content=vtt_content,
            media_type="text/vtt",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
        )

    cache_lang = _cache_lang(lang_key, src_url or "")

    # 2. Check cached translation
    try:
        cached = await db.fetchrow(
            "SELECT vtt_content FROM subtitle_cache WHERE hianime_episode_id = ? AND lang_code = ? AND tier = 'gtx'",
            episode_id,
            cache_lang,
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

    # Translation is only meaningful for a Latin-script source. Anything else
    # would be silently mangled, so serve an empty track and log instead.
    if _latin_ratio(_TAG_RE.sub("", source_raw)) < 0.25:
        logger.warning("Rejecting non-Latin translation source: %s", src_url)
        return Response(
            content=EMPTY_VTT,
            media_type="text/vtt",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
        )

    source_cues = parse_vtt(source_raw)

    if not source_cues:
        logger.warning("Source subtitle had no readable cues: %s", src_url)
        return Response(
            content=EMPTY_VTT,
            media_type="text/vtt",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"},
        )

    if lang_key == "en_ai":
        cues_en = await translate_cues_gtx(source_cues, src_lang="id", tgt_lang="en")
        en_vtt = build_vtt(cues_en)
        try:
            await db.execute(
                """INSERT INTO subtitle_cache (hianime_episode_id, lang_code, tier, vtt_content)
                   VALUES (?, ?, 'gtx', ?)
                   ON CONFLICT (hianime_episode_id, lang_code, tier) DO UPDATE SET vtt_content = excluded.vtt_content""",
                episode_id,
                cache_lang,
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
               VALUES (?, ?, 'gtx', ?)
               ON CONFLICT (hianime_episode_id, lang_code, tier) DO UPDATE SET vtt_content = excluded.vtt_content""",
            episode_id,
            cache_lang,
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
                   VALUES (?, ?, 'gtx', ?)
                   ON CONFLICT (hianime_episode_id, lang_code, tier) DO UPDATE SET vtt_content = excluded.vtt_content""",
                episode_id,
                cache_lang,
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
