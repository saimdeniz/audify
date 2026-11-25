import React, { useMemo, useState } from "react";
import { Crosshair, Eye, EyeOff, Maximize2 } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useI18n } from "../i18n";
import { Reveal } from "./Reveal";

interface FocusRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FrameConfig {
  image: (theme: "dark" | "light" | "contrast") => string;
  aspectClass: string;
  rect: FocusRect;
  tag: string;
  hoverToSubMode?: string;
}

const themeMainImage = (theme: "dark" | "light" | "contrast"): string => {
  if (theme === "light") return "./media/light-theme.webp";
  if (theme === "contrast") return "./media/contrast-theme.webp";
  return "./media/dark-theme.webp";
};

const FRAME_CONFIGS: Record<string, FrameConfig> = {
  "deck:waveform": {
    image: themeMainImage,
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 16.5, top: 3.1, width: 83.2, height: 10.2 },
    tag: "WAVEFORM DECK · RIGHT-DRAG SLICE",
  },
  "deck:transport": {
    image: themeMainImage,
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 0.3, top: 3.1, width: 16.3, height: 10.2 },
    tag: "TRANSPORT · LIVE PITCH (-12st / +12st)",
  },
  "search:table": {
    image: themeMainImage,
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 16.5, top: 17.0, width: 83.2, height: 77.5 },
    tag: "VIRTUALIZED 34px TABLE · MINI WAVEFORMS",
  },
  "search:searchbar": {
    image: themeMainImage,
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 16.5, top: 13.1, width: 83.2, height: 4.1 },
    tag: "FTS5 SMART SEARCH + TAG CLOUD",
  },
  "similarity:drop": {
    image: () => "./media/similarity-drop.webp",
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 16.5, top: 3.1, width: 83.2, height: 10.3 },
    tag: "DROP EXTERNAL AUDIO TO MATCH",
  },
  "similarity:results": {
    image: () => "./media/similarity-results.webp",
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 16.5, top: 16.8, width: 83.2, height: 34.5 },
    tag: "55 MATCHES · 0.2 MS · ANCHOR & SCORES",
  },
  "taxonomy:tags": {
    image: () => "./media/tags-drawer.webp",
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 2.2, top: 80.2, width: 97.5, height: 17.6 },
    tag: "FACETED TAGS DRAWER · COLOR SWATCHES",
  },
  "taxonomy:genre": {
    image: () => "./media/genre-drawer.webp",
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 2.2, top: 80.2, width: 97.5, height: 17.6 },
    tag: "GENRE & MOOD TAXONOMY DRAWER",
  },
  "minidock:idle": {
    image: () => "./media/edge-peek-idle.webp",
    aspectClass: "aspect-[1919/1080]",
    rect: { left: 95.8, top: 28.0, width: 4.0, height: 42.0 },
    tag: "WIN32 EDGE-PEEK STRIP",
    hoverToSubMode: "open",
  },
  "minidock:open": {
    image: () => "./media/edge-peek-open.webp",
    aspectClass: "aspect-[1919/1080]",
    rect: { left: 71.8, top: 0.4, width: 28.0, height: 95.0 },
    tag: "MINI DOCK · DIRECT NLE DRAG",
  },
  "settings:audio": {
    image: () => "./media/settings-audio.webp",
    aspectClass: "aspect-[1920/1032]",
    rect: { left: 22.0, top: 7.5, width: 56.0, height: 85.0 },
    tag: "WASAPI AUDIO ENGINE",
  },
};

interface FeatureTourSectionProps {
  onOpenLightbox: (src: string, caption: string) => void;
}

export const FeatureTourSection: React.FC<FeatureTourSectionProps> = ({ onOpenLightbox }) => {
  const { messages } = useI18n();
  const { theme } = useTheme();
  const items = messages.features.items;

  const [activeFeatureId, setActiveFeatureId] = useState<string>(items[0].id);
  const [subModeByFeature, setSubModeByFeature] = useState<Record<string, string>>({});
  const [showSpotlight, setShowSpotlight] = useState<boolean>(true);
  const [hoverPeek, setHoverPeek] = useState<boolean>(false);

  const activeFeature = useMemo(
    () => items.find((f) => f.id === activeFeatureId) ?? items[0],
    [items, activeFeatureId]
  );

  const selectedSubMode =
    subModeByFeature[activeFeature.id] ?? activeFeature.subModes[0]?.id ?? "default";

  const effectiveSubMode =
    activeFeature.id === "minidock" && hoverPeek ? "open" : selectedSubMode;

  const configKey = `${activeFeature.id}:${effectiveSubMode}`;
  const frameConfig = FRAME_CONFIGS[configKey] ?? FRAME_CONFIGS["deck:waveform"];
  const imgSrc = frameConfig.image(theme);
  const { left, top, width, height } = frameConfig.rect;
  const right = Math.max(0, 100 - left - width);
  const bottom = Math.max(0, 100 - top - height);
  const isSettings = activeFeature.id === "settings";

  return (
    <section id="features" className="relative z-10 border-t border-line py-20 sm:py-24">
      <div className="page-rail">
        <Reveal>
          <div className="mb-10">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
              {messages.features.eyebrow}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
              {messages.features.title}
            </h2>
            <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-fg-2">
              {messages.features.subtitle}
            </p>
          </div>
        </Reveal>

        {/* Asymmetric Split Showcase strictly aligned to page-rail */}
        <Reveal delayMs={80}>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            {/* Left Interactive Chapter Rail */}
            <div className="flex flex-col gap-2">
              {items.map((item) => {
                const isActive = item.id === activeFeature.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveFeatureId(item.id);
                      setHoverPeek(false);
                    }}
                    className={`group rounded-md border p-3.5 text-left transition-all duration-100 ${
                      isActive
                        ? "border-accent bg-accent-soft"
                        : "surface-card-soft border-line hover:border-line-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-mono text-[10px] tracking-wider ${
                          isActive ? "text-accent-fg font-semibold" : "text-fg-3"
                        }`}
                      >
                        {item.code}
                      </span>
                      <span
                        className={`h-1.5 w-1.5 rounded-[2px] transition-colors ${
                          isActive ? "bg-accent" : "bg-line-strong group-hover:bg-fg-3"
                        }`}
                      />
                    </div>
                    <h3
                      className={`mt-1 text-[13.5px] font-semibold ${
                        isActive ? "text-fg" : "text-fg-2 group-hover:text-fg"
                      }`}
                    >
                      {item.title}
                    </h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-fg-3">
                      {item.shortDesc}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Right Code-Driven Focus-Frame Stage */}
            <div className="surface-glass flex flex-col overflow-hidden rounded-lg border border-line-strong shadow-xl">
              {/* Stage Header with Interactive Sub-State Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-header px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Crosshair className="h-3.5 w-3.5 text-accent-fg" />
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-2">
                    {activeFeature.badge}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {activeFeature.subModes.length > 1 && (
                    <div className="flex items-center rounded-[4px] border border-line bg-surface-0 p-0.5">
                      {activeFeature.subModes.map((sub) => {
                        const active = effectiveSubMode === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => {
                              setHoverPeek(false);
                              setSubModeByFeature((prev) => ({
                                ...prev,
                                [activeFeature.id]: sub.id,
                              }));
                            }}
                            className={`whitespace-nowrap rounded-[3px] px-2 py-0.5 font-mono text-[10px] transition-colors ${
                              active
                                ? "bg-accent-soft text-accent-fg"
                                : "text-fg-3 hover:text-fg"
                            }`}
                          >
                            {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    title={showSpotlight ? "Hide spotlight mask" : "Show spotlight mask"}
                    onClick={() => setShowSpotlight((v) => !v)}
                    className={`inline-flex h-6 items-center gap-1 rounded-[3px] border px-2 font-mono text-[10px] transition-colors ${
                      showSpotlight
                        ? "border-accent bg-accent-soft text-accent-fg"
                        : "border-line bg-surface-2 text-fg-3 hover:text-fg"
                    }`}
                  >
                    {showSpotlight ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    <span>Focus</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenLightbox(imgSrc, `${activeFeature.title} — ${frameConfig.tag}`)}
                    className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line bg-surface-2 px-2 font-mono text-[10px] text-fg-2 hover:border-accent hover:text-accent-fg"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span className="hidden sm:inline">{messages.features.inspectFull}</span>
                  </button>
                </div>
              </div>

              {/* Real Screenshot Canvas + Animated 4-Scrim Code Focus Frame */}
              <div
                onMouseEnter={() => {
                  if (activeFeature.id === "minidock" && selectedSubMode === "idle") {
                    setHoverPeek(true);
                  }
                }}
                onMouseLeave={() => {
                  if (activeFeature.id === "minidock") {
                    setHoverPeek(false);
                  }
                }}
                className={`relative w-full overflow-hidden bg-surface-0 ${frameConfig.aspectClass}`}
              >
                <img
                  src={imgSrc}
                  alt={`${activeFeature.title} screenshot`}
                  className={`h-full w-full transition-opacity duration-200 ${
                    isSettings ? "object-contain p-4 sm:p-6" : "object-cover"
                  }`}
                />

                {/* Pure CSS/Code 4-Panel Spotlight Scrim + Accent Reticle Box */}
                {showSpotlight && (
                  <div className="pointer-events-none absolute inset-0">
                    {/* Top Scrim */}
                    <div
                      className="absolute left-0 right-0 top-0 transition-all duration-500 ease-out"
                      style={{
                        height: `${top}%`,
                        backgroundColor: "rgba(6, 7, 10, 0.56)",
                      }}
                    />
                    {/* Bottom Scrim */}
                    <div
                      className="absolute bottom-0 left-0 right-0 transition-all duration-500 ease-out"
                      style={{
                        height: `${bottom}%`,
                        backgroundColor: "rgba(6, 7, 10, 0.56)",
                      }}
                    />
                    {/* Left Scrim */}
                    <div
                      className="absolute left-0 transition-all duration-500 ease-out"
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        width: `${left}%`,
                        backgroundColor: "rgba(6, 7, 10, 0.56)",
                      }}
                    />
                    {/* Right Scrim */}
                    <div
                      className="absolute right-0 transition-all duration-500 ease-out"
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        width: `${right}%`,
                        backgroundColor: "rgba(6, 7, 10, 0.56)",
                      }}
                    />

                    {/* Glowing Accent Focus Frame + Studio Corner Reticles */}
                    <div
                      className="focus-frame-ring absolute rounded-[3px] border border-accent transition-all duration-500 ease-out"
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                      }}
                    >
                      {/* Corner ticks */}
                      <span className="absolute -left-[2px] -top-[2px] h-2.5 w-2.5 border-l-2 border-t-2 border-accent" />
                      <span className="absolute -right-[2px] -top-[2px] h-2.5 w-2.5 border-r-2 border-t-2 border-accent" />
                      <span className="absolute -bottom-[2px] -left-[2px] h-2.5 w-2.5 border-b-2 border-l-2 border-accent" />
                      <span className="absolute -bottom-[2px] -right-[2px] h-2.5 w-2.5 border-b-2 border-r-2 border-accent" />

                      {/* Floating technical tag anchored cleanly inside/outside frame */}
                      <span
                        className={`absolute max-w-[calc(100%-8px)] truncate whitespace-nowrap rounded-[3px] border border-accent bg-surface-0 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tracking-wider text-accent-fg shadow-md sm:max-w-none sm:px-2 sm:text-[9.5px] ${
                          top > 18 ? "-top-6" : "top-1.5 sm:top-2"
                        } ${left > 60 ? "right-1" : "left-1"}`}
                      >
                        {frameConfig.tag}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Caption / Deep Explanation Strip */}
              <div className="border-t border-line bg-surface-1 px-4 py-3.5">
                <p className="text-[13px] leading-relaxed text-fg-2">{activeFeature.detail}</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
