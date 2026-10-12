import React, { useEffect, useState, useMemo } from "react";
import {
  Play,
  Bookmark,
  Check,
  Share2,
  Film,
  Star,
  ArrowUpDown,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Tv,
  Headphones,
  Subtitles,
  Monitor,
  X,
  Plus,
  RotateCcw,
  Sparkles,
  GitBranch,
} from "lucide-react";
import { AnimeItem, Episode, WatchHistoryItem } from "../types";
import { TranslationSchema } from "../i18n";
import { api } from "../api";

interface AnimeDetailsViewProps {
  anime: AnimeItem;
  onPlayEpisode: (anime: AnimeItem, epNum: number, epId: string, episodes: Episode[]) => void;
  onNavigateBrowse: (genre?: string) => void;
  onSelectAnime: (anime: AnimeItem) => void;
  onBack: () => void;
  lang: "en" | "id";
  t: TranslationSchema;
  recentHistory?: WatchHistoryItem[];
  allAnimePool?: AnimeItem[];
}

export const AnimeDetailsView: React.FC<AnimeDetailsViewProps> = ({
  anime,
  onPlayEpisode,
  onNavigateBrowse,
  onSelectAnime,
  lang,
  t,
  recentHistory = [],
  allAnimePool = [],
}) => {
  const [currentAnime, setCurrentAnime] = useState<AnimeItem>(anime);
  const [fullDetails, setFullDetails] = useState<AnimeItem | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(true);
  const [bookmarkStatus, setBookmarkStatus] = useState<string | null>(null);
  const [showBookmarkMenu, setShowBookmarkMenu] = useState(false);
  const [showTrailerModal, setShowTrailerModal] = useState(false);
  const [sortAscending, setSortAscending] = useState(true);
  const [visibleEpisodesCount, setVisibleEpisodesCount] = useState(12);
  const [showFullSynopsis, setShowFullSynopsis] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false);
  const seasonDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        seasonDropdownRef.current &&
        !seasonDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSeasonDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setCurrentAnime(anime);
    setVisibleEpisodesCount(12);
    setShowSeasonDropdown(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [anime.anilist_id]);

  const displayTitle =
    lang === "en" && currentAnime.title_english
      ? currentAnime.title_english
      : currentAnime.title_romaji;

  const score = currentAnime.average_score
    ? (currentAnime.average_score / 10).toFixed(1)
    : null;

  const banner =
    currentAnime.banner_image ||
    currentAnime.cover_image_extra_large ||
    currentAnime.cover_image_large;

  const poster =
    currentAnime.cover_image_extra_large || currentAnime.cover_image_large;

  // 1. Fetch Full Details & Episodes & Bookmarks
  useEffect(() => {
    let isMounted = true;
    setLoadingEpisodes(true);

    api.getAnimeDetails(currentAnime.anilist_id)
      .then((det) => {
        if (!isMounted) return;
        setFullDetails(det);
      })
      .catch((err) => {
        console.error("Failed fetching anime details:", err);
      });

    api.getAnimeEpisodes(currentAnime.anilist_id, currentAnime.title_romaji)
      .then((res) => {
        if (!isMounted) return;
        setEpisodes(res.episodes || []);
      })
      .catch((err) => {
        console.error("Failed fetching episodes:", err);
      })
      .finally(() => {
        if (isMounted) setLoadingEpisodes(false);
      });

    api.getBookmarks()
      .then((bks) => {
        if (!isMounted) return;
        const found = bks.find((b) => b.anilist_id === currentAnime.anilist_id);
        if (found) setBookmarkStatus(found.status);
        else setBookmarkStatus(null);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [currentAnime.anilist_id]);

  // Find user watch history for this specific anime
  const animeHistory = useMemo(() => {
    return recentHistory.filter((h) => h.anilist_id === currentAnime.anilist_id);
  }, [recentHistory, currentAnime.anilist_id]);

  const latestHistory = animeHistory.length > 0 ? animeHistory[0] : null;

  const watchedEpisodesMap = useMemo(() => {
    const map = new Map<number, WatchHistoryItem>();
    animeHistory.forEach((h) => {
      map.set(h.episode_number, h);
    });
    return map;
  }, [animeHistory]);

  const watchedCount = watchedEpisodesMap.size;

  // Sort episodes
  const sortedEpisodes = useMemo(() => {
    const sorted = [...episodes];
    sorted.sort((a, b) =>
      sortAscending
        ? a.episode_number - b.episode_number
        : b.episode_number - a.episode_number
    );
    return sorted;
  }, [episodes, sortAscending]);

  // Franchise relations
  const relations = fullDetails?.relations || currentAnime.relations || [];
  const relatedSeasons = useMemo(() => {
    return relations.filter((r) => r.node && r.node.id && r.node.id !== currentAnime.anilist_id);
  }, [relations, currentAnime.anilist_id]);

  // Real "More Like This" Recommendations from catalog pool
  const recommendations = useMemo(() => {
    const currentGenres = currentAnime.genres || [];
    return allAnimePool
      .filter((a) => a.anilist_id !== currentAnime.anilist_id)
      .map((a) => {
        const overlap = (a.genres || []).filter((g) => currentGenres.includes(g)).length;
        return { anime: a, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3)
      .map((item) => item.anime);
  }, [allAnimePool, currentAnime]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast("Direct link copied to clipboard!");
  };

  const handleSetBookmark = (status: string) => {
    api.setBookmark({
      anime_id: currentAnime.anilist_id,
      status,
      title_romaji: currentAnime.title_romaji,
      title_english: currentAnime.title_english,
      cover_image: currentAnime.cover_image_large,
      score: currentAnime.average_score,
    })
      .then(() => {
        setBookmarkStatus(status);
        setShowBookmarkMenu(false);
        showToast(`Saved as ${status.replace(/_/g, " ").toUpperCase()}!`);
      })
      .catch(console.error);
  };

  const handleRemoveBookmark = () => {
    api.removeBookmark(currentAnime.anilist_id)
      .then(() => {
        setBookmarkStatus(null);
        setShowBookmarkMenu(false);
        showToast("Removed from watchlist.");
      })
      .catch(console.error);
  };

  const handleSwitchAnime = (relatedId: number) => {
    api.getAnimeDetails(relatedId)
      .then((newAnime) => {
        onSelectAnime(newAnime);
      })
      .catch(console.error);
  };

  const handlePrimaryWatch = () => {
    if (episodes.length === 0) return;
    if (latestHistory) {
      const targetEp =
        episodes.find((e) => e.episode_number === latestHistory.episode_number) ||
        episodes[0];
      onPlayEpisode(currentAnime, targetEp.episode_number, targetEp.episode_id, episodes);
    } else {
      onPlayEpisode(currentAnime, episodes[0].episode_number, episodes[0].episode_id, episodes);
    }
  };

  const primaryGenre = currentAnime.genres?.[0] || "Anime";
  const rawSynopsis = (
    currentAnime.synopsis_en ||
    currentAnime.synopsis_id ||
    "No detailed synopsis available for this title."
  ).replace(/<[^>]*>?/gm, "");

  // Derived Season Options for the Netflix-style Season Dropdown
  const seasonOptions = useMemo(() => {
    const prequels: typeof relations = [];
    const sequels: typeof relations = [];
    const others: typeof relations = [];

    relations.forEach((rel) => {
      if (!rel.node || !rel.node.id || rel.node.id === currentAnime.anilist_id) return;
      if (rel.relationType === "PREQUEL") prequels.push(rel);
      else if (rel.relationType === "SEQUEL") sequels.push(rel);
      else if (["SIDE_STORY", "PARENT", "ALTERNATIVE"].includes(rel.relationType)) {
        others.push(rel);
      }
    });

    const titleMatch = currentAnime.title_romaji.match(
      /(?:Season|S)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+Season/i
    );
    let curSeasonNum = 1;
    if (titleMatch) {
      curSeasonNum = parseInt(titleMatch[1] || titleMatch[2], 10);
    } else if (prequels.length > 0) {
      curSeasonNum = prequels.length + 1;
    }

    const list: Array<{
      id: number;
      label: string;
      seasonNumber: number;
      isCurrent: boolean;
      format?: string;
      title: string;
    }> = [];

    // Add prequels
    prequels.forEach((rel, idx) => {
      const sNum = Math.max(1, curSeasonNum - prequels.length + idx);
      const nodeTitle =
        lang === "en" && rel.node.title?.english
          ? rel.node.title.english
          : rel.node.title?.romaji || `Season ${sNum}`;
      list.push({
        id: rel.node.id,
        label: `Season ${sNum}`,
        seasonNumber: sNum,
        isCurrent: false,
        format: rel.node.format,
        title: nodeTitle,
      });
    });

    // Add current anime
    list.push({
      id: currentAnime.anilist_id,
      label: `Season ${curSeasonNum}`,
      seasonNumber: curSeasonNum,
      isCurrent: true,
      format: currentAnime.format,
      title: displayTitle,
    });

    // Add sequels
    sequels.forEach((rel, idx) => {
      const sNum = curSeasonNum + 1 + idx;
      const nodeTitle =
        lang === "en" && rel.node.title?.english
          ? rel.node.title.english
          : rel.node.title?.romaji || `Season ${sNum}`;
      list.push({
        id: rel.node.id,
        label: `Season ${sNum}`,
        seasonNumber: sNum,
        isCurrent: false,
        format: rel.node.format,
        title: nodeTitle,
      });
    });

    // Add other franchise items
    others.forEach((rel) => {
      const nodeTitle =
        lang === "en" && rel.node.title?.english
          ? rel.node.title.english
          : rel.node.title?.romaji || "Related";
      list.push({
        id: rel.node.id,
        label: rel.relationType.replace(/_/g, " "),
        seasonNumber: 99,
        isCurrent: false,
        format: rel.node.format,
        title: nodeTitle,
      });
    });

    return list;
  }, [relations, currentAnime, lang, displayTitle]);

  const currentSeasonOption = useMemo(() => {
    return (
      seasonOptions.find((s) => s.isCurrent) || {
        id: currentAnime.anilist_id,
        label: "Season 1",
        seasonNumber: 1,
        isCurrent: true,
        title: displayTitle,
      }
    );
  }, [seasonOptions, currentAnime.anilist_id, displayTitle]);

  const ratingBadge = useMemo(() => {
    const genres = currentAnime.genres || [];
    if (genres.some((g) => ["Horror", "Ecchi", "Psychological", "Hentai"].includes(g)))
      return "TV-MA";
    if (genres.some((g) => ["Action", "Supernatural", "Thriller", "Sci-Fi", "Drama"].includes(g)))
      return "TV-14";
    if (genres.some((g) => ["Kids", "Comedy", "Slice of Life"].includes(g)))
      return "TV-PG";
    return currentAnime.format === "MOVIE" ? "PG-13" : "TV-14";
  }, [currentAnime]);

  const durationText = currentAnime.duration_per_ep
    ? `${currentAnime.duration_per_ep}m`
    : "24m";

  const formatEpisodeTitle = (ep: Episode) => {
    if (!ep.title) return `Episode ${ep.episode_number}`;
    const trimmed = ep.title.trim();
    if (/^(?:Episode|Ep\.?|EP)?\s*\d+$/i.test(trimmed)) {
      return `Episode ${ep.episode_number}`;
    }
    const cleaned = trimmed
      .replace(/^(?:Episode|Ep\.?|EP)?\s*\d+\s*[:\-–—\.]\s*/i, "")
      .trim();
    if (cleaned.length > 0) {
      return cleaned;
    }
    return `Episode ${ep.episode_number}`;
  };

  const getEpisodeDescription = (epNumber: number, synopsis: string) => {
    if (!synopsis) {
      return `Watch Episode ${epNumber} in high definition with original Japanese audio and multi-language subtitles.`;
    }
    const clean = synopsis.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim();
    const sentences = clean.split(/(?<=[.?!])\s+/).filter((s) => s.length > 20);
    if (sentences.length > 0) {
      const idx = (epNumber - 1) % sentences.length;
      const desc = sentences[idx];
      if (desc && desc.length > 30) {
        return desc;
      }
    }
    return clean.slice(0, 160) + (clean.length > 160 ? "..." : "");
  };

  const studioName = currentAnime.studios?.[0] || "Animation Studio";
  const releaseYear =
    currentAnime.season_year ||
    currentAnime.start_date?.year ||
    (currentAnime.season ? currentAnime.season : "N/A");

  return (
    <div className="flex flex-col w-full pb-20">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-2xl glass bg-[#1a1f2c]/90 text-[#dee2f3] text-sm font-semibold shadow-2xl border border-white/10 animate-fade-in flex items-center gap-2">
          <Check className="w-4 h-4 text-[#7aa2f7]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* YouTube Trailer Modal */}
      {showTrailerModal && currentAnime.trailer?.id && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/10">
            <button
              onClick={() => setShowTrailerModal(false)}
              className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <iframe
              title="Official Trailer"
              src={`https://www.youtube.com/embed/${currentAnime.trailer.id}?autoplay=1`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* Top Hero Backdrop & Key Metadata Showcase (Bleeds under shell header) */}
      <section className="relative w-full -mt-20 overflow-hidden bg-[var(--bg)]">
        {/* Atmospheric Ambient Visual Backdrop */}
        <div
          className="absolute inset-0 w-full h-[640px] md:h-[720px] bg-cover bg-center pointer-events-none filter brightness-95"
          style={{ backgroundImage: `url('${banner}')` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/75 to-[var(--bg)]/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg)] via-[var(--bg)]/85 to-transparent" />
        </div>

        {/* Hero Content Container */}
        <div className="relative w-full max-w-[1800px] mx-auto px-4 md:px-8 lg:px-14 pt-28 md:pt-32 pb-10">
          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-2 text-gray-500 dark:text-[#9aa6bf] text-xs font-semibold mb-6 flex-wrap">
            <button
              onClick={() => onNavigateBrowse()}
              className="hover:text-blue-600 dark:hover:text-[#7aa2f7] transition-colors"
            >
              Catalog
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-[#434751]" />
            <button
              onClick={() => onNavigateBrowse(primaryGenre)}
              className="hover:text-blue-600 dark:hover:text-[#7aa2f7] transition-colors"
            >
              {primaryGenre}
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-[#434751]" />
            <span className="text-blue-600 dark:text-[#aec6ff] font-bold truncate max-w-xs md:max-w-md">
              {displayTitle}
            </span>
          </div>

          {/* Main Showcase Grid: Poster + Data Panel */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-10 items-start">
            {/* Left 2:3 Poster Frame Card */}
            <div className="md:col-span-4 lg:col-span-3 flex flex-col gap-4">
              <div className="relative w-full aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl bg-[#1a1f2c] group border border-white/10">
                <img
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  src={poster}
                  alt={displayTitle}
                />
                {/* Status Badge Overlay */}
                <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-[#f6bc6a] text-[#452b00] shadow-md uppercase tracking-wider">
                    {currentAnime.status ? currentAnime.status.replace(/_/g, " ") : "ONGOING"}
                  </span>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#303542]/90 text-[#dee2f3] backdrop-blur-md shadow-md uppercase">
                    {currentAnime.format || "TV"} • SUB / DUB
                  </span>
                </div>
                {score && (
                  <div className="absolute bottom-3 right-3 flex items-center gap-1 px-3 py-1 rounded-full bg-black/80 backdrop-blur-md text-[#f6bc6a]">
                    <Star className="w-3.5 h-3.5 fill-[#f6bc6a]" />
                    <span className="text-xs font-extrabold text-white">{score} / 10</span>
                  </div>
                )}
              </div>

              {/* Quick Audio & Video Specification Pills */}
              <div className="p-4 rounded-xl bg-[#161b28] shadow-sm flex flex-col gap-2.5 border border-white/5">
                <div className="flex items-center justify-between text-[#c3c6d3] text-xs">
                  <span className="flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5 text-[#7aa2f7]" /> Format
                  </span>
                  <span className="font-bold text-[#dee2f3]">1080p FHD 60FPS</span>
                </div>
                <div className="flex items-center justify-between text-[#c3c6d3] text-xs">
                  <span className="flex items-center gap-1.5">
                    <Headphones className="w-3.5 h-3.5 text-[#7aa2f7]" /> Audio
                  </span>
                  <span className="font-bold text-[#dee2f3]">Dolby Atmos / Stereo</span>
                </div>
                <div className="flex items-center justify-between text-[#c3c6d3] text-xs">
                  <span className="flex items-center gap-1.5">
                    <Subtitles className="w-3.5 h-3.5 text-[#7aa2f7]" /> Subtitles
                  </span>
                  <span className="font-bold text-[#dee2f3]">EN, ID, JP, Softsubs</span>
                </div>
              </div>
            </div>

            {/* Right Side: Extensive Metadata & Call to Actions */}
            <div className="md:col-span-8 lg:col-span-9 flex flex-col justify-start">
              {/* Japanese Kanji & Romaji Overline */}
              <div className="flex flex-wrap items-baseline gap-2 mb-1">
                {currentAnime.title_native && (
                  <span className="text-base font-bold text-amber-600 dark:text-[#f6bc6a] tracking-widest">
                    {currentAnime.title_native}
                  </span>
                )}
                <span className="text-xs font-semibold text-gray-500 dark:text-[#8d909d] tracking-wider uppercase">
                  {currentAnime.title_romaji} • {currentAnime.format || "TV Series"}
                </span>
              </div>

              {/* Primary Anime Display Title */}
              <h1 className="text-2xl md:text-4xl lg:text-5xl font-extrabold text-[#dee2f3] tracking-tight mb-3">
                {displayTitle}
              </h1>

              {/* Technical Metadata Strip */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#c3c6d3] text-xs md:text-sm mb-4">
                <span className="text-[#dee2f3] font-bold">{studioName}</span>
                <span className="text-[#434751]">•</span>
                <span>{releaseYear}</span>
                <span className="text-[#434751]">•</span>
                <span>
                  {currentAnime.episodes_count ? `${currentAnime.episodes_count} Episodes` : "Broadcast"}
                </span>
                <span className="text-[#434751]">•</span>
                <span>1080p FHD</span>
                {score && (
                  <>
                    <span className="text-[#434751]">•</span>
                    <div className="inline-flex items-center gap-1 text-[#f6bc6a] font-bold">
                      <Star className="w-4 h-4 fill-[#f6bc6a]" />
                      <span>{score}</span>
                      <span className="text-[10px] font-bold text-[#dee2f3] bg-[#252a37] px-2 py-0.5 rounded-full ml-1">
                        {parseFloat(score) >= 8.0 ? "#1 Top Rated" : "Popular"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Genre Filter Pills */}
              {currentAnime.genres && currentAnime.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-6">
                  {currentAnime.genres.map((g) => (
                    <button
                      key={g}
                      onClick={() => onNavigateBrowse(g)}
                      className="text-xs font-bold px-3.5 py-1 rounded-full bg-[#1a1f2c] text-[#dee2f3] hover:bg-[#252a37] hover:text-[#7aa2f7] transition-colors border border-white/5"
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}

              {/* Narrative Synopsis */}
              <div className="relative mb-6 max-w-3xl">
                <p
                  className={`text-sm md:text-base text-[#dee2f3] leading-relaxed ${
                    showFullSynopsis ? "" : "line-clamp-3 md:line-clamp-4"
                  }`}
                >
                  {rawSynopsis}
                </p>
                {rawSynopsis.length > 250 && (
                  <button
                    onClick={() => setShowFullSynopsis(!showFullSynopsis)}
                    className="text-xs font-bold text-[#7aa2f7] hover:underline mt-1 inline-block"
                  >
                    {showFullSynopsis ? "Show less" : "Read more"}
                  </button>
                )}
              </div>

              {/* Primary Quick Action Buttons Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-8">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Play / Resume Primary Action */}
                  <button
                    onClick={handlePrimaryWatch}
                    disabled={loadingEpisodes || episodes.length === 0}
                    className="h-11 px-6 rounded-full bg-[#7aa2f7] text-[#002e6b] font-bold text-sm flex items-center gap-2 hover:brightness-110 shadow-lg shadow-[#7aa2f7]/25 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
                    type="button"
                  >
                    <Play className="w-4 h-4 fill-[#002e6b]" />
                    <span>
                      {latestHistory
                        ? `Resume (Ep ${latestHistory.episode_number})`
                        : episodes.length > 0
                        ? "Watch Episode 1"
                        : "Loading Episodes..."}
                    </span>
                  </button>

                  {/* Add to Watchlist */}
                  <div className="relative">
                    <button
                      onClick={() => setShowBookmarkMenu(!showBookmarkMenu)}
                      className={`h-11 px-4 rounded-full font-semibold text-sm flex items-center gap-2 transition-colors border ${
                        bookmarkStatus
                          ? "bg-[#794e00] text-[#fec370] border-[#f6bc6a]/40"
                          : "bg-[#1a1f2c] text-[#dee2f3] hover:bg-[#252a37] border-white/5"
                      }`}
                      type="button"
                    >
                      <Bookmark className={`w-4 h-4 ${bookmarkStatus ? "fill-[#fec370]" : ""}`} />
                      <span>
                        {bookmarkStatus
                          ? bookmarkStatus.replace(/_/g, " ").toUpperCase()
                          : "Watchlist"}
                      </span>
                    </button>

                    {/* Bookmark Menu Dropdown */}
                    {showBookmarkMenu && (
                      <div className="absolute top-12 left-0 w-48 rounded-2xl p-2 glass bg-[#1a1f2c]/95 shadow-2xl flex flex-col gap-1 z-30 border border-white/10">
                        {(["watching", "plan_to_watch", "completed", "favorite", "dropped"] as const).map(
                          (st) => (
                            <button
                              key={st}
                              onClick={() => handleSetBookmark(st)}
                              className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-[#dee2f3] hover:bg-white/10 text-left"
                            >
                              <span>{st.replace(/_/g, " ")}</span>
                              {bookmarkStatus === st && <Check className="w-4 h-4 text-[#7aa2f7]" />}
                            </button>
                          )
                        )}
                        {bookmarkStatus && (
                          <button
                            onClick={handleRemoveBookmark}
                            className="px-3 py-1.5 text-xs text-red-400 hover:bg-white/10 rounded-xl text-left font-medium mt-1 border-t border-white/10"
                          >
                            Remove Bookmark
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Trailer Trigger */}
                  {currentAnime.trailer?.id && (
                    <button
                      onClick={() => setShowTrailerModal(true)}
                      className="h-11 px-4 rounded-full bg-[#1a1f2c] text-[#dee2f3] hover:bg-[#252a37] font-semibold text-sm flex items-center gap-2 border border-white/5 transition-colors"
                      type="button"
                    >
                      <Film className="w-4 h-4 text-[#f6bc6a]" />
                      <span>Trailer</span>
                    </button>
                  )}

                  {/* Share Button */}
                  <button
                    onClick={handleShare}
                    aria-label="Share title"
                    className="w-11 h-11 rounded-full bg-[#1a1f2c] text-[#dee2f3] hover:bg-[#252a37] flex items-center justify-center transition-colors border border-white/5"
                    type="button"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Audio Selector Dropdown Chip */}
                <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-[#161b28] text-[#c3c6d3] text-xs font-semibold border border-white/5 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[#7aa2f7] animate-pulse" />
                  <span>Default Audio:</span>
                  <span className="text-[#dee2f3] font-bold">Japanese (5.1 TrueHD)</span>
                </div>
              </div>

              {/* Content Production Details Micro Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-[#161b28] max-w-3xl border border-white/5">
                <div>
                  <span className="block text-[11px] text-[#8d909d] uppercase font-bold">Studio</span>
                  <span className="font-bold text-xs text-[#dee2f3] truncate block">{studioName}</span>
                </div>
                <div>
                  <span className="block text-[11px] text-[#8d909d] uppercase font-bold">Season</span>
                  <span className="font-bold text-xs text-[#dee2f3] truncate block">
                    {currentAnime.season ? `${currentAnime.season} ${releaseYear}` : String(releaseYear)}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-[#8d909d] uppercase font-bold">Format / Duration</span>
                  <span className="font-bold text-xs text-[#dee2f3] truncate block">
                    {currentAnime.format || "TV"} ({currentAnime.duration_per_ep ? `${currentAnime.duration_per_ep}m` : "24m"})
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-[#8d909d] uppercase font-bold">Airing Status</span>
                  <span className="font-bold text-xs text-[#f6bc6a] truncate block">
                    {currentAnime.status ? currentAnime.status.replace(/_/g, " ") : "Ongoing"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Episodes Library Section (Netflix / Streaming Style) */}
      <section className="w-full max-w-[1800px] mx-auto px-4 md:px-8 lg:px-14 py-8">
        {/* Header row: "Episodes" on the left, Sort & Season selector dropdown on the right */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
          <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3] tracking-tight">
            Episodes
          </h2>

          <div className="flex items-center gap-3 self-end sm:self-auto flex-wrap">
            {watchedCount > 0 && (
              <span className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-[#8d909d]">
                <span className="w-2 h-2 rounded-full bg-[#f6bc6a]" />
                Watched: {watchedCount} of {episodes.length}
              </span>
            )}

            <button
              onClick={() => setSortAscending(!sortAscending)}
              className="px-3 py-2 rounded-lg bg-[#1a1f2c] hover:bg-[#252a37] border border-white/10 text-xs font-semibold text-[#c3c6d3] hover:text-[#dee2f3] transition-colors flex items-center gap-1.5"
              type="button"
              title="Change episode sort order"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {sortAscending ? "Oldest to Newest" : "Newest to Oldest"}
              </span>
            </button>

            {/* Season Selector Dropdown */}
            <div className="relative" ref={seasonDropdownRef}>
              <button
                onClick={() => setShowSeasonDropdown(!showSeasonDropdown)}
                className="flex items-center gap-2.5 px-4 py-2 rounded-lg bg-[#1a1f2c] hover:bg-[#252a37] border border-white/15 text-sm font-semibold text-[#dee2f3] shadow-sm transition-colors"
                type="button"
                aria-expanded={showSeasonDropdown}
                aria-haspopup="true"
              >
                <span>{currentSeasonOption.label}</span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                    showSeasonDropdown ? "rotate-180" : ""
                  }`}
                />
              </button>

              {showSeasonDropdown && (
                <div className="absolute right-0 mt-1.5 w-60 rounded-xl bg-[#1a1f2c] border border-white/15 shadow-2xl py-1.5 z-40 backdrop-blur-md animate-fade-in">
                  <div className="px-3.5 py-1.5 border-b border-white/5 text-[11px] font-bold uppercase tracking-wider text-[#8d909d]">
                    Select Season / Franchise
                  </div>
                  {seasonOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        if (!opt.isCurrent) {
                          handleSwitchAnime(opt.id);
                        }
                        setShowSeasonDropdown(false);
                      }}
                      className={`w-full px-3.5 py-2.5 text-left text-xs sm:text-sm font-medium flex items-center justify-between transition-colors ${
                        opt.isCurrent
                          ? "bg-[#252a37] text-[#dee2f3] font-semibold"
                          : "text-[#c3c6d3] hover:bg-[#252a37] hover:text-[#dee2f3]"
                      }`}
                      type="button"
                    >
                      <div className="truncate pr-2">
                        <div className="font-semibold text-[#dee2f3]">{opt.label}</div>
                        {opt.title && (
                          <div className="text-[11px] text-[#8d909d] truncate max-w-[180px]">
                            {opt.title}
                          </div>
                        )}
                      </div>
                      {opt.isCurrent && (
                        <Check className="w-4 h-4 text-[#7aa2f7] shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Subheader row: Season X: [ TV-PG ] language & subtitle metadata */}
        <div className="flex items-center gap-2 text-xs md:text-sm text-[#8d909d] mb-6 flex-wrap">
          <span className="font-semibold text-[#dee2f3]">{currentSeasonOption.label}:</span>
          <span className="border border-white/20 text-[#dee2f3] text-[11px] px-1.5 py-0.5 rounded font-medium">
            {ratingBadge}
          </span>
          <span className="text-[#c3c6d3]">
            Japanese (Original), English Subtitles
          </span>
        </div>

        {/* Episodes Rows Stack */}
        {loadingEpisodes ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-[#7aa2f7] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#c3c6d3] font-medium">Loading episodes library...</span>
          </div>
        ) : episodes.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[#161b28] text-center border border-white/5">
            <p className="text-sm text-[#c3c6d3]">{t.noEpisodesFound}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedEpisodes.slice(0, visibleEpisodesCount).map((ep, index) => {
              const hist = watchedEpisodesMap.get(ep.episode_number);
              const isWatched =
                hist &&
                hist.total_seconds > 0 &&
                hist.progress_seconds / hist.total_seconds >= 0.9;
              const isInProgress =
                hist &&
                hist.total_seconds > 0 &&
                hist.progress_seconds / hist.total_seconds < 0.9;
              const progressPct =
                hist && hist.total_seconds > 0
                  ? Math.min(100, Math.round((hist.progress_seconds / hist.total_seconds) * 100))
                  : 0;

              const isCardActive =
                isInProgress ||
                (latestHistory
                  ? latestHistory.episode_number === ep.episode_number
                  : index === 0);

              return (
                <article
                  key={ep.episode_id}
                  onClick={() => onPlayEpisode(currentAnime, ep.episode_number, ep.episode_id, episodes)}
                  className={`flex items-center gap-3 sm:gap-5 p-3 sm:p-4 rounded-xl cursor-pointer transition-all group ${
                    isCardActive
                      ? "bg-[#242731] border border-white/10 shadow-lg"
                      : "border-b border-white/5 hover:bg-[#1a1f2c]/70"
                  }`}
                >
                  {/* Far Left: Prominent Episode Number */}
                  <div
                    className={`w-6 sm:w-10 text-center text-lg sm:text-2xl font-bold shrink-0 select-none ${
                      isCardActive ? "text-[#dee2f3]" : "text-gray-400 group-hover:text-[#dee2f3]"
                    } transition-colors`}
                  >
                    {ep.episode_number}
                  </div>

                  {/* Middle-Left: 16:9 Landscape Thumbnail */}
                  <div className="relative w-32 sm:w-44 md:w-52 aspect-video shrink-0 rounded-lg overflow-hidden bg-[#090e1a] shadow-sm">
                    <img
                      src={currentAnime.banner_image || poster}
                      alt={`Episode ${ep.episode_number}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {/* Watched Checkmark Overlay */}
                    {isWatched && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-[#7aa2f7] fill-[#7aa2f7]" />
                      </div>
                    )}
                    {/* In Progress Bar & Badge */}
                    {isInProgress && (
                      <>
                        <div className="absolute inset-0 bg-black/20" />
                        <div className="absolute bottom-0 inset-x-0 h-1.5 bg-[#303542]">
                          <div
                            className="h-full bg-[#7aa2f7] rounded-r"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="absolute top-1.5 left-1.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-[#f6bc6a] text-[#452b00] shadow">
                          RESUME
                        </span>
                      </>
                    )}
                    {/* Hover Play Button */}
                    {!isWatched && !isInProgress && (
                      <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-9 h-9 rounded-full bg-black/70 border border-white/30 flex items-center justify-center backdrop-blur-xs">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Middle-Right: Title, Duration, and Synopsis */}
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <h3
                        className={`text-sm sm:text-base font-bold truncate ${
                          isCardActive ? "text-[#dee2f3]" : "text-[#dee2f3] group-hover:text-[#7aa2f7]"
                        } transition-colors`}
                      >
                        {formatEpisodeTitle(ep)}
                      </h3>
                      <span className="text-xs sm:text-sm text-[#8d909d] font-medium shrink-0">
                        {durationText}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-[#8d909d] line-clamp-2 leading-relaxed">
                      {getEpisodeDescription(ep.episode_number, rawSynopsis)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* View All Episodes Footer Action */}
        {!loadingEpisodes && episodes.length > visibleEpisodesCount && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => setVisibleEpisodesCount(episodes.length)}
              className="px-8 py-2.5 rounded-full bg-[#252a37] text-[#dee2f3] hover:bg-[#303542] text-xs font-bold flex items-center gap-2 shadow-sm transition-colors"
              type="button"
            >
              <span>Load All {episodes.length} Episodes</span>
              <ChevronRight className="w-4 h-4 rotate-90" />
            </button>
          </div>
        )}
      </section>

      {/* Seasons & Franchise Chronology Section */}
      {relatedSeasons.length > 0 && (
        <section className="w-full max-w-[1800px] mx-auto px-4 md:px-8 lg:px-14 py-8 border-t border-white/5">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-6 rounded-full bg-[#f6bc6a]" />
              <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3]">
                Seasons &amp; Franchise Chronology
              </h2>
            </div>
            <span className="text-xs text-[#c3c6d3]">Click to switch season</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
            {relatedSeasons.map((rel) => {
              const node = rel.node;
              const relTitle =
                lang === "en" && node.title?.english
                  ? node.title.english
                  : node.title?.romaji || "Related Anime";
              const cover = node.coverImage?.large || currentAnime.cover_image_large;

              return (
                <article
                  key={node.id}
                  onClick={() => handleSwitchAnime(node.id)}
                  className="group rounded-xl overflow-hidden bg-[#1a1f2c] hover:bg-[#252a37] transition-all p-2.5 flex flex-col gap-2 cursor-pointer border border-white/5 hover:-translate-y-1"
                >
                  <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#090e1a]">
                    <img
                      src={cover}
                      alt={relTitle}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#090e1a]/80 text-[#fec370] uppercase">
                      {rel.relationType.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[#dee2f3] group-hover:text-[#7aa2f7] transition-colors truncate">
                      {relTitle}
                    </h4>
                    <span className="text-[10px] text-[#8d909d] block truncate">
                      {node.format || "TV"} {node.status ? `· ${node.status.replace(/_/g, " ")}` : ""}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Related & Recommended Anime Rail */}
      {recommendations.length > 0 && (
        <section className="w-full max-w-[1800px] mx-auto px-4 md:px-8 lg:px-14 py-8 border-t border-white/5">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-[#dee2f3] tracking-tight">
                More Like This
              </h2>
              <p className="text-xs text-[#c3c6d3]">
                Titles sharing {primaryGenre} &amp; narrative themes
              </p>
            </div>
            <button
              onClick={() => onNavigateBrowse(primaryGenre)}
              className="text-xs font-bold text-[#7aa2f7] hover:underline flex items-center gap-1"
              type="button"
            >
              <span>Explore {primaryGenre} Shelf</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recommendations.map((rec) => {
              const recTitle =
                lang === "en" && rec.title_english
                  ? rec.title_english
                  : rec.title_romaji;
              const recThumb =
                rec.banner_image ||
                rec.cover_image_extra_large ||
                rec.cover_image_large;
              const recScore = rec.average_score
                ? (rec.average_score / 10).toFixed(1)
                : null;
              const recStudio = rec.studios?.[0] || "Animation Studio";

              return (
                <article
                  key={rec.anilist_id}
                  onClick={() => onSelectAnime(rec)}
                  className="p-4 rounded-xl bg-[#1a1f2c] hover:bg-[#252a37] transition-all group flex flex-col justify-between shadow-sm border border-white/5 cursor-pointer hover:-translate-y-1"
                >
                  <div>
                    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-[#090e1a] mb-3">
                      <img
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        src={recThumb}
                        alt={recTitle}
                      />
                      <div className="absolute top-2 left-2 flex gap-1">
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#090e1a]/80 text-[#dee2f3] backdrop-blur-md">
                          {rec.episodes_count ? `${rec.episodes_count} Ep` : rec.format || "TV"}
                        </span>
                      </div>
                      {recScore && (
                        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-[#090e1a]/80 backdrop-blur-md flex items-center gap-1 text-[#f6bc6a]">
                          <Star className="w-3 h-3 fill-[#f6bc6a]" />
                          <span className="text-[11px] font-bold text-[#dee2f3]">{recScore}</span>
                        </div>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-[#dee2f3] mb-1 group-hover:text-[#7aa2f7] transition-colors truncate">
                      {recTitle}
                    </h3>
                    <p className="text-xs text-[#c3c6d3] line-clamp-2 mb-3">
                      {(rec.synopsis_en || rec.synopsis_id || "").replace(/<[^>]*>?/gm, "")}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-[11px] font-semibold text-[#8d909d] truncate mr-2">
                      {recStudio} · {rec.genres?.slice(0, 2).join(" / ") || "Anime"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        api.setBookmark({
                          anime_id: rec.anilist_id,
                          status: "plan_to_watch",
                          title_romaji: rec.title_romaji,
                          title_english: rec.title_english,
                          cover_image: rec.cover_image_large,
                        }).then(() => showToast(`Added "${recTitle}" to watchlist`));
                      }}
                      aria-label="Add to watchlist"
                      className="w-8 h-8 rounded-full bg-[#252a37] text-[#dee2f3] hover:bg-[#7aa2f7] hover:text-[#002e6b] flex items-center justify-center transition-colors"
                      type="button"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
