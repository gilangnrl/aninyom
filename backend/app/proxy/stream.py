"""Video Stream Proxy & M3U8 Rewriter.
Proxies HLS playlists, ensures codec compatibility, and streams video segments.
"""

import logging
import re
import urllib.parse
from typing import Optional

import httpx
from curl_cffi import requests as creq
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import StreamingResponse

from ..config import HI_UA
from .desync import tls_desync_request

logger = logging.getLogger("aninyom.proxy.stream")
router = APIRouter(prefix="/api/player", tags=["Player"])

DEFAULT_HEADERS = {
    "User-Agent": HI_UA,
    "Accept": "*/*",
}


def rewrite_m3u8(content: str, base_url: str, referer: Optional[str] = None) -> str:
    """Rewrite M3U8 variant and segment links to point through the internal proxy."""
    lines = content.splitlines()
    rewritten_lines = []

    for line in lines:
        sline = line.strip()
        if not sline:
            rewritten_lines.append(line)
            continue

        if sline.startswith("#EXT-X-STREAM-INF:"):
            # Ensure audio codec is present
            if "CODECS=" not in sline:
                sline += ',CODECS="avc1.64001f,mp4a.40.2"'
            elif "mp4a" not in sline and "aac" not in sline:
                sline = re.sub(r'CODECS="([^"]+)"', r'CODECS="\1,mp4a.40.2"', sline)
            rewritten_lines.append(sline)
            continue

        if sline.startswith("#EXT-X-I-FRAME-STREAM-INF:"):
            # If URI="..." exists, rewrite it
            def repl_uri(m):
                orig_uri = m.group(1)
                abs_url = urllib.parse.urljoin(base_url, orig_uri)
                proxied = f'/api/player/video?url={urllib.parse.quote(abs_url, safe="")}'
                if referer:
                    proxied += f'&ref={urllib.parse.quote(referer, safe="")}'
                return f'URI="{proxied}"'

            sline = re.sub(r'URI="([^"]+)"', repl_uri, sline)
            rewritten_lines.append(sline)
            continue

        if sline.startswith("#"):
            rewritten_lines.append(sline)
            continue

        # This line is a segment or variant playlist URI
        abs_target = urllib.parse.urljoin(base_url, sline)
        proxied_target = f"/api/player/video?url={urllib.parse.quote(abs_target, safe='')}"
        if referer:
            proxied_target += f"&ref={urllib.parse.quote(referer, safe='')}"

        rewritten_lines.append(proxied_target)

    return "\n".join(rewritten_lines)


@router.get("/video")
async def proxy_video(
    url: str = Query(..., description="Target M3U8 or segment URL"),
    ref: Optional[str] = Query(None, description="Upstream referer"),
):
    """Proxy video segment or rewrite HLS playlist."""
    headers = dict(DEFAULT_HEADERS)
    if ref:
        headers["Referer"] = ref

    is_playlist = ".m3u8" in url or "master" in url or "playlist" in url

    if is_playlist:
        # Fetch playlist text
        content_text = ""
        try:
            r = creq.get(url, headers=headers, impersonate="chrome124", timeout=10)
            if r.status_code == 200:
                content_text = r.text
        except Exception:
            pass

        if not content_text:
            try:
                raw_bytes = tls_desync_request(url, headers=headers, timeout=10)
                content_text = raw_bytes.decode("utf-8", errors="replace")
            except Exception as e:
                logger.error("Failed fetching playlist %s: %s", url, e)
                raise HTTPException(status_code=502, detail="Failed to fetch upstream playlist")

        rewritten = rewrite_m3u8(content_text, base_url=url, referer=ref)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
            },
        )

    # For video segments (binary stream)
    async def stream_generator():
        client = httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15.0)
        try:
            async with client.stream("GET", url) as resp:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk
        finally:
            await client.aclose()

    return StreamingResponse(
        stream_generator(),
        media_type="video/mp2t",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
        },
    )
