import React from "react";
import { Star, Play, Layers } from "lucide-react";
import { AnimeItem } from "../types";
import { TranslationSchema } from "../i18n";

interface AnimeCardProps {
  anime: AnimeItem;
  onSelect: (anime: AnimeItem) => void;
  lang: "en" | "id";
  t: TranslationSchema;
  badge?: string;
  subtitle?: string;
}

export const AnimeCard: React.FC<AnimeCardProps> = ({ anime, onSelect, lang, t, badge, subtitle }) => {
  const title = lang === "en" && anime.title_english ? anime.title_english : anime.title_romaji;
  const score = anime.average_score ? (anime.average_score / 10).toFixed(1) : null;
  const image = anime.cover_image_large || anime.cover_image_extra_large;

  return (
    <button
      type="button"
      onClick={() => onSelect(anime)}
      className="anime-card group"
      aria-label={`View details for ${title}`}
    >
      <span className="anime-card-media">
        <img src={image} alt={title} loading="lazy" />
        <span className="anime-card-scrim" aria-hidden="true" />

        <span className="anime-card-topline">
          <span className={`anime-card-badge${badge ? " anime-card-badge--accent" : ""}`}>
            {badge ? (
              badge
            ) : score ? (
              <>
                <Star className="h-3 w-3 fill-current text-[#f6bc6a]" aria-hidden="true" />
                {score}
              </>
            ) : (
              anime.format || "Anime"
            )}
          </span>
          <span className="anime-card-badge">
            {subtitle || anime.format || "SUB"}
          </span>
        </span>

        <span className="anime-card-play" aria-hidden="true">
          <Play className="h-5 w-5 fill-current" />
        </span>

        {anime.episodes_count ? (
          <span className="anime-card-episodes">
            <Layers className="h-3 w-3" aria-hidden="true" />
            {anime.episodes_count} {t.episodes}
          </span>
        ) : null}
      </span>

      <span className="anime-card-copy">
        <span className="anime-card-title">{title}</span>
        {anime.genres && anime.genres.length > 0 && (
          <span className="anime-card-genres">
            {anime.genres.slice(0, 2).join(" / ")}
          </span>
        )}
      </span>
    </button>
  );
};
