export interface TranslationSchema {
  appName: string;
  tagline: string;
  navHome: string;
  navBrowse: string;
  navWatchlist: string;
  navSettings: string;
  searchPlaceholder: string;
  trendingNow: string;
  topPopular: string;
  seasonalAnime: string;
  continueWatching: string;
  episode: string;
  episodes: string;
  playNow: string;
  details: string;
  resumeAt: string;
  duration: string;
  score: string;
  status: string;
  studios: string;
  genres: string;
  synopsis: string;
  selectEpisode: string;
  noEpisodesFound: string;
  bookmark: string;
  bookmarkWatching: string;
  bookmarkPlan: string;
  bookmarkCompleted: string;
  bookmarkDropped: string;
  bookmarkFavorite: string;
  playerSettings: string;
  playerQuality: string;
  playerSubtitles: string;
  playerDualSub: string;
  playerIndoSub: string;
  playerEngSub: string;
  playerSubOff: string;
  playerSkipIntro: string;
  playerSkipOutro: string;
  playerNextEp: string;
  playerPrevEp: string;
  playerServer: string;
  playerAmbientGlow: string;
  settingsTitle: string;
  settingsLang: string;
  settingsDefaultSub: string;
  settingsAutoSkip: string;
  settingsAutoNext: string;
  settingsGlow: string;
  settingsSaveSuccess: string;
  lexiconTitle: string;
  lexiconDesc: string;
  lexiconSource: string;
  lexiconTarget: string;
  lexiconCategory: string;
  lexiconAdd: string;
  lexiconAdded: string;
  emptyWatchlist: string;
  emptyHistory: string;
}

export const translations: Record<"en" | "id", TranslationSchema> = {
  en: {
    appName: "Aninyom",
    tagline: "Bilingual Anime Streaming",
    navHome: "Home",
    navBrowse: "Browse",
    navWatchlist: "Watchlist",
    navSettings: "Settings",
    searchPlaceholder: "Search anime by title, genre...",
    trendingNow: "Trending Now",
    topPopular: "All-Time Popular",
    seasonalAnime: "Current Season",
    continueWatching: "Continue Watching",
    episode: "Episode",
    episodes: "Episodes",
    playNow: "Play Now",
    details: "Details",
    resumeAt: "Resume at",
    duration: "Duration",
    score: "Score",
    status: "Status",
    studios: "Studios",
    genres: "Genres",
    synopsis: "Synopsis",
    selectEpisode: "Select Episode",
    noEpisodesFound: "No streamable episodes found yet.",
    bookmark: "Bookmark",
    bookmarkWatching: "Watching",
    bookmarkPlan: "Plan to Watch",
    bookmarkCompleted: "Completed",
    bookmarkDropped: "Dropped",
    bookmarkFavorite: "Favorite",
    playerSettings: "Player settings",
    playerQuality: "Quality",
    playerSubtitles: "Subtitles",
    playerDualSub: "Dual Subtitles (ID + EN)",
    playerIndoSub: "Indonesian (AI Fansub)",
    playerEngSub: "English (Original)",
    playerSubOff: "Subtitles Off",
    playerSkipIntro: "Skip Intro",
    playerSkipOutro: "Skip Outro",
    playerNextEp: "Next Episode",
    playerPrevEp: "Previous Episode",
    playerServer: "Server",
    playerAmbientGlow: "Ambient Glow",
    settingsTitle: "Preferences & Settings",
    settingsLang: "UI Language",
    settingsDefaultSub: "Default Subtitle Track",
    settingsAutoSkip: "Auto-skip Opening & Ending",
    settingsAutoNext: "Auto-play Next Episode",
    settingsGlow: "Dynamic Ambient Backlight",
    settingsSaveSuccess: "Settings updated successfully",
    lexiconTitle: "Fansub Lexicon Dictionary",
    lexiconDesc: "Customize terms and slang used by the Indonesian AI fansub translation engine.",
    lexiconSource: "Original Term (e.g. Onii-chan)",
    lexiconTarget: "Indonesian Translation (e.g. Kakak)",
    lexiconCategory: "Category",
    lexiconAdd: "Add / Update Term",
    lexiconAdded: "Term saved to translation lexicon!",
    emptyWatchlist: "Your watchlist is currently empty. Explore trending shows and bookmark your favorites!",
    emptyHistory: "No watch history recorded yet. Start watching an episode!",
  },
  id: {
    appName: "Aninyom",
    tagline: "Streaming Anime Dwibahasa",
    navHome: "Beranda",
    navBrowse: "Jelajah",
    navWatchlist: "Daftar Tonton",
    navSettings: "Pengaturan",
    searchPlaceholder: "Cari anime, genre, judul...",
    trendingNow: "Sedang Tren",
    topPopular: "Paling Populer",
    seasonalAnime: "Musim Ini",
    continueWatching: "Lanjut Nonton",
    episode: "Episode",
    episodes: "Episode",
    playNow: "Nonton Sekarang",
    details: "Detail",
    resumeAt: "Lanjut di",
    duration: "Durasi",
    score: "Skor",
    status: "Status",
    studios: "Studio",
    genres: "Genre",
    synopsis: "Sinopsis",
    selectEpisode: "Pilih Episode",
    noEpisodesFound: "Belum ada episode yang siap diputar.",
    bookmark: "Tandai",
    bookmarkWatching: "Sedang Nonton",
    bookmarkPlan: "Rencana Nonton",
    bookmarkCompleted: "Selesai",
    bookmarkDropped: "Berhenti Nonton",
    bookmarkFavorite: "Favorit",
    playerSettings: "Pengaturan Pemutar",
    playerQuality: "Kualitas",
    playerSubtitles: "Teks Terjemahan",
    playerDualSub: "Dwibahasa (ID + EN)",
    playerIndoSub: "Bahasa Indonesia (AI Fansub)",
    playerEngSub: "Bahasa Inggris (Asli)",
    playerSubOff: "Matikan Subtitle",
    playerSkipIntro: "Lewati Intro",
    playerSkipOutro: "Lewati Outro",
    playerNextEp: "Episode Selanjutnya",
    playerPrevEp: "Episode Sebelumnya",
    playerServer: "Server",
    playerAmbientGlow: "Cahaya Sekitar (Ambient Glow)",
    settingsTitle: "Preferensi & Pengaturan",
    settingsLang: "Bahasa Tampilan",
    settingsDefaultSub: "Bahasa Subtitle Utama",
    settingsAutoSkip: "Lewati Otomatis Intro/Outro",
    settingsAutoNext: "Otomatis Putar Episode Berikutnya",
    settingsGlow: "Efek Cahaya Dinamis",
    settingsSaveSuccess: "Pengaturan berhasil diperbarui",
    lexiconTitle: "Kamus Istilah Fansub",
    lexiconDesc: "Atur istilah anime dan sebutan fansub untuk mesin terjemahan Bahasa Indonesia.",
    lexiconSource: "Istilah Asli (misal: Onii-chan)",
    lexiconTarget: "Terjemahan Indonesia (misal: Kakak)",
    lexiconCategory: "Kategori",
    lexiconAdd: "Simpan Istilah",
    lexiconAdded: "Istilah tersimpan ke kamus penerjemah!",
    emptyWatchlist: "Daftar tonton Anda masih kosong. Cari anime menarik dan tandai favorit Anda!",
    emptyHistory: "Belum ada riwayat tontonan. Mulai tonton episode pertama Anda!",
  }
};
