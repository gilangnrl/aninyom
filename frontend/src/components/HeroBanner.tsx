import React, { useState, useEffect } from "react";
import { Play, Info, BookmarkPlus, Star } from "lucide-react";
import { AnimeItem } from "../types";
import { TranslationSchema } from "../i18n";

interface HeroBannerProps {
  items: AnimeItem[];
  onPlay: (anime: AnimeItem) => void;
  onDetails: (anime: AnimeItem) => void;
  onBookmark?: (anime: AnimeItem) => void;
  lang: "en" | "id";
  t: TranslationSchema;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  items,
  onPlay,
  onDetails,
  onBookmark,
  lang,
  t,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const heroList = items.slice(0, 5);
  const currentAnime = heroList[currentIndex] || heroList[0];

  useEffect(() => {
    if (heroList.length <= 1 || isPaused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % heroList.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [heroList.length, isPaused]);

  if (!currentAnime) return null;

  const title =
    lang === "en" && currentAnime.title_english
      ? currentAnime.title_english
      : currentAnime.title_romaji;
  const score = currentAnime.average_score
    ? (currentAnime.average_score / 10).toFixed(1)
    : null;
  const backdrop =
    currentAnime.banner_image ||
    currentAnime.cover_image_extra_large ||
    currentAnime.cover_image_large;
  const cleanSynopsis = currentAnime.synopsis_en
    ? currentAnime.synopsis_en.replace(/<[^>]*>?/gm, "").trim()
    : "";
  const synopsis = cleanSynopsis.split(/(?<=[.!?])\s+/)[0]?.slice(0, 150) || "";

  return (
    <section
      className="hero-cinema"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsPaused(false);
        }
      }}
      aria-label={t.trendingNow}
    >
      <div
        key={currentAnime.anilist_id}
        className="spotlight-backdrop"
        style={{ backgroundImage: `url('${backdrop}')` }}
        aria-hidden="true"
      />
      <div className="spotlight-scrim" aria-hidden="true" />

      <div className="spotlight-content">
        <div className="spotlight-copy">
          <p className="spotlight-kicker">{t.trendingNow}</p>
          <h1 className="spotlight-title">{title}</h1>

          <div className="spotlight-meta" aria-label="Anime information">
            {score && (
              <span className="spotlight-score">
                <Star className="h-4 w-4 fill-current" aria-hidden="true" />
                {score}
              </span>
            )}
            {currentAnime.season_year && <span>{currentAnime.season_year}</span>}
            {currentAnime.season && <span>{currentAnime.season}</span>}
            {currentAnime.episodes_count && (
              <span>{currentAnime.episodes_count} {t.episodes}</span>
            )}
            {currentAnime.status && <span>{currentAnime.status.replace(/_/g, " ")}</span>}
          </div>

          {synopsis && <p className="spotlight-synopsis">{synopsis}</p>}

          <div className="spotlight-actions">
            <button
              onClick={() => onPlay(currentAnime)}
              className="spotlight-primary"
              type="button"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              <span>{t.playNow}</span>
            </button>
            <button
              onClick={() => onDetails(currentAnime)}
              className="spotlight-secondary"
              type="button"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
              <span>{t.details}</span>
            </button>
            {onBookmark && (
              <button
                onClick={() => onBookmark(currentAnime)}
                className="spotlight-icon"
                type="button"
                aria-label={t.bookmark}
                title={t.bookmark}
              >
                <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {heroList.length > 1 && (
            <div className="spotlight-pagination" role="tablist" aria-label="Featured anime">
              {heroList.map((item, index) => (
                <button
                  key={item.anilist_id}
                  type="button"
                  role="tab"
                  onClick={() => setCurrentIndex(index)}
                  aria-label={`Show featured anime ${index + 1}`}
                  aria-selected={index === currentIndex}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
