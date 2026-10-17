"""AniZone provider.

AniZone is a Laravel/Livewire site. Anime pages embed their catalog in an Alpine
``x-data`` expression and episode pages embed the player config as
``vidstackPlayer(JSON.parse('...'))``. The player config carries the HLS master
URL, subtitle renditions (usually ASS) and the intro/outro chapters.
"""

import asyncio
import json
import logging
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional

from curl_cffi import requests as creq

from ..config import HI_UA
from .base import (
    BaseProvider,
    ProviderError,
    StreamRequest,
    StreamResult,
    SubtitleTrack,
)

logger = logging.getLogger("aninyom.providers.anizone")

BASE_URL = "https://anizone.to"
HEADERS = {
    "User-Agent": HI_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_ITEMS_RE = re.compile(r"items:\s*JSON\.parse\('(.*?)'\)", re.S)
_PLAYER_RE = re.compile(r"vidstackPlayer\(JSON\.parse\('(.*?)'\)\)", re.S)

# slug lookups are expensive (one search request per anime), so remember them
_slug_cache: Dict[str, tuple[str, float]] = {}
_SLUG_TTL = 6 * 3600


def _unescape_js_json(raw: str) -> str:
    """Undo the escaping Laravel applies inside the Alpine attribute."""
    text = raw.replace("\\u0022", '"')
    return re.sub(r"\\+/", "/", text)


def _parse_js_json(raw: str) -> Any:
    return json.loads(_unescape_js_json(raw))


def _fetch(url: str, referer: Optional[str] = None, timeout: int = 60) -> str:
    headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
    response = creq.get(
        url,
        headers=headers,
        impersonate="chrome124",
        timeout=timeout,
        allow_redirects=True,
    )
    if response.status_code != 200:
        raise ProviderError(f"AniZone returned HTTP {response.status_code} for {url}")
    return response.text


def _clean_title(value: Any) -> str:
    """Normalize the doubly-encoded titles AniZone stores."""
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if not text:
        return ""

    if text.startswith('"') and text.endswith('"') and len(text) > 1:
        try:
            text = json.loads(text)
        except Exception:
            text = text[1:-1]
    elif "\\u" in text or "\\/" in text:
        try:
            text = json.loads(f'"{text}"')
        except Exception:
            pass

    return re.sub(r"\s+", " ", str(text)).strip()


def _normalize(text: str) -> str:
    lowered = _clean_title(text).lower()
    lowered = re.sub(r"[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af ]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _score(query: str, candidate: str) -> float:
    if not query or not candidate:
        return 0.0
    if query == candidate:
        return 1.0
    if query in candidate or candidate in query:
        return 0.85
    q_tokens = set(query.split())
    c_tokens = set(candidate.split())
    if not q_tokens or not c_tokens:
        return 0.0
    return 0.7 * len(q_tokens & c_tokens) / len(q_tokens | c_tokens)


def _candidate_names(item: Dict[str, Any]) -> List[str]:
    names = [item.get("main_title")]
    names.extend((item.get("title_list") or {}).values())
    return [name for name in (_clean_title(n) for n in names) if name]


def _parse_items(html: str) -> List[Dict[str, Any]]:
    match = _ITEMS_RE.search(html)
    if not match:
        return []
    try:
        items = _parse_js_json(match.group(1))
    except Exception as e:
        logger.warning("Failed parsing AniZone item list: %s", e)
        return []
    return items if isinstance(items, list) else []


def _search_queries(titles: List[str]) -> List[str]:
    queries: List[str] = []
    for raw in titles:
        title = (raw or "").strip()
        if not title:
            continue
        if title not in queries:
            queries.append(title)
        base = re.sub(
            r"\b(Season\s+\d+|Part\s+\d+|Cour\s+\d+|\d+(?:st|nd|rd|th)\s+Season)\b",
            "",
            title,
            flags=re.IGNORECASE,
        ).strip(" :-")
        if base and len(base) > 3 and base not in queries:
            queries.append(base)
        if ":" in title:
            head = title.split(":", 1)[0].strip()
            if head and len(head) > 3 and head not in queries:
                queries.append(head)
    return queries


def _resolve_slug(titles: List[str]) -> str:
    """Map a human title to AniZone's opaque slug."""
    for title in titles:
        cached = _slug_cache.get(_normalize(title))
        if cached and cached[1] > time.time():
            return cached[0]

    best_item: Optional[Dict[str, Any]] = None
    best_score = 0.0
    tried = set()

    for query in _search_queries(titles):
        norm_query = _normalize(query)
        if not norm_query or norm_query in tried:
            continue
        tried.add(norm_query)

        try:
            html = _fetch(f"{BASE_URL}/anime?search={urllib.parse.quote(query)}")
        except Exception as e:
            logger.debug("AniZone search failed for %r: %s", query, e)
            continue

        for item in _parse_items(html):
            if not item.get("slug"):
                continue
            score = max(
                (_score(norm_query, _normalize(name)) for name in _candidate_names(item)),
                default=0.0,
            )
            if score > best_score:
                best_score, best_item = score, item

        if best_score >= 0.999:
            break

    if not best_item or best_score < 0.5:
        raise ProviderError(f"AniZone has no confident match for {titles!r}")

    slug = str(best_item["slug"])
    expires = time.time() + _SLUG_TTL
    for title in titles:
        key = _normalize(title)
        if key:
            _slug_cache[key] = (slug, expires)
    return slug


def _fetch_player_config(slug: str, episode_number: int) -> Dict[str, Any]:
    url = f"{BASE_URL}/anime/{slug}/{episode_number}"
    html = _fetch(url, referer=f"{BASE_URL}/anime/{slug}")
    match = _PLAYER_RE.search(html)
    if not match:
        raise ProviderError(f"AniZone episode page had no player config: {url}")
    try:
        config = _parse_js_json(match.group(1))
    except Exception as e:
        raise ProviderError(f"Failed to parse AniZone player config: {e}") from e
    if not isinstance(config, dict):
        raise ProviderError("AniZone player config was not an object")
    return config


class AnizoneProvider(BaseProvider):
    name = "anizone"

    async def resolve(self, request: StreamRequest) -> StreamResult:
        if not request.title and not request.title_alt:
            raise ProviderError("AniZone requires an anime title")
        if request.episode_number is None:
            raise ProviderError("AniZone requires an episode number")

        titles = [t for t in (request.title, request.title_alt) if t]
        slug = await asyncio.to_thread(_resolve_slug, titles)
        config = await asyncio.to_thread(_fetch_player_config, slug, int(request.episode_number))

        master_url = str(config.get("src") or "")
        if not master_url:
            raise ProviderError("AniZone player config had no stream source")
        master_url = urllib.parse.urljoin(f"{BASE_URL}/", master_url)

        subtitles = []
        for track in config.get("subtitles") or []:
            file_url = str(track.get("file") or "")
            if not file_url:
                continue
            subtitles.append(
                SubtitleTrack(
                    url=urllib.parse.urljoin(f"{BASE_URL}/", file_url),
                    lang=str(track.get("language") or "").strip().lower(),
                    label=str(track.get("title") or track.get("language") or "Unknown"),
                    default=bool(track.get("default", False)),
                    forced=str(track.get("forced") or "").lower() in ("yes", "true", "1"),
                    format=str(track.get("format") or "vtt").strip().lower(),
                )
            )

        # Audio renditions are declared as EXT-X-MEDIA in the master playlist;
        # the registry replaces audio_tracks with the manifest-derived list.
        return StreamResult(
            master_url=master_url,
            referer=f"{BASE_URL}/",
            provider=self.name,
            server="AniZone",
            subtitles=subtitles,
            audio_tracks=[],
            intro={"start": 0, "end": 0},
            outro={"start": 0, "end": 0},
            available_modes=["sub"],
        )
