import React, { useEffect, useRef, useState } from "react";
import { Sliders, BookOpen, Plus, Check, Cloud, Copy, LogOut, Trash2 } from "lucide-react";
import { LexiconItem } from "../types";
import { TranslationSchema } from "../i18n";
import { api } from "../api";
import { localUserData } from "../localUserData";
import {
  getSyncCode,
  createSyncCode,
  connectSync,
  disconnectSync,
  deleteSyncData,
  syncNow,
} from "../syncClient";
import {
  Account,
  getAccount,
  renderGoogleButton,
  signInWithGoogle,
  signOutGoogle,
  deleteGoogleAccount,
} from "../auth";

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

  const [syncCode, setSyncCodeState] = useState<string | null>(() => getSyncCode());
  const [codeInput, setCodeInput] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [account, setAccount] = useState<Account | null>(() => getAccount());
  const [googleError, setGoogleError] = useState("");
  const googleButtonRef = useRef<HTMLDivElement>(null);

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

  const runSyncAction = async (action: () => Promise<void>, failMsg: string) => {
    setSyncBusy(true);
    setSyncError("");
    try {
      await action();
      setSyncCodeState(getSyncCode());
    } catch (e) {
      setSyncError(e instanceof Error && e.message ? e.message : failMsg);
      setSyncCodeState(getSyncCode());
    } finally {
      setSyncBusy(false);
    }
  };

  useEffect(() => {
    if (account || !googleButtonRef.current) return;
    setGoogleError("");
    renderGoogleButton(googleButtonRef.current, (credential) =>
      runSyncAction(async () => {
        const signedIn = await signInWithGoogle(credential);
        setAccount(signedIn);
        await syncNow();
      }, "Could not sign in with Google.")
    ).catch((e) =>
      setGoogleError(e instanceof Error ? e.message : "Google sign-in is unavailable.")
    );
  }, [account]);

  // Clears this device's copy after the session is gone; the server copy comes back on sign-in.
  const handleSignOutGoogle = () =>
    runSyncAction(async () => {
      await signOutGoogle();
      disconnectSync();
      localUserData.clearAll();
      window.location.reload();
    }, "Could not sign out.");

  const handleDeleteGoogleAccount = () => {
    if (!window.confirm("Delete your account and the synced copy on the server? Data on this device is kept.")) return;
    runSyncAction(async () => {
      await deleteGoogleAccount();
      setAccount(null);
    }, "Could not delete your account.");
  };

  const handleCreateSync = () =>
    runSyncAction(async () => {
      await createSyncCode();
    }, "Could not create a sync code.");

  const handleConnectSync = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim()) return;
    runSyncAction(async () => {
      await connectSync(codeInput);
      setCodeInput("");
    }, "Could not connect. Check the code and try again.");
  };

  const handleDisconnectSync = () => {
    disconnectSync();
    setSyncCodeState(null);
  };

  const handleDeleteSync = () => {
    if (!window.confirm("Delete the synced copy on the server? Data on this device is kept.")) return;
    runSyncAction(deleteSyncData, "Could not delete synced data.");
  };

  const handleCopySync = async () => {
    if (!syncCode) return;
    await navigator.clipboard.writeText(syncCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

      {/* Sync Across Devices Panel */}
      <div className="rounded-2xl bg-[#1a1f2c] p-6 md:p-8 border border-white/5 space-y-6">
        <div>
          <h2 className="text-base md:text-lg font-bold text-[#dee2f3] flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[#7aa2f7]" />
            Sync across devices
          </h2>
          <p className="text-xs text-[#c3c6d3] mt-1">
            Your watchlist and history are saved in this browser. Sign in with Google to use them on any device, or create a sync code instead. Anyone with a sync code can read and change its synced data, so keep it private.
          </p>
        </div>

        {account ? (
          <div className="p-4 rounded-xl bg-[#252a37] border border-white/5 space-y-4">
            <div className="flex items-center gap-3 min-w-0">
              {account.picture && (
                <img src={account.picture} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-full" />
              )}
              <div className="min-w-0">
                <span className="text-xs font-bold text-[#dee2f3] block truncate">{account.name || "Signed in"}</span>
                <span className="text-[11px] text-[#c3c6d3] block truncate">{account.email}</span>
              </div>
            </div>
            <p className="text-[11px] text-[#c3c6d3]">
              Your list syncs to this account on every device where you sign in with Google.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSignOutGoogle}
                disabled={syncBusy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1a1f2c] text-xs font-bold text-[#c3c6d3] border border-white/10 hover:text-[#dee2f3] disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
              <button
                onClick={handleDeleteGoogleAccount}
                disabled={syncBusy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-500/10 text-xs font-bold text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete account
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-[#252a37] border border-white/5 space-y-3">
            <span className="text-xs font-bold text-[#dee2f3] block">Sign in with Google</span>
            <p className="text-[11px] text-[#c3c6d3]">
              Syncs your list to your account on every device. No code needed.
            </p>
            <div ref={googleButtonRef} className="google-signin-btn" />
            {googleError && <p className="text-[11px] text-[#c3c6d3]">{googleError}</p>}
          </div>
        )}

        {!account && (syncCode ? (
          <div className="p-4 rounded-xl bg-[#252a37] border border-white/5 space-y-4">
            <div>
              <span className="text-[11px] text-[#c3c6d3] block mb-1">Your sync code</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono font-bold text-[#f6bc6a] tracking-widest">
                  {syncCode}
                </code>
                <button
                  onClick={handleCopySync}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1a1f2c] text-xs font-semibold text-[#dee2f3] border border-white/10 hover:border-[#7aa2f7]"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[11px] text-[#c3c6d3] mt-2">
                Enter this code on another device to load your list. If you lose it, your synced copy cannot be recovered.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleDisconnectSync}
                disabled={syncBusy}
                className="px-4 py-2 rounded-full bg-[#1a1f2c] text-xs font-bold text-[#c3c6d3] border border-white/10 hover:text-[#dee2f3] disabled:opacity-50"
              >
                Turn off sync on this device
              </button>
              <button
                onClick={handleDeleteSync}
                disabled={syncBusy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-500/10 text-xs font-bold text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete synced data
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-[#252a37] border border-white/5 space-y-3">
              <span className="text-xs font-bold text-[#dee2f3] block">New sync code</span>
              <p className="text-[11px] text-[#c3c6d3]">
                Creates a code for this device. Your current list is uploaded.
              </p>
              <button
                onClick={handleCreateSync}
                disabled={syncBusy}
                className="px-5 py-2 rounded-full bg-[#7aa2f7] text-[#002e6b] text-xs font-bold shadow-md active:scale-95 disabled:opacity-50"
              >
                Create code
              </button>
            </div>
            <form onSubmit={handleConnectSync} className="p-4 rounded-xl bg-[#252a37] border border-white/5 space-y-3">
              <label className="text-xs font-bold text-[#dee2f3] block">I have a code</label>
              <p className="text-[11px] text-[#c3c6d3]">
                Connecting merges this device's list with the synced list. The newer change wins.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="flex-1 bg-[#1a1f2c] text-xs font-mono text-[#dee2f3] rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-[#7aa2f7]"
                />
                <button
                  type="submit"
                  disabled={syncBusy || !codeInput.trim()}
                  className="px-4 py-2 rounded-full bg-[#7aa2f7] text-[#002e6b] text-xs font-bold disabled:opacity-50"
                >
                  Connect
                </button>
              </div>
            </form>
          </div>
        ))}

        {syncError && <p className="text-xs text-red-400 font-semibold">{syncError}</p>}
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
