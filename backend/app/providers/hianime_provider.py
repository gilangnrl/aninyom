"""HiAnime provider: wraps the existing scraper behind the provider contract."""

import asyncio
import logging

from ..scrapers import hianime
from .base import (
    AudioTrack,
    BaseProvider,
    ProviderError,
    StreamRequest,
    StreamResult,
    SubtitleTrack,
)

logger = logging.getLogger("aninyom.providers.hianime")


class HianimeProvider(BaseProvider):
    name = "hianime"

    async def resolve(self, request: StreamRequest) -> StreamResult:
        try:
            data = await asyncio.to_thread(
                hianime.extract_stream, request.episode_id, request.mode
            )
        except Exception as e:
            raise ProviderError(f"HiAnime extraction failed: {e}") from e

        master_url = str(data.get("master_url") or "")
        if not master_url:
            raise ProviderError("HiAnime returned no master playlist")

        subtitles = []
        for track in data.get("tracks", []):
            file_url = track.get("file") or track.get("src") or track.get("url") or ""
            if not file_url:
                continue
            subtitles.append(
                SubtitleTrack(
                    url=file_url,
                    lang=str(track.get("lang") or track.get("language") or "").lower(),
                    label=str(track.get("label") or track.get("lang") or "Unknown"),
                    default=bool(track.get("default", False)),
                    format="vtt",
                )
            )

        modes = [str(m).lower() for m in (data.get("available_modes") or [request.mode])]
        audio_tracks = [
            AudioTrack(lang="ja", label="Japanese (Sub)", kind="mode", mode="sub", default=True)
        ]
        if "dub" in modes:
            audio_tracks.append(
                AudioTrack(lang="en", label="English (Dub)", kind="mode", mode="dub")
            )

        return StreamResult(
            master_url=master_url,
            referer=str(data.get("referer") or ""),
            provider=self.name,
            server=str(data.get("server") or ""),
            subtitles=subtitles,
            audio_tracks=audio_tracks,
            intro=data.get("intro") or {"start": 0, "end": 0},
            outro=data.get("outro") or {"start": 0, "end": 0},
            available_modes=modes,
        )
