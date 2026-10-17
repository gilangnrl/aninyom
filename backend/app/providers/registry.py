"""Provider registry with ordered failover and manifest validation."""

import logging
import os
import re
from typing import Any, Dict, List

from ..proxy.stream import DEFAULT_HEADERS, fetch_playlist_text
from .anizone import AnizoneProvider
from .base import (
    AudioTrack,
    BaseProvider,
    ProviderError,
    StreamRequest,
    StreamResult,
)
from .hianime_provider import HianimeProvider

logger = logging.getLogger("aninyom.providers.registry")

_PROVIDER_CLASSES = {
    "hianime": HianimeProvider,
    "anizone": AnizoneProvider,
}

DEFAULT_PROVIDER_ORDER = "hianime,anizone"

_VARIANT_RE = re.compile(r"^#EXT-X-STREAM-INF:", re.MULTILINE)
_ATTR_RE = re.compile(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)')


def provider_order() -> List[str]:
    raw = os.getenv("PROVIDER_ORDER", DEFAULT_PROVIDER_ORDER)
    requested = [name.strip().lower() for name in raw.split(",") if name.strip()]
    ordered = [name for name in requested if name in _PROVIDER_CLASSES]
    return ordered or ["hianime"]


def _attributes(line: str) -> Dict[str, str]:
    return {key: value.strip('"') for key, value in _ATTR_RE.findall(line)}


def parse_audio_renditions(manifest: str) -> List[Dict[str, Any]]:
    """Extract ``EXT-X-MEDIA`` audio renditions from a master playlist."""
    tracks: List[Dict[str, Any]] = []
    for line in manifest.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#EXT-X-MEDIA:"):
            continue
        attrs = _attributes(stripped)
        if attrs.get("TYPE", "").upper() != "AUDIO":
            continue
        tracks.append(
            {
                "lang": attrs.get("LANGUAGE", "").lower(),
                "label": attrs.get("NAME") or attrs.get("LANGUAGE") or "Audio",
                "default": attrs.get("DEFAULT", "").upper() == "YES",
            }
        )
    return tracks


async def _validate_manifest(master_url: str, referer: str) -> str:
    """Fetch the master playlist and require at least one playable rendition."""
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers["Referer"] = referer
    try:
        manifest = await fetch_playlist_text(master_url, headers)
    except Exception as e:
        raise ProviderError(f"master playlist is unreachable: {e}") from e

    if not _VARIANT_RE.search(manifest) and "#EXTINF:" not in manifest:
        raise ProviderError("master playlist declared no variants or segments")
    return manifest


async def resolve_stream(request: StreamRequest) -> StreamResult:
    """Try each configured provider in order until one yields a valid manifest."""
    failures: List[str] = []

    for name in provider_order():
        provider: BaseProvider = _PROVIDER_CLASSES[name]()
        try:
            result = await provider.resolve(request)
            manifest = await _validate_manifest(result.master_url, result.referer)
        except Exception as e:
            logger.warning("Provider %s failed for episode %s: %s", name, request.episode_id, e)
            failures.append(f"{name}: {e}")
            continue

        manifest_audio = parse_audio_renditions(manifest)
        if manifest_audio:
            result.audio_tracks = [
                AudioTrack(
                    lang=track["lang"],
                    label=track["label"],
                    kind="manifest",
                    index=index,
                    default=track["default"],
                )
                for index, track in enumerate(manifest_audio)
            ]

        logger.info("Resolved episode %s via %s (%s)", request.episode_id, name, result.server)
        return result

    raise ProviderError("all providers failed: " + " | ".join(failures))
