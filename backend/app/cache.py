"""Aninyom Asynchronous Cache Layer.
Supports Redis with automatic in-memory TTL fallback.
"""

import json
import logging
import time
from typing import Any, Optional

import redis.asyncio as aioredis

from .config import REDIS_URL

logger = logging.getLogger("aninyom.cache")


class InMemoryTTLCache:
    """Lightweight in-memory cache with second-precision TTL expiration."""

    def __init__(self):
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Optional[Any]:
        item = self._store.get(key)
        if not item:
            return None
        val, expires_at = item
        if time.time() > expires_at:
            del self._store[key]
            return None
        return val

    def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        self._store[key] = (value, time.time() + ttl)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()


class CacheManager:
    """Unified Cache Manager for fast API responses and stream token caching."""

    def __init__(self):
        self.redis_client: Optional[aioredis.Redis] = None
        self.is_redis_connected = False
        self._memory_cache = InMemoryTTLCache()

    async def connect(self) -> None:
        try:
            client = aioredis.from_url(
                REDIS_URL,
                decode_responses=True,
                socket_timeout=2.0,
                socket_connect_timeout=2.0,
            )
            await client.ping()
            self.redis_client = client
            self.is_redis_connected = True
            logger.info("Connected to Redis cache at %s", REDIS_URL)
        except Exception as e:
            self.is_redis_connected = False
            self.redis_client = None
            logger.warning(
                "Redis unavailable (%s). Using high-performance in-memory TTL cache fallback.",
                e,
            )

    async def close(self) -> None:
        if self.redis_client and self.is_redis_connected:
            await self.redis_client.aclose()
            self.is_redis_connected = False
            logger.info("Redis cache connection closed.")

    async def get(self, key: str) -> Optional[Any]:
        if self.is_redis_connected and self.redis_client:
            try:
                raw = await self.redis_client.get(key)
                if raw is not None:
                    return json.loads(raw)
                return None
            except Exception as e:
                logger.debug("Redis get error for key %s: %s", key, e)
                return self._memory_cache.get(key)
        return self._memory_cache.get(key)

    async def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        if self.is_redis_connected and self.redis_client:
            try:
                serialized = json.dumps(value)
                await self.redis_client.set(key, serialized, ex=ttl)
                return
            except Exception as e:
                logger.debug("Redis set error for key %s: %s", key, e)
                self._memory_cache.set(key, value, ttl)
                return
        self._memory_cache.set(key, value, ttl)

    async def set_with_stale(self, key: str, value: Any, ttl: int, stale_ttl: int) -> None:
        """Store ``value`` under ``key`` and mirror it to a long-lived copy.

        The mirror (``stale:<key>``) outlives the normal TTL so an upstream
        outage can still be served from the last known good payload.
        """
        await self.set(key, value, ttl=ttl)
        if stale_ttl > ttl:
            await self.set(f"stale:{key}", value, ttl=stale_ttl)

    async def get_stale(self, key: str, max_age: int = 0) -> Optional[Any]:
        """Return the last known good payload for ``key``, if still retained."""
        if max_age <= 0:
            return None
        return await self.get(f"stale:{key}")

    async def delete(self, key: str) -> None:
        if self.is_redis_connected and self.redis_client:
            try:
                await self.redis_client.delete(key)
            except Exception:
                pass
        self._memory_cache.delete(key)


cache = CacheManager()
