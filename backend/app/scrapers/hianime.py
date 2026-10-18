"""HiAnime Scraper & Megaplay Stream Extractor.
Extracts Master M3U8 URLs, quality variants, and WebVTT subtitle tracks.
"""

import base64
import html as htmlmod
import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from curl_cffi import requests as creq

from ..config import HI_UA, MEGA_IV, MEGA_KEY, XOR_KEY
from ..proxy.desync import tls_desync_request

logger = logging.getLogger("aninyom.scrapers.hianime")

BASE_URL = "https://hianime.at"

HEADERS = {
    "User-Agent": HI_UA,
    "Referer": f"{BASE_URL}/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def _fetch(url: str, referer: Optional[str] = None, timeout: int = 10) -> str:
    """Fetch URL with curl_cffi Chrome impersonation and TLS desync fallback."""
    h = dict(HEADERS)
    if referer:
        h["Referer"] = referer

    try:
        r = creq.get(
            url, headers=h, impersonate="chrome124", timeout=timeout, allow_redirects=True
        )
        if r.status_code == 200:
            return r.text
    except Exception as e:
        logger.debug("creq fetch failed for %s: %s", url, e)

    # Fallback to TLS desync request
    try:
        raw = tls_desync_request(url, headers=h, timeout=timeout)
        txt = raw.decode("utf-8", errors="replace")
        if txt and ("<html" in txt.lower() or "{" in txt):
            return txt
    except Exception as e:
        logger.error("TLS desync fetch failed for %s: %s", url, e)

    raise RuntimeError(f"Failed to fetch {url}")


def _b64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    return base64.b64decode(s)


def mega_decrypt(enc: str) -> str:
    """Decrypt Megaplay AES-128-CBC source payload."""
    raw = _b64url_decode(enc.strip())
    d = Cipher(algorithms.AES(MEGA_KEY), modes.CBC(MEGA_IV)).decryptor()
    pt = d.update(raw) + d.finalize()
    pad = pt[-1] if pt else 0
    if 1 <= pad <= 16 and all(b == pad for b in pt[-pad:]):
        pt = pt[:-pad]
    return pt.decode("utf-8", errors="strict")


def deobfuscate_blob(b64: str) -> str:
    """Decode ZokoAnime / Vidtube XOR obfuscated payload."""
    raw = base64.b64decode(b64.strip())
    return bytes(b ^ XOR_KEY[i % len(XOR_KEY)] for i, b in enumerate(raw)).decode(
        "utf-8", errors="strict"
    )


def search_anime(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Search anime catalog on HiAnime."""
    clean_q = re.sub(r"\s+", "+", query.strip())
    url = f"{BASE_URL}/search?keyword={clean_q}"
    html = _fetch(url)

    soup = BeautifulSoup(html, "html.parser")
    items = []

    for card in soup.select(".flw-item"):
        name_el = card.select_one(".film-name a")
        if not name_el:
            continue

        href = str(name_el.get("href") or "")
        slug = re.sub(r"^https?://[^/]+/", "", href)
        slug = re.sub(r"^watch/", "", slug).split("?")[0].strip("/")
        if not slug or "hentai" in slug.lower():
            continue

        title = htmlmod.unescape(name_el.text.strip())
        img_el = card.select_one("img.film-poster-img")
        poster = img_el.get("data-src") or img_el.get("src") if img_el else ""

        sub_el = card.select_one(".tick-sub")
        dub_el = card.select_one(".tick-dub")
        eps_el = card.select_one(".tick-eps")

        items.append(
            {
                "id": slug,
                "title": title,
                "poster": poster,
                "sub": int(sub_el.text.strip()) if sub_el and sub_el.text.strip().isdigit() else 0,
                "dub": int(dub_el.text.strip()) if dub_el and dub_el.text.strip().isdigit() else 0,
                "eps": int(eps_el.text.strip()) if eps_el and eps_el.text.strip().isdigit() else 0,
            }
        )
        if len(items) >= limit:
            break

    return items


def get_episodes(slug_or_id: str) -> List[Dict[str, Any]]:
    """Fetch episode list for an anime slug or ID."""
    numeric_id = slug_or_id.rsplit("-", 1)[-1]
    url = f"{BASE_URL}/api/theme/episode/list/{numeric_id}"
    data_json = json.loads(_fetch(url))
    html = data_json.get("html", "")

    soup = BeautifulSoup(html, "html.parser")
    episodes = []
    seen = set()

    for item in soup.select(".ssl-item.ep-item"):
        ep_num_str = str(item.get("data-number") or "")
        ep_id = str(item.get("data-id") or "")
        title = str(item.get("title") or item.text.strip())

        try:
            ep_num = int(ep_num_str)
        except (ValueError, TypeError):
            continue

        if ep_num in seen:
            continue
        seen.add(ep_num)

        episodes.append(
            {
                "episode_number": ep_num,
                "episode_id": ep_id,
                "title": title,
            }
        )

    episodes.sort(key=lambda x: int(x["episode_number"]))
    return episodes


def extract_megaplay(embed_url: str, referer: str = "") -> Dict[str, Any]:
    """Resolve a Megaplay embed page into a playable master playlist.

    Megaplay exposes a numeric ``data-id`` on its embed page; the matching
    ``/stream/getSourcesNew`` payload carries either an AES-encrypted source
    blob (``enc``) or a plain ``sources`` list, plus subtitle tracks and skip
    markers. Shared by the HiAnime scraper and providers that front Megaplay.
    """
    origin = re.sub(r"^(https?://[^/]*).*", r"\1", embed_url)
    embed_page = _fetch(embed_url, referer=referer or f"{origin}/")
    match = re.search(r'data-id="(\d+)"', embed_page)
    if not match:
        raise RuntimeError("Megaplay embed exposed no data-id")

    data_id = match.group(1)
    try:
        sources_text = _fetch(f"{origin}/stream/getSourcesNew?id={data_id}", referer=embed_url)
    except Exception:
        sources_text = _fetch(f"{origin}/stream/getSources?id={data_id}", referer=embed_url)

    cfg = json.loads(sources_text)
    master_url = ""
    enc = cfg.get("enc")
    if enc and isinstance(enc, str):
        master_url = json.loads(mega_decrypt(enc)).get("file", "")
    elif isinstance(cfg.get("sources"), list) and cfg["sources"]:
        master_url = cfg["sources"][0].get("file", "")
    elif isinstance(cfg.get("sources"), dict):
        master_url = cfg["sources"].get("file", "")

    if not master_url:
        raise RuntimeError("Megaplay returned no master playlist")
    if master_url.startswith("/"):
        master_url = origin + master_url

    tracks = []
    raw_subs = cfg.get("tracks") or cfg.get("subtitles") or []
    for track in raw_subs:
        file_url = str(track.get("file") or track.get("src") or "")
        kind = str(track.get("kind") or "").lower()
        is_vtt_url = bool(re.search(r"\.vtt(?:$|[?#])", file_url, re.IGNORECASE))
        if file_url and (is_vtt_url or "caption" in kind or "subtitle" in kind):
            label = track.get("label") or track.get("lang") or "Unknown"
            lang = str(track.get("lang") or track.get("language") or label or "").strip().lower()
            tracks.append(
                {
                    "file": file_url,
                    "label": label,
                    "lang": lang,
                    "default": bool(track.get("default", False)),
                }
            )

    return {
        "master_url": master_url,
        "referer": f"{origin}/",
        "tracks": tracks,
        "intro": cfg.get("intro", {"start": 0, "end": 0}),
        "outro": cfg.get("outro", {"start": 0, "end": 0}),
    }


def extract_stream(episode_id: str, mode: str = "sub") -> Dict[str, Any]:
    """Extract stream master M3U8, variants, and subtitle tracks for an episode."""
    servers_url = f"{BASE_URL}/api/theme/episode/servers?episodeId={episode_id}"
    servers_json = json.loads(_fetch(servers_url))
    soup = BeautifulSoup(servers_json.get("html", ""), "html.parser")

    server_items = soup.select(".server-item")
    servers = []

    # Which audio modes this episode actually exposes (sub / dub).
    available_modes = sorted(
        {str(it.get("data-type")) for it in server_items if it.get("data-type")}
    )

    for it in server_items:
        stype = it.get("data-type")
        if stype != mode:
            continue
        sname = str(it.get("data-server-name") or "")
        shash = str(it.get("data-hash") or "")
        if not shash:
            continue
        try:
            embed_url = base64.b64decode(shash).decode("utf-8")
        except Exception:
            continue
        if embed_url.startswith("http"):
            servers.append({"name": sname, "embed": embed_url})

    if not servers:
        # Fallback to any mode if requested mode is not available
        for it in server_items:
            shash = str(it.get("data-hash") or "")
            sname = str(it.get("data-server-name") or "")
            if shash:
                try:
                    embed_url = base64.b64decode(shash).decode("utf-8")
                    if embed_url.startswith("http"):
                        servers.append({"name": sname, "embed": embed_url})
                except Exception:
                    pass

    if not servers:
        raise RuntimeError(f"No stream servers found for episode {episode_id}")

    # Prioritize Megaplay (0), then Vidtube/Vidplay (1), then ZokoAnime (2)
    def server_tier(s):
        e = s["embed"].lower()
        if "megaplay" in e:
            return 0
        if "vidtube" in e or "vidplay" in e:
            return 1
        if "zokoanime" in e:
            return 2
        return 3

    servers.sort(key=server_tier)

    last_error = None
    for srv in servers:
        embed = str(srv["embed"])
        origin = re.sub(r"^(https?://[^/]*).*", r"\1", embed)
        referer = origin + "/"
        try:
            embed_page = _fetch(embed, referer=f"{BASE_URL}/")

            # Strategy 1: Check for window.__P (ZokoAnime / Vidtube / Vidplay)
            p_match = re.search(r'window\.__P\s*=\s*"([^"]*)"', embed_page)
            if p_match:
                cfg = json.loads(deobfuscate_blob(p_match.group(1)))
                master_url = cfg.get("src") or ""
                if not master_url and isinstance(cfg.get("sources"), list) and cfg["sources"]:
                    master_url = (
                        cfg["sources"][0].get("src") or cfg["sources"][0].get("file") or ""
                    )
                if not master_url and isinstance(cfg.get("sources"), dict):
                    master_url = cfg["sources"].get("src") or cfg["sources"].get("file") or ""

                if master_url:
                    if master_url.startswith("/"):
                        master_url = origin + master_url

                    tracks = []
                    raw_subs = cfg.get("subtitles") or cfg.get("tracks") or []
                    for t in raw_subs:
                        file_url = t.get("file") or t.get("src") or t.get("url") or ""
                        if file_url:
                            lbl = t.get("label") or t.get("lang") or "Unknown"
                            lng = (
                                str(t.get("lang") or t.get("language") or lbl or "")
                                .strip()
                                .lower()
                            )
                            tracks.append(
                                {
                                    "file": file_url,
                                    "label": lbl,
                                    "lang": lng,
                                    "default": bool(t.get("default", False)),
                                }
                            )

                    skip = cfg.get("skip") or {}
                    intro = skip.get("intro") or cfg.get("intro") or {"start": 0, "end": 0}
                    outro = skip.get("outro") or cfg.get("outro") or {"start": 0, "end": 0}

                    return {
                        "server": srv["name"],
                        "master_url": master_url,
                        "referer": referer,
                        "tracks": tracks,
                        "intro": intro,
                        "outro": outro,
                        "available_modes": available_modes,
                    }

            # Strategy 2: Check for data-id (Megaplay)
            if re.search(r'data-id="(\d+)"', embed_page):
                mega = extract_megaplay(embed, referer=f"{BASE_URL}/")
                return {
                    "server": srv["name"],
                    "master_url": mega["master_url"],
                    "referer": mega["referer"],
                    "tracks": mega["tracks"],
                    "intro": mega["intro"],
                    "outro": mega["outro"],
                    "available_modes": available_modes,
                }
        except Exception as e:
            last_error = e
            logger.warning("Failed extracting server %s (%s): %s", srv["name"], srv["embed"], e)
            continue

    raise RuntimeError(f"Failed to extract stream for episode {episode_id}: {last_error}")
