import { AnimeItem, Episode, StreamData, WatchHistoryItem, BookmarkItem, LexiconItem, RecentReleaseItem } from "./types";
import { localUserData, UserDataState } from "./localUserData";

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api`;

export function toApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    // The backend returns copy that is safe to show. Technical context (upstream
    // provider failures, validation detail) is only logged, not surfaced.
    console.error(`API ${res.status} ${endpoint} failed`, errorData?.detail ?? errorData);
    const detail = typeof errorData?.detail === "string" ? errorData.detail : "";
    throw new Error(detail || "Something went wrong. Please try again.");
  }
  return res.json();
}

/**
 * Same as `request`, but also reports whether the server says another page
 * exists. The backend sends `X-Has-More` because the payload is a bare array;
 * guessing from page length wrongly hides "load more" on short pages.
 */
async function requestWithPagination<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ items: T; hasMore: boolean | undefined }> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error(`API ${res.status} ${endpoint} failed`, errorData?.detail ?? errorData);
    const detail = typeof errorData?.detail === "string" ? errorData.detail : "";
    throw new Error(detail || "Something went wrong. Please try again.");
  }
  const data = await res.json();
  const header = res.headers.get("X-Has-More");
  return { items: data as T, hasMore: header === null ? undefined : header === "true" };
}

export interface SearchAnimeOptions {
  query?: string;
  genre?: string;
  format?: string;
  page?: number;
  sort?: string;
  season?: string;
  year?: number;
  status?: string;
}

export const api = {
  // Discovery
  getTrending: (page = 1, perPage = 20): Promise<AnimeItem[]> =>
    request<AnimeItem[]>(`/anime/trending?page=${page}&per_page=${perPage}`),

  getPopular: (page = 1, perPage = 20): Promise<AnimeItem[]> =>
    request<AnimeItem[]>(`/anime/popular?page=${page}&per_page=${perPage}`),

  getRecentReleases: (page = 1, perPage = 20): Promise<RecentReleaseItem[]> =>
    request<RecentReleaseItem[]>(`/anime/recent?page=${page}&per_page=${perPage}`),

  getUpcoming: (page = 1, perPage = 20): Promise<AnimeItem[]> =>
    request<AnimeItem[]>(`/anime/upcoming?page=${page}&per_page=${perPage}`),

  getSeasonal: (season?: string, year?: number, page = 1): Promise<AnimeItem[]> => {
    let url = `/anime/seasonal?page=${page}`;
    if (season) url += `&season=${season}`;
    if (year) url += `&year=${year}`;
    return request<AnimeItem[]>(url);
  },

  searchAnime: (
    queryOrOptions?: string | SearchAnimeOptions,
    genre?: string,
    format?: string,
    page = 1,
    sort?: string,
    season?: string,
    year?: number,
    status?: string
  ): Promise<AnimeItem[]> => {
    let opts: SearchAnimeOptions = {};
    if (typeof queryOrOptions === "object" && queryOrOptions !== null) {
      opts = queryOrOptions;
    } else {
      opts = {
        query: typeof queryOrOptions === "string" ? queryOrOptions : undefined,
        genre,
        format,
        page,
        sort,
        season,
        year,
        status,
      };
    }

    const pageNum = opts.page || 1;
    let url = `/anime/search?page=${pageNum}`;
    if (opts.query) url += `&q=${encodeURIComponent(opts.query)}`;
    if (opts.genre) url += `&genre=${encodeURIComponent(opts.genre)}`;
    if (opts.format) url += `&format=${encodeURIComponent(opts.format)}`;
    if (opts.sort) url += `&sort=${encodeURIComponent(opts.sort)}`;
    if (opts.season) url += `&season=${encodeURIComponent(opts.season)}`;
    if (opts.year) url += `&year=${encodeURIComponent(opts.year)}`;
    if (opts.status) url += `&status=${encodeURIComponent(opts.status)}`;
    return request<AnimeItem[]>(url);
  },

  /**
   * Search including the server's pagination verdict.
   *
   * Providers differ in whether they can serve a second page; the backend
   * reports that explicitly via `X-Has-More` so the UI never offers a "load
   * more" that returns nothing (or, worse, repeats the same rows).
   */
  searchAnimePage: async (
    opts: SearchAnimeOptions = {}
  ): Promise<{ items: AnimeItem[]; hasMore: boolean }> => {
    const pageNum = opts.page || 1;
    let url = `/anime/search?page=${pageNum}`;
    if (opts.query) url += `&q=${encodeURIComponent(opts.query)}`;
    if (opts.genre) url += `&genre=${encodeURIComponent(opts.genre)}`;
    if (opts.format) url += `&format=${encodeURIComponent(opts.format)}`;
    if (opts.sort) url += `&sort=${encodeURIComponent(opts.sort)}`;
    if (opts.season) url += `&season=${encodeURIComponent(opts.season)}`;
    if (opts.year) url += `&year=${encodeURIComponent(opts.year)}`;
    if (opts.status) url += `&status=${encodeURIComponent(opts.status)}`;
    const { items, hasMore } = await requestWithPagination<AnimeItem[]>(url);
    // Fall back to the old length heuristic only when the header is absent.
    return { items, hasMore: hasMore ?? items.length >= 15 };
  },

  // Anime Details & Episodes
  getAnimeDetails: (id: number): Promise<AnimeItem> =>
    request<AnimeItem>(`/anime/${id}`),

  getAnimeEpisodes: (id: number, title?: string): Promise<{ hianime_id: string; episodes: Episode[]; title: string }> => {
    let url = `/anime/${id}/episodes`;
    if (title) url += `?title=${encodeURIComponent(title)}`;
    return request(url);
  },

  // Player & Streaming
  getStreamData: (
    episodeId: string,
    mode: "sub" | "dub" = "sub",
    options?: { title?: string; titleAlt?: string; episode?: number; anilistId?: number }
  ): Promise<StreamData> => {
    const params = new URLSearchParams({ mode });
    if (options?.title) params.set("title", options.title);
    if (options?.titleAlt) params.set("title_alt", options.titleAlt);
    if (options?.episode != null) params.set("episode", String(options.episode));
    if (options?.anilistId != null) params.set("anilist_id", String(options.anilistId));
    return request<StreamData>(`/player/stream/${episodeId}?${params.toString()}`);
  },

  // Watch History & Resume
  getHistory: async (): Promise<WatchHistoryItem[]> => localUserData.getHistory(),

  saveHistory: async (data: {
    anime_id: number;
    episode_number: number;
    progress_seconds: number;
    total_seconds: number;
    completed?: boolean;
    title_romaji?: string;
    title_english?: string;
    cover_image?: string;
  }) => localUserData.saveHistory(data),

  // Bookmarks
  getBookmarks: async (status?: string): Promise<BookmarkItem[]> => localUserData.getBookmarks(status),

  setBookmark: (data: {
    anime_id: number;
    status: string;
    title_romaji?: string;
    title_english?: string;
    cover_image?: string;
    score?: number;
  }) => localUserData.setBookmark(data),

  removeBookmark: async (animeId: number) => localUserData.removeBookmark(animeId),

  // Settings
  getSettings: async (): Promise<Record<string, string>> => localUserData.getSettings(),

  saveSetting: async (key: string, value: string) => localUserData.saveSetting(key, value),

  // Sync across devices (anonymous sync code)
  syncCreate: () => request<{ code: string }>("/sync/create", { method: "POST" }),

  syncPush: (code: string | null, state: UserDataState) =>
    request<UserDataState>("/sync/state", {
      method: "PUT",
      headers: code ? { "X-Sync-Code": code } : {},
      body: JSON.stringify(state),
    }),

  syncDelete: (code: string) =>
    request<{ status: string }>("/sync/account", {
      method: "DELETE",
      headers: { "X-Sync-Code": code },
    }),

  // Google sign-in (session cookie, same origin)
  authConfig: () => request<{ google_client_id: string | null }>("/auth/config"),

  authGoogle: (credential: string) =>
    request<{ name: string | null; email: string | null; picture: string | null }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }),

  authLogout: () => request<{ status: string }>("/auth/logout", { method: "POST" }),

  authDeleteAccount: () => request<{ status: string }>("/auth/account", { method: "DELETE" }),

  // Lexicon
  getLexicon: (): Promise<LexiconItem[]> =>
    request<LexiconItem[]>("/subtitles/lexicon/list"),

  saveLexicon: (entry: { source_term: string; id_term: string; category?: string; notes?: string }) =>
    request("/subtitles/lexicon/entry", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
};
