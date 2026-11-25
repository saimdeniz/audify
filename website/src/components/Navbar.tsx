import React, { useEffect, useState } from "react";
import { Contrast, Download, Menu, Moon, Sparkles, Sun, X } from "lucide-react";
import { ACCENT_PRESETS, SITE_CONFIG, type AsciiPresetId, type ThemeMode } from "../config/siteConfig";
import { useTheme } from "../context/ThemeContext";
import { useI18n } from "../i18n";

const NAV_SECTIONS = [
  { id: "overview", key: "overview" as const },
  { id: "demo", key: "demo" as const },
  { id: "features", key: "features" as const },
  { id: "workflow", key: "workflow" as const },
  { id: "docs", key: "docs" as const },
  { id: "faq", key: "faq" as const },
];

const ASCII_PRESET_LIST: readonly AsciiPresetId[] = ["isobars", "spectrum", "horizon"];

interface NavbarProps {
  version: string;
}

export const Navbar: React.FC<NavbarProps> = ({ version }) => {
  const { messages } = useI18n();
  const {
    theme,
    setTheme,
    accent,
    setAccentById,
    asciiEnabled,
    setAsciiEnabled,
    asciiPreset,
    setAsciiPreset,
  } = useTheme();
  const [activeId, setActiveId] = useState<string>("overview");
  const [scrolled, setScrolled] = useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const offset = window.scrollY + 180;
      let current = "overview";
      for (const sec of NAV_SECTIONS) {
        const el = document.getElementById(sec.id);
        if (el && el.offsetTop <= offset) {
          current = sec.id;
        }
      }
      setActiveId(current);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const themeButtons: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { mode: "dark", label: "Dark", icon: <Moon className="h-3.5 w-3.5" /> },
    { mode: "light", label: "Light", icon: <Sun className="h-3.5 w-3.5" /> },
    { mode: "contrast", label: "Contrast", icon: <Contrast className="h-3.5 w-3.5" /> },
  ];

  return (
    <header className="fixed inset-x-0 top-3 z-40 px-3 sm:px-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2">
        <nav
          aria-label="Primary navigation"
          className={`surface-glass-strong flex h-12 items-center justify-between rounded-lg border px-3 transition-shadow duration-150 ${
            scrolled ? "border-line-strong shadow-lg" : "border-line"
          }`}
        >
          {/* Brand */}
          <a
            href="#overview"
            className="flex items-center gap-2.5 rounded-sm px-1.5 py-1 text-fg transition-colors hover:text-accent-fg"
          >
            <img
              src="./audify-icon.png"
              alt=""
              aria-hidden="true"
              className="h-6 w-6 rounded-[5px] object-contain"
            />
            <span className="text-[13px] font-semibold tracking-tight">{SITE_CONFIG.appName}</span>
            <span className="hidden rounded-[3px] border border-line bg-surface-badge px-1.5 py-0.5 font-mono text-[10px] text-fg-3 sm:inline-block">
              {version}
            </span>
          </a>

          {/* Center Anchor Links */}
          <div className="hidden items-center gap-0.5 lg:flex">
            {NAV_SECTIONS.map((sec) => {
              const isActive = activeId === sec.id;
              return (
                <a
                  key={sec.id}
                  href={`#${sec.id}`}
                  className={`rounded-sm px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-75 ${
                    isActive
                      ? "bg-accent-soft text-accent-fg"
                      : "text-fg-3 hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  {messages.nav[sec.key]}
                </a>
              );
            })}
          </div>

          {/* Right Studio Controls */}
          <div className="flex items-center gap-2">
            {/* Theme segmented toggle */}
            <div
              role="group"
              aria-label={messages.nav.themeLabel}
              className="hidden items-center rounded-sm border border-line bg-surface-0 p-0.5 sm:flex"
            >
              {themeButtons.map((btn) => {
                const active = theme === btn.mode;
                return (
                  <button
                    key={btn.mode}
                    type="button"
                    title={`${messages.nav.themeLabel}: ${btn.label}`}
                    aria-label={`${messages.nav.themeLabel}: ${btn.label}`}
                    aria-pressed={active}
                    onClick={() => setTheme(btn.mode)}
                    className={`flex h-6 w-7 items-center justify-center rounded-[3px] transition-colors duration-75 ${
                      active
                        ? "bg-accent-soft text-accent-fg"
                        : "text-fg-3 hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    {btn.icon}
                  </button>
                );
              })}
            </div>

            {/* Uniform rounded-square Accent Swatches */}
            <div
              role="group"
              aria-label={messages.nav.accentLabel}
              className="hidden items-center gap-1 rounded-sm border border-line bg-surface-0 px-1.5 py-1 xl:flex"
            >
              {ACCENT_PRESETS.map((preset) => {
                const active = accent.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.label}
                    aria-label={preset.label}
                    aria-pressed={active}
                    onClick={() => setAccentById(preset.id)}
                    className={`h-3.5 w-3.5 rounded-[2px] border transition-transform duration-75 ${
                      active
                        ? "scale-110 border-fg ring-1 ring-accent"
                        : "border-line hover:scale-105"
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  />
                );
              })}
            </div>

            {/* Redesigned ASCII toggle */}
            <button
              type="button"
              disabled={theme === "contrast"}
              title={
                theme === "contrast"
                  ? messages.nav.asciiDisabledContrast
                  : messages.nav.asciiLabel
              }
              aria-pressed={asciiEnabled && theme !== "contrast"}
              onClick={() => setAsciiEnabled(!asciiEnabled)}
              className={`hidden h-7 items-center gap-1.5 rounded-sm border px-2 font-mono text-[11px] transition-colors duration-75 sm:inline-flex ${
                theme === "contrast"
                  ? "cursor-not-allowed border-line bg-surface-2 text-fg-faint opacity-50"
                  : asciiEnabled
                    ? "border-accent bg-accent-soft text-accent-fg"
                    : "border-line bg-surface-2 text-fg-3 hover:border-line-hover hover:text-fg"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>{messages.ascii.label}</span>
            </button>

            {/* Primary Download pill */}
            <a
              href="#download"
              aria-label={messages.nav.download}
              title={messages.nav.download}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-accent px-3 text-[12px] font-semibold text-accent-on transition-colors duration-75 hover:bg-accent-hover"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{messages.nav.download}</span>
            </a>

            {/* Mobile menu toggle */}
            <button
              type="button"
              aria-label="Toggle navigation menu"
              onClick={() => setMobileOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-sm border border-line bg-surface-2 text-fg-2 hover:text-fg lg:hidden"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>

        {/* Sub-pill for redesigned ASCII Preset selector when ASCII mode is active */}
        {asciiEnabled && theme !== "contrast" && (
          <div className="flex justify-end">
            <div className="surface-glass-strong inline-flex items-center gap-1 rounded-md border border-line px-2 py-1">
              <span className="px-1 font-mono text-[10px] uppercase tracking-wider text-fg-3">
                ASCII Scene
              </span>
              {ASCII_PRESET_LIST.map((preset) => {
                const active = asciiPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAsciiPreset(preset)}
                    className={`rounded-[3px] px-2 py-0.5 font-mono text-[10px] transition-colors duration-75 ${
                      active
                        ? "bg-accent-soft text-accent-fg"
                        : "text-fg-3 hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    {messages.ascii.presets[preset]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mobile Dropdown Drawer */}
        {mobileOpen && (
          <div className="surface-glass-strong rounded-lg border border-line p-3 lg:hidden">
            <div className="grid grid-cols-2 gap-1.5">
              {NAV_SECTIONS.map((sec) => (
                <a
                  key={sec.id}
                  href={`#${sec.id}`}
                  onClick={() => setMobileOpen(false)}
                  className={`rounded-sm px-2.5 py-2 text-[12px] font-medium ${
                    activeId === sec.id
                      ? "bg-accent-soft text-accent-fg"
                      : "text-fg-2 hover:bg-surface-hover"
                  }`}
                >
                  {messages.nav[sec.key]}
                </a>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-1">
                {themeButtons.map((btn) => (
                  <button
                    key={btn.mode}
                    type="button"
                    onClick={() => setTheme(btn.mode)}
                    className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] ${
                      theme === btn.mode
                        ? "border-accent bg-accent-soft text-accent-fg"
                        : "border-line bg-surface-2 text-fg-3"
                    }`}
                  >
                    {btn.icon}
                    <span>{btn.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  disabled={theme === "contrast"}
                  aria-pressed={asciiEnabled && theme !== "contrast"}
                  onClick={() => setAsciiEnabled(!asciiEnabled)}
                  className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-mono text-[11px] ${
                    theme === "contrast"
                      ? "cursor-not-allowed border-line bg-surface-2 text-fg-faint opacity-50"
                      : asciiEnabled
                        ? "border-accent bg-accent-soft text-accent-fg"
                        : "border-line bg-surface-2 text-fg-3"
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{messages.ascii.label}</span>
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={preset.label}
                    onClick={() => setAccentById(preset.id)}
                    className={`h-4 w-4 rounded-[2px] border ${
                      accent.id === preset.id ? "border-fg ring-1 ring-accent" : "border-line"
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
