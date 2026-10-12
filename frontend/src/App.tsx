import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  RotateCw,
  AlertCircle,
  Play,
  Bell,
  ArrowRight,
} from "lucide-react";
import { Navbar } from "./components/Navbar";
import { HeroBanner } from "./components/HeroBanner";
import { AnimeCard } from "./components/AnimeCard";
import { AnimeDetailsView } from "./components/AnimeDetailsView";
import { MediaPlayer } from "./components/MediaPlayer";
import { BrowseView } from "./components/BrowseView";
import { WatchlistView } from "./components/WatchlistView";
import { SettingsView } from "./components/SettingsView";
import { FooterInfoDialog, FooterInfoPage } from "./components/FooterInfoDialog";
import { api } from "./api";
import { translations, TranslationSchema } from "./i18n";
import { AnimeItem, Episode, WatchHistoryItem, RecentReleaseItem } from "./types";

interface PlayingEpisodeState {
  anime: AnimeItem;
  episodeNumber: number;
  episodeId: string;
  episodesList: Episode[];
}

const COPYRIGHT_YEAR = new Date().getFullYear();

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatAiredTime(timestamp: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - timestamp;
  if (diffSec < 0) return "Airing soon";
  const hours = Math.floor(diffSec / 3600);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins}m ago`;
  }
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatReleaseDate(anime: AnimeItem): string {
  if (anime.season && anime.season.trim() && anime.season_year && anime.season_year > 0) {
    return `${anime.season} ${anime.season_year}`;
  }
  if (anime.start_date?.year) {
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    if (anime.start_date.month && anime.start_date.month >= 1 && anime.start_date.month <= 12) {
      return `${monthNames[anime.start_date.month - 1]} ${anime.start_date.year}`;
    }
    return `Coming ${anime.start_date.year}`;
  }
  return "TBA";
}

export const App: React.FC = () => {
  // Localization
  const [lang, setLang] = useState<"en" | "id">(() => {
    const saved = localStorage.getItem("aninyom_lang");
    return saved === "id" ? "id" : "en";
  });
  const t: TranslationSchema = translations[lang];

  useEffect(() => {
    localStorage.setItem("aninyom_lang", lang);
  }, [lang]);

  // Theme (Dark / Light)
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("aninyom_theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    localStorage.setItem("aninyom_theme", theme);
    if (theme === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    }
  }, [theme]);

  // Navigation & Search State
  const [activeTab, setActiveTab] = useState<string>(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#/browse")) return "browse";
    if (hash.startsWith("#/watchlist")) return "watchlist";
    if (hash.startsWith("#/settings")) return "settings";
    if (hash.startsWith("#/anime/")) return "details";
    if (hash.startsWith("#/watch/")) return "details";
    try {
      const saved = sessionStorage.getItem("aninyom_active_player");
      if (saved) return "details";
    } catch {}
    return "home";
  });
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedGenre, setSelectedGenre] = useState<string>("");
  const [browseSort, setBrowseSort] = useState<string>("popular");
  const [browseSeason, setBrowseSeason] = useState<string>("");
  const [browseYear, setBrowseYear] = useState<number | undefined>(undefined);
  const [browseFormat, setBrowseFormat] = useState<string>("");
  const [browseStatus, setBrowseStatus] = useState<string>("");

  const currentSeasonYear = useMemo(() => {
    const now = new Date();
    const m = now.getMonth() + 1;
    let season = "WINTER";
    if (m >= 4 && m <= 6) season = "SPRING";
    else if (m >= 7 && m <= 9) season = "SUMMER";
    else if (m >= 10 && m <= 12) season = "FALL";
    return { season, year: now.getFullYear() };
  }, []);

  const navigateToBrowse = useCallback(
    (params: {
      sort?: string;
      season?: string;
      year?: number;
      format?: string;
      genre?: string;
      status?: string;
      query?: string;
    }) => {
      if (params.sort !== undefined) setBrowseSort(params.sort);
      if (params.season !== undefined) setBrowseSeason(params.season);
      if (params.year !== undefined) setBrowseYear(params.year);
      if (params.format !== undefined) setBrowseFormat(params.format);
      if (params.genre !== undefined) setSelectedGenre(params.genre);
      if (params.status !== undefined) setBrowseStatus(params.status);
      if (params.query !== undefined) setSearchQuery(params.query);

      const searchParams = new URLSearchParams();
      const q = params.query !== undefined ? params.query : searchQuery;
      const g = params.genre !== undefined ? params.genre : selectedGenre;
      const f = params.format !== undefined ? params.format : browseFormat;
      const s = params.sort !== undefined ? params.sort : browseSort;
      const se = params.season !== undefined ? params.season : browseSeason;
      const y = params.year !== undefined ? params.year : browseYear;
      const st = params.status !== undefined ? params.status : browseStatus;

      if (q) searchParams.set("q", q);
      if (g) searchParams.set("genre", g);
      if (f) searchParams.set("format", f);
      if (s && s !== "popular") searchParams.set("sort", s);
      if (se) searchParams.set("season", se);
      if (y) searchParams.set("year", y.toString());
      if (st) searchParams.set("status", st);

      const qs = searchParams.toString();
      const hash = qs ? `#/browse?${qs}` : `#/browse`;
      window.location.hash = hash;
      setActiveTab("browse");
    },
    [searchQuery, selectedGenre, browseFormat, browseSort, browseSeason, browseYear, browseStatus]
  );

  // Modals & Player State
  const [selectedAnime, setSelectedAnime] = useState<AnimeItem | null>(() => {
    try {
      const saved = sessionStorage.getItem("aninyom_active_player");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.anime) return parsed.anime;
      }
    } catch {}
    return null;
  });

  const [playingEpisode, setPlayingEpisode] = useState<PlayingEpisodeState | null>(() => {
    try {
      const hash = window.location.hash;
      const saved = sessionStorage.getItem("aninyom_active_player");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.anime?.anilist_id) {
          if (hash.startsWith("#/watch/")) {
            const parts = hash.replace("#/watch/", "").split("/");
            const anilistId = parseInt(parts[0], 10);
            const epNum = parseInt(parts[1], 10) || 1;
            if (parsed.anime.anilist_id === anilistId) {
              const ep = parsed.episodesList?.find((e: Episode) => e.episode_number === epNum) || parsed.episodesList?.[0];
              return {
                anime: parsed.anime,
                episodeNumber: ep?.episode_number || epNum,
                episodeId: ep?.episode_id || parsed.episodeId,
                episodesList: parsed.episodesList || [],
              };
            }
          } else if (!hash || hash === "#" || hash === "#/" || hash === "#/home") {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to restore player session from storage:", e);
    }
    return null;
  });

  // Keep active player session persisted in sessionStorage
  useEffect(() => {
    if (playingEpisode) {
      try {
        sessionStorage.setItem("aninyom_active_player", JSON.stringify(playingEpisode));
      } catch (e) {
        console.warn("Failed to save player session:", e);
      }
    } else {
      try {
        sessionStorage.removeItem("aninyom_active_player");
      } catch {}
    }
  }, [playingEpisode]);

  const handleSelectAnime = useCallback((anime: AnimeItem) => {
    setSelectedAnime(anime);
    setActiveTab("details");
    window.location.hash = `#/anime/${anime.anilist_id}`;
  }, []);

  // Home Screen Content State
  const [trending, setTrending] = useState<AnimeItem[]>([]);
  const [popular, setPopular] = useState<AnimeItem[]>([]);
  const [seasonal, setSeasonal] = useState<AnimeItem[]>([]);
  const [upcoming, setUpcoming] = useState<AnimeItem[]>([]);
  const [recentReleases, setRecentReleases] = useState<RecentReleaseItem[]>([]);
  const [recentHistory, setRecentHistory] = useState<WatchHistoryItem[]>([]);
  const [loadingHome, setLoadingHome] = useState<boolean>(true);
  const [homeError, setHomeError] = useState<string | null>(null);

  // Refresh the rolling week and countdown while the page remains open.
  const [scheduleNow, setScheduleNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setScheduleNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Schedule dates use the visitor's local calendar and timezone.
  const scheduleDays = useMemo(() => {
    const today = new Date(scheduleNow);
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return {
        key: localDateKey(date),
        date,
        label: new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric" }).format(date),
        isToday: offset === 0,
      };
    });
  }, [lang, scheduleNow]);
  const [selectedDay, setSelectedDay] = useState<string>(() => localDateKey(new Date()));
  const visibleScheduleDay = scheduleDays.some((day) => day.key === selectedDay)
    ? selectedDay
    : scheduleDays[0].key;
  const [footerInfoPage, setFooterInfoPage] = useState<FooterInfoPage | null>(null);
  const [subscribedUpcoming, setSubscribedUpcoming] = useState<Record<number, boolean>>({});

  const scheduleItems = useMemo(() => {
    const uniqueCatalog = new Map<number, AnimeItem>();
    [...seasonal, ...trending, ...popular, ...upcoming].forEach((anime) => {
      if (!uniqueCatalog.has(anime.anilist_id)) uniqueCatalog.set(anime.anilist_id, anime);
    });
    const now = scheduleNow.getTime();
    return [...uniqueCatalog.values()]
      .filter((anime) => {
        const airingAt = anime.next_airing?.airingAt;
        return airingAt && airingAt * 1000 >= now && localDateKey(new Date(airingAt * 1000)) === visibleScheduleDay;
      })
      .sort((a, b) => a.next_airing!.airingAt - b.next_airing!.airingAt);
  }, [seasonal, trending, popular, upcoming, visibleScheduleDay, scheduleNow]);

  const nextAiringCountdown = useMemo(() => {
    const candidate = [...seasonal, ...trending, ...popular, ...upcoming]
      .filter((anime) => anime.next_airing && anime.next_airing.airingAt * 1000 > scheduleNow.getTime())
      .sort((a, b) => a.next_airing!.airingAt - b.next_airing!.airingAt)[0];
    if (!candidate?.next_airing) return null;
    const totalSecs = Math.max(0, candidate.next_airing.airingAt - Math.floor(scheduleNow.getTime() / 1000));
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    if (hours > 24) {
      return `${Math.floor(hours / 24)}D ${hours % 24}H`;
    }
    return `${hours}H ${mins}M`;
  }, [seasonal, trending, popular, upcoming, scheduleNow]);

  const navigateHomeToSection = useCallback((sectionId: string) => {
    setActiveTab("home");
    window.history.replaceState(null, "", "#/home");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const section = document.getElementById(sectionId);
        if (!section) return;
        section.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        });
      });
    });
  }, []);
  const closeFooterInfo = useCallback(() => setFooterInfoPage(null), []);

  const isHashParsedRef = useRef(false);

  // Sync state to URL hash
  useEffect(() => {
    if (!isHashParsedRef.current) return;

    if (playingEpisode) {
      const targetHash = `#/watch/${playingEpisode.anime.anilist_id}/${playingEpisode.episodeNumber}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(null, "", targetHash);
      }
    } else if (activeTab === "details" && selectedAnime) {
      const targetHash = `#/anime/${selectedAnime.anilist_id}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(null, "", targetHash);
      }
    } else if (activeTab === "browse") {
      if (!window.location.hash.startsWith("#/browse")) {
        window.history.replaceState(null, "", "#/browse");
      }
    } else {
      const targetHash = `#/${activeTab}`;
      if (window.location.hash !== targetHash && !(activeTab === "home" && !window.location.hash)) {
        window.history.replaceState(null, "", targetHash);
      }
    }
  }, [playingEpisode, selectedAnime, activeTab]);

  // Handle URL hash on initial mount and hashchange
  useEffect(() => {
    const parseHash = async () => {
      const hash = window.location.hash;
      try {
        if (!hash || hash === "#" || hash === "#/" || hash === "#/home") {
          if (playingEpisode) {
            window.history.replaceState(
              null,
              "",
              `#/watch/${playingEpisode.anime.anilist_id}/${playingEpisode.episodeNumber}`
            );
          } else {
            setActiveTab("home");
          }
          return;
        }

        if (hash.startsWith("#/watch/")) {
          const parts = hash.replace("#/watch/", "").split("/");
          const anilistId = parseInt(parts[0], 10);
          const epNum = parseInt(parts[1], 10) || 1;
          if (anilistId) {
            if (
              playingEpisode &&
              playingEpisode.anime.anilist_id === anilistId &&
              playingEpisode.episodeNumber === epNum
            ) {
              return;
            }
            try {
              const anime = await api.getAnimeDetails(anilistId);
              setSelectedAnime(anime);
              const episodesRes = await api.getAnimeEpisodes(anilistId, anime.title_romaji);
              const eps = episodesRes.episodes || [];
              const targetEp = eps.find((e) => e.episode_number === epNum) || eps[0];
              if (targetEp) {
                setPlayingEpisode({
                  anime,
                  episodeNumber: targetEp.episode_number,
                  episodeId: targetEp.episode_id,
                  episodesList: eps,
                });
              } else {
                setActiveTab("details");
              }
            } catch (err) {
              console.error("Failed to restore player from URL:", err);
            }
          }
          return;
        }

        if (hash.startsWith("#/anime/")) {
          const idStr = hash.replace("#/anime/", "").split("/")[0];
          const anilistId = parseInt(idStr, 10);
          if (anilistId) {
            try {
              setActiveTab("details");
              const anime = await api.getAnimeDetails(anilistId);
              setSelectedAnime(anime);
            } catch (err) {
              console.error("Failed to restore anime details from URL:", err);
            }
          }
          return;
        }

        if (hash.startsWith("#/browse")) {
          setActiveTab("browse");
          const queryIndex = hash.indexOf("?");
          if (queryIndex !== -1) {
            const searchParams = new URLSearchParams(hash.substring(queryIndex + 1));
            const sort = searchParams.get("sort");
            const season = searchParams.get("season");
            const yearStr = searchParams.get("year");
            const genre = searchParams.get("genre");
            const format = searchParams.get("format");
            const status = searchParams.get("status");
            const q = searchParams.get("q");

            if (sort) setBrowseSort(sort);
            if (season) setBrowseSeason(season);
            if (yearStr) setBrowseYear(parseInt(yearStr, 10) || undefined);
            if (genre) setSelectedGenre(genre);
            if (format) setBrowseFormat(format);
            if (status) setBrowseStatus(status);
            if (q) setSearchQuery(q);
          }
          return;
        }
        if (hash.startsWith("#/watchlist")) {
          setActiveTab("watchlist");
          return;
        }
        if (hash.startsWith("#/settings")) {
          setActiveTab("settings");
          return;
        }
      } finally {
        isHashParsedRef.current = true;
      }
    };

    parseHash();
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, []);

  // Fetch Home Catalog
  const loadHomeData = useCallback(async () => {
    setLoadingHome(true);
    setHomeError(null);
    try {
      const [trendRes, popRes, seasRes, recRes, histRes, upRes] = await Promise.allSettled([
        api.getTrending(1, 20),
        api.getPopular(1, 20),
        api.getSeasonal(undefined, undefined, 1),
        api.getRecentReleases(1, 16),
        api.getHistory(),
        api.getUpcoming(1, 16),
      ]);

      if (trendRes.status === "fulfilled") setTrending(trendRes.value);
      if (popRes.status === "fulfilled") setPopular(popRes.value);
      if (seasRes.status === "fulfilled") setSeasonal(seasRes.value);
      if (recRes.status === "fulfilled") setRecentReleases(recRes.value);
      if (histRes.status === "fulfilled") setRecentHistory(histRes.value);
      if (upRes.status === "fulfilled") setUpcoming(upRes.value);

      if (
        trendRes.status === "rejected" &&
        popRes.status === "rejected" &&
        seasRes.status === "rejected"
      ) {
        setHomeError("Failed to connect to backend server. Please check your connection.");
      }
    } catch (err: any) {
      setHomeError(err?.message || "Failed to load catalogue.");
    } finally {
      setLoadingHome(false);
    }
  }, []);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  // Search Submission from Navbar
  const handleNavbarSearch = (query: string) => {
    navigateToBrowse({ query, sort: "popular" });
  };

  // Play Hero Anime immediately (EP 1)
  const handlePlayAnime = async (anime: AnimeItem) => {
    try {
      const res = await api.getAnimeEpisodes(anime.anilist_id, anime.title_romaji);
      if (res.episodes && res.episodes.length > 0) {
        setPlayingEpisode({
          anime,
          episodeNumber: res.episodes[0].episode_number,
          episodeId: res.episodes[0].episode_id,
          episodesList: res.episodes,
        });
      } else {
        handleSelectAnime(anime);
      }
    } catch {
      handleSelectAnime(anime);
    }
  };

  // Quick Bookmark from Hero or Cards
  const handleQuickBookmark = async (anime: AnimeItem) => {
    try {
      await api.setBookmark({
        anime_id: anime.anilist_id,
        status: "watching",
        title_romaji: anime.title_romaji,
        title_english: anime.title_english,
        cover_image: anime.cover_image_large,
      });
      alert(`Added "${anime.title_romaji}" to your watchlist!`);
    } catch {
      handleSelectAnime(anime);
    }
  };

  // Play a specific episode from Details or History
  const handlePlayEpisode = (
    anime: AnimeItem,
    episodeNumber: number,
    episodeId: string,
    episodesList: Episode[]
  ) => {
    setPlayingEpisode({
      anime,
      episodeNumber,
      episodeId,
      episodesList,
    });
  };

  // Resume from History card on Home
  const handleResumeHistory = async (item: WatchHistoryItem) => {
    try {
      const episodesRes = await api.getAnimeEpisodes(item.anilist_id, item.title_romaji);
      const eps = episodesRes.episodes || [];
      const targetEp = eps.find((e) => e.episode_number === item.episode_number) || eps[0];
      if (targetEp) {
        const animeStub: AnimeItem = {
          anilist_id: item.anilist_id,
          title_romaji: item.title_romaji,
          title_english: item.title_english,
          cover_image_large: item.cover_image_large,
        };
        handlePlayEpisode(animeStub, targetEp.episode_number, targetEp.episode_id, eps);
      } else {
        const anime = await api.getAnimeDetails(item.anilist_id);
        handleSelectAnime(anime);
      }
    } catch (err) {
      console.error("Failed to resume from history:", err);
    }
  };

  // Close player and refresh watch history
  const handleClosePlayer = () => {
    setPlayingEpisode(null);
    try {
      sessionStorage.removeItem("aninyom_active_player");
    } catch {}
    if (activeTab === "details" && selectedAnime) {
      window.history.replaceState(null, "", `#/anime/${selectedAnime.anilist_id}`);
    } else {
      window.history.replaceState(null, "", `#/${activeTab}`);
    }
    api.getHistory().then(setRecentHistory).catch(() => {});
  };

  // Toggle upcoming season notification
  const toggleUpcomingNotify = (id: number) => {
    setSubscribedUpcoming((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className="app-shell min-h-screen bg-[var(--bg)] text-[var(--tx)] flex flex-col selection:bg-[#7aa2f7] selection:text-[#002e6b]">
      {/* Floating Pill Detached Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
        t={t}
        onSearch={handleNavbarSearch}
      />

      {/* Main Body Content */}
      <main className="w-full pt-0 bg-[var(--bg)] flex-grow">
        {activeTab === "home" && (
          <div className="flex flex-col w-full">
            {/* Loading / Error States */}
            {loadingHome ? (
              <div className="w-full h-[500px] flex flex-col items-center justify-center space-y-4">
                <div className="w-10 h-10 border-3 border-[#7aa2f7] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-[#c3c6d3] tracking-widest uppercase font-bold">
                  Ingesting feeds from AniList & Megaplay CDN...
                </p>
              </div>
            ) : homeError ? (
              <div className="max-w-4xl mx-auto my-12 p-8 rounded-2xl glass border border-red-500/20 text-center space-y-4">
                <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
                <h3 className="text-lg font-bold text-[var(--tx)]">{homeError}</h3>
                <button
                  onClick={loadHomeData}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#7aa2f7] text-[#002e6b] font-bold text-xs transition-all shadow-lg hover:scale-105 active:scale-95"
                >
                  <RotateCw className="w-4 h-4" /> Retry
                </button>
              </div>
            ) : (
              trending.length > 0 && (
                <HeroBanner
                  items={trending}
                  onPlay={handlePlayAnime}
                  onDetails={handleSelectAnime}
                  onBookmark={handleQuickBookmark}
                  lang={lang}
                  t={t}
                />
              )
            )}

            {/* Main Showcase Container (Max-Width 1800px matching Stitch) */}
            <div className="w-full max-w-[1440px] mx-auto px-4 md:px-8 lg:px-14 flex flex-col gap-12 lg:gap-16 py-8">
              {/* 1. CONTINUE WATCHING RAIL (16:9 Landscape cards) */}
              {recentHistory.length > 0 && (
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-6 rounded-full bg-[#7aa2f7]" />
                      <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3]">
                        {t.continueWatching}
                      </h2>
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#252a37] text-[#c3c6d3] uppercase">
                        {`${recentHistory.length} IN PROGRESS`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveTab("watchlist")}
                        aria-label="View all in watchlist"
                        className="text-xs font-bold text-[#7aa2f7] hover:underline flex items-center gap-1 mr-2"
                      >
                        <span>View all</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 16:9 Landscape Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px]">
                    {recentHistory.slice(0, 4).map((h) => {
                      const progressPct =
                        h.total_seconds > 0
                          ? Math.min(100, Math.round((h.progress_seconds / h.total_seconds) * 100))
                          : 0;
                      const itemTitle =
                        lang === "en" && h.title_english ? h.title_english : h.title_romaji;
                      const minutesLeft =
                        h.total_seconds > h.progress_seconds
                          ? Math.ceil((h.total_seconds - h.progress_seconds) / 60)
                          : 0;

                      return (
                        <article
                          key={h.id}
                          onClick={() => handleResumeHistory(h)}
                          className="group relative rounded-xl overflow-hidden bg-[#1a1f2c] flex flex-col cursor-pointer transition-transform duration-200 hover:-translate-y-1 border border-white/5"
                        >
                          <div className="relative w-full aspect-video bg-[#303542] overflow-hidden">
                            <img
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              src={h.cover_image_large}
                              alt={itemTitle}
                            />
                            {/* Floating play icon on hover */}
                            <div className="absolute inset-0 bg-[#0e131f]/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <div className="w-12 h-12 rounded-full bg-[#7aa2f7] text-[#002e6b] flex items-center justify-center shadow-lg shadow-[#7aa2f7]/40 scale-90 group-hover:scale-100 transition-transform">
                                <Play className="w-5 h-5 fill-[#002e6b] ml-0.5" />
                              </div>
                            </div>
                            {/* Progress Bar Rail (4px accent) */}
                            {progressPct > 0 && (
                              <div className="absolute bottom-0 inset-x-0 h-1 bg-[#303542]/80">
                                <div
                                  className="h-full bg-[#7aa2f7] rounded-r"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <div className="p-4 flex flex-col gap-1">
                            <h3 className="text-sm font-bold text-[#dee2f3] group-hover:text-[#7aa2f7] transition-colors truncate">
                              {itemTitle}
                            </h3>
                            <div className="flex items-center justify-between text-xs text-[#c3c6d3]">
                              <span>
                                Ep {h.episode_number}{minutesLeft > 0 ? ` · ${minutesLeft}m left` : ""}
                              </span>
                              {progressPct > 0 && (
                                <span className="font-semibold text-[#7aa2f7]">
                                  {progressPct}%
                                </span>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 2. RECENT RELEASES / LATEST UPDATES RAIL (16:9 Landscape cards) */}
              {recentReleases.length > 0 && (
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-6 rounded-full bg-[#f6bc6a]" />
                        <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3]">
                          Recent Releases
                        </h2>
                        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#794e00] text-[#fec370] uppercase">
                          ONGOING
                        </span>
                      </div>
                      <span className="text-xs text-[#c3c6d3]">
                        Recent releases listed in the loaded catalog
                      </span>
                    </div>
                    <button
                      onClick={() =>
                        navigateToBrowse({
                          sort: "recent",
                          season: "",
                          year: undefined,
                          genre: "",
                          format: "",
                          query: "",
                        })
                      }
                      className="text-xs font-bold text-[#7aa2f7] hover:underline flex items-center gap-1"
                    >
                      <span>{t.navBrowse}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px]">
                    {recentReleases.slice(0, 8).map((rel) => {
                      const anime = rel.media;
                      const itemTitle =
                        lang === "en" && anime.title_english
                          ? anime.title_english
                          : anime.title_romaji;
                      const thumb =
                        anime.banner_image ||
                        anime.cover_image_extra_large ||
                        anime.cover_image_large;
                      const airedText = formatAiredTime(rel.airing_at);

                      return (
                        <article
                          key={rel.airing_id}
                          onClick={() => handlePlayAnime(anime)}
                          className="group relative rounded-xl overflow-hidden bg-[#1a1f2c] flex flex-col cursor-pointer transition-transform duration-200 hover:-translate-y-1 border border-white/5"
                        >
                          <div className="relative w-full aspect-video bg-[#303542] overflow-hidden">
                            <img
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              src={thumb}
                              alt={itemTitle}
                            />
                            {/* Airing Episode Tag */}
                            <div className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-[#7aa2f7] text-[#002e6b] text-[11px] font-extrabold uppercase shadow-sm">
                              EP {rel.episode}
                            </div>
                            <div className="absolute top-2.5 right-2.5 glass px-2.5 py-0.5 rounded-full text-[10px] font-bold text-[#f6bc6a]">
                              {airedText}
                            </div>
                            {/* Hover Play Button */}
                            <div className="absolute inset-0 bg-[#0e131f]/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <div className="w-12 h-12 rounded-full bg-[#7aa2f7] text-[#002e6b] flex items-center justify-center shadow-lg shadow-[#7aa2f7]/40 scale-90 group-hover:scale-100 transition-transform">
                                <Play className="w-5 h-5 fill-[#002e6b] ml-0.5" />
                              </div>
                            </div>
                            <div className="absolute bottom-2.5 left-2.5 text-[10px] font-bold px-2 py-0.5 rounded bg-black/70 text-[#dee2f3]">
                              1080P · SUB DUB
                            </div>
                          </div>
                          <div className="p-4 flex flex-col gap-1">
                            <h3 className="text-sm font-bold text-[#dee2f3] group-hover:text-[#7aa2f7] transition-colors truncate">
                              {itemTitle}
                            </h3>
                            <div className="flex items-center justify-between text-xs text-[#c3c6d3]">
                              <span>{anime.format || "TV"} · Episode {rel.episode}</span>
                              <span className="text-[#f6bc6a] font-medium">Aired {airedText}</span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 3. TRENDING CATALOG RAIL (2:3 Portrait Cards) */}
              {trending.length > 0 && (
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-6 rounded-full bg-[#f6bc6a]" />
                        <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3]">
                          {t.trendingNow}
                        </h2>
                      </div>
                      <span className="text-xs text-[#c3c6d3]">
                        Global popularity index updated continuously
                      </span>
                    </div>
                    <button
                      onClick={() =>
                        navigateToBrowse({
                          sort: "trending",
                          season: "",
                          year: undefined,
                          genre: "",
                          format: "",
                          query: "",
                        })
                      }
                      className="text-xs font-bold text-[#7aa2f7] hover:underline flex items-center gap-1"
                    >
                      <span>{t.navBrowse}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 md:gap-4">
                    {trending.slice(1, 13).map((anime) => (
                      <AnimeCard
                        key={anime.anilist_id}
                        anime={anime}
                        onSelect={handleSelectAnime}
                        lang={lang}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section id="release-schedule" className="weekly-schedule">
                <div className="schedule-heading">
                  <div>
                    <p className="schedule-eyebrow">Coming up</p>
                    <h2>Weekly release schedule</h2>
                    <p className="schedule-description">
                      Upcoming airings among titles in the loaded catalog. Times are shown in your local timezone.
                    </p>
                  </div>
                  {nextAiringCountdown && (
                    <div className="schedule-countdown" aria-live="polite">
                      <span className="schedule-live-dot" aria-hidden="true" />
                      <span>Next listed airing in <strong>{nextAiringCountdown}</strong></span>
                    </div>
                  )}
                </div>

                <div id="broadcast-calendar" className="schedule-calendar">
                  <div className="schedule-day-list" aria-label="Choose a schedule date" role="tablist">
                    {scheduleDays.map((day) => (
                      <button
                        key={day.key}
                        id={`schedule-day-${day.key}`}
                        type="button"
                        role="tab"
                        aria-selected={visibleScheduleDay === day.key}
                        aria-controls="schedule-airings"
                        className={`schedule-day${visibleScheduleDay === day.key ? " is-selected" : ""}`}
                        onClick={() => setSelectedDay(day.key)}
                      >
                        {day.isToday && <span className="schedule-today">Today</span>}
                        <span>{day.label}</span>
                      </button>
                    ))}
                  </div>

                  <div id="schedule-airings" className="schedule-airings" role="tabpanel" aria-labelledby={`schedule-day-${visibleScheduleDay}`}>
                    {scheduleItems.length > 0 ? (
                      <div className="schedule-card-grid">
                        {scheduleItems.map((item) => {
                          const itemTitle = lang === "en" && item.title_english
                            ? item.title_english
                            : item.title_romaji;
                          const airingAt = item.next_airing!.airingAt * 1000;
                          const timeLabel = new Intl.DateTimeFormat(lang, {
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(airingAt));
                          const badgeLabel = item.next_airing?.episode
                            ? `Episode ${item.next_airing.episode}`
                            : item.format || "Anime";

                          return (
                            <button
                              key={item.anilist_id}
                              type="button"
                              className="schedule-card"
                              onClick={() => handleSelectAnime(item)}
                              aria-label={`View ${itemTitle}, airing at ${timeLabel}`}
                            >
                              <span className="schedule-card-image">
                                <img
                                  src={item.banner_image || item.cover_image_extra_large || item.cover_image_large}
                                  alt=""
                                  loading="lazy"
                                />
                                <span className="schedule-card-time">{timeLabel}</span>
                                <span className="schedule-card-episode">{badgeLabel}</span>
                              </span>
                              <span className="schedule-card-copy">
                                <strong>{itemTitle}</strong>
                                <span>{item.genres?.slice(0, 2).join(" · ") || item.studios?.[0] || "Release details"}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="schedule-empty-state">
                        <strong>No listed airings for this day</strong>
                        <span>There are no matching future airing times in the titles currently loaded in the catalog.</span>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* 4. ALL-TIME POPULAR SECTION (2:3 Portrait Cards) */}
              {popular.length > 0 && (
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-6 rounded-full bg-[#7aa2f7]" />
                      <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3]">
                        {t.topPopular}
                      </h2>
                    </div>
                    <button
                      onClick={() =>
                        navigateToBrowse({
                          sort: "popular",
                          season: "",
                          year: undefined,
                          genre: "",
                          format: "",
                          query: "",
                        })
                      }
                      className="text-xs font-bold text-[#7aa2f7] hover:underline flex items-center gap-1"
                    >
                      <span>View all</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 md:gap-4">
                    {popular.slice(0, 12).map((anime) => (
                      <AnimeCard
                        key={anime.anilist_id}
                        anime={anime}
                        onSelect={handleSelectAnime}
                        lang={lang}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* 5. CURRENT SEASON SECTION (2:3 Portrait Cards) */}
              {seasonal.length > 0 && (
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-6 rounded-full bg-[#aec6ff]" />
                      <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3]">
                        {t.seasonalAnime}
                      </h2>
                    </div>
                    <button
                      onClick={() =>
                        navigateToBrowse({
                          sort: "seasonal",
                          season: currentSeasonYear.season,
                          year: currentSeasonYear.year,
                          genre: "",
                          format: "",
                          query: "",
                        })
                      }
                      className="text-xs font-bold text-[#7aa2f7] hover:underline flex items-center gap-1"
                    >
                      <span>View all</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 md:gap-4">
                    {seasonal.slice(0, 12).map((anime) => (
                      <AnimeCard
                        key={anime.anilist_id}
                        anime={anime}
                        onSelect={handleSelectAnime}
                        lang={lang}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* 6. UPCOMING SEASONS & PREMIERES (AniList Live Data) */}
              {upcoming.length > 0 && (
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-6 rounded-full bg-[#f1c040]" />
                      <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3]">
                        Upcoming Seasons &amp; Premieres
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          navigateToBrowse({
                            status: "NOT_YET_RELEASED",
                            sort: "popular",
                            season: "",
                            year: undefined,
                            genre: "",
                            format: "",
                            query: "",
                          })
                        }
                        className="text-xs font-bold text-[#7aa2f7] hover:underline flex items-center gap-1 mr-2"
                      >
                        <span>View all</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          const allSubbed: Record<number, boolean> = {};
                          upcoming.forEach((u) => {
                            allSubbed[u.anilist_id] = true;
                          });
                          setSubscribedUpcoming(allSubbed);
                        }}
                        aria-label="Remind all upcoming"
                        className="h-9 px-4 rounded-full bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] text-xs font-bold uppercase flex items-center gap-1.5 transition-colors border border-white/5"
                        type="button"
                      >
                        <Bell className="w-3.5 h-3.5 text-[#f6bc6a]" />
                        <span>Season Notify</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px]">
                    {upcoming.slice(0, 8).map((up) => {
                      const itemTitle =
                        lang === "en" && up.title_english
                          ? up.title_english
                          : up.title_romaji;
                      const thumb =
                        up.banner_image ||
                        up.cover_image_extra_large ||
                        up.cover_image_large;
                      const dateLabel = formatReleaseDate(up);
                      const studio = up.studios?.[0] || "Animation Studio";
                      const genres =
                        up.genres && up.genres.length > 0
                          ? up.genres.slice(0, 2).join(" / ")
                          : "Anime";
                      const meta = `${studio} · ${genres}`;
                      const countdownLabel = up.next_airing?.timeUntilAiring
                        ? `${Math.ceil(up.next_airing.timeUntilAiring / 86400)} days left`
                        : up.status === "NOT_YET_RELEASED"
                        ? "Coming Soon"
                        : "Announced";

                      return (
                        <article
                          key={up.anilist_id}
                          onClick={() => handleSelectAnime(up)}
                          className="group relative rounded-xl overflow-hidden bg-[#1a1f2c] flex flex-col transition-all duration-200 hover:-translate-y-1 border border-white/5 cursor-pointer"
                        >
                          <div className="relative w-full aspect-video bg-[#303542] overflow-hidden">
                            <img
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              src={thumb}
                              alt={itemTitle}
                            />
                            <div className="absolute top-2.5 left-2.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#794e00] text-[#fec370] uppercase tracking-wider">
                              {dateLabel}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleUpcomingNotify(up.anilist_id);
                              }}
                              aria-label="Set reminder"
                              className={`absolute top-2.5 right-2.5 w-8 h-8 rounded-full glass flex items-center justify-center transition-colors ${
                                subscribedUpcoming[up.anilist_id]
                                  ? "text-[#f6bc6a] bg-[#794e00]/60"
                                  : "text-[#dee2f3] hover:text-[#f6bc6a]"
                              }`}
                              type="button"
                            >
                              <Bell
                                className={`w-4 h-4 ${
                                  subscribedUpcoming[up.anilist_id] ? "fill-[#f6bc6a]" : ""
                                }`}
                              />
                            </button>
                          </div>
                          <div className="p-4 flex flex-col gap-1">
                            <h3 className="text-sm font-bold text-[#dee2f3] group-hover:text-[#7aa2f7] transition-colors truncate">
                              {itemTitle}
                            </h3>
                            <div className="flex items-center justify-between text-xs text-[#c3c6d3]">
                              <span className="truncate mr-2">{meta}</span>
                              <span className="text-[#f6bc6a] font-medium whitespace-nowrap">
                                {countdownLabel}
                              </span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {/* Full-Page Anime Details View */}
        {activeTab === "details" && !playingEpisode && (
          selectedAnime ? (
            <AnimeDetailsView
              anime={selectedAnime}
              onPlayEpisode={handlePlayEpisode}
              onNavigateBrowse={(genre) => {
                navigateToBrowse({ genre, sort: "popular" });
              }}
              onSelectAnime={handleSelectAnime}
              onBack={() => {
                setActiveTab("home");
                window.location.hash = "#/home";
              }}
              lang={lang}
              t={t}
              recentHistory={recentHistory}
              allAnimePool={[...trending, ...popular, ...seasonal, ...upcoming]}
            />
          ) : (
            <div className="w-full h-[600px] flex flex-col items-center justify-center space-y-4">
              <div className="w-10 h-10 border-3 border-[#7aa2f7] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-[#c3c6d3] tracking-widest uppercase font-bold">
                Loading anime details...
              </p>
            </div>
          )
        )}

        {/* Browse Catalog View */}
        {activeTab === "browse" && (
          <div className="w-full max-w-[1440px] mx-auto px-4 md:px-8 lg:px-14 py-8">
            <BrowseView
              initialQuery={searchQuery}
              initialGenre={selectedGenre}
              initialSort={browseSort}
              initialSeason={browseSeason}
              initialYear={browseYear}
              initialFormat={browseFormat}
              initialStatus={browseStatus}
              onSelectAnime={handleSelectAnime}
              lang={lang}
              t={t}
              onFilterChange={(filters) => {
                if (filters.sort !== undefined) setBrowseSort(filters.sort);
                if (filters.season !== undefined) setBrowseSeason(filters.season);
                if (filters.year !== undefined) setBrowseYear(filters.year);
                if (filters.genre !== undefined) setSelectedGenre(filters.genre);
                if (filters.format !== undefined) setBrowseFormat(filters.format);
                if (filters.status !== undefined) setBrowseStatus(filters.status);
                if (filters.query !== undefined) setSearchQuery(filters.query);
              }}
            />
          </div>
        )}

        {/* Watchlist / History View */}
        {activeTab === "watchlist" && (
          <div className="w-full max-w-[1440px] mx-auto px-4 md:px-8 lg:px-14 py-8">
            <WatchlistView
              onSelectAnime={handleSelectAnime}
              lang={lang}
              t={t}
            />
          </div>
        )}

        {/* Settings View */}
        {activeTab === "settings" && (
          <div className="w-full max-w-[1440px] mx-auto px-4 md:px-8 lg:px-14 py-8">
            <SettingsView lang={lang} setLang={setLang} t={t} />
          </div>
        )}
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-brand-row">
            <div className="site-footer-brand">
              <div className="brand-mark footer-brand-mark" aria-hidden="true">
                <Play className="h-4 w-4 fill-current" />
              </div>
              <span>Aninyom</span>
            </div>
            <p className="site-footer-note">Release times and availability can vary by title and source.</p>
          </div>

          <nav className="site-footer-links" aria-label="Footer information">
            <button type="button" onClick={() => navigateHomeToSection("release-schedule")}>Release Schedule</button>
            <button type="button" onClick={() => navigateHomeToSection("broadcast-calendar")}>Broadcast Calendar</button>
            <button type="button" onClick={() => setFooterInfoPage("audio")}>Audio Calibration</button>
            <button type="button" onClick={() => setFooterInfoPage("content")}>Content Guidelines</button>
            <button type="button" onClick={() => setFooterInfoPage("legal")}>Legal &amp; DMCA</button>
          </nav>

          <div className="site-footer-legal">
            <p>© {COPYRIGHT_YEAR} Aninyom. Catalog details and artwork are provided by external sources.</p>
            <p>Anime availability, release times, and playback options may change.</p>
          </div>
        </div>
      </footer>

      {footerInfoPage && <FooterInfoDialog page={footerInfoPage} onClose={closeFooterInfo} />}

      {/* Media Player Overlay */}
      {playingEpisode && (
        <MediaPlayer
          anime={playingEpisode.anime}
          episodeNumber={playingEpisode.episodeNumber}
          episodeId={playingEpisode.episodeId}
          episodesList={playingEpisode.episodesList}
          onClose={handleClosePlayer}
          onSelectEpisode={(epNum, epId) => {
            setPlayingEpisode((prev) => {
              if (!prev) return null;
              const updated = { ...prev, episodeNumber: epNum, episodeId: epId };
              try {
                sessionStorage.setItem("aninyom_active_player", JSON.stringify(updated));
              } catch {}
              return updated;
            });
          }}
          lang={lang}
          t={t}
        />
      )}
    </div>
  );
};

export default App;
