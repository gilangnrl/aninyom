"""Subtitle Engine & Bilingual Translator.
Handles WebVTT parsing, Google RPC translation with HTML preservation,
Indonesian anime lexicon replacements, and dual-subtitle generation.
"""

import html as htmlmod
import json
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

from ..database import db

logger = logging.getLogger("aninyom.subtitle")

CUE_TIMING_RE = re.compile(
    r"((?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})"
)


def parse_vtt(vtt_text: str) -> List[Dict[str, Any]]:
    """Parse WebVTT content into structured cues list."""
    lines = vtt_text.replace("\r\n", "\n").split("\n")
    cues = []

    start = ""
    end = ""
    buf = []

    for line in lines:
        sline = line.strip()
        if not sline:
            if start and end and buf:
                text = "\n".join(buf).strip()
                if text:
                    cues.append({"start": start, "end": end, "text": text})
                start = ""
                end = ""
                buf = []
            continue

        match = CUE_TIMING_RE.search(sline)
        if match:
            if start and end and buf:
                text = "\n".join(buf).strip()
                if text:
                    cues.append({"start": start, "end": end, "text": text})
                buf = []
            start = match.group(1).replace(",", ".")
            end = match.group(2).replace(",", ".")
            continue

        if start and end:
            # Strip formatting tags for translation
            clean = re.sub(r"<[^>]+>", "", sline).strip()
            if clean:
                buf.append(clean)

    if start and end and buf:
        text = "\n".join(buf).strip()
        if text:
            cues.append({"start": start, "end": end, "text": text})

    return cues


def build_vtt(cues: List[Dict[str, Any]]) -> str:
    """Serialize cues into a clean standard WebVTT document."""
    out = ["WEBVTT", ""]
    for i, c in enumerate(cues, 1):
        out.append(f"{c['start']} --> {c['end']}")
        out.append(c["text"])
        out.append("")
    return "\n".join(out)


def build_dual_vtt(cues_id: List[Dict[str, Any]], cues_en: List[Dict[str, Any]]) -> str:
    """Build a dual-track WebVTT document with Indonesian on top and English below."""
    en_map = {c["start"]: c["text"] for c in cues_en}
    dual_cues = []

    for i, cid in enumerate(cues_id):
        st = cid["start"]
        en_text = en_map.get(st) or (cues_en[i]["text"] if i < len(cues_en) else "")
        id_text = cid["text"]

        if en_text:
            combined = (
                f"<c.id>{htmlmod.escape(id_text)}</c.id>\n<c.en>{htmlmod.escape(en_text)}</c.en>"
            )
        else:
            combined = f"<c.id>{htmlmod.escape(id_text)}</c.id>"

        dual_cues.append({"start": cid["start"], "end": cid["end"], "text": combined})

    return build_vtt(dual_cues)


async def apply_lexicon(text: str) -> str:
    """Replace common anime terms and honorifics using the Indonesian lexicon."""
    try:
        rows = await db.fetch("SELECT source_term, id_term FROM anime_lexicon")
        for row in rows:
            pattern = re.compile(rf"\b{re.escape(row['source_term'])}\b", re.IGNORECASE)
            text = pattern.sub(row["id_term"], text)
    except Exception as e:
        logger.warning("Error applying lexicon: %s", e)
    return text


def _extract_translated_html(resp_text: str) -> str:
    """Parse JSON response from Google Translate RPC and extract inner HTML."""
    try:
        data = json.loads(resp_text)
        if isinstance(data, list):
            # Format 1: clients5.google.com -> ["<p id=..."]
            if len(data) > 0 and isinstance(data[0], str):
                return data[0]
            # Format 2: translate.googleapis.com -> [[["chunk1", ...], ["chunk2", ...]]]
            if len(data) > 0 and isinstance(data[0], list):
                chunks = []
                for item in data[0]:
                    if isinstance(item, list) and len(item) > 0 and isinstance(item[0], str):
                        chunks.append(item[0])
                if chunks:
                    return "".join(chunks)
    except Exception as e:
        logger.debug("Failed parsing translation JSON: %s", e)
    return resp_text


async def translate_cues_gtx(
    cues: List[Dict[str, Any]], src_lang: str = "en", tgt_lang: str = "id"
) -> List[Dict[str, Any]]:
    """Translate cues using Google Translate with HTML tag chunking to guarantee timing sync."""
    if not cues:
        return []

    batch_size = 25
    translated_cues = []

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
    }

    async with httpx.AsyncClient(headers=headers, timeout=12.0) as client:
        for i in range(0, len(cues), batch_size):
            batch = cues[i : i + batch_size]
            html_chunks = [
                f'<p id="{idx}">{htmlmod.escape(c["text"])}</p>' for idx, c in enumerate(batch)
            ]
            joined = "".join(html_chunks)

            endpoints = [
                (
                    "https://translate.googleapis.com/translate_a/single",
                    {
                        "client": "gtx",
                        "sl": src_lang,
                        "tl": tgt_lang,
                        "dt": "t",
                        "q": joined,
                    },
                ),
                (
                    "https://clients5.google.com/translate_a/t",
                    {"client": "dict-chrome-ex", "sl": src_lang, "tl": tgt_lang, "q": joined},
                ),
                (
                    "https://translate.googleapis.com/translate_a/single",
                    {
                        "client": "dict-chrome-ex",
                        "sl": src_lang,
                        "tl": tgt_lang,
                        "dt": "t",
                        "q": joined,
                    },
                ),
            ]

            translated_batch_map = {}
            for ep_url, params in endpoints:
                try:
                    resp = await client.get(ep_url, params=params)
                    if resp.status_code == 200:
                        raw_html = _extract_translated_html(resp.text)
                        matches = re.findall(
                            r"<p\s+id=[\'\"]?(\d+)[\'\"]?\s*>(.*?)</p>",
                            raw_html,
                            re.IGNORECASE | re.DOTALL,
                        )
                        for m_id, m_text in matches:
                            clean_text = htmlmod.unescape(m_text.strip())
                            translated_batch_map[int(m_id)] = clean_text
                        if translated_batch_map:
                            break
                except Exception as e:
                    logger.debug("GTX endpoint failed: %s", e)

            # Assemble batch
            for idx, c in enumerate(batch):
                tr_text = translated_batch_map.get(idx, c["text"])
                # Apply lexicon to translated Indonesian text
                if tgt_lang == "id":
                    tr_text = await apply_lexicon(tr_text)

                translated_cues.append({"start": c["start"], "end": c["end"], "text": tr_text})

    return translated_cues
