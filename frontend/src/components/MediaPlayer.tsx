import React, { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, RotateCcw, RotateCw, Settings, Captions,
  X, Check, Sparkles, ChevronRight, ListVideo, CheckCircle2, Clock
} from "lucide-react";
import { AnimeItem, Episode, StreamData, SubtitleTrack, WatchHistoryItem } from "../types";
import { TranslationSchema } from "../i18n";
import { api } from "../api";

interface MediaPlayerProps {
  anime: AnimeItem;
  episodeNumber: number;
  episodeId: string;
  episodesList: Episode[];
  onClose: () => void;
  onSelectEpisode: (epNum: number, epId: string) => void;
  lang: "en" | "id";
  t: TranslationSchema;
}

interface ParsedCue {
  start: number;
  end: number;
  idText?: string;
  enText?: string;
  rawText: string;
}

function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
}

function parseVttTimeString(timeStr: string): number {
  const parts = timeStr.trim().split(":");
  let s = 0;
  if (parts.length === 3) {
    s = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    s = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return s;
}

function parseVttCues(vttText: string): ParsedCue[] {
  const cues: ParsedCue[] = [];
  const lines = vttText.replace(/\r\n/g, "\n").split("\n");
  const timingRegex = /((?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})/;

  let start = -1;
  let end = -1;
  let textLines: string[] = [];

  const flush = () => {
    if (start >= 0 && end > start && textLines.length > 0) {
      const fullText = textLines.join("\n");
      const idMatch = fullText.match(/<c\.id>(.*?)<\/c\.id>/s);
      const enMatch = fullText.match(/<c\.en>(.*?)<\/c\.en>/s);

      cues.push({
        start,
        end,
        idText: idMatch ? decodeHtmlEntities(idMatch[1].trim()) : undefined,
        enText: enMatch ? decodeHtmlEntities(enMatch[1].trim()) : undefined,
        rawText: decodeHtmlEntities(fullText.replace(/<[^>]+>/g, "").trim()),
      });
    }
    start = -1;
    end = -1;
    textLines = [];
  };

  for (const line of lines) {
    const s = line.trim();
    if (!s) {
      flush();
      continue;
    }
    const match = s.match(timingRegex);
    if (match) {
      flush();
      start = parseVttTimeString(match[1].replace(",", "."));
      end = parseVttTimeString(match[2].replace(",", "."));
      continue;
    }
    if (start >= 0 && !s.startsWith("WEBVTT") && !s.startsWith("NOTE")) {
      textLines.push(s);
    }
  }
  flush();
  return cues;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({
  anime,
  episodeNumber,
  episodeId,
  episodesList,
  onClose,
  onSelectEpisode,
  lang,
  t,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Stream state
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // HUD & controls
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<number | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [ambientGlow, setAmbientGlow] = useState(true);

  // Netflix-style Episode Navigation
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
  const [historyList, setHistoryList] = useState<WatchHistoryItem[]>([]);
  const [dismissNextPrompt, setDismissNextPrompt] = useState(false);
  const activeEpRef = useRef<HTMLButtonElement>(null);

  // Quality & Subtitles
  const [qualityLevels, setQualityLevels] = useState<{ id: number; height: number; bitrate: number }[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 = Auto
  const [subTracks, setSubTracks] = useState<SubtitleTrack[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>("id"); // "id", "dual", "en", "off"
  const [activeCues, setActiveCues] = useState<ParsedCue[]>([]);
  const [currentActiveCue, setCurrentActiveCue] = useState<ParsedCue | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const hasSubtitleTrack = (language: string) =>
    subTracks.some((track) => track.lang === language && Boolean(track.url));

  // Auto skip state
  const [autoSkipIntro, setAutoSkipIntro] = useState(false);

  // Load Watch History for Episode Drawer indicators
  useEffect(() => {
    api.getHistory().then(setHistoryList).catch(() => {});
  }, [anime.anilist_id, episodeNumber]);

  // Reset dismissed prompt on episode change
  useEffect(() => {
    setDismissNextPrompt(false);
  }, [episodeId]);

  // Scroll current episode into view when episode drawer opens
  useEffect(() => {
    if (showEpisodesDrawer && activeEpRef.current) {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      activeEpRef.current.scrollIntoView({ behavior, block: "center" });
    }
  }, [showEpisodesDrawer]);

  // 1. Fetch Stream Metadata
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setSubtitleError(null);
    setActiveCues([]);
    setCurrentActiveCue(null);

    api.getStreamData(episodeId, "sub")
      .then((data) => {
        if (!isMounted) return;
        setStreamData(data);
        const tracks = data.tracks || [];
        setSubTracks(tracks);

        const defaultTrack = tracks.find((track) => track.lang === "dual" && track.url)
          || tracks.find((track) => track.lang === "id" && track.url)
          || tracks.find((track) => track.lang === "en" && track.url);
        setSelectedSub(defaultTrack?.lang || "off");
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || "Failed to load stream");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [episodeId]);

  // 2. Initialize HLS Player
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamData?.proxied_url) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });
      hlsRef.current = hls;

      hls.loadSource(streamData.proxied_url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const levels = data.levels.map((lvl, index) => ({
          id: index,
          height: lvl.height,
          bitrate: lvl.bitrate,
        }));
        setQualityLevels(levels);

        // Resume playback if history exists
        api.getHistory().then((history) => {
          const item = history.find(
            (h) => h.anilist_id === anime.anilist_id && h.episode_number === episodeNumber
          );
          if (item && item.progress_seconds > 10 && item.progress_seconds < item.total_seconds - 30) {
            video.currentTime = item.progress_seconds;
          }
        }).catch(() => {});

        video.play().catch(() => setPlaying(false));
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentQuality(data.level);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamData.proxied_url;
      video.play().catch(() => setPlaying(false));
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamData, episodeNumber, anime.anilist_id]);

  // 3. Load & Parse Subtitle Track
  useEffect(() => {
    const controller = new AbortController();
    setActiveCues([]);
    setCurrentActiveCue(null);
    setSubtitleError(null);

    if (selectedSub === "off") return () => controller.abort();

    const track = subTracks.find((t) => t.lang === selectedSub && t.url);
    if (!track) {
      const missingLanguage = selectedSub === "en" ? "English" : selectedSub === "en-ai" ? "AI English" : "Selected";
      setSubtitleError(`${missingLanguage} subtitles are not available for this episode.`);
      return () => controller.abort();
    }

    fetch(track.url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Subtitle request failed (${res.status})`);
        return res.text();
      })
      .then((vttText) => {
        const cues = parseVttCues(vttText);
        if (cues.length === 0) throw new Error("Subtitle file contained no readable WebVTT cues");
        if (controller.signal.aborted) return;
        setActiveCues(cues);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Failed loading subtitle track:", err);
        setSubtitleError(`Could not load ${track.label}. Try another subtitle track or stream.`);
      });

    return () => controller.abort();
  }, [selectedSub, subTracks]);

  // 4. Update Current Active Subtitle Cue
  useEffect(() => {
    if (!activeCues.length) {
      setCurrentActiveCue(null);
      return;
    }
    const cue = activeCues.find((c) => currentTime >= c.start && currentTime <= c.end);
    setCurrentActiveCue(cue || null);
  }, [currentTime, activeCues]);

  // 5. Video Event Listeners & Progress Persistence
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      setDuration(video.duration || 0);

      // Auto skip intro if enabled
      if (autoSkipIntro && streamData?.intro?.start && streamData?.intro?.end) {
        if (video.currentTime >= streamData.intro.start && video.currentTime < streamData.intro.end) {
          video.currentTime = streamData.intro.end;
        }
      }
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    // Save progress interval
    const interval = setInterval(() => {
      if (video.currentTime > 5 && video.duration > 0) {
        api.saveHistory({
          anime_id: anime.anilist_id,
          episode_number: episodeNumber,
          progress_seconds: video.currentTime,
          total_seconds: video.duration,
          title_romaji: anime.title_romaji,
          title_english: anime.title_english,
          cover_image: anime.cover_image_large,
        }).catch(() => {});
      }
    }, 5000);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      clearInterval(interval);
    };
  }, [anime, episodeNumber, streamData, autoSkipIntro]);

  // 6. Dynamic Ambient Backlight Glow Canvas
  useEffect(() => {
    if (!ambientGlow || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let animId: number;
    const renderGlow = () => {
      if (!video.paused && !video.ended && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      animId = requestAnimationFrame(renderGlow);
    };
    renderGlow();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [ambientGlow]);

  // Handle Controls Visibility Timeout
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3500);
  };

  // Next / Previous episode handlers
  const currentIdx = episodesList.findIndex((e) => e.episode_number === episodeNumber);
  const nextEpisode = currentIdx >= 0 && currentIdx < episodesList.length - 1 ? episodesList[currentIdx + 1] : null;
  const prevEpisode = currentIdx > 0 ? episodesList[currentIdx - 1] : null;

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;
    video.volume = val;
    setVolume(val);
    setMuted(val === 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  };

  // Keyboard Shortcuts Listener (Space, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, M, F, N, P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      if (activeTag === "input" || activeTag === "textarea") return;

      const video = videoRef.current;
      if (!video) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          setShowControls(true);
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          setCurrentTime(video.currentTime);
          setShowControls(true);
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
          setCurrentTime(video.currentTime);
          setShowControls(true);
          break;
        case "ArrowUp": {
          e.preventDefault();
          const newVol = Math.min(1, Math.round((video.volume + 0.1) * 100) / 100);
          video.volume = newVol;
          video.muted = false;
          setVolume(newVol);
          setMuted(false);
          setShowControls(true);
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const newVol = Math.max(0, Math.round((video.volume - 0.1) * 100) / 100);
          video.volume = newVol;
          setVolume(newVol);
          setMuted(newVol === 0);
          setShowControls(true);
          break;
        }
        case "KeyM":
          e.preventDefault();
          toggleMute();
          setShowControls(true);
          break;
        case "KeyF":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "KeyN":
          if (nextEpisode) {
            e.preventDefault();
            onSelectEpisode(nextEpisode.episode_number, nextEpisode.episode_id);
          }
          break;
        case "KeyP":
          if (prevEpisode) {
            e.preventDefault();
            onSelectEpisode(prevEpisode.episode_number, prevEpisode.episode_id);
          }
          break;
        case "KeyE":
          e.preventDefault();
          setShowEpisodesDrawer((prev) => !prev);
          break;
        case "Escape":
          if (showEpisodesDrawer) {
            e.preventDefault();
            setShowEpisodesDrawer(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, toggleMute, toggleFullscreen, nextEpisode, prevEpisode, onSelectEpisode]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  // Intro / Outro active check
  const isIntroActive = streamData?.intro && currentTime >= streamData.intro.start && currentTime <= streamData.intro.end;
  const isOutroActive = streamData?.outro && currentTime >= streamData.outro.start && currentTime <= streamData.outro.end;

  // Netflix-style Next Episode Floating Prompt check
  const isNearEnd =
    duration > 30 &&
    (currentTime >= duration - 40 || (streamData?.outro && currentTime >= streamData.outro.start));
  const showNextPrompt = isNearEnd && !!nextEpisode && !dismissNextPrompt;

  const displayTitle =
    lang === "en" && anime.title_english ? anime.title_english : anime.title_romaji;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="media-player fixed inset-0 z-50 flex items-center justify-center select-none overflow-hidden"
      role="region"
      aria-label={`${displayTitle}, episode ${episodeNumber} player`}
    >
      {/* Dynamic Ambient Backlight Canvas */}
      {ambientGlow && (
        <canvas
          ref={canvasRef}
          width={64}
          height={36}
          className="media-player-glow absolute inset-0 w-full h-full object-cover filter blur-[80px] opacity-45 pointer-events-none scale-125 transition-opacity"
        />
      )}

      {/* Main Video Element */}
      <video
        ref={videoRef}
        onClick={togglePlay}
        playsInline
        className="media-player-video relative z-10 w-full h-full object-contain cursor-pointer"
      />

      {/* Custom High-Fidelity Subtitle Overlay */}
      {currentActiveCue && selectedSub !== "off" && (
        <div className="media-subtitles absolute bottom-20 md:bottom-24 left-6 right-6 z-20 flex flex-col items-center justify-center text-center sub-overlay pointer-events-none">
          {selectedSub === "dual" && currentActiveCue.idText && currentActiveCue.enText ? (
            // Dual-Subtitle Mode: Top Indonesian in Amber/Gold, Bottom English in Crisp White
            <div className="media-subtitle-box inline-flex flex-col items-center max-w-4xl space-y-1">
              <div className="media-subtitle-id text-base sm:text-lg md:text-2xl font-extrabold leading-snug drop-shadow-md">
                {currentActiveCue.idText}
              </div>
              <div className="media-subtitle-en text-xs sm:text-sm md:text-base font-medium leading-snug drop-shadow-sm">
                {currentActiveCue.enText}
              </div>
            </div>
          ) : (
            // Single Track Mode
            <div className="media-subtitle-box inline-block max-w-4xl text-sm sm:text-base md:text-xl font-bold text-white">
              {selectedSub === "id" && currentActiveCue.idText
                ? currentActiveCue.idText
                : selectedSub === "en" && currentActiveCue.enText
                ? currentActiveCue.enText
                : currentActiveCue.rawText}
            </div>
          )}
        </div>
      )}

      {subtitleError && selectedSub !== "off" && (
        <div className="media-subtitle-message" role="status" aria-live="polite">
          {subtitleError}
        </div>
      )}

      {/* Netflix-Style Floating Next Episode Prompt Card */}
      {showNextPrompt && nextEpisode && (
        <div className="media-next-card absolute bottom-28 right-6 z-30 flex items-center gap-3 p-3.5 animate-fade-in max-w-sm">
          <div className="relative w-16 h-12 rounded-lg overflow-hidden bg-black/60 shrink-0">
            <img
              src={anime.cover_image_large}
              alt={`Episode ${nextEpisode.episode_number}`}
              className="w-full h-full object-cover"
            />
            <div className="media-next-art-overlay absolute inset-0 flex items-center justify-center">
              <Play className="w-4 h-4 fill-white text-white" />
            </div>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="media-next-label text-[10px] font-extrabold uppercase tracking-wider">
                Up Next • EP {nextEpisode.episode_number}
              </span>
              <button
                onClick={() => setDismissNextPrompt(true)}
                className="media-next-dismiss"
                aria-label="Dismiss next episode prompt"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <h4 className="text-xs font-bold text-white truncate">
              {nextEpisode.title || `Episode ${nextEpisode.episode_number}`}
            </h4>
            <button
              onClick={() => onSelectEpisode(nextEpisode.episode_number, nextEpisode.episode_id)}
              className="media-action-primary mt-1 inline-flex items-center gap-1.5 self-start"
              aria-label={`Play episode ${nextEpisode.episode_number}`}
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Play Next</span>
            </button>
          </div>
        </div>
      )}

      {/* Skip Intro & Skip Outro Floating Buttons */}
      {isIntroActive && (
        <button
          onClick={() => {
            if (videoRef.current && streamData?.intro?.end) {
              videoRef.current.currentTime = streamData.intro.end;
            }
          }}
          className="media-skip-button absolute bottom-28 right-8 z-30 flex items-center gap-2 px-5 py-2.5 text-xs md:text-sm font-bold"
        >
          <SkipForward className="w-4 h-4 fill-white" />
          {t.playerSkipIntro}
        </button>
      )}

      {isOutroActive && (
        <button
          onClick={() => {
            if (videoRef.current && streamData?.outro?.end) {
              videoRef.current.currentTime = streamData.outro.end;
            }
          }}
          className="media-skip-button absolute bottom-28 right-8 z-30 flex items-center gap-2 px-5 py-2.5 text-xs md:text-sm font-bold"
        >
          <SkipForward className="w-4 h-4 fill-black" />
          {t.playerSkipOutro}
        </button>
      )}

      {/* Loading Spinner */}
      {loading && (
        <div className="media-status-layer absolute inset-0 z-30 flex flex-col items-center justify-center" role="status" aria-live="polite">
          <div className="media-loading-mark"><Play className="h-5 w-5 fill-current" /></div>
          <div className="media-loading-track" aria-hidden="true"><span /></div>
          <span className="media-status-copy">Loading stream</span>
        </div>
      )}

      {/* Error View */}
      {error && (
        <div className="media-status-layer absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center" role="alert">
          <div className="media-error-panel max-w-md">
            <h3 className="media-error-title">Streaming Error</h3>
            <p className="media-error-copy">{error}</p>
            <button
              onClick={onClose}
              className="media-close-action"
            >
              Close Player
            </button>
          </div>
        </div>
      )}

      {/* Top Header Overlay */}
      <div
        className={`media-player-header absolute top-0 left-0 right-0 z-30 p-4 md:p-6 flex items-center justify-between transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="media-player-heading flex items-center gap-3">
          <span className="media-episode-tag">EP {episodeNumber}</span>
          <div className="min-w-0">
            <h2 className="media-player-title">
              {displayTitle}
            </h2>
            <p className="media-player-meta">
              {streamData?.server || "Stream"} <span aria-hidden="true">/</span> {currentQuality === -1 ? "Auto" : qualityLevels[currentQuality]?.height ? `${qualityLevels[currentQuality].height}p` : "Auto"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAmbientGlow(!ambientGlow)}
            title={t.playerAmbientGlow}
            aria-label={t.playerAmbientGlow}
            aria-pressed={ambientGlow}
            className={`media-player-tool-button ${ambientGlow ? "is-active" : ""}`}
          >
            <Sparkles className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            className="media-player-tool-button"
            aria-label="Close player"
            title="Close player"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Bottom Controls HUD */}
      <div
        className={`media-player-hud absolute bottom-0 left-0 right-0 z-30 p-4 md:p-6 transition-opacity duration-300 flex flex-col gap-2 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Scrubber Progress Bar */}
        <div className="media-scrubber-row flex items-center gap-3 w-full">
          <span className="media-timecode text-xs font-mono min-w-[45px]">
            {formatTime(currentTime)}
          </span>
          <div className="relative flex-grow flex items-center group">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              aria-label="Seek in episode"
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
              className="media-range media-seek-range w-full h-1.5 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <span className="media-timecode media-timecode-muted text-xs font-mono min-w-[45px]">
            {formatTime(duration)}
          </span>
        </div>

        {/* Buttons Bar */}
        <div className="media-controls-row flex items-center justify-between pt-1">
          {/* Playback and audio controls */}
          <div className="media-control-group media-left-controls flex items-center gap-2 md:gap-3">
            {/* Previous Episode Button */}
            <button
              onClick={() => prevEpisode && onSelectEpisode(prevEpisode.episode_number, prevEpisode.episode_id)}
              disabled={!prevEpisode}
              title={prevEpisode ? `Previous Episode (EP ${prevEpisode.episode_number}) [P]` : "No previous episode"}
              aria-label="Previous episode"
              className={`media-control-button media-episode-skip ${prevEpisode ? "is-available" : "is-disabled"}`}
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>

            {/* Rewind 10s */}
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
                }
              }}
              title="Rewind 10s [Left Arrow]"
              aria-label="Rewind 10 seconds"
              className="media-control-button media-seek-button hidden sm:flex items-center justify-center"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Play / Pause Primary Button */}
            <button
              onClick={togglePlay}
              title={playing ? "Pause [Space]" : "Play [Space]"}
              aria-label={playing ? "Pause" : "Play"}
              className="media-control-play"
            >
              {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
            </button>

            {/* Forward 10s */}
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = Math.min(videoRef.current.duration || Infinity, videoRef.current.currentTime + 10);
                }
              }}
              title="Fast Forward 10s [Right Arrow]"
              aria-label="Forward 10 seconds"
              className="media-control-button media-seek-button hidden sm:flex items-center justify-center"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Next Episode Button */}
            <button
              onClick={() => nextEpisode && onSelectEpisode(nextEpisode.episode_number, nextEpisode.episode_id)}
              disabled={!nextEpisode}
              title={nextEpisode ? `Next Episode (EP ${nextEpisode.episode_number}) [N]` : "No next episode"}
              aria-label="Next episode"
              className={`media-control-button media-episode-skip ${nextEpisode ? "is-available" : "is-disabled"}`}
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            {/* Volume Controls */}
            <div className="media-volume-controls flex items-center gap-2 group ml-2">
              <button
                onClick={toggleMute}
                title={muted ? "Unmute [M]" : "Mute [M]"}
                aria-label={muted ? "Unmute" : "Mute"}
                className="media-control-button media-volume-button"
              >
                {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
                aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} percent`}
                className="media-range media-volume-range w-16 h-1 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Right Buttons: Episodes Drawer, Subtitles, Quality, Fullscreen */}
          <div className="media-control-group media-right-controls flex items-center gap-2 md:gap-3 relative">
            {/* Episodes Button */}
            <button
              onClick={() => {
                setShowEpisodesDrawer(!showEpisodesDrawer);
                setShowSubMenu(false);
                setShowSettingsMenu(false);
              }}
              title="Episodes Drawer [E]"
              aria-label="Episodes"
              aria-pressed={showEpisodesDrawer}
              className="media-episodes-toggle"
            >
              <ListVideo className="w-4 h-4" />
              <span className="hidden sm:inline">Episodes</span>
            </button>

            {/* Subtitle Selector */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSubMenu(!showSubMenu);
                  setShowSettingsMenu(false);
                }}
                className={`media-tool-button ${selectedSub !== "off" ? "is-active" : ""}`}
                aria-label={t.playerSubtitles}
                title={t.playerSubtitles}
                aria-pressed={selectedSub !== "off"}
              >
                <Captions className="w-5 h-5" />
              </button>

              {showSubMenu && (
                <div className="media-menu absolute bottom-12 right-0 w-64 glass-dropdown rounded-2xl p-2 shadow-2xl flex flex-col gap-1 z-40" role="group" aria-label={t.playerSubtitles}>
                  <div className="media-menu-heading px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
                    {t.playerSubtitles}
                  </div>
                  <button
                    onClick={() => { setSelectedSub("dual"); setShowSubMenu(false); }}
                    className="media-menu-option flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold"
                    aria-pressed={selectedSub === "dual"}
                    disabled={!hasSubtitleTrack("dual")}
                    title={!hasSubtitleTrack("dual") ? "Dual subtitles are not available for this episode" : undefined}
                  >
                    <span>{t.playerDualSub}</span>
                    {hasSubtitleTrack("dual")
                      ? selectedSub === "dual" && <Check className="media-menu-check w-4 h-4" />
                      : <span className="media-track-unavailable">Unavailable</span>}
                  </button>
                  <button
                    onClick={() => { setSelectedSub("id"); setShowSubMenu(false); }}
                    className="media-menu-option flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold"
                    aria-pressed={selectedSub === "id"}
                    disabled={!hasSubtitleTrack("id")}
                    title={!hasSubtitleTrack("id") ? "Indonesian subtitles are not available for this episode" : undefined}
                  >
                    <span>{t.playerIndoSub}</span>
                    {hasSubtitleTrack("id")
                      ? selectedSub === "id" && <Check className="media-menu-check w-4 h-4" />
                      : <span className="media-track-unavailable">Unavailable</span>}
                  </button>
                  <button
                    onClick={() => { setSelectedSub("en"); setShowSubMenu(false); }}
                    className="media-menu-option flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold"
                    aria-pressed={selectedSub === "en"}
                    disabled={!hasSubtitleTrack("en")}
                    title={!hasSubtitleTrack("en") ? "No English source subtitle track was provided for this episode" : undefined}
                  >
                    <span>English (Source)</span>
                    {hasSubtitleTrack("en")
                      ? selectedSub === "en" && <Check className="media-menu-check w-4 h-4" />
                      : <span className="media-track-unavailable">Unavailable</span>}
                  </button>
                  <button
                    onClick={() => { setSelectedSub("en-ai"); setShowSubMenu(false); }}
                    className="media-menu-option flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold"
                    aria-pressed={selectedSub === "en-ai"}
                    disabled={!hasSubtitleTrack("en-ai")}
                    title={!hasSubtitleTrack("en-ai") ? "AI English requires an Indonesian subtitle source" : undefined}
                  >
                    <span>English (AI)</span>
                    {hasSubtitleTrack("en-ai")
                      ? selectedSub === "en-ai" && <Check className="media-menu-check w-4 h-4" />
                      : <span className="media-track-unavailable">Unavailable</span>}
                  </button>
                  <button
                    onClick={() => { setSelectedSub("off"); setShowSubMenu(false); }}
                    className="media-menu-option flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold"
                    aria-pressed={selectedSub === "off"}
                  >
                    <span>{t.playerSubOff}</span>
                    {selectedSub === "off" && <Check className="media-menu-check w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>

            {/* Quality Selector */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSettingsMenu(!showSettingsMenu);
                  setShowSubMenu(false);
                }}
                className="media-tool-button"
                aria-label={t.playerQuality}
                title={t.playerQuality}
                aria-expanded={showSettingsMenu}
              >
                <Settings className="w-5 h-5" />
              </button>

              {showSettingsMenu && (
                <div className="media-menu absolute bottom-12 right-0 w-48 glass-dropdown rounded-2xl p-2 shadow-2xl flex flex-col gap-1 z-40" role="group" aria-label={t.playerQuality}>
                  <div className="media-menu-heading px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
                    {t.playerQuality}
                  </div>
                  <button
                    onClick={() => {
                      if (hlsRef.current) hlsRef.current.currentLevel = -1;
                      setCurrentQuality(-1);
                      setShowSettingsMenu(false);
                    }}
                    className="media-menu-option flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold"
                    aria-pressed={currentQuality === -1}
                  >
                    <span>Auto</span>
                    {currentQuality === -1 && <Check className="media-menu-check w-4 h-4" />}
                  </button>
                  {qualityLevels.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => {
                        if (hlsRef.current) hlsRef.current.currentLevel = lvl.id;
                        setCurrentQuality(lvl.id);
                        setShowSettingsMenu(false);
                      }}
                      className="media-menu-option flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold"
                      aria-pressed={currentQuality === lvl.id}
                    >
                      <span>{lvl.height}p</span>
                      {currentQuality === lvl.id && <Check className="media-menu-check w-4 h-4" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="media-tool-button"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Netflix-Style Sliding Episode Drawer Overlay */}
      {showEpisodesDrawer && (
        <div className="media-drawer-layer fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            onClick={() => setShowEpisodesDrawer(false)}
            className="media-drawer-scrim absolute inset-0"
            aria-label="Close episode list"
          />

          <div
            className="media-drawer relative w-full max-w-sm sm:max-w-md h-full flex flex-col z-10 animate-slide-left"
            role="dialog"
            aria-modal="true"
            aria-labelledby="episode-drawer-title"
          >
            <div className="media-drawer-header p-5 flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <ListVideo className="media-drawer-icon w-5 h-5" />
                  <h3 id="episode-drawer-title" className="text-base font-extrabold text-white">Episodes</h3>
                </div>
                <p className="media-drawer-subtitle text-xs truncate max-w-xs mt-0.5">
                  {displayTitle} / {episodesList.length} Episodes
                </p>
              </div>
              <button
                onClick={() => setShowEpisodesDrawer(false)}
                className="media-player-tool-button"
                aria-label="Close episode list"
                title="Close drawer [Esc]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Episodes List Container */}
            <div className="media-episodes-list flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
              {episodesList.map((ep) => {
                const isCurrent = ep.episode_number === episodeNumber;
                const hist = historyList.find(
                  (h) => h.anilist_id === anime.anilist_id && h.episode_number === ep.episode_number
                );
                const isWatched =
                  hist &&
                  hist.total_seconds > 0 &&
                  hist.progress_seconds / hist.total_seconds >= 0.85;
                const progressPct =
                  hist && hist.total_seconds > 0
                    ? Math.min(100, Math.round((hist.progress_seconds / hist.total_seconds) * 100))
                    : 0;

                const cleanTitle = (() => {
                  if (!ep.title) return `Episode ${ep.episode_number}`;
                  const t = ep.title.trim();
                  if (/^(?:Episode|Ep\.?|EP)?\s*\d+$/i.test(t)) return `Episode ${ep.episode_number}`;
                  const c = t.replace(/^(?:Episode|Ep\.?|EP)?\s*\d+\s*[:\-–—\.]\s*/i, "").trim();
                  return c.length > 0 ? c : `Episode ${ep.episode_number}`;
                })();

                const epDuration = anime.duration_per_ep ? `${anime.duration_per_ep}m` : null;

                return (
                  <button
                    type="button"
                    key={ep.episode_id}
                    ref={isCurrent ? activeEpRef : null}
                    onClick={() => {
                      onSelectEpisode(ep.episode_number, ep.episode_id);
                      setShowEpisodesDrawer(false);
                    }}
                    className={`media-episode-row group p-2.5 sm:p-3 flex items-center gap-3 ${isCurrent ? "is-current" : ""}`}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {/* Episode Number */}
                    <span className={`media-episode-number w-6 text-center text-xs sm:text-sm font-bold shrink-0 ${isCurrent ? "is-current" : ""}`}>
                      {ep.episode_number}
                    </span>

                    <span className="media-episode-art relative w-24 sm:w-28 aspect-video rounded-lg overflow-hidden shrink-0">
                      <img
                        src={anime.banner_image || anime.cover_image_large}
                        alt={`EP ${ep.episode_number}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      {isCurrent ? (
                        <span className="media-episode-art-state media-episode-current-overlay absolute inset-0 flex items-center justify-center">
                          <Play className="w-5 h-5 fill-current" />
                        </span>
                      ) : isWatched ? (
                        <span className="media-episode-art-state media-episode-watched-overlay absolute inset-0 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5" />
                        </span>
                      ) : (
                        <span className="media-episode-art-state media-episode-hover-overlay absolute inset-0 flex items-center justify-center">
                          <Play className="w-5 h-5 fill-current" />
                        </span>
                      )}
                      {progressPct > 0 && (
                        <span className="media-episode-progress absolute bottom-0 inset-x-0 h-1">
                          <span className="media-episode-progress-value block h-full" style={{ width: `${progressPct}%` }} />
                        </span>
                      )}
                    </span>

                    <span className="media-episode-meta flex-1 min-w-0 pr-1">
                      <span className="media-episode-heading flex items-baseline justify-between gap-2 mb-0.5">
                        <span className={`media-episode-title text-xs sm:text-sm font-bold truncate ${isCurrent ? "is-current" : ""}`}>
                          {cleanTitle}
                        </span>
                        {epDuration && <span className="media-episode-duration text-[11px] font-medium shrink-0">{epDuration}</span>}
                      </span>
                      <span className={`media-episode-status ${isCurrent ? "is-current" : isWatched ? "is-watched" : ""}`}>
                        {isCurrent ? "Now Playing" : isWatched ? "Watched" : "Available"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
