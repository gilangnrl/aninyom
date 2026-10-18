import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Search, RotateCcw, X, Sparkles, Flame, Clock, Calendar, Star } from "lucide-react";
import { AnimeItem, RecentReleaseItem } from "../types";
import { TranslationSchema } from "../i18n";
import { api } from "../api";
import { AnimeCard } from "./AnimeCard";

const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy",
  "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life",
  "Sports", "Supernatural", "Thriller"
];

const FORMATS = ["TV", "MOVIE", "OVA", "ONA", "SPECIAL"];

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;

const YEARS = [2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2018, 2015, 2010, 2000];

export interface BrowseFilterState {
  query?: string;
  genre?: string;
  format?: string;
  sort?: string;
  season?: string;
  year?: number;
  status?: string;
}

interface BrowseViewProps {
  initialQuery?: string;
  initialGenre?: string;
  initialSort?: string;
  initialSeason?: string;
  initialYear?: number;
  initialFormat?: string;
  initialStatus?: string;
  onSelectAnime: (anime: AnimeItem) => void;
  lang: "en" | "id";
  t: TranslationSchema;
  onFilterChange?: (filters: BrowseFilterState) => void;
}

interface DisplayItem {
  anime: AnimeItem;
  badge?: string;
  subtitle?: string;
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

function getCurrentSeasonAndYear() {
  const now = new Date();
  const m = now.getMonth() + 1;
  let season = "WINTER";
  if (m >= 4 && m <= 6) season = "SPRING";
  else if (m >= 7 && m <= 9) season = "SUMMER";
  else if (m >= 10 && m <= 12) season = "FALL";
  return { season, year: now.getFullYear() };
}

export const BrowseView: React.FC<BrowseViewProps> = ({
  initialQuery = "",
  initialGenre = "",
  initialSort = "popular",
  initialSeason = "",
  initialYear,
  initialFormat = "",
  initialStatus = "",
  onSelectAnime,
  lang,
  t,
  onFilterChange,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [selectedGenre, setSelectedGenre] = useState<string>(initialGenre);
  const [selectedFormat, setSelectedFormat] = useState<string>(initialFormat);
  const [sortBy, setSortBy] = useState<string>(initialSort);
  const [selectedSeason, setSelectedSeason] = useState<string>(initialSeason);
  const [selectedYear, setSelectedYear] = useState<number | undefined>(initialYear);
  const [selectedStatus, setSelectedStatus] = useState<string>(initialStatus);

  const [results, setResults] = useState<DisplayItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Sync props when parent updates
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setSelectedGenre(initialGenre);
  }, [initialGenre]);

  useEffect(() => {
    if (initialSort) setSortBy(initialSort);
  }, [initialSort]);

  useEffect(() => {
    setSelectedSeason(initialSeason);
  }, [initialSeason]);

  useEffect(() => {
    setSelectedYear(initialYear);
  }, [initialYear]);

  useEffect(() => {
    setSelectedFormat(initialFormat);
  }, [initialFormat]);

  useEffect(() => {
    setSelectedStatus(initialStatus);
  }, [initialStatus]);

  // Report the active filters up to App, which owns the browse URL and decides
  // whether a change is a new history entry or an in-place update. Writing the
  // address here as well would race that decision (this effect runs before the
  // parent's) and silently drop the entry.
  const syncUrlHash = useCallback(
    (nextState: BrowseFilterState) => {
      if (onFilterChange) {
        onFilterChange(nextState);
      }
    },
    [onFilterChange]
  );

  const currentSeasonYear = useMemo(() => getCurrentSeasonAndYear(), []);

  // Fetch data according to current filters
  const fetchCatalog = useCallback(
    (pageNumber = 1, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const q = query.trim() || undefined;
      const g = selectedGenre.trim() || undefined;
      const f = selectedFormat.trim() || undefined;
      const s = selectedSeason.trim() || undefined;
      const y = selectedYear || undefined;
      const st = selectedStatus.trim() || undefined;

      // Special case: "recent" sort with no query or genre fetches pure live broadcast schedule
      if (sortBy === "recent" && !q && !g && !f && !s && !y && !st) {
        api.getRecentReleases(pageNumber, 24)
          .then((items: RecentReleaseItem[]) => {
            const mapped: DisplayItem[] = items.map((item) => ({
              anime: item.media,
              badge: `EP ${item.episode}`,
              subtitle: formatAiredTime(item.airing_at),
            }));

            if (append) {
              setResults((prev) => {
                const existingIds = new Set(prev.map((d) => d.anime.anilist_id));
                const newItems = mapped.filter((d) => !existingIds.has(d.anime.anilist_id));
                return [...prev, ...newItems];
              });
            } else {
              setResults(mapped);
            }
            setHasMore(items.length >= 15);
            setPage(pageNumber);
          })
          .catch((err) => {
            console.error("Browse recent releases error:", err);
          })
          .finally(() => {
            setLoading(false);
            setLoadingMore(false);
          });
        return;
      }

      // If "seasonal" sort is picked without manual season/year, use current season & year
      const effectiveSeason = sortBy === "seasonal" && !s ? currentSeasonYear.season : s;
      const effectiveYear = sortBy === "seasonal" && !y ? currentSeasonYear.year : y;
      const effectiveSort = sortBy === "seasonal" ? "popular" : sortBy;

      api.searchAnime({
        query: q,
        genre: g,
        format: f,
        sort: effectiveSort,
        season: effectiveSeason,
        year: effectiveYear,
        status: st,
        page: pageNumber,
      })
        .then((items) => {
          const mapped: DisplayItem[] = items.map((a) => ({
            anime: a,
          }));

          if (append) {
            setResults((prev) => {
              const existingIds = new Set(prev.map((d) => d.anime.anilist_id));
              const newItems = mapped.filter((d) => !existingIds.has(d.anime.anilist_id));
              return [...prev, ...newItems];
            });
          } else {
            setResults(mapped);
          }
          setHasMore(items.length >= 15);
          setPage(pageNumber);
        })
        .catch((err) => {
          console.error("Browse search error:", err);
        })
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [query, selectedGenre, selectedFormat, sortBy, selectedSeason, selectedYear, selectedStatus, currentSeasonYear]
  );

  // Trigger search whenever any filter changes
  useEffect(() => {
    fetchCatalog(1, false);
    syncUrlHash({
      query: query.trim() || undefined,
      genre: selectedGenre || undefined,
      format: selectedFormat || undefined,
      sort: sortBy || undefined,
      season: selectedSeason || undefined,
      year: selectedYear,
      status: selectedStatus || undefined,
    });
  }, [query, selectedGenre, selectedFormat, sortBy, selectedSeason, selectedYear, selectedStatus, fetchCatalog, syncUrlHash]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCatalog(1, false);
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchCatalog(page + 1, true);
  };

  const handleResetFilters = () => {
    setQuery("");
    setSelectedGenre("");
    setSelectedFormat("");
    setSortBy("popular");
    setSelectedSeason("");
    setSelectedYear(undefined);
    setSelectedStatus("");
  };

  const hasActiveFilters = Boolean(
    query ||
    selectedGenre ||
    selectedFormat ||
    (sortBy && sortBy !== "popular") ||
    selectedSeason ||
    selectedYear ||
    selectedStatus
  );

  const getActiveTitle = () => {
    if (query) return `Search: "${query}"`;
    if (sortBy === "recent") return "Recent Releases & Ongoing Series";
    if (sortBy === "trending") return "Trending Anime";
    if (sortBy === "seasonal" || selectedSeason) {
      const s = selectedSeason || currentSeasonYear.season;
      const y = selectedYear || currentSeasonYear.year;
      return `${s} ${y} Anime`;
    }
    if (sortBy === "score") return "Top Rated Anime";
    if (sortBy === "start_date") return "Newly Aired Anime";
    if (selectedStatus === "NOT_YET_RELEASED") return "Upcoming Anime Premieres";
    return t.navBrowse;
  };

  return (
    <div className="w-full space-y-6">
      {/* Header & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-6 rounded-full bg-[#7aa2f7]" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-[#dee2f3]">
              {getActiveTitle()}
            </h1>
          </div>
          <p className="text-xs md:text-sm text-[#c3c6d3] mt-1 pl-4.5">
            {t.browseCatalogHint}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <form onSubmit={handleSearchSubmit} className="relative flex-grow md:w-80">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full bg-[#1a1f2c] text-xs md:text-sm text-[#dee2f3] rounded-full pl-10 pr-9 py-2.5 border border-white/10 focus:outline-none focus:border-[#7aa2f7] transition-all placeholder-[#c3c6d3]/60"
            />
            <Search className="w-4 h-4 text-[#c3c6d3] absolute left-3.5 top-3" />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search query"
                className="absolute right-3 top-2.5 text-[#c3c6d3] hover:text-[#dee2f3]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              aria-label="Reset all filters"
              title="Reset all filters"
              className="p-2.5 rounded-full bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/10 transition-colors flex items-center justify-center shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Primary Category & Sort Pills */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => {
              setSortBy("recent");
              setSelectedSeason("");
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              sortBy === "recent"
                ? "bg-[#f6bc6a] text-[#002e6b] shadow-md shadow-[#f6bc6a]/20 scale-105"
                : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Ongoing Releases</span>
          </button>

          <button
            onClick={() => {
              setSortBy("trending");
              setSelectedSeason("");
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              sortBy === "trending"
                ? "bg-[#7aa2f7] text-[#002e6b] shadow-md shadow-[#7aa2f7]/20 scale-105"
                : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Trending</span>
          </button>

          <button
            onClick={() => {
              setSortBy("popular");
              setSelectedSeason("");
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              sortBy === "popular" && !selectedSeason
                ? "bg-[#7aa2f7] text-[#002e6b] shadow-md shadow-[#7aa2f7]/20 scale-105"
                : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Top Popular</span>
          </button>

          <button
            onClick={() => {
              setSortBy("seasonal");
              setSelectedSeason(currentSeasonYear.season);
              setSelectedYear(currentSeasonYear.year);
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              sortBy === "seasonal" || (selectedSeason === currentSeasonYear.season && selectedYear === currentSeasonYear.year)
                ? "bg-[#aec6ff] text-[#002e6b] shadow-md shadow-[#aec6ff]/20 scale-105"
                : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Current Season ({currentSeasonYear.season} {currentSeasonYear.year})</span>
          </button>

          <button
            onClick={() => {
              setSortBy("score");
              setSelectedSeason("");
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              sortBy === "score"
                ? "bg-[#7aa2f7] text-[#002e6b] shadow-md shadow-[#7aa2f7]/20 scale-105"
                : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            <span>Top Rated</span>
          </button>

          <button
            onClick={() => {
              setSortBy("start_date");
              setSelectedSeason("");
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              sortBy === "start_date"
                ? "bg-[#7aa2f7] text-[#002e6b] shadow-md shadow-[#7aa2f7]/20 scale-105"
                : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Newly Aired</span>
          </button>
        </div>

        {/* Secondary Filter Controls: Season, Year, Format */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          {/* Season Selector */}
          <div className="flex items-center gap-1 bg-[#161b28] p-1 rounded-full border border-white/5">
            <span className="px-2.5 text-[10px] font-bold text-[#c3c6d3] uppercase">Season:</span>
            <button
              onClick={() => setSelectedSeason("")}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                selectedSeason === ""
                  ? "bg-[#7aa2f7] text-[#002e6b]"
                  : "text-[#c3c6d3] hover:text-[#dee2f3]"
              }`}
            >
              All
            </button>
            {SEASONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSelectedSeason(selectedSeason === s ? "" : s);
                  if (sortBy === "recent") setSortBy("popular");
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                  selectedSeason === s
                    ? "bg-[#7aa2f7] text-[#002e6b]"
                    : "text-[#c3c6d3] hover:text-[#dee2f3]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Year Dropdown */}
          <div className="flex items-center gap-1.5 bg-[#161b28] px-3 py-1 rounded-full border border-white/5">
            <span className="text-[10px] font-bold text-[#c3c6d3] uppercase">Year:</span>
            <select
              value={selectedYear || ""}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                setSelectedYear(val);
                if (sortBy === "recent") setSortBy("popular");
              }}
              className="bg-transparent text-[11px] font-bold text-[#dee2f3] focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-[#1a1f2c] text-[#dee2f3]">All Years</option>
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-[#1a1f2c] text-[#dee2f3]">{y}</option>
              ))}
            </select>
          </div>

          {/* Format Selector */}
          <div className="flex items-center gap-1 bg-[#161b28] p-1 rounded-full border border-white/5">
            <span className="px-2.5 text-[10px] font-bold text-[#c3c6d3] uppercase">Format:</span>
            <button
              onClick={() => setSelectedFormat("")}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                selectedFormat === ""
                  ? "bg-[#f6bc6a] text-[#002e6b]"
                  : "text-[#c3c6d3] hover:text-[#dee2f3]"
              }`}
            >
              All
            </button>
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setSelectedFormat(selectedFormat === f ? "" : f)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                  selectedFormat === f
                    ? "bg-[#f6bc6a] text-[#002e6b]"
                    : "text-[#c3c6d3] hover:text-[#dee2f3]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Genre Horizontal Scroller */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedGenre("")}
            className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
              selectedGenre === ""
                ? "bg-[#303542] text-[#dee2f3] border border-[#7aa2f7]/50"
                : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
            }`}
          >
            All Genres
          </button>
          {GENRES.map((g) => (
            <button
              key={g}
              onClick={() => setSelectedGenre(selectedGenre === g ? "" : g)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
                selectedGenre === g
                  ? "bg-[#7aa2f7] text-[#002e6b] shadow-sm"
                  : "bg-[#1a1f2c] text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#252a37] border border-white/5"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog Grid */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-3 border-[#7aa2f7] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-[#c3c6d3] tracking-widest uppercase font-bold">
            {t.loading}
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="py-24 text-center space-y-3">
          <p className="text-[#dee2f3] text-sm font-semibold">No anime matches your current filters.</p>
          <button
            onClick={handleResetFilters}
            className="px-4 py-2 rounded-full bg-[#7aa2f7] text-[#002e6b] text-xs font-bold transition-transform hover:scale-105 active:scale-95"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 md:gap-4">
            {results.map((item, idx) => (
              <AnimeCard
                key={`${item.anime.anilist_id}-${idx}`}
                anime={item.anime}
                onSelect={onSelectAnime}
                lang={lang}
                t={t}
                badge={item.badge}
                subtitle={item.subtitle}
              />
            ))}
          </div>

          {/* Load More Pagination Button */}
          {hasMore && (
            <div className="flex justify-center pt-4 pb-12">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-8 py-3 rounded-full bg-[#1a1f2c] hover:bg-[#252a37] text-xs font-bold text-[#dee2f3] border border-white/10 transition-all flex items-center gap-2 shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <div className="w-4 h-4 border-2 border-[#7aa2f7] border-t-transparent rounded-full animate-spin" />
                    <span>Loading more titles...</span>
                  </>
                ) : (
                  <span>Load More Titles (Page {page + 1})</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
