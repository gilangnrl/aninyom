"""Metadata failover chain.

AniList is the primary metadata source, but it can be disabled outright (it
returns ``403`` with "The AniList API has been temporarily disabled...") or
Cloudflare-blocked from datacenter IPs.  When that happens the catalog must not
collapse into HTTP 500s, so requests fall through to Jikan and then Kitsu.

Design notes
------------
* Every provider returns the same normalized payload, so the API layer and
  frontend are provider-agnostic.
* AniList and Kitsu key on AniList ids; Jikan keys on MAL ids.  ``_to_mal_id``
  bridges the two through Kitsu's mapping index (cached, since it is stable).
* Results are cached normally, then re-served as *stale* data while every
  upstream is failing so a transient outage degrades gracefully instead of
  showing an empty page.
"""

import asyncio
import logging
import time
from typing import Any, Callable, Dict, List, Optional

from ..cache import cache
from ..config import METADATA_PROVIDERS, METADATA_STALE_TTL
from . import anilist, jikan, kitsu

logger = logging.getLogger("aninyom.providers.metadata")

# Mapping cache key -> mal_id.  Ids never change, so keep them a long time.
_MAPPING_TTL = 60 * 60 * 24 * 30

# Seconds before the next provider joins the race.  Keeps the preferred
# provider first while ensuring a slow one never holds up the response.
_HEDGE_DELAY = 0.35

# Provider name -> metadata module exposing the shared function surface.
_PROVIDERS = {"anilist": anilist, "jikan": jikan, "kitsu": kitsu}


class MetadataUnavailable(RuntimeError):
    """Raised when no configured provider could satisfy a metadata request."""


class ProviderBreaker:
    """Per-provider cooldown after repeated failures.

    The motivating failure was Jikan being unreachable: every catalog request
    paid its 15s connect timeout before falling through to a working provider.
    Tripping the breaker after the first failure removes that cost for the
    following ``cooldown`` seconds.

    State is per-process; with several workers each trips independently, which
    is acceptable because trip/reset is cheap and self-healing.
    """

    def __init__(self, threshold: int = 1, cooldown: int = 120):
        self.threshold = threshold
        self.cooldown = cooldown
        self._failures: Dict[str, int] = {}
        self._open_until: Dict[str, float] = {}

    def is_tripped(self, provider: str) -> bool:
        until = self._open_until.get(provider, 0.0)
        if until and time.monotonic() < until:
            return True
        if until:
            # Cooldown elapsed: allow a probe and reset the counter.
            self._open_until.pop(provider, None)
            self._failures.pop(provider, None)
        return False

    def record_failure(self, provider: str) -> None:
        failures = self._failures.get(provider, 0) + 1
        self._failures[provider] = failures
        if failures >= self.threshold:
            self._open_until[provider] = time.monotonic() + self.cooldown
            logger.warning(
                "Circuit opened for %s after %d failure(s); skipping for %ds",
                provider,
                failures,
                self.cooldown,
            )

    def record_success(self, provider: str) -> None:
        self._failures.pop(provider, None)
        self._open_until.pop(provider, None)

    def reset(self) -> None:
        self._failures.clear()
        self._open_until.clear()


_breaker = ProviderBreaker()


async def _to_mal_id(anilist_id: int) -> Optional[int]:
    """Translate an AniList id to a MyAnimeList id (Kitsu-backed, cached)."""
    cache_key = f"idmap:anilist+mal:{anilist_id}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return cached or None

    try:
        mal_id = await kitsu.mal_id_from_anilist(anilist_id)
    except Exception as exc:
        logger.debug("AniList->MAL mapping failed for %s: %s", anilist_id, exc)
        return None

    # Cache misses too (as 0) so a permanently unmapped id is not retried hot.
    await cache.set(cache_key, mal_id or 0, ttl=_MAPPING_TTL)
    return mal_id or None


async def _first_success(
    operation: str,
    *,
    cache_key: str,
    cache_ttl: int,
    call: Callable[[str], Any],
) -> Any:
    """Race the providers and take the first good answer.

    Providers are started concurrently with a small stagger, so a slow or dead
    upstream adds no latency to the response: the first provider to return real
    data wins and the rest are cancelled.  (A serial chain paid each dead
    provider's timeout in full -- 16s while Jikan was unreachable.)

    Providers tripped by the breaker are not started at all.  If every provider
    fails, any retained stale value is returned instead of raising.
    """
    candidates = [p for p in METADATA_PROVIDERS if p in _PROVIDERS]
    healthy = [p for p in candidates if not _breaker.is_tripped(p)]
    errors: List[str] = [f"{p}: circuit open" for p in candidates if p not in healthy]
    ordered = healthy or candidates

    if not ordered:
        stale_only = await cache.get_stale(cache_key, max_age=METADATA_STALE_TTL)
        if stale_only:
            return stale_only
        raise MetadataUnavailable("; ".join(errors) or "no metadata providers configured")

    async def attempt(provider: str, delay: float) -> Any:
        try:
            if delay:
                await asyncio.sleep(delay)
            return provider, await call(provider)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - surfaced via ``errors`` below
            return provider, exc

    # Stagger starts so the preferred provider gets a head start; later ones are
    # hedges that only engage if it is genuinely slow.
    tasks = {
        asyncio.ensure_future(attempt(provider, index * _HEDGE_DELAY))
        for index, provider in enumerate(ordered)
    }

    pending = set(tasks)
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                provider, result = task.result()
                if isinstance(result, BaseException):
                    _breaker.record_failure(provider)
                    errors.append(f"{provider}: {result}")
                    logger.warning(
                        "Metadata provider %s failed for %s: %s", provider, operation, result
                    )
                    continue

                # An explicit ``([], False)`` is a valid "no more results"
                # answer, not a provider failure.
                if isinstance(result, tuple):
                    items, has_more = result
                    if not items and has_more:
                        errors.append(f"{provider}: empty page")
                        continue
                elif not result:
                    errors.append(f"{provider}: empty result")
                    logger.warning(
                        "Metadata provider %s returned no data for %s", provider, operation
                    )
                    continue

                _breaker.record_success(provider)
                await cache.set_with_stale(cache_key, result, cache_ttl, METADATA_STALE_TTL)
                logger.info("Served %s via %s", operation, provider)
                return result
    finally:
        for task in pending:
            task.cancel()

    stale = await cache.get_stale(cache_key, max_age=METADATA_STALE_TTL)
    if stale:
        logger.warning("All metadata providers failed for %s; serving stale cache", operation)
        return stale

    raise MetadataUnavailable("; ".join(errors) or "no metadata providers configured")


async def _dispatch(provider: str, function: str, **kwargs) -> Any:
    """Call ``function`` on the provider module by name."""
    return await getattr(_PROVIDERS[provider], function)(**kwargs)


async def get_trending(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    async def call(provider: str) -> List[Dict[str, Any]]:
        return await _dispatch(provider, "get_trending", page=page, per_page=per_page)

    return await _first_success(
        "trending", cache_key=f"anilist:trending:{page}:{per_page}", cache_ttl=1800, call=call
    )


async def get_popular(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    async def call(provider: str) -> List[Dict[str, Any]]:
        return await _dispatch(provider, "get_popular", page=page, per_page=per_page)

    return await _first_success(
        "popular", cache_key=f"anilist:popular:{page}:{per_page}", cache_ttl=3600, call=call
    )


async def get_seasonal(
    season: Optional[str] = None,
    year: Optional[int] = None,
    page: int = 1,
    per_page: int = 20,
) -> List[Dict[str, Any]]:
    async def call(provider: str) -> List[Dict[str, Any]]:
        return await _dispatch(
            provider, "get_seasonal", season=season, year=year, page=page, per_page=per_page
        )

    return await _first_success(
        "seasonal",
        cache_key=f"anilist:seasonal:{season}:{year}:{page}:{per_page}",
        cache_ttl=7200,
        call=call,
    )


async def get_upcoming(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    async def call(provider: str) -> List[Dict[str, Any]]:
        return await _dispatch(provider, "get_upcoming", page=page, per_page=per_page)

    return await _first_success(
        "upcoming", cache_key=f"anilist:upcoming:{page}:{per_page}", cache_ttl=7200, call=call
    )


async def get_recent_releases(page: int = 1, per_page: int = 20) -> List[Dict[str, Any]]:
    async def call(provider: str) -> List[Dict[str, Any]]:
        return await _dispatch(provider, "get_recent_releases", page=page, per_page=per_page)

    return await _first_success(
        "recent", cache_key=f"anilist:recent:{page}:{per_page}", cache_ttl=600, call=call
    )


async def search_anime(
    search: Optional[str] = None,
    genre: Optional[str] = None,
    format: Optional[str] = None,
    sort: Optional[List[str]] = None,
    season: Optional[str] = None,
    year: Optional[int] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
) -> List[Dict[str, Any]]:
    cache_key = f"anilist:search:{search}:{genre}:{format}:{sort}:{season}:{year}:{status}:{page}:{per_page}"

    async def call(provider: str) -> List[Dict[str, Any]]:
        return await _dispatch(
            provider,
            "search_anime_anilist",
            search=search,
            genre=genre,
            format=format,
            sort=sort,
            season=season,
            year=year,
            status=status,
            page=page,
            per_page=per_page,
        )

    return await _first_success("search", cache_key=cache_key, cache_ttl=600, call=call)


async def search_with_more(
    search: Optional[str] = None,
    genre: Optional[str] = None,
    format: Optional[str] = None,
    sort: Optional[List[str]] = None,
    season: Optional[str] = None,
    year: Optional[int] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
) -> Any:
    """Search returning ``(items, has_more)``.

    ``has_more`` is reported by the provider that served the page, so callers
    never offer a next page that the upstream cannot actually produce.
    """
    cache_key = (
        "anilist:search:"
        f"{search}:{genre}:{format}:{sort}:{season}:{year}:{status}:{page}:{per_page}"
    )

    async def call(provider: str) -> Any:
        module = _PROVIDERS[provider]
        page_fn = getattr(module, "search_page", None)
        if page_fn is not None:
            return await page_fn(
                search=search,
                genre=genre,
                format=format,
                sort=sort,
                season=season,
                year=year,
                status=status,
                page=page,
                per_page=per_page,
            )

        items = await module.search_anime_anilist(
            search=search,
            genre=genre,
            format=format,
            sort=sort,
            season=season,
            year=year,
            status=status,
            page=page,
            per_page=per_page,
        )
        # Providers without page metadata: a full page implies there may be more.
        return items, len(items) >= min(per_page, 20)

    return await _first_success("search", cache_key=f"page:{cache_key}", cache_ttl=600, call=call)


async def _details_via(provider: str, anilist_id: int) -> Optional[Dict[str, Any]]:
    """Fetch details for one provider, translating ids where required."""
    if provider == "anilist":
        return await anilist.get_anime_details(anilist_id)
    if provider == "jikan":
        mal_id = await _to_mal_id(anilist_id)
        if not mal_id:
            return None
        return await jikan.get_anime_details(mal_id, anilist_id=anilist_id)
    if provider == "kitsu":
        return await kitsu.get_anime_details(anilist_id)
    return None


async def get_anime_details(anilist_id: int) -> Optional[Dict[str, Any]]:
    """Details by AniList id, hedged across providers like the list endpoints."""
    try:
        return await _first_success(
            f"details:{anilist_id}",
            cache_key=f"anilist:details:{anilist_id}",
            cache_ttl=86400,
            call=lambda provider: _details_via(provider, anilist_id),
        )
    except MetadataUnavailable:
        return None


async def any_provider_healthy(ttl: int = 30) -> bool:
    """Cheap probe: is any metadata provider answering right now?

    Used to distinguish "this anime does not exist" (404) from "every upstream
    is down" (503).  The answer is cached for ``ttl`` seconds so a struggling
    upstream is not probed once per request.
    """
    cached = await cache.get("metadata:healthy")
    if cached is not None:
        return bool(cached)

    healthy = False
    for provider in METADATA_PROVIDERS:
        module = _PROVIDERS.get(provider)
        if module is None:
            continue
        try:
            if provider == "anilist":
                await module._post_graphql(
                    "query ($id: Int) { Media(id: $id, type: ANIME) { id } }", {"id": 1}
                )
            else:
                await module.get_popular(page=1, per_page=1)
            healthy = True
            break
        except Exception as exc:
            logger.warning("Health probe failed for %s: %s", provider, exc)

    await cache.set("metadata:healthy", healthy, ttl=ttl)
    return healthy


def get_current_season_year():
    """Season helper shared by the API layer (AniList-independent)."""
    return anilist.get_current_season_year()
