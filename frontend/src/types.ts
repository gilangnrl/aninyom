export interface AnimeTitle {
  romaji?: string;
  english?: string;
  native?: string;
}

export interface AnimeCover {
  large?: string;
  extraLarge?: string;
  color?: string;
}

export interface AnimeItem {
  anilist_id: number;
  mal_id?: number;
  title_romaji: string;
  title_english: string;
  title_native?: string;
  synopsis_en?: string;
  synopsis_id?: string;
  cover_image_large: string;
  cover_image_extra_large?: string;
  banner_image?: string;
  format?: string;
  status?: string;
  episodes_count?: number;
  duration_per_ep?: number;
  season?: string;
  season_year?: number;
  average_score?: number;
  genres?: string[];
  studios?: string[];
  next_airing?: {
    airingAt: number;
    timeUntilAiring: number;
    episode: number;
  };
  trailer?: {
    id: string;
    site: string;
  };
  relations?: AnimeRelation[];
  start_date?: {
    year?: number;
    month?: number;
    day?: number;
  };
}

export interface AnimeRelation {
  relationType: string;
  node: {
    id: number;
    title: AnimeTitle;
    coverImage?: AnimeCover;
    format?: string;
    status?: string;
  };
}

export interface RecentReleaseItem {
  airing_id: number;
  airing_at: number;
  episode: number;
  media: AnimeItem;
}

export interface Episode {
  episode_number: number;
  episode_id: string;
  title?: string;
}

export interface SubtitleTrack {
  lang: string;
  label: string;
  url: string;
  default?: boolean;
}

export interface StreamData {
  proxied_url: string;
  master_url: string;
  tracks: SubtitleTrack[];
  intro: { start: number; end: number };
  outro: { start: number; end: number };
  server?: string;
  cached?: boolean;
}

export interface WatchHistoryItem {
  id: number;
  anime_id: number;
  anilist_id: number;
  title_romaji: string;
  title_english: string;
  cover_image_large: string;
  banner_image?: string;
  episode_number: number;
  progress_seconds: number;
  total_seconds: number;
  completed: boolean;
  last_watched_at: string;
}

export interface BookmarkItem {
  id: number;
  anilist_id: number;
  title_romaji: string;
  title_english: string;
  cover_image_large: string;
  banner_image?: string;
  average_score?: number;
  status: 'watching' | 'plan_to_watch' | 'completed' | 'dropped' | 'favorite';
  updated_at: string;
}

export interface LexiconItem {
  id: number;
  source_term: string;
  id_term: string;
  category: string;
  notes?: string;
}
