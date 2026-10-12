import { AnimeItem, Episode, StreamData, WatchHistoryItem, BookmarkItem, LexiconItem, RecentReleaseItem } from "./types";

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api`;

export function toApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Request failed with status ${res.status}`);
  }
  return res.json();
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

  // Anime Details & Episodes
  getAnimeDetails: (id: number): Promise<AnimeItem> =>
    request<AnimeItem>(`/anime/${id}`),

  getAnimeEpisodes: (id: number, title?: string): Promise<{ hianime_id: string; episodes: Episode[]; title: string }> => {
    let url = `/anime/${id}/episodes`;
    if (title) url += `?title=${encodeURIComponent(title)}`;
    return request(url);
  },

  // Player & Streaming
  getStreamData: (episodeId: string, mode: "sub" | "dub" = "sub"): Promise<StreamData> =>
    request<StreamData>(`/player/stream/${episodeId}?mode=${mode}`),

  // Watch History & Resume
  getHistory: (): Promise<WatchHistoryItem[]> =>
    request<WatchHistoryItem[]>("/user/history"),

  saveHistory: (data: {
    anime_id: number;
    episode_number: number;
    progress_seconds: number;
    total_seconds: number;
    completed?: boolean;
    title_romaji?: string;
    title_english?: string;
    cover_image?: string;
  }) => request("/user/history", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  // Bookmarks
  getBookmarks: (status?: string): Promise<BookmarkItem[]> => {
    let url = "/user/bookmarks";
    if (status) url += `?status=${encodeURIComponent(status)}`;
    return request<BookmarkItem[]>(url);
  },

  setBookmark: (data: {
    anime_id: number;
    status: string;
    title_romaji?: string;
    title_english?: string;
    cover_image?: string;
    score?: number;
  }) => request("/user/bookmarks", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  removeBookmark: (animeId: number) =>
    request(`/user/bookmarks/${animeId}`, {
      method: "DELETE",
    }),

  // Settings
  getSettings: (): Promise<Record<string, string>> =>
    request<Record<string, string>>("/user/settings"),

  saveSetting: (key: string, value: string) =>
    request("/user/settings", {
      method: "POST",
      body: JSON.stringify({ key, value }),
    }),

  // Lexicon
  getLexicon: (): Promise<LexiconItem[]> =>
    request<LexiconItem[]>("/subtitles/lexicon/list"),

  saveLexicon: (entry: { source_term: string; id_term: string; category?: string; notes?: string }) =>
    request("/subtitles/lexicon/entry", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
};
