import React, { useEffect, useState } from "react";
import { X, Play, Star, Calendar, Bookmark, Layers, Check, GitBranch, Tv } from "lucide-react";
import { AnimeItem, Episode } from "../types";
import { TranslationSchema } from "../i18n";
import { api } from "../api";

interface AnimeDetailsModalProps {
  anime: AnimeItem;
  onClose: () => void;
  onPlayEpisode: (anime: AnimeItem, epNum: number, epId: string, episodes: Episode[]) => void;
  lang: "en" | "id";
  t: TranslationSchema;
}

export const AnimeDetailsModal: React.FC<AnimeDetailsModalProps> = ({
  anime,
  onClose,
  onPlayEpisode,
  lang,
  t,
}) => {
  const [currentAnime, setCurrentAnime] = useState<AnimeItem>(anime);
  const [fullDetails, setFullDetails] = useState<AnimeItem | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(true);
  const [bookmarkStatus, setBookmarkStatus] = useState<string | null>(null);
  const [showBookmarkMenu, setShowBookmarkMenu] = useState(false);

  useEffect(() => {
    setCurrentAnime(anime);
  }, [anime]);

  const title = lang === "en" && currentAnime.title_english ? currentAnime.title_english : currentAnime.title_romaji;
  const score = currentAnime.average_score ? (currentAnime.average_score / 10).toFixed(1) : null;
  const banner = currentAnime.banner_image || currentAnime.cover_image_extra_large || currentAnime.cover_image_large;

  // 1. Fetch Full Details (for relations/seasons) and Episodes
  useEffect(() => {
    let isMounted = true;
    setLoadingEpisodes(true);

    // Fetch full details if relations not present
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

    // Fetch existing bookmark
    api.getBookmarks()
      .then((bks) => {
        const found = bks.find((b) => b.anilist_id === currentAnime.anilist_id);
        if (found) setBookmarkStatus(found.status);
        else setBookmarkStatus(null);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [currentAnime.anilist_id]);

  const handleSwitchAnime = (relatedId: number) => {
    setLoadingEpisodes(true);
    api.getAnimeDetails(relatedId)
      .then((newAnime) => {
        setCurrentAnime(newAnime);
        window.location.hash = `#/anime/${relatedId}`;
      })
      .catch(console.error);
  };

  const handleSetBookmark = (status: string) => {
    api.setBookmark({
      anime_id: currentAnime.anilist_id,
      status,
      title_romaji: currentAnime.title_romaji,
      title_english: currentAnime.title_english,
      cover_image: currentAnime.cover_image_large,
      score: currentAnime.average_score,
    }).then(() => {
      setBookmarkStatus(status);
      setShowBookmarkMenu(false);
    }).catch(console.error);
  };

  const handleRemoveBookmark = () => {
    api.removeBookmark(currentAnime.anilist_id).then(() => {
      setBookmarkStatus(null);
      setShowBookmarkMenu(false);
    }).catch(console.error);
  };

  const relations = fullDetails?.relations || currentAnime.relations || [];
  const relatedSeasons = relations.filter((r) => r.node && r.node.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-3xl glass border border-white/10 overflow-hidden shadow-2xl my-auto bg-[#0e131f]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-30 p-2.5 rounded-full bg-black/60 hover:bg-black/90 text-white backdrop-blur-md border border-white/10 transition-transform active:scale-95"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Backdrop Banner Header */}
        <div className="relative h-64 md:h-80 w-full overflow-hidden">
          <img
            src={banner}
            alt={title}
            className="w-full h-full object-cover filter brightness-[0.5]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0e131f] via-[#0e131f]/60 to-transparent" />
        </div>

        {/* Modal Main Content Container */}
        <div className="relative px-6 md:px-10 pb-8 -mt-28 md:-mt-36 z-20">
          <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
            {/* Poster Card */}
            <div className="w-36 md:w-56 flex-shrink-0 rounded-2xl overflow-hidden glass border border-white/10 shadow-xl bg-[#1a1f2c]">
              <img
                src={anime.cover_image_large || anime.cover_image_extra_large}
                alt={title}
                className="w-full h-auto object-cover"
              />
            </div>

            {/* Info and Actions */}
            <div className="flex-grow space-y-4 pt-4">
              <div className="space-y-1">
                <h1 className="text-xl md:text-3xl font-extrabold text-[#dee2f3] leading-tight">
                  {title}
                </h1>
                {anime.title_romaji && anime.title_english && (
                  <p className="text-xs md:text-sm text-[#c3c6d3] font-medium">
                    {anime.title_romaji}
                  </p>
                )}
              </div>

              {/* Badges Row */}
              <div className="flex flex-wrap items-center gap-2">
                {score && (
                  <div className="glass flex items-center gap-1 px-3 py-1 rounded-full text-[#f6bc6a] text-xs font-bold">
                    <Star className="w-3.5 h-3.5 fill-[#f6bc6a]" />
                    <span>{score}</span>
                  </div>
                )}
                {anime.format && (
                  <div className="px-3 py-1 rounded-full bg-[#252a37] text-[#aec6ff] text-xs font-bold uppercase">
                    {anime.format}
                  </div>
                )}
                {anime.status && (
                  <div className="px-3 py-1 rounded-full bg-[#794e00] text-[#fec370] text-xs font-bold uppercase">
                    {anime.status}
                  </div>
                )}
                {anime.season_year ? (
                  <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-[#252a37] text-[#c3c6d3] text-xs font-medium">
                    <Calendar className="w-3 h-3 text-[#7aa2f7]" />
                    {anime.season} {anime.season_year}
                  </div>
                ) : null}
              </div>

              {/* Action Buttons: Play First Episode & Bookmark */}
              <div className="flex items-center gap-3 pt-2 relative">
                {episodes.length > 0 && (
                  <button
                    onClick={() => onPlayEpisode(anime, episodes[0].episode_number, episodes[0].episode_id, episodes)}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#7aa2f7] hover:scale-[1.03] text-[#002e6b] text-xs md:text-sm font-bold shadow-lg shadow-[#7aa2f7]/25 transition-all active:scale-95"
                  >
                    <Play className="w-4 h-4 fill-[#002e6b]" />
                    {t.playNow} (EP 1)
                  </button>
                )}

                {/* Bookmark Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowBookmarkMenu(!showBookmarkMenu)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-full border text-xs md:text-sm font-semibold transition-all ${
                      bookmarkStatus
                        ? "bg-[#794e00] border-[#f6bc6a]/40 text-[#fec370]"
                        : "bg-[#252a37] hover:bg-[#303542] border-white/5 text-[#dee2f3]"
                    }`}
                  >
                    <Bookmark className={`w-4 h-4 ${bookmarkStatus ? "fill-[#f6bc6a]" : ""}`} />
                    {bookmarkStatus ? bookmarkStatus.replace("_", " ").toUpperCase() : t.bookmark}
                  </button>

                  {showBookmarkMenu && (
                    <div className="absolute top-12 left-0 w-48 glass-dropdown rounded-2xl p-2 shadow-2xl flex flex-col gap-1 z-30">
                      {(["watching", "plan_to_watch", "completed", "favorite", "dropped"] as const).map((st) => (
                        <button
                          key={st}
                          onClick={() => handleSetBookmark(st)}
                          className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-[#dee2f3] hover:bg-white/10"
                        >
                          <span>{st.replace(/_/g, " ")}</span>
                          {bookmarkStatus === st && <Check className="w-4 h-4 text-[#7aa2f7]" />}
                        </button>
                      ))}
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
              </div>

              {/* Synopsis */}
              {anime.synopsis_en && (
                <div className="pt-2">
                  <h3 className="text-xs font-bold text-[#c3c6d3] uppercase tracking-wider mb-1">
                    {t.synopsis}
                  </h3>
                  <p className="text-xs md:text-sm text-[#c3c6d3] leading-relaxed max-h-36 overflow-y-auto pr-2">
                    {anime.synopsis_en.replace(/<[^>]*>?/gm, "")}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Episode Grid Section */}
          <div className="mt-8 border-t border-white/10 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base md:text-lg font-bold text-[#dee2f3] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#7aa2f7]" />
                {t.selectEpisode} ({episodes.length})
              </h2>
            </div>

            {loadingEpisodes ? (
              <div className="py-12 flex justify-center">
                <div className="w-8 h-8 border-3 border-[#7aa2f7] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : episodes.length === 0 ? (
              <p className="text-xs text-[#c3c6d3] py-6">{t.noEpisodesFound}</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5 max-h-72 overflow-y-auto pr-2">
                {episodes.map((ep) => (
                  <button
                    key={ep.episode_id}
                    onClick={() => onPlayEpisode(currentAnime, ep.episode_number, ep.episode_id, episodes)}
                    className="p-3 rounded-xl bg-[#1a1f2c] hover:bg-[#252a37] hover:border-[#7aa2f7]/50 border border-white/5 transition-all text-left flex flex-col justify-between group active:scale-95"
                  >
                    <span className="text-xs font-bold text-[#dee2f3] group-hover:text-[#7aa2f7]">
                      EP {ep.episode_number}
                    </span>
                    <span className="text-[10px] text-[#c3c6d3] line-clamp-1 mt-1">
                      {ep.title || `${t.episode} ${ep.episode_number}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Franchise, Seasons & Sequels Rail */}
          {relatedSeasons.length > 0 && (
            <div className="mt-8 border-t border-white/10 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base md:text-lg font-bold text-[#dee2f3] flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[#f6bc6a]" />
                  Seasons &amp; Franchise Chronology ({relatedSeasons.length})
                </h2>
                <span className="text-xs text-[#c3c6d3]">Click to switch season</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-64 overflow-y-auto pr-2">
                {relatedSeasons.map((rel, idx) => {
                  const node = rel.node;
                  const relTitle = lang === "en" && node.title?.english ? node.title.english : (node.title?.romaji || "Related Title");
                  const cover = node.coverImage?.large || currentAnime.cover_image_large;
                  const isCurrent = node.id === currentAnime.anilist_id;

                  const badgeColor =
                    rel.relationType === "SEQUEL"
                      ? "bg-[#7aa2f7] text-[#002e6b]"
                      : rel.relationType === "PREQUEL"
                      ? "bg-[#f6bc6a] text-[#002e6b]"
                      : "bg-[#252a37] text-[#c3c6d3]";

                  return (
                    <div
                      key={`${node.id}-${idx}`}
                      onClick={() => !isCurrent && handleSwitchAnime(node.id)}
                      className={`group relative rounded-xl overflow-hidden bg-[#1a1f2c] p-2 flex flex-col gap-2 transition-all cursor-pointer border ${
                        isCurrent
                          ? "border-[#7aa2f7] shadow-lg shadow-[#7aa2f7]/20 pointer-events-none"
                          : "border-white/5 hover:border-[#7aa2f7]/50 hover:bg-[#252a37] hover:-translate-y-1"
                      }`}
                    >
                      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-[#303542]">
                        <img
                          src={cover}
                          alt={relTitle}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                        <div className={`absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${badgeColor}`}>
                          {rel.relationType.replace(/_/g, " ")}
                        </div>
                        {node.format && (
                          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold text-white uppercase">
                            {node.format}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-[#dee2f3] line-clamp-2 leading-tight group-hover:text-[#7aa2f7] transition-colors">
                          {relTitle}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] text-[#7aa2f7] font-semibold mt-1">
                            Current Season
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
