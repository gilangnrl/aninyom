"""AniChi provider.

``anichi.to`` exposes an unauthenticated resolver pipeline that this provider
replays:

1. ``GET /filter/?keyword=<title>`` returns candidate ``/anime/<slug>`` pages.
2. ``GET /anime/<slug>`` carries the numeric series id on ``#series-page``.
3. ``GET /ajax/episode/list/<id>?style=&vrf=<id>`` lists episodes; each anchor
   carries an opaque ``data-ids`` server token.
4. ``GET /ajax/server/list?servers=<token>`` expands that token into per-language
   servers (``sub`` / ``dub``) with an opaque ``data-link-id``.
5. ``GET /ajax/server?get=<link-id>`` returns the embed URL for that server
   (currently a Megaplay page) plus ``skip_data`` intro/outro markers.

The Megaplay embed is then resolved to a master playlist with the extractor
shared with the HiAnime scraper.
"""

import asyncio
import json
import logging
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from bs4 import BeautifulSoup
from curl_cffi import requests as creq

from ..config import HI_UA
from ..scrapers.hianime import extract_megaplay
from .base import (
    AudioTrack,
    BaseProvider,
    ProviderError,
    StreamRequest,
    StreamResult,
    SubtitleTrack,
)

logger = logging.getLogger("aninyom.providers.anichi")

BASE_URL = "https://anichi.to"
HEADERS = {
    "User-Agent": HI_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Slug lookups cost one search request each, so remember them per title briefly.
_slug_cache: Dict[str, Tuple[str, float]] = {}
_SLUG_TTL = 6 * 3600


def _fetch(url: str, referer: Optional[str] = None, ajax: bool = False, timeout: int = 25) -> str:
    headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
    if ajax:
        headers["X-Requested-With"] = "XMLHttpRequest"
        headers["Accept"] = "application/json, text/javascript, */*; q=0.01"
    response = creq.get(
        url, headers=headers, impersonate="chrome124", timeout=timeout, allow_redirects=True
    )
    if response.status_code != 200:
        raise ProviderError(f"AniChi returned HTTP {response.status_code} for {url}")
    return response.text


def _normalize(text: Any) -> str:
    lowered = str(text or "").lower()
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


def _search_queries(titles: List[str]) -> List[str]:
    queries: List[str] = []
    for raw in titles:
        title = (raw or "").strip()
        if not title:
            continue
        if title not in queries:
            queries.append(title)
        head = re.sub(r":.*$", "", title).strip()
        if head and len(head) > 3 and head not in queries:
            queries.append(head)
    return queries


def _resolve_slug(titles: List[str]) -> str:
    """Map a human title to AniChi's ``/anime/<slug>`` identifier."""
    for title in titles:
        cached = _slug_cache.get(_normalize(title))
        if cached and cached[1] > time.time():
            return cached[0]

    best_slug = ""
    best_score = 0.0
    seen = set()

    for query in _search_queries(titles):
        norm_query = _normalize(query)
        if not norm_query or norm_query in seen:
            continue
        seen.add(norm_query)
        try:
            html = _fetch(f"{BASE_URL}/filter/?keyword={urllib.parse.quote(query)}")
        except Exception as e:
            logger.debug("AniChi search failed for %r: %s", query, e)
            continue

        soup = BeautifulSoup(html, "html.parser")
        for anchor in soup.select('a[href*="/anime/"]'):
            match = re.search(r"/anime/([^/?#]+)", str(anchor.get("href") or ""))
            if not match:
                continue
            slug = match.group(1)
            candidates = [
                anchor.get_text(" ", strip=True),
                anchor.get("data-en"),
                anchor.get("data-jp"),
            ]
            for candidate in candidates:
                score = _score(norm_query, _normalize(candidate))
                if score > best_score:
                    best_score, best_slug = score, slug

        if best_score >= 0.999:
            break

    if not best_slug or best_score < 0.5:
        raise ProviderError(f"AniChi has no confident match for {titles!r}")

    expires = time.time() + _SLUG_TTL
    for title in titles:
        key = _normalize(title)
        if key:
            _slug_cache[key] = (best_slug, expires)
    return best_slug


def _anime_id(slug: str) -> str:
    """Read the numeric series id from an AniChi series page."""
    html = _fetch(f"{BASE_URL}/anime/{slug}")
    soup = BeautifulSoup(html, "html.parser")
    for selector in ("#series-page", "#watch-main", "main[data-id]"):
        element = soup.select_one(selector)
        if element and element.get("data-id"):
            return str(element.get("data-id"))
    match = re.search(r'data-id="(\d+)"', html)
    if match:
        return match.group(1)
    raise ProviderError(f"AniChi series page exposed no id for {slug!r}")


def _episodes(anime_id: str) -> List[Dict[str, Any]]:
    text = _fetch(
        f"{BASE_URL}/ajax/episode/list/{anime_id}?style=&vrf={anime_id}",
        referer=f"{BASE_URL}/watch/x/ep-1",
        ajax=True,
    )
    payload = json.loads(text)
    soup = BeautifulSoup(payload.get("result", ""), "html.parser")
    episodes: List[Dict[str, Any]] = []
    for anchor in soup.select("a[data-id]"):
        try:
            number = int(str(anchor.get("data-num")))
        except (TypeError, ValueError):
            continue
        episodes.append(
            {
                "episode_number": number,
                "episode_id": str(anchor.get("data-id")),
                "data_ids": str(anchor.get("data-ids") or ""),
            }
        )
    episodes.sort(key=lambda item: item["episode_number"])
    return episodes


def _servers(data_ids: str) -> List[Dict[str, str]]:
    text = _fetch(
        f"{BASE_URL}/ajax/server/list?servers={urllib.parse.quote(data_ids, safe='')}",
        referer=f"{BASE_URL}/watch/x/ep-1",
        ajax=True,
    )
    payload = json.loads(text)
    soup = BeautifulSoup(payload.get("result", ""), "html.parser")
    servers: List[Dict[str, str]] = []
    for group in soup.select(".servers .type"):
        server_type = str(group.get("data-type") or "").lower()
        for item in group.select("li[data-link-id]"):
            servers.append(
                {
                    "type": server_type,
                    "name": item.get_text(" ", strip=True) or "Server",
                    "link_id": str(item.get("data-link-id")),
                }
            )
    return servers


def _embed(link_id: str) -> Dict[str, Any]:
    text = _fetch(
        f"{BASE_URL}/ajax/server?get={urllib.parse.quote(link_id, safe='')}",
        referer=f"{BASE_URL}/watch/x/ep-1",
        ajax=True,
    )
    try:
        payload = json.loads(text)
    except Exception as e:
        raise ProviderError(f"AniChi server lookup returned invalid JSON: {e}") from e
    result = payload.get("result")
    if not isinstance(result, dict):
        raise ProviderError("AniChi server lookup had no result")
    return result


def _skip_range(value: Any) -> Dict[str, int]:
    """Turn AniChi's ``[start, end]`` skip data into the provider's dict shape."""
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        try:
            return {"start": int(value[0]), "end": int(value[1])}
        except (TypeError, ValueError):
            pass
    return {"start": 0, "end": 0}


def _pick_range(primary: Any, fallback: Any) -> Dict[str, int]:
    if isinstance(primary, dict) and int(primary.get("end") or 0) > 0:
        return {"start": int(primary.get("start") or 0), "end": int(primary.get("end") or 0)}
    return _skip_range(fallback)


class AnichiProvider(BaseProvider):
    name = "anichi"

    async def resolve(self, request: StreamRequest) -> StreamResult:
        if not request.title and not request.title_alt:
            raise ProviderError("AniChi requires an anime title")
        if request.episode_number is None:
            raise ProviderError("AniChi requires an episode number")

        titles = [t for t in (request.title, request.title_alt) if t]
        slug = await asyncio.to_thread(_resolve_slug, titles)
        anime_id = await asyncio.to_thread(_anime_id, slug)
        episodes = await asyncio.to_thread(_episodes, anime_id)
        if not episodes:
            raise ProviderError(f"AniChi listed no episodes for {slug!r}")

        wanted = int(request.episode_number)
        episode = next((e for e in episodes if e["episode_number"] == wanted), None)
        if episode is None:
            episode = min(episodes, key=lambda e: abs(e["episode_number"] - wanted))
        if not episode.get("data_ids"):
            raise ProviderError(f"AniChi episode {wanted} had no server token")

        servers = await asyncio.to_thread(_servers, episode["data_ids"])
        if not servers:
            raise ProviderError(f"AniChi exposed no servers for {slug!r} episode {wanted}")

        modes: List[str] = []
        for server in servers:
            if server["type"] and server["type"] not in modes:
                modes.append(server["type"])

        # Prefer the requested audio mode, but keep every server as a fallback.
        wanted_mode = "dub" if str(request.mode).lower() == "dub" and "dub" in modes else "sub"
        ordered = [s for s in servers if s["type"] == wanted_mode]
        ordered += [s for s in servers if s["type"] != wanted_mode]

        failures: List[str] = []
        for server in ordered:
            try:
                resolved = await asyncio.to_thread(_embed, server["link_id"])
                embed_url = str(resolved.get("url") or "")
                if not embed_url:
                    failures.append(f"{server['name']}: no embed url")
                    continue
                mega = await asyncio.to_thread(extract_megaplay, embed_url, f"{BASE_URL}/")
            except Exception as e:
                failures.append(f"{server['name']}: {e}")
                continue

            master_url = str(mega.get("master_url") or "")
            if not master_url:
                failures.append(f"{server['name']}: no master playlist")
                continue

            subtitles = []
            for track in mega.get("tracks", []):
                file_url = str(track.get("file") or "")
                if not file_url:
                    continue
                subtitles.append(
                    SubtitleTrack(
                        url=file_url,
                        lang=str(track.get("lang") or "").lower(),
                        label=str(track.get("label") or "Unknown"),
                        default=bool(track.get("default", False)),
                        format="vtt",
                    )
                )

            audio_tracks = [
                AudioTrack(
                    lang="ja", label="Japanese (Sub)", kind="mode", mode="sub", default=True
                )
            ]
            if "dub" in modes:
                audio_tracks.append(
                    AudioTrack(lang="en", label="English (Dub)", kind="mode", mode="dub")
                )

            skip = resolved.get("skip_data") or {}
            logger.info("Resolved episode %s via anichi (%s)", request.episode_id, server["name"])
            return StreamResult(
                master_url=master_url,
                referer=str(mega.get("referer") or f"{BASE_URL}/"),
                provider=self.name,
                server=server["name"],
                subtitles=subtitles,
                audio_tracks=audio_tracks,
                intro=_pick_range(mega.get("intro"), skip.get("intro")),
                outro=_pick_range(mega.get("outro"), skip.get("outro")),
                available_modes=modes or ["sub"],
            )

        raise ProviderError("anichi: " + (" | ".join(failures) or "no playable server"))
