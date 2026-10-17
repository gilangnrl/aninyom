"""Unit tests for the HLS manifest rewriter.

Run from the repository root:

    .venv/bin/python -m unittest discover -s backend/tests -t . -v
"""

import re
import sys
import unittest
import urllib.parse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.proxy.stream import _mime_for, rewrite_m3u8  # noqa: E402

BASE = "https://cdn.example.com/a/b/master.m3u8"
REFERER = "https://anizone.to/"

MASTER = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_audio",NAME="Japanese",DEFAULT=YES,LANGUAGE="ja",CHANNELS="2",URI="audio/0_ja/playlist.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="../subtitles/en.vtt"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="group_audio"
video/720/playlist.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="video/720/iframe.m3u8"
#EXT-X-KEY:METHOD=AES-128,URI="../../keys/abc.key",IV=0x0123456789ABCDEF
#EXT-X-MAP:URI="init.mp4"
#EXT-X-PART:DURATION=1.0,URI="part0.m4s"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part1.m4s"
#EXTINF:6.0,
00000.ts
#EXT-X-ENDLIST
"""


def _uri_values(manifest: str):
    return re.findall(r'URI="([^"]*)"', manifest)


def _proxied_targets(manifest: str):
    """Every proxy URL in the document, whether in a URI= or on a bare line."""
    targets = []
    for raw in re.findall(r'/api/player/video\?url=[^"\s]+', manifest):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(raw).query)
        targets.append(query.get("url", [""])[0])
    return targets


class RewriteM3u8Tests(unittest.TestCase):
    def setUp(self):
        self.output = rewrite_m3u8(MASTER, BASE, REFERER)
        self.uris = _uri_values(self.output)

    def test_every_uri_points_at_the_proxy(self):
        self.assertTrue(self.uris, "expected rewritten URI attributes")
        for uri in self.uris:
            parts = urllib.parse.urlsplit(uri)
            self.assertEqual(parts.path, "/api/player/video", uri)

    def test_resolves_key_relative_to_the_master(self):
        self.assertEqual(self._find("abc.key"), "https://cdn.example.com/keys/abc.key")

    def test_resolves_init_segment_relative_to_the_master(self):
        self.assertEqual(self._find("init.mp4"), "https://cdn.example.com/a/b/init.mp4")

    def test_resolves_audio_rendition_relative_to_the_master(self):
        self.assertEqual(
            self._find("0_ja"),
            "https://cdn.example.com/a/b/audio/0_ja/playlist.m3u8",
        )

    def test_resolves_subtitle_rendition(self):
        self.assertEqual(
            self._find("subtitles/en.vtt"),
            "https://cdn.example.com/a/subtitles/en.vtt",
        )

    def test_resolves_variant_playlist(self):
        self.assertEqual(
            self._find("video/720/playlist.m3u8"),
            "https://cdn.example.com/a/b/video/720/playlist.m3u8",
        )

    def test_resolves_media_segment(self):
        self.assertEqual(self._find("00000.ts"), "https://cdn.example.com/a/b/00000.ts")

    def test_forwards_referer_on_every_uri(self):
        for uri in self.uris:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(uri).query)
            self.assertEqual(query.get("ref"), [REFERER])

    def test_does_not_rewrite_media_sequence(self):
        self.assertIn("#EXT-X-MEDIA-SEQUENCE:0", self.output)

    def test_segment_line_is_proxied_not_left_raw(self):
        self.assertNotIn("\n00000.ts\n", self.output)
        self.assertEqual(self._find("00000.ts"), "https://cdn.example.com/a/b/00000.ts")

    def test_injects_audio_codec_into_stream_inf(self):
        line = next(ln for ln in self.output.splitlines() if ln.startswith("#EXT-X-STREAM-INF:"))
        self.assertIn("mp4a.40.2", line)

    def _find(self, needle: str) -> str:
        targets = _proxied_targets(self.output)
        for target in targets:
            if needle in target:
                return target
        self.fail(f"no proxied target contained {needle!r}: {targets}")


class MimeTests(unittest.TestCase):
    def test_known_extensions(self):
        self.assertEqual(_mime_for("https://x/a/0.ts", None), "video/mp2t")
        self.assertEqual(_mime_for("https://x/a/0.m4s", None), "video/mp4")
        self.assertEqual(_mime_for("https://x/a/0.aac", None), "audio/aac")
        self.assertEqual(_mime_for("https://x/a/0.vtt", None), "text/vtt")
        self.assertEqual(_mime_for("https://x/a/0.key", None), "application/octet-stream")

    def test_obfuscated_extension_ignores_image_content_type(self):
        self.assertEqual(_mime_for("https://x/a/seg.jpg", "image/jpeg"), "video/mp2t")

    def test_unknown_extension_uses_upstream_audio_type(self):
        self.assertEqual(_mime_for("https://x/a/seg", "audio/mp4"), "audio/mp4")


if __name__ == "__main__":
    unittest.main()
