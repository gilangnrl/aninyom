"""Unit tests for subtitle conversion and language guards."""

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.api.subtitles import _latin_ratio, _script_matches  # noqa: E402
from backend.app.providers.registry import parse_audio_renditions  # noqa: E402
from backend.app.subtitle.formats import (  # noqa: E402
    ass_to_vtt,
    detect_format,
    srt_to_vtt,
    to_vtt,
)

ASS_SAMPLE = """[Script Info]
Title: Test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\i1}Hello{\\i1} world\\NSecond line
Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,Plain text, with comma
Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,Ignored
"""

SRT_SAMPLE = """1
00:00:01,000 --> 00:00:03,500
Hello <b>world</b>

2
00:00:04,000 --> 00:00:05,000
Line one
Line two
"""


class AssConversionTests(unittest.TestCase):
    def setUp(self):
        self.vtt = ass_to_vtt(ASS_SAMPLE)

    def test_header(self):
        self.assertTrue(self.vtt.startswith("WEBVTT\n"))

    def test_strips_override_blocks_and_converts_newlines(self):
        self.assertIn("Hello world\nSecond line", self.vtt)
        self.assertNotIn("{", self.vtt)

    def test_keeps_commas_in_dialogue_text(self):
        self.assertIn("Plain text, with comma", self.vtt)

    def test_ignores_comment_lines(self):
        self.assertNotIn("Ignored", self.vtt)

    def test_timestamps_are_webvtt(self):
        self.assertIn("00:00:01.000 --> 00:00:03.500", self.vtt)


class SrtConversionTests(unittest.TestCase):
    def setUp(self):
        self.vtt = srt_to_vtt(SRT_SAMPLE)

    def test_normalizes_timestamps(self):
        self.assertIn("00:00:01.000 --> 00:00:03.500", self.vtt)

    def test_strips_html_tags(self):
        self.assertIn("Hello world", self.vtt)
        self.assertNotIn("<b>", self.vtt)

    def test_keeps_multiline_cues(self):
        self.assertIn("Line one\nLine two", self.vtt)


class DetectionTests(unittest.TestCase):
    def test_extension_wins(self):
        self.assertEqual(detect_format("https://x/a.ass", ""), "ass")
        self.assertEqual(detect_format("https://x/a.srt", ""), "srt")
        self.assertEqual(detect_format("https://x/a.vtt", ""), "vtt")

    def test_sniffs_content_without_extension(self):
        self.assertEqual(detect_format("https://x/a", ASS_SAMPLE), "ass")
        self.assertEqual(detect_format("https://x/a", SRT_SAMPLE), "srt")
        self.assertEqual(detect_format("https://x/a", "WEBVTT\n\n"), "vtt")

    def test_to_vtt_passes_vtt_through(self):
        self.assertEqual(to_vtt("https://x/a.vtt", "WEBVTT\n\n"), "WEBVTT\n\n")


class ScriptGuardTests(unittest.TestCase):
    def test_latin_ratio(self):
        self.assertEqual(_latin_ratio("Hello world"), 1.0)
        self.assertLess(_latin_ratio("مرحبا بالعالم"), 0.1)

    def test_english_rejects_arabic(self):
        self.assertFalse(_script_matches("مرحبا بالعالم", "en"))

    def test_english_accepts_latin(self):
        self.assertTrue(_script_matches("Hello world", "en"))

    def test_arabic_accepts_arabic(self):
        self.assertTrue(_script_matches("مرحبا بالعالم", "ar"))

    def test_arabic_rejects_latin(self):
        self.assertFalse(_script_matches("Hello world", "ar"))

    def test_unknown_language_is_not_filtered(self):
        self.assertTrue(_script_matches("whatever", ""))


class AudioRenditionTests(unittest.TestCase):
    def test_parses_audio_only(self):
        manifest = (
            "#EXTM3U\n"
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g",NAME="Japanese",DEFAULT=YES,LANGUAGE="ja",URI="a.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g",NAME="English",DEFAULT=NO,LANGUAGE="en",URI="b.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",URI="c.vtt"\n'
        )
        tracks = parse_audio_renditions(manifest)
        self.assertEqual([t["lang"] for t in tracks], ["ja", "en"])
        self.assertTrue(tracks[0]["default"])
        self.assertFalse(tracks[1]["default"])

    def test_ignores_media_sequence(self):
        self.assertEqual(parse_audio_renditions("#EXT-X-MEDIA-SEQUENCE:0\n"), [])


if __name__ == "__main__":
    unittest.main()
