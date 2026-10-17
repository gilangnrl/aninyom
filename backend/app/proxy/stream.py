"""Video Stream Proxy & M3U8 Rewriter.
Proxies HLS playlists, rewrites every media URI (variants, segments, keys,
init segments and alternate renditions), and streams binary resources.
"""

import asyncio
import logging
import os
import re
import urllib.parse
from typing import Dict, Optional

import httpx
from curl_cffi import requests as creq
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from ..config import HI_UA
from .desync import tls_desync_request

logger = logging.getLogger("aninyom.proxy.stream")
router = APIRouter(prefix="/api/player", tags=["Player"])

DEFAULT_HEADERS = {
    "User-Agent": HI_UA,
    "Accept": "*/*",
}

PLAYLIST_MIME = "application/vnd.apple.mpegurl"

# Tags whose ``URI="..."`` attribute points at a resource the player must fetch
# through this proxy. Tags such as ``#EXT-X-SESSION-DATA`` also carry a URI but
# it is metadata, not a media resource, so it is intentionally left untouched.
_URI_REWRITE_TAGS = (
    "#EXT-X-KEY:",
    "#EXT-X-SESSION-KEY:",
    "#EXT-X-MAP:",
    "#EXT-X-MEDIA:",
    "#EXT-X-I-FRAME-STREAM-INF:",
    "#EXT-X-PART:",
    "#EXT-X-PRELOAD-HINT:",
    "#EXT-X-RENDITION-REPORT:",
)

# Only unambiguous media extensions are mapped. Some upstreams serve MPEG-TS
# bytes under obfuscated extensions (.jpg, .js, .txt...), so anything unknown
# falls back to video/mp2t instead of trusting the URL or upstream headers.
_EXTENSION_MIME = {
    ".ts": "video/mp2t",
    ".m4s": "video/mp4",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".mp3": "audio/mpeg",
    ".vtt": "text/vtt",
    ".webvtt": "text/vtt",
    ".key": "application/octet-stream",
}

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    """Return the shared upstream client, creating it lazily."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(30.0, connect=10.0),
        )
    return _client


async def close_client() -> None:
    """Close the shared upstream client (called from the app lifespan)."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _proxy_url(abs_url: str, referer: Optional[str] = None) -> str:
    proxied = f"/api/player/video?url={urllib.parse.quote(abs_url, safe='')}"
    if referer:
        proxied += f"&ref={urllib.parse.quote(referer, safe='')}"
    return proxied


def rewrite_m3u8(content: str, base_url: str, referer: Optional[str] = None) -> str:
    """Rewrite every media URI in an M3U8 document to point at this proxy."""
    rewritten_lines = []

    for line in content.splitlines():
        sline = line.strip()
        if not sline:
            rewritten_lines.append(line)
            continue

        if sline.startswith("#EXT-X-STREAM-INF:"):
            # Ensure an audio codec is advertised, otherwise some players
            # silently refuse the rendition.
            if "CODECS=" not in sline:
                sline += ',CODECS="avc1.64001f,mp4a.40.2"'
            elif "mp4a" not in sline and "aac" not in sline:
                sline = re.sub(r'CODECS="([^"]+)"', r'CODECS="\1,mp4a.40.2"', sline)
            rewritten_lines.append(sline)
            continue

        if sline.startswith("#"):
            if sline.startswith(_URI_REWRITE_TAGS):
                sline = re.sub(
                    r'URI="([^"]*)"',
                    lambda m: (
                        f'URI="{_proxy_url(urllib.parse.urljoin(base_url, m.group(1)), referer)}"'
                    ),
                    sline,
                )
            rewritten_lines.append(sline)
            continue

        # Bare line: a variant playlist, media segment or init segment.
        abs_target = urllib.parse.urljoin(base_url, sline)
        rewritten_lines.append(_proxy_url(abs_target, referer))

    return "\n".join(rewritten_lines)


def _validate_target(url: str) -> None:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise HTTPException(status_code=400, detail="Unsupported upstream URL")


def _is_playlist(url: str) -> bool:
    path = urllib.parse.urlsplit(url).path.lower()
    if path.endswith((".m3u8", ".m3u")):
        return True
    # Some CDNs serve playlists without an extension but keep a telling path.
    segments = [segment for segment in path.split("/") if segment]
    return any("master" in segment or "playlist" in segment for segment in segments)


def _mime_for(url: str, upstream_content_type: Optional[str]) -> str:
    ext = os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower()
    mapped = _EXTENSION_MIME.get(ext)
    if mapped:
        return mapped

    if upstream_content_type:
        ct = upstream_content_type.split(";", 1)[0].strip().lower()
        if ct.startswith(("video/", "audio/")) or ct == "text/vtt":
            return ct

    return "video/mp2t"


async def fetch_playlist_text(url: str, headers: Dict[str, str], timeout: float = 15.0) -> str:
    """Fetch a playlist as text, preferring curl_cffi and falling back to TLS desync."""
    last_error: Optional[BaseException] = None

    try:
        response = await asyncio.to_thread(
            creq.get, url, headers=headers, impersonate="chrome124", timeout=timeout
        )
        if response.status_code == 200 and response.text.strip():
            return response.text
        if response.status_code == 200:
            last_error = RuntimeError("upstream returned an empty playlist")
        else:
            last_error = RuntimeError(f"upstream returned HTTP {response.status_code}")
    except Exception as e:
        last_error = e

    try:
        raw = await asyncio.to_thread(tls_desync_request, url, headers, timeout)
        text = raw.decode("utf-8", errors="replace")
        if text.strip():
            return text
        last_error = RuntimeError("TLS desync returned an empty playlist")
    except Exception as e:
        last_error = e

    logger.warning("Failed fetching playlist %s: %s", url, last_error)
    raise HTTPException(
        status_code=502,
        detail=f"Failed to fetch upstream playlist: {last_error}",
    )


@router.get("/video")
async def proxy_video(
    request: Request,
    url: str = Query(..., description="Target M3U8 or segment URL"),
    ref: Optional[str] = Query(None, description="Upstream referer"),
):
    """Proxy a video segment/key or rewrite an HLS playlist."""
    _validate_target(url)

    headers = dict(DEFAULT_HEADERS)
    if ref:
        headers["Referer"] = ref

    if _is_playlist(url):
        content_text = await fetch_playlist_text(url, headers)
        rewritten = rewrite_m3u8(content_text, base_url=url, referer=ref)
        return Response(
            content=rewritten,
            media_type=PLAYLIST_MIME,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
            },
        )

    upstream_headers = dict(headers)
    # Range correctness requires byte-identical bodies, so never ask for a
    # compressed representation here.
    upstream_headers["Accept-Encoding"] = "identity"

    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    client = _get_client()
    try:
        upstream = await client.send(
            client.build_request("GET", url, headers=upstream_headers),
            stream=True,
        )
    except httpx.HTTPError as e:
        logger.warning("Upstream resource request failed for %s: %s", url, e)
        raise HTTPException(status_code=502, detail=f"Failed to reach upstream resource: {e}")

    if upstream.status_code >= 400:
        await upstream.aclose()
        logger.warning("Upstream resource %s returned HTTP %s", url, upstream.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Upstream resource returned HTTP {upstream.status_code}",
        )

    # Some CDNs serve playlists from extension-less URLs. Trust the upstream
    # content type rather than streaming a manifest as if it were media.
    upstream_content_type = upstream.headers.get("content-type", "").lower()
    if "mpegurl" in upstream_content_type or "vnd.apple" in upstream_content_type:
        body = await upstream.aread()
        await upstream.aclose()
        text = body.decode("utf-8", errors="replace")
        rewritten = rewrite_m3u8(text, base_url=url, referer=ref)
        return Response(
            content=rewritten,
            media_type=PLAYLIST_MIME,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
            },
        )

    response_headers = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
    }
    # Pass through only the headers we actually honour. Accept-Ranges is echoed
    # only when upstream advertises it, so we never claim range support we lack.
    for name in ("Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"):
        value = upstream.headers.get(name)
        if value:
            response_headers[name] = value

    media_type = _mime_for(url, upstream.headers.get("content-type"))

    async def stream_generator():
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        stream_generator(),
        status_code=upstream.status_code,
        media_type=media_type,
        headers=response_headers,
    )
