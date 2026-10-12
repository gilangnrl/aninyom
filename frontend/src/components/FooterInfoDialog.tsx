import React, { useEffect, useRef, useState } from "react";
import { FileText, ShieldAlert, Volume2, X } from "lucide-react";

export type FooterInfoPage = "audio" | "content" | "legal";

const RIGHTS_HOLDER_EMAIL = "aninyom@nyomlab.site";

interface FooterInfoDialogProps {
  page: FooterInfoPage;
  onClose: () => void;
}

const pageCopy: Record<FooterInfoPage, { title: string; description: string; icon: typeof Volume2 }> = {
  audio: {
    title: "Audio Calibration",
    description: "Play a brief reference tone to check that browser audio reaches your selected output. This does not measure or change your system equalizer.",
    icon: Volume2,
  },
  content: {
    title: "Content Guidelines",
    description: "Anime titles, artwork, and catalog details are provided by external sources. Release times, episode availability, and subtitle tracks can change or vary by title. Aninyom does not guarantee playback quality or availability.",
    icon: FileText,
  },
  legal: {
    title: "Legal & DMCA",
    description: "For rights-holder inquiries or takedown requests, contact the site operator using the address below. Catalog metadata and availability may be provided by third-party sources.",
    icon: ShieldAlert,
  },
};

export const FooterInfoDialog: React.FC<FooterInfoDialogProps> = ({ page, onClose }) => {
  const { title, description, icon: Icon } = pageCopy[page];
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [audioError, setAudioError] = useState("");

  const stopAudioTest = () => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try {
      oscillatorRef.current?.stop();
    } catch {
      // The oscillator may already have completed its short test tone.
    }
    oscillatorRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    setIsTesting(false);
  };

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      try {
        oscillatorRef.current?.stop();
      } catch {
        // The oscillator may already have completed its short test tone.
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
    };
  }, [onClose]);

  const playTestTone = async () => {
    setAudioError("");
    if (!window.AudioContext) {
      setAudioError("This browser does not support the audio output check.");
      return;
    }

    try {
      const context = new window.AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      audioContextRef.current = context;
      oscillatorRef.current = oscillator;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(440, context.currentTime);
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.045, context.currentTime + 0.04);
      gain.gain.setValueAtTime(0.045, context.currentTime + 0.62);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.78);
      oscillator.connect(gain);
      gain.connect(context.destination);
      await context.resume();
      oscillator.start();
      oscillator.stop(context.currentTime + 0.8);
      setIsTesting(true);
      stopTimerRef.current = window.setTimeout(stopAudioTest, 850);
    } catch {
      setAudioError("The audio output check could not start. Check your browser audio permissions.");
      stopAudioTest();
    }
  };

  return (
    <div
      className="footer-info-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="footer-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="footer-info-title"
        aria-describedby="footer-info-description"
      >
        <div className="footer-info-heading">
          <div className="footer-info-icon"><Icon className="h-5 w-5" aria-hidden="true" /></div>
          <button
            ref={closeButtonRef}
            type="button"
            className="footer-info-close"
            onClick={onClose}
            aria-label="Close information"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id="footer-info-title">{title}</h2>
        <p id="footer-info-description">{description}</p>

        {page === "audio" && (
          <div className="footer-info-action-area">
            <button
              type="button"
              className="footer-info-action"
              onClick={() => void playTestTone()}
              disabled={isTesting}
            >
              <Volume2 className="h-4 w-4" aria-hidden="true" />
              {isTesting ? "Testing output…" : "Play test tone"}
            </button>
            {audioError && <p className="footer-info-error" role="alert">{audioError}</p>}
          </div>
        )}

        {page === "legal" && (
          <div className="footer-info-notice">
            <strong>Site operator: Aninyom</strong>
            <a className="footer-info-contact" href={`mailto:${RIGHTS_HOLDER_EMAIL}`}>
              {RIGHTS_HOLDER_EMAIL}
            </a>
          </div>
        )}
      </section>
    </div>
  );
};
