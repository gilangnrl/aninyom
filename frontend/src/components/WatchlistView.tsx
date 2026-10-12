import React, { useEffect, useState } from "react";
import { Clock, Trash2, ArrowLeft } from "lucide-react";
import { BookmarkItem, WatchHistoryItem, AnimeItem } from "../types";
import { TranslationSchema } from "../i18n";
import { api } from "../api";

interface WatchlistViewProps {
  onSelectAnime: (anime: AnimeItem) => void;
  lang: "en" | "id";
  t: TranslationSchema;
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  onSelectAnime,
  lang,
  t,
}) => {
  const [activeTab, setActiveTab] = useState<string>("history");
  const [history, setHistory] = useState<WatchHistoryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    Promise.all([api.getHistory(), api.getBookmarks()])
      .then(([histData, bkData]) => {
        setHistory(histData || []);
        setBookmarks(bkData || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRemoveBookmark = (e: React.MouseEvent, animeId: number) => {
    e.stopPropagation();
    api.removeBookmark(animeId).then(() => {
      setBookmarks((prev) => prev.filter((b) => b.anilist_id !== animeId));
    });
  };

  const filteredBookmarks =
    activeTab === "all_bookmarks"
      ? bookmarks
      : bookmarks.filter((b) => b.status === activeTab);

  return (
    <div className="w-full space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 rounded-full bg-[#7aa2f7]" />
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#dee2f3]">
            {t.navWatchlist}
          </h1>
        </div>
        <p className="text-xs md:text-sm text-[#c3c6d3] mt-1 pl-4.5">
          Your saved anime queue and playback progress
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-white/5">
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "history"
              ? "bg-[#7aa2f7] text-[#002e6b] shadow-sm"
              : "text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#1a1f2c]"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{t.continueWatching} ({history.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("watching")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "watching"
              ? "bg-[#7aa2f7] text-[#002e6b] shadow-sm"
              : "text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#1a1f2c]"
          }`}
        >
          {t.bookmarkWatching} ({bookmarks.filter((b) => b.status === "watching").length})
        </button>
        <button
          onClick={() => setActiveTab("plan_to_watch")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "plan_to_watch"
              ? "bg-[#7aa2f7] text-[#002e6b] shadow-sm"
              : "text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#1a1f2c]"
          }`}
        >
          {t.bookmarkPlan} ({bookmarks.filter((b) => b.status === "plan_to_watch").length})
        </button>
        <button
          onClick={() => setActiveTab("favorite")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "favorite"
              ? "bg-[#f6bc6a] text-[#002e6b] shadow-sm"
              : "text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#1a1f2c]"
          }`}
        >
          {t.bookmarkFavorite} ({bookmarks.filter((b) => b.status === "favorite").length})
        </button>
        <button
          onClick={() => setActiveTab("completed")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "completed"
              ? "bg-[#7aa2f7] text-[#002e6b] shadow-sm"
              : "text-[#c3c6d3] hover:text-[#dee2f3] hover:bg-[#1a1f2c]"
          }`}
        >
          {t.bookmarkCompleted} ({bookmarks.filter((b) => b.status === "completed").length})
        </button>
      </div>

      {/* History View (16:9 Landscape cards) */}
      {activeTab === "history" ? (
        history.length === 0 ? (
          <p className="text-[#c3c6d3] text-xs py-12 text-center">{t.emptyHistory}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px]">
            {history.map((h) => {
              const progressPct =
                h.total_seconds > 0
                  ? Math.min(100, Math.round((h.progress_seconds / h.total_seconds) * 100))
                  : 50;
              const title = lang === "en" && h.title_english ? h.title_english : h.title_romaji;
              return (
                <div
                  key={h.id}
                  onClick={() =>
                    onSelectAnime({
                      anilist_id: h.anilist_id,
                      title_romaji: h.title_romaji,
                      title_english: h.title_english,
                      cover_image_large: h.cover_image_large,
                    } as AnimeItem)
                  }
                  className="group relative cursor-pointer rounded-xl overflow-hidden bg-[#1a1f2c] border border-white/5 hover:border-[#7aa2f7]/30 transition-all hover:-translate-y-1 p-3 flex flex-col gap-3"
                >
                  <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-[#303542]">
                    <img
                      src={h.cover_image_large}
                      alt={title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-[#303542]/80">
                      <div
                        className="bg-[#7aa2f7] h-full rounded-r"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col justify-between flex-grow">
                    <div>
                      <span className="text-[10px] font-bold text-[#aec6ff] uppercase tracking-wider">
                        EP {h.episode_number}
                      </span>
                      <h3 className="text-xs font-bold text-[#dee2f3] line-clamp-1 mt-0.5 group-hover:text-[#7aa2f7]">
                        {title}
                      </h3>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-[#c3c6d3] font-mono mt-2">
                      <span>{Math.floor(h.progress_seconds / 60)}m / {Math.floor(h.total_seconds / 60)}m</span>
                      <span className="text-[#7aa2f7] font-semibold">{progressPct}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Bookmarks Grid (2:3 Portrait cards) */
        filteredBookmarks.length === 0 ? (
          <p className="text-[#c3c6d3] text-xs py-12 text-center">{t.emptyWatchlist}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 md:gap-4">
            {filteredBookmarks.map((b) => {
              const title = lang === "en" && b.title_english ? b.title_english : b.title_romaji;
              return (
                <div
                  key={b.id}
                  onClick={() =>
                    onSelectAnime({
                      anilist_id: b.anilist_id,
                      title_romaji: b.title_romaji,
                      title_english: b.title_english,
                      cover_image_large: b.cover_image_large,
                    } as AnimeItem)
                  }
                  className="group relative cursor-pointer rounded-xl overflow-hidden bg-[#1a1f2c] border border-white/5 hover:border-[#7aa2f7]/30 transition-all hover:-translate-y-1"
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#303542]">
                    <img
                      src={b.cover_image_large}
                      alt={title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <button
                      onClick={(e) => handleRemoveBookmark(e, b.anilist_id)}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 hover:bg-red-600 text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-3">
                    <h3 className="text-xs font-bold text-[#dee2f3] line-clamp-2 group-hover:text-[#7aa2f7]">
                      {title}
                    </h3>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};
