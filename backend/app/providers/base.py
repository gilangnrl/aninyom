"""Provider contract for stream resolution.

A provider turns an episode reference into a playable HLS master playlist plus
the metadata the player needs (subtitle renditions, audio options, intro/outro).
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


class ProviderError(RuntimeError):
    """Raised when a provider cannot produce a playable stream."""


@dataclass
class SubtitleTrack:
    url: str
    lang: str
    label: str
    default: bool = False
    forced: bool = False
    format: str = "vtt"


@dataclass
class AudioTrack:
    """A selectable audio option.

    ``kind="manifest"`` means the track is an HLS rendition declared by
    ``EXT-X-MEDIA`` and selectable through ``hls.audioTrack``. ``kind="mode"``
    means the audio is chosen by re-resolving the stream with ``mode``.
    """

    lang: str
    label: str
    kind: str = "mode"
    mode: Optional[str] = None
    index: Optional[int] = None
    url: Optional[str] = None
    default: bool = False


@dataclass
class StreamRequest:
    episode_id: str
    mode: str = "sub"
    title: Optional[str] = None
    title_alt: Optional[str] = None
    episode_number: Optional[int] = None
    anilist_id: Optional[int] = None


@dataclass
class StreamResult:
    master_url: str
    referer: str
    provider: str
    server: str = ""
    subtitles: List[SubtitleTrack] = field(default_factory=list)
    audio_tracks: List[AudioTrack] = field(default_factory=list)
    intro: Dict[str, Any] = field(default_factory=lambda: {"start": 0, "end": 0})
    outro: Dict[str, Any] = field(default_factory=lambda: {"start": 0, "end": 0})
    available_modes: List[str] = field(default_factory=list)


class BaseProvider:
    """Minimal async provider interface."""

    name = "base"

    async def resolve(self, request: StreamRequest) -> StreamResult:
        raise NotImplementedError
