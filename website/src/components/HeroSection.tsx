import React, { useEffect, useState } from "react";
import { ArrowDownRight, Download, HardDrive, Maximize2, ShieldCheck, Zap } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useI18n } from "../i18n";
import { Reveal } from "./Reveal";

type HeroPreviewKey = "dark" | "light" | "contrast" | "ascii" | "collapsed";

const HERO_MEDIA: Record<HeroPreviewKey, string> = {
  dark: "./media/dark-theme.webp",
  light: "./media/light-theme.webp",
  contrast: "./media/contrast-theme.webp",
  ascii: "./media/ascii-theme.webp",
  collapsed: "./media/collapsed-sidebar.webp",
};

interface HeroSectionProps {
  onOpenLightbox: (src: string, caption: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenLightbox }) => {
  const { messages } = useI18n();
  const { theme, asciiEnabled } = useTheme();
  const [previewKey, setPreviewKey] = useState<HeroPreviewKey>("dark");

  // Keep the hero screenshot synced whenever the user switches the website theme or ASCII toggle
  useEffect(() => {
    if (theme === "contrast") {
      setPreviewKey("contrast");
    } else if (asciiEnabled) {
      setPreviewKey("ascii");
    } else {
      setPreviewKey(theme);
    }
  }, [theme, asciiEnabled]);

  const previewKeys: HeroPreviewKey[] = ["dark", "light", "contrast", "ascii", "collapsed"];

  return (
    <section id="overview" className="relative z-10 pb-16 pt-28 sm:pb-20 sm:pt-32">
      <div className="page-rail">
        {/* Eyebrow */}
        <Reveal>
          <div className="mb-5 inline-flex items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
            <span className="h-1.5 w-1.5 rounded-[2px] bg-accent" />
            <span>{messages.hero.eyebrow}</span>
          </div>
        </Reveal>

        {/* Headline + Copy */}
        <Reveal delayMs={60}>
          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.06] tracking-[-0.03em] text-fg sm:text-6xl">
            {messages.hero.titleLine1}
            <br />
            <span className="text-accent-fg">{messages.hero.titleAccent}</span>
          </h1>
        </Reveal>

        <Reveal delayMs={120}>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-fg-2 sm:text-[16px]">
            {messages.hero.subtitle}
          </p>
        </Reveal>

        {/* Actions + Key Specs */}
        <Reveal delayMs={180}>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#download"
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-accent px-5 text-[13px] font-semibold text-accent-on transition-all duration-100 hover:-translate-y-[1px] hover:bg-accent-hover"
            >
              <Download className="h-4 w-4" />
              <span>{messages.hero.ctaPrimary}</span>
            </a>
            <a
              href="#demo"
              className="surface-card-soft inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong px-5 text-[13px] font-medium text-fg transition-all duration-100 hover:-translate-y-[1px] hover:border-accent hover:text-accent-fg"
            >
              <span>{messages.hero.ctaSecondary}</span>
              <ArrowDownRight className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-accent-fg" />
              {messages.hero.metaPortable}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-accent-fg" />
              {messages.hero.metaOffline}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-accent-fg" />
              {messages.hero.metaScale}
            </span>
          </div>
        </Reveal>

        {/* Theme-Synced Real Audify Screenshot Stage */}
        <Reveal delayMs={240} className="mt-10">
          <div className="surface-glass overflow-hidden rounded-lg border border-line-strong shadow-2xl">
            {/* Stage Toolbar — single clean horizontal rail on mobile & desktop */}
            <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-header px-3 py-2">
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {previewKeys.map((key) => {
                  const active = previewKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPreviewKey(key)}
                      className={`shrink-0 whitespace-nowrap rounded-[3px] px-2.5 py-1 font-mono text-[11px] transition-colors duration-75 ${
                        active
                          ? "bg-accent-soft text-accent-fg"
                          : "text-fg-3 hover:bg-surface-hover hover:text-fg"
                      }`}
                    >
                      {messages.hero.previewTabs[key]}
                    </button>
                  );
                })}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden font-mono text-[10px] text-fg-3 md:inline">
                  {messages.hero.previewCaption}
                </span>
                <button
                  type="button"
                  title={messages.hero.zoomHint}
                  aria-label={messages.hero.zoomHint}
                  onClick={() =>
                    onOpenLightbox(
                      HERO_MEDIA[previewKey],
                      `Audify — ${messages.hero.previewTabs[previewKey]}`
                    )
                  }
                  className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line bg-surface-2 px-2 font-mono text-[10px] text-fg-2 hover:border-accent hover:text-accent-fg"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span className="hidden sm:inline">{messages.hero.zoomHint}</span>
                </button>
              </div>
            </div>

            {/* Real 1920x1032 Capture */}
            <div className="relative aspect-[1920/1032] w-full overflow-hidden bg-surface-0">
              <img
                src={HERO_MEDIA[previewKey]}
                alt={`Audify desktop interface — ${messages.hero.previewTabs[previewKey]}`}
                className="h-full w-full object-cover transition-opacity duration-200"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
