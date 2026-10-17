import React, { useState } from "react";
import {
  Bookmark,
  Compass,
  Home,
  Moon,
  Search,
  Settings2,
  Sun,
  Tv,
  UserRound,
  X,
} from "lucide-react";
import { TranslationSchema } from "../i18n";
import { BrandMark } from "./BrandMark";
import { BrandWordmark } from "./BrandWordmark";

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lang: "en" | "id";
  setLang: (lang: "en" | "id") => void;
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
  t: TranslationSchema;
  onSearch: (query: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  lang,
  setLang,
  theme,
  setTheme,
  t,
  onSearch,
}) => {
  const [query, setQuery] = useState("");
  const [showSearchInput, setShowSearchInput] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const search = query.trim();
    if (!search) return;
    onSearch(search);
    setActiveTab("browse");
    setShowSearchInput(false);
  };

  const navItems = [
    { id: "home", label: t.navHome, icon: Home },
    { id: "browse", label: t.navBrowse, icon: Compass },
    ...(activeTab === "details"
      ? [{ id: "details", label: t.details, icon: Tv }]
      : []),
    { id: "watchlist", label: t.navWatchlist, icon: Bookmark },
    { id: "settings", label: t.navSettings, icon: Settings2 },
  ];

  const renderSearch = (className: string, inputId: string) => (
    <form className={`site-search ${className}`} onSubmit={handleSubmit} role="search">
      <label className="sr-only" htmlFor={inputId}>
        {t.searchPlaceholder}
      </label>
      <Search className="h-4 w-4" aria-hidden="true" />
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.searchPlaceholder}
      />
      {showSearchInput && (
        <button
          className="header-icon-button"
          type="button"
          aria-label="Close search"
          onClick={() => setShowSearchInput(false)}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </form>
  );

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <button
          type="button"
          onClick={() => setActiveTab("home")}
          className="brand-button"
          aria-label="Aninyom home"
        >
          <BrandMark />
          <BrandWordmark />
        </button>

        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className="nav-link"
              aria-current={activeTab === id ? "page" : undefined}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="header-tools">
          {renderSearch("desktop-search", "desktop-anime-search")}
          <button
            type="button"
            onClick={() => setShowSearchInput((shown) => !shown)}
            className="header-icon-button search-toggle"
            aria-label={showSearchInput ? "Close search" : "Search anime"}
            aria-expanded={showSearchInput}
          >
            {showSearchInput ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>
          {showSearchInput && renderSearch("mobile-search", "mobile-anime-search")}

          <div className="language-switch" aria-label="Language">
            <button type="button" onClick={() => setLang("en")} aria-pressed={lang === "en"}>
              EN
            </button>
            <button type="button" onClick={() => setLang("id")} aria-pressed={lang === "id"}>
              ID
            </button>
          </div>

          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="header-tool-button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className="header-tool-button"
            aria-label="Account and sync"
            title="Account and sync"
          >
            <UserRound className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems
          .filter(({ id }) => id !== "details")
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-label={label}
              aria-current={activeTab === id ? "page" : undefined}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
      </nav>
    </header>
  );
};
