import { BookmarkItem, WatchHistoryItem } from "./types";

// Watchlist, watch history and settings are stored per browser in localStorage.
// Records use the same shape as the sync API, so syncClient.ts can push them to the
// server and merge the response back. Removing a bookmark leaves a "removed" tombstone,
// so the deletion also reaches other devices.

const KEYS = {
  bookmarks: "aninyom_v2_bookmarks",
  history: "aninyom_v2_history",
  settings: "aninyom_v2_settings",
} as const;

const HISTORY_LIMIT = 30;
const MAX_BOOKMARKS = 2000;
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const BOOKMARK_STATUSES = ["watching", "plan_to_watch", "completed", "dropped", "favorite"];

export const USER_DATA_CHANGED_EVENT = "aninyom:user-data-changed";
const SHORT_SYNC_DELAY_MS = 3000;
const HISTORY_SYNC_DELAY_MS = 60000;

export type BookmarkStatus = BookmarkItem["status"] | "removed";

export interface BookmarkRecord {
  anilist_id: number;
  status: BookmarkStatus;
  title_romaji?: string | null;
  title_english?: string | null;
  cover_image_large?: string | null;
  average_score?: number | null;
  updated_at: string;
}

export interface HistoryRecord {
  anilist_id: number;
  episode_number: number;
  title_romaji?: string | null;
  title_english?: string | null;
  cover_image?: string | null;
  progress_seconds: number;
  total_seconds: number;
  completed: boolean;
  last_watched_at: string;
}

export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

export interface UserDataState {
  bookmarks: BookmarkRecord[];
  history: HistoryRecord[];
  settings: SettingRecord[];
}

export interface BookmarkInput {
  anime_id: number;
  status: string;
  title_romaji?: string;
  title_english?: string;
  cover_image?: string;
  score?: number;
}

export interface HistoryInput {
  anime_id: number;
  episode_number: number;
  progress_seconds: number;
  total_seconds: number;
  completed?: boolean;
  title_romaji?: string;
  title_english?: string;
  cover_image?: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Failed to save user data locally:", e);
  }
}

// A change event schedules a debounced sync. Merges pass null so they do not trigger a push.
function commit<T>(key: string, value: T, syncDelayMs: number | null): void {
  write(key, value);
  if (syncDelayMs !== null) {
    window.dispatchEvent(new CustomEvent(USER_DATA_CHANGED_EVENT, { detail: { delay: syncDelayMs } }));
  }
}

function readBookmarks(): BookmarkRecord[] {
  return read<BookmarkRecord[]>(KEYS.bookmarks, []);
}

function readHistory(): HistoryRecord[] {
  return read<HistoryRecord[]>(KEYS.history, []);
}

function readSettings(): SettingRecord[] {
  return read<SettingRecord[]>(KEYS.settings, []);
}

function nowIso(): string {
  return new Date().toISOString();
}

function pruneTombstones(items: BookmarkRecord[]): BookmarkRecord[] {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  return items.filter((b) => b.status !== "removed" || Date.parse(b.updated_at) >= cutoff);
}

function trimHistory(items: HistoryRecord[]): HistoryRecord[] {
  return [...items]
    .sort((a, b) => b.last_watched_at.localeCompare(a.last_watched_at))
    .slice(0, HISTORY_LIMIT);
}

function mergeByKey<T>(
  local: T[],
  remote: T[],
  keyOf: (item: T) => string,
  stampOf: (item: T) => string,
): T[] {
  const merged = new Map<string, T>();
  for (const item of local) merged.set(keyOf(item), item);
  for (const item of remote) {
    const current = merged.get(keyOf(item));
    if (!current || stampOf(item) > stampOf(current)) merged.set(keyOf(item), item);
  }
  return [...merged.values()];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function toBookmarkItem(record: BookmarkRecord): BookmarkItem {
  return {
    id: record.anilist_id,
    anilist_id: record.anilist_id,
    title_romaji: record.title_romaji || `Anime #${record.anilist_id}`,
    title_english: record.title_english || record.title_romaji || `Anime #${record.anilist_id}`,
    cover_image_large: record.cover_image_large || "",
    average_score: record.average_score ?? undefined,
    status: record.status as BookmarkItem["status"],
    updated_at: record.updated_at,
  };
}

function toHistoryItem(record: HistoryRecord): WatchHistoryItem {
  return {
    id: record.anilist_id * 10000 + record.episode_number,
    anime_id: record.anilist_id,
    anilist_id: record.anilist_id,
    title_romaji: record.title_romaji || `Anime #${record.anilist_id}`,
    title_english: record.title_english || record.title_romaji || `Anime #${record.anilist_id}`,
    cover_image_large: record.cover_image || "",
    episode_number: record.episode_number,
    progress_seconds: record.progress_seconds,
    total_seconds: record.total_seconds,
    completed: record.completed,
    last_watched_at: record.last_watched_at,
  };
}

export const localUserData = {
  getBookmarks(status?: string): BookmarkItem[] {
    return readBookmarks()
      .filter((b) => b.status !== "removed" && (!status || b.status === status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(toBookmarkItem);
  },

  setBookmark(input: BookmarkInput): void {
    if (!BOOKMARK_STATUSES.includes(input.status)) {
      throw new Error("Invalid bookmark status");
    }
    const items = readBookmarks();
    const existing = items.find((b) => b.anilist_id === input.anime_id);
    const record: BookmarkRecord = {
      anilist_id: input.anime_id,
      status: input.status as BookmarkStatus,
      title_romaji: input.title_romaji || existing?.title_romaji,
      title_english: input.title_english || existing?.title_english,
      cover_image_large: input.cover_image || existing?.cover_image_large,
      average_score: existing?.average_score ?? input.score,
      updated_at: nowIso(),
    };
    commit(
      KEYS.bookmarks,
      pruneTombstones([record, ...items.filter((b) => b.anilist_id !== input.anime_id)]),
      SHORT_SYNC_DELAY_MS,
    );
  },

  removeBookmark(animeId: number): void {
    const items = readBookmarks();
    if (!items.some((b) => b.anilist_id === animeId && b.status !== "removed")) return;
    const updated = items.map((b) =>
      b.anilist_id === animeId ? { ...b, status: "removed" as const, updated_at: nowIso() } : b,
    );
    commit(KEYS.bookmarks, pruneTombstones(updated), SHORT_SYNC_DELAY_MS);
  },

  getHistory(): WatchHistoryItem[] {
    return trimHistory(readHistory()).map(toHistoryItem);
  },

  saveHistory(input: HistoryInput): void {
    const ratio = input.total_seconds > 0 ? input.progress_seconds / input.total_seconds : 0;
    const record: HistoryRecord = {
      anilist_id: input.anime_id,
      episode_number: input.episode_number,
      title_romaji: input.title_romaji,
      title_english: input.title_english,
      cover_image: input.cover_image,
      progress_seconds: input.progress_seconds,
      total_seconds: input.total_seconds,
      completed: input.completed || ratio > 0.9,
      last_watched_at: nowIso(),
    };
    const rest = readHistory().filter(
      (h) => !(h.anilist_id === input.anime_id && h.episode_number === input.episode_number),
    );
    commit(KEYS.history, trimHistory([record, ...rest]), HISTORY_SYNC_DELAY_MS);
  },

  getSettings(): Record<string, string> {
    return Object.fromEntries(readSettings().map((s) => [s.key, s.value]));
  },

  saveSetting(key: string, value: string): void {
    const rest = readSettings().filter((s) => s.key !== key);
    commit(KEYS.settings, [...rest, { key, value, updated_at: nowIso() }], SHORT_SYNC_DELAY_MS);
  },

  // Only sends records the server accepts. One invalid record would fail the whole push.
  exportState(): UserDataState {
    return {
      bookmarks: pruneTombstones(readBookmarks())
        .filter((b) => b.anilist_id > 0)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, MAX_BOOKMARKS),
      history: trimHistory(
        readHistory().filter(
          (h) =>
            h.anilist_id > 0 &&
            h.episode_number > 0 &&
            isFiniteNumber(h.progress_seconds) &&
            isFiniteNumber(h.total_seconds),
        ),
      ),
      settings: readSettings(),
    };
  },

  // Union of local and remote data. For each record, the newer timestamp wins.
  mergeState(remote: UserDataState): void {
    const bookmarks = mergeByKey(
      readBookmarks(),
      remote.bookmarks,
      (b) => String(b.anilist_id),
      (b) => b.updated_at,
    );
    const history = mergeByKey(
      readHistory(),
      remote.history,
      (h) => `${h.anilist_id}:${h.episode_number}`,
      (h) => h.last_watched_at,
    );
    const settings = mergeByKey(
      readSettings(),
      remote.settings,
      (s) => s.key,
      (s) => s.updated_at,
    );
    commit(KEYS.bookmarks, pruneTombstones(bookmarks), null);
    commit(KEYS.history, trimHistory(history), null);
    commit(KEYS.settings, settings, null);
  },
};
