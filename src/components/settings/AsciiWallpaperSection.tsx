import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Pause, Play, PowerOff, Sparkles } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

const LazyAsciiMagicCatalogPanel = lazy(() =>
  import("./AsciiMagicCatalogPanel").then((m) => ({
    default: m.AsciiMagicCatalogPanel,
  }))
);
import {
  ASCII_CATEGORY_LABELS,
  ASCII_PRESETS,
} from "../../constants/asciiPresets";
import { AsciiPresetCategory, AsciiPresetId, ThemeMode } from "../../types";
import {
  loadAsciiPresetRenderer,
  renderAsciiPresetFrame,
} from "../../utils/asciiWallpaperEngine";

const MOTION_SPEED_OPTIONS = [
  { value: 0, label: "Pause" },
  { value: 0.5, label: "Calm" },
  { value: 1, label: "Normal" },
  { value: 1.5, label: "Lively" },
] as const;

interface PresetSwatchProps {
  presetId: AsciiPresetId;
  accentHex: string;
  themeMode: ThemeMode;
  swatchBg: string;
}

const PresetMosaicSwatch: React.FC<PresetSwatchProps> = React.memo(
  ({ presetId, accentHex, themeMode, swatchBg }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
      const canvasEl = canvasRef.current;
      let cancelled = false;
      let rafId: number | null = null;
      void loadAsciiPresetRenderer(presetId).then(() => {
        if (cancelled) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (cancelled) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (canvas.width !== 140) canvas.width = 140;
          if (canvas.height !== 98) canvas.height = 98;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          renderAsciiPresetFrame({
            ctx,
            width: canvas.width,
            height: canvas.height,
            timeSec: 2.6,
            preset: presetId,
            accentHex,
            themeMode,
            isPlaying: true,
          });
        });
      });
      return () => {
        cancelled = true;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        if (canvasEl) {
          canvasEl.width = 0;
          canvasEl.height = 0;
        }
      };
    }, [presetId, accentHex, themeMode]);

    return (
      <div
        className="w-[54px] h-[38px] shrink-0 rounded-xs border border-line overflow-hidden relative select-none pointer-events-none"
        style={{ background: swatchBg }}
      >
        <canvas
          ref={canvasRef}
          width={140}
          height={98}
          className="w-full h-full block"
        />
      </div>
    );
  }
);

/**
 * Compact DAW-grade selector & animation speed bar for Audify's procedural
 * Animated ASCII scenes. Uses fixed-metric tabs (zero horizontal jump) and
 * authentic pixel-tile mosaic canvas swatches.
 */
export const AsciiWallpaperSection: React.FC = React.memo(() => {
  const wallpaperKind = useSampleStore((s) => s.wallpaperKind);
  const asciiPreset = useSampleStore((s) => s.asciiPreset);
  const asciiMotionSpeed = useSampleStore((s) => s.asciiMotionSpeed);
  const themeMode = useSampleStore((s) => s.themeMode);
  const accentColor = useSampleStore((s) => s.accentColor);
  const setWallpaperKind = useSampleStore((s) => s.setWallpaperKind);
  const setAsciiPreset = useSampleStore((s) => s.setAsciiPreset);
  const setAsciiMotionSpeed = useSampleStore((s) => s.setAsciiMotionSpeed);

  const isLight = themeMode === "light";

  const activePresetCategory = useMemo<AsciiPresetCategory>(
    () =>
      ASCII_PRESETS.find((p) => p.id === asciiPreset)?.category ?? "nature",
    [asciiPreset]
  );

  const [sourceMode, setSourceMode] = useState<"builtin" | "magic">(() =>
    wallpaperKind === "ascii_magic" ? "magic" : "builtin"
  );
  const [categoryFilter, setCategoryFilter] =
    useState<AsciiPresetCategory>(activePresetCategory);

  const visiblePresets = useMemo(
    () => ASCII_PRESETS.filter((p) => p.category === categoryFilter),
    [categoryFilter]
  );

  useEffect(() => {
    const firstPreset = visiblePresets[0];
    if (firstPreset) {
      void loadAsciiPresetRenderer(firstPreset.id);
    }
  }, [visiblePresets]);

  const handleSelectPreset = (id: AsciiPresetId) => {
    setAsciiPreset(id);
  };

  return (
    <div className="space-y-2.5 min-w-0">
      {/* Row 1 (Fixed Position): Title Left + Off & Built-in/Catalog Switch Locked Top-Right */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <Sparkles className="w-3 h-3 text-accent-fg shrink-0" />
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-2 truncate">
            Animated ASCII Scenes
          </span>
          {sourceMode === "builtin" ? (
            <span className="text-[10px] font-mono text-fg-3 shrink-0">
              ({visiblePresets.length}/{ASCII_PRESETS.length})
            </span>
          ) : (
            <span className="text-[10px] font-mono text-fg-3 shrink-0">
              (734)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setWallpaperKind("none")}
            className={`h-[22px] px-2 rounded-xs border inline-flex items-center space-x-1 text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
              wallpaperKind === "none"
                ? "border-accent bg-accent-soft text-fg font-semibold"
                : "border-line bg-surface-2 text-fg-3 hover:text-fg hover:bg-surface-3"
            }`}
            title="Disable animated background (Default clean studio surface)"
          >
            <PowerOff className="w-2.5 h-2.5 shrink-0" />
            <span>Off</span>
          </button>

          <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line gap-0.5 shrink-0">
            {(
              [
                {
                  id: "builtin" as const,
                  label: `Built-in (${ASCII_PRESETS.length})`,
                  hasLiveDot:
                    wallpaperKind === "ascii_preset" &&
                    sourceMode !== "builtin",
                  showGlobe: false,
                },
                {
                  id: "magic" as const,
                  label: "Catalog (734)",
                  hasLiveDot:
                    wallpaperKind === "ascii_magic" && sourceMode !== "magic",
                  showGlobe: true,
                },
              ] as const
            ).map((tab) => {
              const active = sourceMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSourceMode(tab.id)}
                  className={`relative h-[18px] px-2.5 rounded-xs inline-flex items-center gap-1 text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
                    active
                      ? "bg-accent text-accent-on font-semibold shadow-xs"
                      : "text-fg-3 hover:text-fg"
                  }`}
                >
                  {tab.showGlobe && <Globe className="w-2.5 h-2.5 shrink-0" />}
                  {/* Lock label width to bold metrics via ::after so toggling active weight never shifts peers */}
                  <span
                    data-label={tab.label}
                    className="inline-flex flex-col items-center justify-center whitespace-nowrap after:content-[attr(data-label)] after:font-semibold after:h-0 after:overflow-hidden after:invisible after:select-none after:pointer-events-none"
                  >
                    {tab.label}
                  </span>
                  {tab.hasLiveDot && (
                    <span
                      aria-hidden="true"
                      className="absolute top-[2px] right-[2px] w-1.5 h-1.5 rounded-full bg-accent pointer-events-none"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Built-in Category Strip (strictly below locked Row 1) */}
      {sourceMode === "builtin" && (
        <div className="flex flex-wrap items-center p-0.5 bg-surface-2 rounded-xs border border-line gap-0.5">
          {ASCII_CATEGORY_LABELS.map((cat) => {
            const active = categoryFilter === cat.id;
            const hasLivePreset =
              wallpaperKind === "ascii_preset" &&
              activePresetCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onMouseEnter={() => {
                  const match = ASCII_PRESETS.find(
                    (p) => p.category === cat.id
                  );
                  if (match) void loadAsciiPresetRenderer(match.id);
                }}
                onClick={() => setCategoryFilter(cat.id)}
                className={`relative h-[18px] min-w-[44px] px-1.5 rounded-xs inline-flex items-center justify-center text-[10px] font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-accent text-accent-on font-semibold shadow-xs"
                    : "text-fg-3 hover:text-fg"
                }`}
              >
                <span>{cat.label}</span>
                {hasLivePreset && !active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 inset-x-1.5 h-[2px] rounded-full bg-accent pointer-events-none"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {sourceMode === "magic" ? (
        <Suspense
          fallback={
            <div className="p-4 rounded-xs border border-line bg-surface-2 text-[11px] text-fg-3 text-center">
              Loading community catalog...
            </div>
          }
        >
          <LazyAsciiMagicCatalogPanel />
        </Suspense>
      ) : (
        /* Compact DAW Studio Cards (12 per category, scrollable) */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-2 max-h-[232px] overflow-y-auto pr-1">
          {visiblePresets.map((preset) => {
            const isSelected =
              wallpaperKind === "ascii_preset" && asciiPreset === preset.id;
            const swatchBg =
              isLight && preset.swatchGradientLight
                ? preset.swatchGradientLight
                : preset.swatchGradient;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                title={`${preset.name} — ${preset.subtitle}`}
                className={`group relative h-[54px] px-2 rounded-xs border text-left transition-all cursor-pointer flex items-center gap-2.5 overflow-hidden ${
                  isSelected
                    ? "border-accent bg-accent-soft ring-1 ring-accent"
                    : "border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3"
                }`}
              >
                <PresetMosaicSwatch
                  presetId={preset.id}
                  accentHex={
                    (preset.category === "studio"
                      ? accentColor
                      : preset.autoAccentHex) ?? "#38bdf8"
                  }
                  themeMode={themeMode}
                  swatchBg={swatchBg}
                />

                {/* Scene Info */}
                <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span
                      className={`text-[11px] font-medium truncate ${
                        isSelected ? "text-fg font-semibold" : "text-fg"
                      }`}
                    >
                      {preset.name}
                    </span>
                    {isSelected && (
                      <span className="px-1 py-[1px] rounded-xs bg-accent text-accent-on text-[8.5px] font-mono font-bold uppercase tracking-wider shrink-0">
                        Live
                      </span>
                    )}
                  </div>
                  <span className="text-[9.5px] text-fg-3 truncate leading-tight">
                    {preset.subtitle}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Unified Animation Speed Bar */}
      <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-xs bg-surface-2 border border-line">
        <div className="flex items-center space-x-2">
          {asciiMotionSpeed === 0 ? (
            <Pause className="w-3 h-3 text-fg-3" />
          ) : (
            <Play className="w-3 h-3 text-accent-fg" />
          )}
          <span className="text-[11px] font-medium text-fg-2">
            Animation Speed
          </span>
        </div>

        <div className="flex items-center p-0.5 bg-surface-1 rounded-xs border border-line">
          {MOTION_SPEED_OPTIONS.map((opt) => {
            const active = Math.abs(asciiMotionSpeed - opt.value) < 0.1;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setAsciiMotionSpeed(opt.value)}
                className={`h-[20px] px-2 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-accent text-accent-on font-semibold shadow-xs"
                    : "text-fg-3 hover:text-fg"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
