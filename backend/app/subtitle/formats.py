"""Subtitle format detection and conversion to WebVTT.

AniZone ships ASS and SRT tracks; the player only understands WebVTT. These
helpers convert both formats while dropping styling/positioning overrides, which
is the tradeoff we accept until a full ASS renderer is added.
"""

import re
from typing import Iterator, List, Optional, Tuple

_ASS_OVERRIDE_RE = re.compile(r"\{[^}]*\}")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_ASS_TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2})[.:](\d{1,3})$")
_SRT_TIMING_RE = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})"
)

_ASS_DEFAULT_FIELDS = [
    "layer",
    "start",
    "end",
    "style",
    "name",
    "marginl",
    "marginr",
    "marginv",
    "effect",
    "text",
]


def _build_vtt(cues: List[Tuple[str, str, str]]) -> str:
    out = ["WEBVTT", ""]
    for start, end, body in cues:
        out.append(f"{start} --> {end}")
        out.append(body)
        out.append("")
    return "\n".join(out)


def _ass_time(value: str) -> Optional[str]:
    match = _ASS_TIME_RE.match(value.strip())
    if not match:
        return None
    hours, minutes, seconds, fraction = match.groups()
    millis = int(fraction.ljust(3, "0")[:3])
    return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}.{millis:03d}"


def _srt_time(hours: str, minutes: str, seconds: str, fraction: str) -> str:
    millis = int(fraction.ljust(3, "0")[:3])
    return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}.{millis:03d}"


def _ass_events(text: str) -> Iterator[dict]:
    in_events = False
    fields = list(_ASS_DEFAULT_FIELDS)

    for raw in text.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if line.startswith("[") and line.endswith("]"):
            in_events = line.lower() == "[events]"
            continue
        if not in_events:
            continue
        if line.lower().startswith("format:"):
            fields = [part.strip().lower() for part in line.split(":", 1)[1].split(",")]
            continue
        if not line.lower().startswith("dialogue:"):
            continue

        payload = line.split(":", 1)[1]
        parts = payload.split(",", len(fields) - 1)
        if len(parts) < len(fields):
            continue
        yield dict(zip(fields, parts))


def ass_to_vtt(text: str) -> str:
    cues: List[Tuple[str, str, str]] = []

    for record in _ass_events(text):
        start = _ass_time(record.get("start", ""))
        end = _ass_time(record.get("end", ""))
        if not start or not end:
            continue

        body = record.get("text", "")
        body = _ASS_OVERRIDE_RE.sub("", body)
        body = body.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
        body = body.replace("\\", "")
        body = "\n".join(part.strip() for part in body.split("\n") if part.strip())
        if body:
            cues.append((start, end, body))

    return _build_vtt(cues)


def srt_to_vtt(text: str) -> str:
    cues: List[Tuple[str, str, str]] = []
    lines = text.replace("\r\n", "\n").split("\n")
    index = 0

    while index < len(lines):
        match = _SRT_TIMING_RE.search(lines[index])
        if not match:
            index += 1
            continue

        start = _srt_time(*match.group(1, 2, 3, 4))
        end = _srt_time(*match.group(5, 6, 7, 8))
        index += 1

        body_lines = []
        while index < len(lines) and lines[index].strip():
            body_lines.append(_HTML_TAG_RE.sub("", _ASS_OVERRIDE_RE.sub("", lines[index])).strip())
            index += 1

        body = "\n".join(line for line in body_lines if line)
        if body:
            cues.append((start, end, body))

    return _build_vtt(cues)


def detect_format(url: str, content: str = "") -> str:
    """Detect a subtitle format from the URL first, then the payload."""
    path = url.split("?", 1)[0].split("#", 1)[0].lower()
    if path.endswith((".ass", ".ssa")):
        return "ass"
    if path.endswith(".srt"):
        return "srt"
    if path.endswith((".vtt", ".webvtt")):
        return "vtt"

    head = content.lstrip()[:2000].lower()
    if head.startswith("webvtt"):
        return "vtt"
    if "[events]" in head or "\ndialogue:" in ("\n" + head):
        return "ass"
    if "-->" in head:
        return "srt"
    return "vtt"


def to_vtt(url: str, content: str) -> str:
    """Return a WebVTT document for any supported subtitle payload."""
    fmt = detect_format(url, content)
    if fmt == "ass":
        return ass_to_vtt(content)
    if fmt == "srt":
        return srt_to_vtt(content)
    return content
