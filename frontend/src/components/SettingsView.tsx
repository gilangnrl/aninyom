import React, { useEffect, useState } from "react";
import { Sliders, BookOpen, Plus, Check } from "lucide-react";
import { LexiconItem } from "../types";
import { TranslationSchema } from "../i18n";
import { api } from "../api";

interface SettingsViewProps {
  lang: "en" | "id";
  setLang: (lang: "en" | "id") => void;
  t: TranslationSchema;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  lang,
  setLang,
  t,
}) => {
  const [lexicon, setLexicon] = useState<LexiconItem[]>([]);
  const [sourceTerm, setSourceTerm] = useState("");
  const [idTerm, setIdTerm] = useState("");
  const [category, setCategory] = useState("general");
  const [notes, setNotes] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [ambientGlow, setAmbientGlow] = useState(true);
  const [autoSkip, setAutoSkip] = useState(false);

  useEffect(() => {
    api.getLexicon().then(setLexicon).catch(console.error);
    api.getSettings().then((s) => {
      if (s.player_glow !== undefined) setAmbientGlow(s.player_glow === "true");
      if (s.auto_skip_intro !== undefined) setAutoSkip(s.auto_skip_intro === "true");
    }).catch(console.error);
  }, []);

  const handleToggleGlow = () => {
    const nextVal = !ambientGlow;
    setAmbientGlow(nextVal);
    api.saveSetting("player_glow", String(nextVal));
  };

  const handleToggleAutoSkip = () => {
    const nextVal = !autoSkip;
    setAutoSkip(nextVal);
    api.saveSetting("auto_skip_intro", String(nextVal));
  };

  const handleAddLexicon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceTerm.trim() || !idTerm.trim()) return;

    api.saveLexicon({
      source_term: sourceTerm.trim(),
      id_term: idTerm.trim(),
      category,
      notes,
    }).then(() => {
      setSuccessMsg(t.lexiconAdded);
      setTimeout(() => setSuccessMsg(""), 3000);
      setSourceTerm("");
      setIdTerm("");
      setNotes("");
      api.getLexicon().then(setLexicon);
    }).catch(console.error);
  };

  return (
    <div className="w-full space-y-10">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 rounded-full bg-[#7aa2f7]" />
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#dee2f3]">
            {t.settingsTitle}
          </h1>
        </div>
        <p className="text-xs md:text-sm text-[#c3c6d3] mt-1 pl-4.5">
          Customize playback parameters, default subtitles, and fansub dictionary
        </p>
      </div>

      {/* General Preferences Panel */}
      <div className="rounded-2xl bg-[#1a1f2c] p-6 md:p-8 border border-white/5 space-y-6">
        <h2 className="text-base md:text-lg font-bold text-[#dee2f3] flex items-center gap-2">
          <Sliders className="w-5 h-5 text-[#7aa2f7]" />
          General Preferences
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Language Switch */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#c3c6d3] block">
              {t.settingsLang}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLang("en")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  lang === "en"
                    ? "bg-[#7aa2f7] text-[#002e6b] shadow-sm"
                    : "bg-[#252a37] text-[#c3c6d3] hover:text-[#dee2f3]"
                }`}
              >
                English (EN)
              </button>
              <button
                onClick={() => setLang("id")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  lang === "id"
                    ? "bg-[#f6bc6a] text-[#002e6b] shadow-sm"
                    : "bg-[#252a37] text-[#c3c6d3] hover:text-[#dee2f3]"
                }`}
              >
                Bahasa Indonesia (ID)
              </button>
            </div>
          </div>

          {/* Ambient Glow Switch */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-[#252a37] border border-white/5">
            <div>
              <span className="text-xs font-bold text-[#dee2f3] block">
                {t.settingsGlow}
              </span>
              <span className="text-[11px] text-[#c3c6d3]">
                Dynamic atmospheric backlight behind video player
              </span>
            </div>
            <button
              onClick={handleToggleGlow}
              className={`w-12 h-6 rounded-full transition-colors relative p-1 ${
                ambientGlow ? "bg-[#7aa2f7]" : "bg-black/40"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  ambientGlow ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Auto Skip Intro Switch */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-[#252a37] border border-white/5">
            <div>
              <span className="text-xs font-bold text-[#dee2f3] block">
                {t.settingsAutoSkip}
              </span>
              <span className="text-[11px] text-[#c3c6d3]">
                Auto-jump over detected opening &amp; ending credits
              </span>
            </div>
            <button
              onClick={handleToggleAutoSkip}
              className={`w-12 h-6 rounded-full transition-colors relative p-1 ${
                autoSkip ? "bg-[#7aa2f7]" : "bg-black/40"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  autoSkip ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Fansub Lexicon Dictionary Section */}
      <div className="rounded-2xl bg-[#1a1f2c] p-6 md:p-8 border border-white/5 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base md:text-lg font-bold text-[#dee2f3] flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#f6bc6a]" />
              {t.lexiconTitle}
            </h2>
            <p className="text-xs text-[#c3c6d3] mt-1">{t.lexiconDesc}</p>
          </div>
        </div>

        {/* Add Entry Form */}
        <form onSubmit={handleAddLexicon} className="p-4 rounded-xl bg-[#252a37] border border-white/5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-[#c3c6d3] block mb-1">
                {t.lexiconSource}
              </label>
              <input
                type="text"
                value={sourceTerm}
                onChange={(e) => setSourceTerm(e.target.value)}
                placeholder="e.g. Onii-chan"
                className="w-full bg-[#1a1f2c] text-xs text-[#dee2f3] rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-[#7aa2f7]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#c3c6d3] block mb-1">
                {t.lexiconTarget}
              </label>
              <input
                type="text"
                value={idTerm}
                onChange={(e) => setIdTerm(e.target.value)}
                placeholder="e.g. Kakak"
                className="w-full bg-[#1a1f2c] text-xs text-[#dee2f3] rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-[#7aa2f7]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#c3c6d3] block mb-1">
                {t.lexiconCategory}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-[#1a1f2c] text-xs text-[#dee2f3] rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-[#7aa2f7]"
              >
                <option value="honorific">Honorific (Panggilan)</option>
                <option value="phrase">Phrase (Ungkapan)</option>
                <option value="concept">Concept (Konsep/Ikatan)</option>
                <option value="slang">Slang</option>
                <option value="terms">Terms (Jurus/Rank)</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-[#c3c6d3] block mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                className="w-full bg-[#1a1f2c] text-xs text-[#dee2f3] rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-[#7aa2f7]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {successMsg ? (
              <span className="text-xs text-green-400 flex items-center gap-1 font-semibold">
                <Check className="w-3.5 h-3.5" />
                {successMsg}
              </span>
            ) : <span />}
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#7aa2f7] text-[#002e6b] text-xs font-bold transition-all shadow-md active:scale-95 hover:scale-105"
            >
              <Plus className="w-4 h-4" />
              {t.lexiconAdd}
            </button>
          </div>
        </form>

        {/* Existing Terms List */}
        <div className="max-h-60 overflow-y-auto space-y-1.5 pr-2">
          {lexicon.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-[#252a37] border border-white/5 text-xs"
            >
              <div className="flex items-center gap-3">
                <span className="font-bold text-[#f6bc6a] font-mono">
                  {item.source_term}
                </span>
                <span className="text-[#c3c6d3]">→</span>
                <span className="font-semibold text-[#dee2f3]">
                  {item.id_term}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1a1f2c] text-[#c3c6d3] border border-white/5">
                  {item.category}
                </span>
                {item.notes && (
                  <span className="text-[10px] text-[#c3c6d3] hidden sm:inline">
                    {item.notes}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
