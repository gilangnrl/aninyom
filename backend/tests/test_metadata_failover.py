"""Regression tests for the metadata failover chain.

Covers the AniList outage that surfaced as ``403 Forbidden`` from
``graphql.anilist.co`` ("The AniList API has been temporarily disabled...").
The catalog must degrade instead of returning HTTP 500.

Run from the repository root:

    .venv/bin/python -m unittest discover -s backend/tests -t . -v
"""

import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.providers import jikan, kitsu, metadata  # noqa: E402


class FailingProvider:
    """Stand-in provider whose every call fails, like a disabled AniList."""

    def __getattr__(self, name):
        async def _raise(**kwargs):
            raise RuntimeError("upstream disabled")

        return _raise


class WorkingProvider:
    """Stand-in provider that returns one recognizable record."""

    def __init__(self, marker="served"):
        self.marker = marker

    def __getattr__(self, name):
        async def _call(**kwargs):
            return [{"anilist_id": 1, "title_english": self.marker}]

        return _call


class StaticCache:
    """Minimal async cache double used by the orchestrator."""

    def __init__(self):
        self.store = {}
        self.stale = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ttl=3600):
        self.store[key] = value

    async def set_with_stale(self, key, value, ttl, stale_ttl):
        self.store[key] = value
        self.stale[f"stale:{key}"] = value

    async def get_stale(self, key, max_age=0):
        return self.stale.get(f"stale:{key}") if max_age > 0 else None


def _call(provider):
    return metadata._dispatch(provider, "get_upcoming", page=1, per_page=1)


class FailoverChainTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cache = StaticCache()
        self._cache_patch = mock.patch.object(metadata, "cache", self.cache)
        self._cache_patch.start()
        self._orig_providers = dict(metadata._PROVIDERS)
        self._orig_order = list(metadata.METADATA_PROVIDERS)
        metadata._breaker.reset()

    async def asyncTearDown(self):
        self._cache_patch.stop()
        metadata._PROVIDERS.clear()
        metadata._PROVIDERS.update(self._orig_providers)
        metadata.METADATA_PROVIDERS[:] = self._orig_order
        metadata._breaker.reset()

    async def test_falls_through_when_primary_is_disabled(self):
        """AniList 403 must not abort the request when a fallback works."""
        metadata._PROVIDERS.update(
            {"anilist": FailingProvider(), "jikan": WorkingProvider("from-jikan")}
        )
        metadata.METADATA_PROVIDERS[:] = ["anilist", "jikan"]

        result = await metadata._first_success("upcoming", cache_key="k", cache_ttl=60, call=_call)
        self.assertEqual(result[0]["title_english"], "from-jikan")

    async def test_serves_stale_cache_when_every_provider_fails(self):
        """Total outage returns last known good data rather than raising."""
        metadata._PROVIDERS.update({"anilist": FailingProvider(), "jikan": FailingProvider()})
        metadata.METADATA_PROVIDERS[:] = ["anilist", "jikan"]
        await self.cache.set_with_stale("k", [{"anilist_id": 9}], 60, 3600)

        result = await metadata._first_success("upcoming", cache_key="k", cache_ttl=60, call=_call)
        self.assertEqual(result[0]["anilist_id"], 9)

    async def test_raises_unavailable_without_cache(self):
        """No cache and no healthy provider maps to the 503 path."""
        metadata._PROVIDERS.update({"anilist": FailingProvider()})
        metadata.METADATA_PROVIDERS[:] = ["anilist"]

        with self.assertRaises(metadata.MetadataUnavailable):
            await metadata._first_success(
                "upcoming", cache_key="missing", cache_ttl=60, call=_call
            )

    async def test_empty_result_tries_next_provider(self):
        """A provider returning nothing is treated as a failure, not success."""
        metadata._PROVIDERS.update(
            {
                "anilist": _EmptyProvider(),
                "jikan": WorkingProvider("second"),
            }
        )
        metadata.METADATA_PROVIDERS[:] = ["anilist", "jikan"]

        result = await metadata._first_success("upcoming", cache_key="k", cache_ttl=60, call=_call)
        self.assertEqual(result[0]["title_english"], "second")

    async def test_unknown_provider_is_skipped(self):
        """A typo in METADATA_PROVIDERS must not crash the request."""
        metadata._PROVIDERS.update({"jikan": WorkingProvider("ok")})
        metadata.METADATA_PROVIDERS[:] = ["bogus", "jikan"]

        result = await metadata._first_success("upcoming", cache_key="k", cache_ttl=60, call=_call)
        self.assertEqual(result[0]["title_english"], "ok")


class _EmptyProvider:
    def __getattr__(self, name):
        async def _call(**kwargs):
            return []

        return _call


class SlowProvider:
    """Provider that never answers in time (stands in for an unreachable host)."""

    def __init__(self, delay=5.0):
        self.delay = delay
        self.cancelled = False

    def __getattr__(self, name):
        async def _call(**kwargs):
            try:
                await asyncio.sleep(self.delay)
            except asyncio.CancelledError:
                self.cancelled = True
                raise
            return [{"anilist_id": 0, "title_english": "too-late"}]

        return _call


class LatencyTests(unittest.IsolatedAsyncioTestCase):
    """A dead provider must not add its timeout to the response.

    Regression guard: a serial chain paid Jikan's full connect timeout on every
    cold request (~16s) while it was unreachable.
    """

    async def asyncSetUp(self):
        self.cache = StaticCache()
        self._cache_patch = mock.patch.object(metadata, "cache", self.cache)
        self._cache_patch.start()
        self._orig_providers = dict(metadata._PROVIDERS)
        self._orig_order = list(metadata.METADATA_PROVIDERS)
        metadata._breaker.reset()

    async def asyncTearDown(self):
        self._cache_patch.stop()
        metadata._PROVIDERS.clear()
        metadata._PROVIDERS.update(self._orig_providers)
        metadata.METADATA_PROVIDERS[:] = self._orig_order
        metadata._breaker.reset()

    async def test_slow_primary_does_not_block_fast_fallback(self):
        slow = SlowProvider(delay=5.0)
        metadata._PROVIDERS.update({"anilist": slow, "jikan": WorkingProvider("fast")})
        metadata.METADATA_PROVIDERS[:] = ["anilist", "jikan"]

        started = time.monotonic()
        result = await metadata._first_success("upcoming", cache_key="k", cache_ttl=60, call=_call)
        elapsed = time.monotonic() - started

        self.assertEqual(result[0]["title_english"], "fast")
        self.assertLess(elapsed, 2.0, f"fallback took {elapsed:.2f}s; expected hedging")

    async def test_tripped_provider_is_skipped_on_next_call(self):
        """After one failure the breaker stops paying that provider's timeout."""
        metadata._PROVIDERS.update(
            {"anilist": FailingProvider(), "jikan": WorkingProvider("fast")}
        )
        metadata.METADATA_PROVIDERS[:] = ["anilist", "jikan"]

        await metadata._first_success("op", cache_key="k1", cache_ttl=60, call=_call)
        self.assertTrue(metadata._breaker.is_tripped("anilist"))

        started = time.monotonic()
        await metadata._first_success("op", cache_key="k2", cache_ttl=60, call=_call)
        self.assertLess(time.monotonic() - started, 1.0)

    async def test_breaker_resets_after_cooldown(self):
        breaker = metadata.ProviderBreaker(threshold=1, cooldown=0.05)
        breaker.record_failure("anilist")
        self.assertTrue(breaker.is_tripped("anilist"))
        await asyncio.sleep(0.06)
        self.assertFalse(breaker.is_tripped("anilist"))

    async def test_success_clears_breaker_state(self):
        breaker = metadata.ProviderBreaker()
        breaker.record_failure("jikan")
        breaker.record_success("jikan")
        self.assertFalse(breaker.is_tripped("jikan"))


class NormalizerTests(unittest.TestCase):
    """The fallback providers must emit the AniList-shaped payload."""

    def test_kitsu_rating_string_becomes_anilist_scale(self):
        entry = {"attributes": {"averageRating": "88.92", "titles": {}, "subtype": "TV"}}
        normalized = kitsu._normalize(entry)
        self.assertEqual(normalized["average_score"], 89)

    def test_kitsu_season_derived_from_start_date(self):
        entry = {"attributes": {"titles": {}, "startDate": "2026-11-20", "subtype": "TV"}}
        normalized = kitsu._normalize(entry)
        self.assertEqual(normalized["season"], "FALL")
        self.assertEqual(normalized["season_year"], 2026)
        self.assertEqual(normalized["start_date"], {"year": 2026, "month": 11, "day": 20})

    def test_kitsu_missing_values_are_safe(self):
        normalized = kitsu._normalize({"attributes": {}})
        self.assertEqual(normalized["average_score"], 0)
        self.assertEqual(normalized["title_romaji"], "")
        self.assertIsNone(normalized["start_date"])

    def test_jikan_score_scaled_to_anilist_scale(self):
        entry = {"title": "X", "score": 8.5}
        self.assertEqual(jikan._normalize(entry)["average_score"], 85)

    def test_jikan_duration_parsing(self):
        self.assertEqual(jikan._duration_minutes("23 min per ep"), 23)
        self.assertEqual(jikan._duration_minutes("1 hr 47 min"), 107)
        self.assertEqual(jikan._duration_minutes(None), 24)

    def test_jikan_status_mapping(self):
        entry = {"title": "X", "status": "Not yet aired"}
        self.assertEqual(jikan._normalize(entry)["status"], "NOT_YET_RELEASED")

    def test_jikan_start_date_prefers_preparsed_prop(self):
        entry = {
            "title": "X",
            "aired": {"prop": {"from": {"year": 2026, "month": 10, "day": 5}}},
        }
        self.assertEqual(
            jikan._normalize(entry)["start_date"], {"year": 2026, "month": 10, "day": 5}
        )

    def test_normalized_payload_has_every_contract_field(self):
        """Both fallbacks must supply the full AnimeItem shape."""
        expected = {
            "anilist_id",
            "mal_id",
            "title_romaji",
            "title_english",
            "title_native",
            "synopsis_en",
            "cover_image_large",
            "cover_image_extra_large",
            "banner_image",
            "format",
            "status",
            "episodes_count",
            "duration_per_ep",
            "season",
            "season_year",
            "average_score",
            "genres",
            "studios",
            "next_airing",
            "trailer",
            "relations",
            "start_date",
        }
        self.assertTrue(expected.issubset(kitsu._normalize({"attributes": {}}).keys()))
        self.assertTrue(expected.issubset(jikan._normalize({"title": "X"}).keys()))


if __name__ == "__main__":
    unittest.main()
