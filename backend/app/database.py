import json
import logging
import re
from typing import Any, Dict, List, Optional

import aiosqlite
import asyncpg

from .config import DATABASE_URL, DB_PATH

logger = logging.getLogger("aninyom.database")

PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS anime (
    id BIGSERIAL PRIMARY KEY,
    anilist_id INTEGER UNIQUE,
    mal_id INTEGER,
    hianime_id TEXT UNIQUE,
    title_romaji TEXT NOT NULL,
    title_english TEXT,
    title_native TEXT,
    synopsis_en TEXT,
    synopsis_id TEXT,
    cover_image_large TEXT,
    cover_image_extra_large TEXT,
    banner_image TEXT,
    format VARCHAR(32),
    status VARCHAR(32),
    episodes_count INTEGER,
    duration_per_ep INTEGER,
    season VARCHAR(16),
    season_year INTEGER,
    average_score INTEGER,
    genres JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episodes (
    id BIGSERIAL PRIMARY KEY,
    anime_id BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    hianime_episode_id TEXT NOT NULL,
    title_en TEXT,
    title_id TEXT,
    thumbnail_url TEXT,
    duration INTEGER,
    is_filler BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_anime_episode UNIQUE (anime_id, episode_number)
);

CREATE TABLE IF NOT EXISTS watch_history (
    id BIGSERIAL PRIMARY KEY,
    anime_id BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    progress_seconds DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    total_seconds DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    completed BOOLEAN DEFAULT FALSE,
    last_watched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_anime_watch_progress UNIQUE (anime_id, episode_number)
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id BIGSERIAL PRIMARY KEY,
    anime_id BIGINT NOT NULL UNIQUE REFERENCES anime(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL CHECK(status IN ('watching', 'plan_to_watch', 'completed', 'dropped', 'favorite')),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stream_cache (
    id BIGSERIAL PRIMARY KEY,
    hianime_episode_id TEXT NOT NULL,
    server_type VARCHAR(16) NOT NULL DEFAULT 'sub',
    master_m3u8_url TEXT NOT NULL,
    subtitles JSONB DEFAULT '[]'::jsonb,
    headers JSONB DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stream_cache UNIQUE (hianime_episode_id, server_type)
);

CREATE TABLE IF NOT EXISTS subtitle_cache (
    id BIGSERIAL PRIMARY KEY,
    hianime_episode_id TEXT NOT NULL,
    lang_code VARCHAR(16) NOT NULL,
    tier VARCHAR(16) NOT NULL DEFAULT 'gtx',
    vtt_content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_subtitle_cache UNIQUE (hianime_episode_id, lang_code, tier)
);

CREATE TABLE IF NOT EXISTS anime_lexicon (
    id BIGSERIAL PRIMARY KEY,
    source_term TEXT NOT NULL UNIQUE,
    id_term TEXT NOT NULL,
    category VARCHAR(32) DEFAULT 'general',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_accounts (
    code_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_bookmarks (
    code_hash TEXT NOT NULL,
    anilist_id INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL,
    title_romaji TEXT,
    title_english TEXT,
    cover_image_large TEXT,
    average_score INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (code_hash, anilist_id)
);

CREATE TABLE IF NOT EXISTS sync_history (
    code_hash TEXT NOT NULL,
    anilist_id INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title_romaji TEXT,
    title_english TEXT,
    cover_image TEXT,
    progress_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_watched_at TEXT NOT NULL,
    PRIMARY KEY (code_hash, anilist_id, episode_number)
);

CREATE TABLE IF NOT EXISTS sync_settings (
    code_hash TEXT NOT NULL,
    key VARCHAR(64) NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (code_hash, key)
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    picture TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_accounts_seen ON sync_accounts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_anime_anilist_id ON anime(anilist_id);
CREATE INDEX IF NOT EXISTS idx_anime_hianime_id ON anime(hianime_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_last_watched ON watch_history(last_watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);
CREATE INDEX IF NOT EXISTS idx_episodes_anime_ep ON episodes(anime_id, episode_number);
CREATE INDEX IF NOT EXISTS idx_stream_cache_expires ON stream_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_sub_cache_lookup ON subtitle_cache(hianime_episode_id, lang_code);
"""

SQLITE_SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS anime (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anilist_id INTEGER UNIQUE,
    mal_id INTEGER,
    hianime_id TEXT UNIQUE,
    title_romaji TEXT NOT NULL,
    title_english TEXT,
    title_native TEXT,
    synopsis_en TEXT,
    synopsis_id TEXT,
    cover_image_large TEXT,
    cover_image_extra_large TEXT,
    banner_image TEXT,
    format TEXT,
    status TEXT,
    episodes_count INTEGER,
    duration_per_ep INTEGER,
    season TEXT,
    season_year INTEGER,
    average_score INTEGER,
    genres TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    hianime_episode_id TEXT NOT NULL,
    title_en TEXT,
    title_id TEXT,
    thumbnail_url TEXT,
    duration INTEGER,
    is_filler BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(anime_id, episode_number)
);

CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    progress_seconds REAL NOT NULL DEFAULT 0.0,
    total_seconds REAL NOT NULL DEFAULT 0.0,
    completed BOOLEAN DEFAULT 0,
    last_watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(anime_id, episode_number)
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id INTEGER NOT NULL UNIQUE REFERENCES anime(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('watching', 'plan_to_watch', 'completed', 'dropped', 'favorite')),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stream_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hianime_episode_id TEXT NOT NULL,
    server_type TEXT NOT NULL DEFAULT 'sub',
    master_m3u8_url TEXT NOT NULL,
    subtitles TEXT,
    headers TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hianime_episode_id, server_type)
);

CREATE TABLE IF NOT EXISTS subtitle_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hianime_episode_id TEXT NOT NULL,
    lang_code TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'gtx',
    vtt_content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hianime_episode_id, lang_code, tier)
);

CREATE TABLE IF NOT EXISTS anime_lexicon (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_term TEXT NOT NULL UNIQUE,
    id_term TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_accounts (
    code_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_bookmarks (
    code_hash TEXT NOT NULL,
    anilist_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    title_romaji TEXT,
    title_english TEXT,
    cover_image_large TEXT,
    average_score INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (code_hash, anilist_id)
);

CREATE TABLE IF NOT EXISTS sync_history (
    code_hash TEXT NOT NULL,
    anilist_id INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title_romaji TEXT,
    title_english TEXT,
    cover_image TEXT,
    progress_seconds REAL NOT NULL DEFAULT 0,
    total_seconds REAL NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT 0,
    last_watched_at TEXT NOT NULL,
    PRIMARY KEY (code_hash, anilist_id, episode_number)
);

CREATE TABLE IF NOT EXISTS sync_settings (
    code_hash TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (code_hash, key)
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    picture TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_accounts_seen ON sync_accounts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_watch_history_last_watched ON watch_history(last_watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);
CREATE INDEX IF NOT EXISTS idx_episodes_anime_ep ON episodes(anime_id, episode_number);
CREATE INDEX IF NOT EXISTS idx_stream_cache_expires ON stream_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_sub_cache_lookup ON subtitle_cache(hianime_episode_id, lang_code);
"""

DEFAULT_SETTINGS = [
    ("ui_language", "en"),
    ("default_subtitle_lang", "id"),
    ("dual_subtitle_mode", "false"),
    ("auto_play_next", "true"),
    ("auto_skip_intro", "false"),
    ("player_glow", "true"),
    ("preferred_quality", "1080p"),
]

DEFAULT_LEXICON = [
    ("onii-chan", "Kakak", "honorific", "Older brother"),
    ("onee-chan", "Kakak", "honorific", "Older sister"),
    ("senpai", "Senior", "honorific", "Upperclassman"),
    ("kouhai", "Junior", "honorific", "Underclassman"),
    ("sensei", "Guru", "honorific", "Teacher/Master"),
    ("nakama", "Sahabat", "concept", "Comrade/Close Friend"),
    ("baka", "Bodoh", "slang", "Fool/Idiot"),
    ("itadakimasu", "Selamat makan", "phrase", "Meal greeting"),
    ("gomen", "Maaf", "phrase", "Sorry"),
    ("arigatou", "Terima kasih", "phrase", "Thank you"),
    ("dattebayo", "tau!", "slang", "Naruto catchphrase"),
    ("bankai", "Bankai", "terms", "Bleach release"),
    ("jutsu", "Jutsu", "terms", "Ninja technique"),
    ("chunin", "Chunin", "terms", "Ninja rank"),
    ("genin", "Genin", "terms", "Ninja rank"),
    ("hokage", "Hokage", "terms", "Leader title"),
]


class DatabaseManager:
    def __init__(self):
        self.is_postgres = False
        self.pg_pool: Optional[asyncpg.Pool] = None
        self._sqlite_path = DB_PATH

    async def connect(self):
        if DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://"):
            try:
                self.pg_pool = await asyncpg.create_pool(
                    DATABASE_URL, min_size=2, max_size=15, timeout=5.0
                )
                self.is_postgres = True
                logger.info("Connected to PostgreSQL successfully.")
                await self._init_pg_schema()
                return
            except Exception as e:
                logger.warning(
                    "Failed to connect to PostgreSQL (%s). Falling back to SQLite: %s",
                    e,
                    self._sqlite_path,
                )
                self.is_postgres = False
                self.pg_pool = None

        self.is_postgres = False
        logger.info("Using SQLite database at %s", self._sqlite_path)
        await self._init_sqlite_schema()

    async def close(self):
        if self.pg_pool:
            await self.pg_pool.close()
            self.pg_pool = None

    def _convert_params_to_pg(self, query: str) -> str:
        count = 0

        def repl(match):
            nonlocal count
            count += 1
            return f"${count}"

        return re.sub(r"\?", repl, query)

    async def _init_pg_schema(self):
        if not self.pg_pool:
            return
        async with self.pg_pool.acquire() as conn:
            await conn.execute(PG_SCHEMA)
            for key, val in DEFAULT_SETTINGS:
                await conn.execute(
                    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
                    key,
                    val,
                )
            for term, id_term, cat, notes in DEFAULT_LEXICON:
                await conn.execute(
                    "INSERT INTO anime_lexicon (source_term, id_term, category, notes) VALUES ($1, $2, $3, $4) ON CONFLICT (source_term) DO NOTHING",
                    term,
                    id_term,
                    cat,
                    notes,
                )

    async def _init_sqlite_schema(self):
        async with aiosqlite.connect(self._sqlite_path) as conn:
            await conn.executescript(SQLITE_SCHEMA)
            for key, val in DEFAULT_SETTINGS:
                await conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, val)
                )
            for term, id_term, cat, notes in DEFAULT_LEXICON:
                await conn.execute(
                    "INSERT OR IGNORE INTO anime_lexicon (source_term, id_term, category, notes) VALUES (?, ?, ?, ?)",
                    (term, id_term, cat, notes),
                )
            await conn.commit()

    async def execute(self, query: str, *args) -> None:
        if self.is_postgres and self.pg_pool:
            pg_query = self._convert_params_to_pg(query)
            # Serialize dict/list to JSON string if needed
            converted_args = [json.dumps(a) if isinstance(a, (dict, list)) else a for a in args]
            async with self.pg_pool.acquire() as conn:
                await conn.execute(pg_query, *converted_args)
        else:
            converted_args = [json.dumps(a) if isinstance(a, (dict, list)) else a for a in args]
            async with aiosqlite.connect(self._sqlite_path) as conn:
                await conn.execute(query, converted_args)
                await conn.commit()

    async def execute_many(self, query: str, rows: List[tuple]) -> None:
        if not rows:
            return
        if self.is_postgres and self.pg_pool:
            pg_query = self._convert_params_to_pg(query)
            async with self.pg_pool.acquire() as conn:
                await conn.executemany(pg_query, rows)
        else:
            async with aiosqlite.connect(self._sqlite_path) as conn:
                await conn.executemany(query, rows)
                await conn.commit()

    async def fetch(self, query: str, *args) -> List[Dict[str, Any]]:
        if self.is_postgres and self.pg_pool:
            pg_query = self._convert_params_to_pg(query)
            async with self.pg_pool.acquire() as conn:
                records = await conn.fetch(pg_query, *args)
                return [dict(r) for r in records]
        else:
            async with aiosqlite.connect(self._sqlite_path) as conn:
                conn.row_factory = aiosqlite.Row
                async with conn.execute(query, args) as cursor:
                    rows = await cursor.fetchall()
                    return [dict(r) for r in rows]

    async def fetchrow(self, query: str, *args) -> Optional[Dict[str, Any]]:
        if self.is_postgres and self.pg_pool:
            pg_query = self._convert_params_to_pg(query)
            async with self.pg_pool.acquire() as conn:
                row = await conn.fetchrow(pg_query, *args)
                return dict(row) if row else None
        else:
            async with aiosqlite.connect(self._sqlite_path) as conn:
                conn.row_factory = aiosqlite.Row
                async with conn.execute(query, args) as cursor:
                    row = await cursor.fetchone()
                    return dict(row) if row else None


db = DatabaseManager()
