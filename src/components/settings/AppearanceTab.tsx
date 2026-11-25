import React, { useEffect, useRef } from "react";
import { ChevronDown, RotateCcw, Sparkles } from "lucide-react";
import {
  ATMOSPHERE_CUSTOM_STYLE,
  ATMOSPHERE_STYLE_PRESETS,
  resolveAtmosphereStyle,
} from "../../constants/atmosphereStyles";
import { useSampleStore } from "../../store/useSampleStore";
import { ThemeMode } from "../../types";
import { ColorPickerPopover } from "../ColorPickerPopover";
import { AtmosphereMiniPreview } from "./AtmosphereMiniPreview";
import { WallpaperCanvasControl } from "./BackdropGallerySection";
import { ModernToggleSwitch } from "./ModernToggleSwitch";

/**
 * 1-Click Curated Atmosphere Presets Bar + Custom Mode.
 */
const AtmospherePresetsBar: React.FC = React.memo(() => {
  const enableMica = useSampleStore((s) => s.enableMica);
  const themeTintIntensity = useSampleStore((s) => s.themeTintIntensity);
  const customBgBlur = useSampleStore((s) => s.customBgBlur);
  const customBgOpacity = useSampleStore((s) => s.customBgOpacity);

  const setEnableMica = useSampleStore((s) => s.setEnableMica);
  const setThemeTintIntensity = useSampleStore((s) => s.setThemeTintIntensity);
  const setCustomBgBlur = useSampleStore((s) => s.setCustomBgBlur);
  const setCustomBgOpacity = useSampleStore((s) => s.setCustomBgOpacity);

  const lastCustomRef = useRef({
    enableMica: false,
    tint: 0,
    blur: 0,
    opacity: 0.75,
  });

  const resolvedStyle = resolveAtmosphereStyle({
    enableMica,
    themeTintIntensity,
    customBgBlur,
    customBgOpacity,
  });
  const isCustom = resolvedStyle.id === ATMOSPHERE_CUSTOM_STYLE.id;

  useEffect(() => {
    if (isCustom) {
      lastCustomRef.current = {
        enableMica,
        tint: themeTintIntensity,
        blur: customBgBlur,
        opacity: customBgOpacity,
      };
    }
  }, [isCustom, enableMica, themeTintIntensity, customBgBlur, customBgOpacity]);

  const applyPresetValues = (
    nextMica: boolean,
    nextTint: number,
    nextBlur: number,
    nextOpacity: number
  ) => {
    setEnableMica(nextMica);
    setThemeTintIntensity(nextTint);
    setCustomBgBlur(nextBlur);
    setCustomBgOpacity(nextOpacity);
  };

  const presets = [
    ...ATMOSPHERE_STYLE_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      tagline: preset.tagline,
      apply: () =>
        applyPresetValues(
          preset.enableMica,
          preset.tint,
          preset.blur,
          preset.opacity
        ),
      isActive: resolvedStyle.id === preset.id,
    })),
    {
      id: ATMOSPHERE_CUSTOM_STYLE.id,
      name: ATMOSPHERE_CUSTOM_STYLE.name,
      tagline: ATMOSPHERE_CUSTOM_STYLE.tagline,
      apply: () => {
        if (isCustom) return;
        const saved = lastCustomRef.current;
        applyPresetValues(
          saved.enableMica,
          saved.tint,
          saved.blur,
          saved.opacity
        );
      },
      isActive: isCustom,
    },
  ];

  return (
    <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line">
      {presets.map((p) => {
        const active = p.isActive;
        return (
          <button
            key={p.id}
            type="button"
            onClick={p.apply}
            className={`h-[22px] px-2.5 rounded-xs text-[11px] flex items-center justify-center transition-colors cursor-pointer ${
              active
                ? "bg-accent-soft border border-accent/60 text-accent-fg font-semibold"
                : "text-fg-2 hover:text-fg border border-transparent font-medium"
            }`}
            title={p.tagline}
          >
            <span className="truncate">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
});

/**
 * Unified Surface & Atmosphere Controls (Style, Tint, Backdrop Blur, Visibility).
 */
const SurfaceAtmosphereRows: React.FC<{ disabled?: boolean }> = React.memo(
  ({ disabled = false }) => {
  const themeTintIntensity = useSampleStore((s) => s.themeTintIntensity);
  const setThemeTintIntensity = useSampleStore((s) => s.setThemeTintIntensity);
  const customBgBlur = useSampleStore((s) => s.customBgBlur);
  const setCustomBgBlur = useSampleStore((s) => s.setCustomBgBlur);
  const customBgOpacity = useSampleStore((s) => s.customBgOpacity);
  const setCustomBgOpacity = useSampleStore((s) => s.setCustomBgOpacity);

  return (
    <div className={`divide-y divide-line ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {/* Row 1: Style Preset */}
      <div className="h-[38px] px-3 flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-fg">Style</span>
        <AtmospherePresetsBar />
      </div>

      {/* Row 2: Accent Tint */}
      <div
        className="h-[38px] px-3 flex items-center justify-between gap-3"
        title="Blends theme accent color across studio surfaces and borders (0% = neutral studio surface)"
      >
        <span className="text-[12px] font-medium text-fg">Tint</span>
        <div className="flex items-center space-x-2 shrink-0">
          {themeTintIntensity > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setThemeTintIntensity(0)}
              className="w-[20px] h-[20px] flex items-center justify-center text-fg-2 hover:text-fg bg-surface-2 rounded-xs border border-line cursor-pointer"
              title="Reset surface tint to 0% (Neutral studio surface)"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            disabled={disabled}
            aria-label="Theme tint intensity"
            aria-valuetext={`${Math.round(themeTintIntensity * 100)}%`}
            value={themeTintIntensity}
            onChange={(e) => setThemeTintIntensity(parseFloat(e.target.value))}
            className="w-[140px]"
          />
          <span className="font-mono tabular-nums text-[10.5px] font-semibold text-accent-fg bg-surface-2 border border-line rounded-xs w-[44px] h-[20px] inline-flex items-center justify-center">
            {Math.round(themeTintIntensity * 100)}%
          </span>
        </div>
      </div>

      {/* Row 3: Backdrop Blur */}
      <div
        className="h-[38px] px-3 flex items-center justify-between gap-3"
        title="Softens the wallpaper or ASCII scene behind the table; frosted Sidebar & Titlebar stay crisp"
      >
        <span className="text-[12px] font-medium text-fg">Backdrop blur</span>
        <div className="flex items-center space-x-2 shrink-0">
          {customBgBlur > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCustomBgBlur(0)}
              className="w-[20px] h-[20px] flex items-center justify-center text-fg-2 hover:text-fg bg-surface-2 rounded-xs border border-line cursor-pointer"
              title="Reset backdrop blur to 0px (Crisp ASCII / Artwork)"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          )}
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            disabled={disabled}
            aria-label="Backdrop blur radius"
            aria-valuetext={`${customBgBlur}px`}
            value={customBgBlur}
            onChange={(e) => setCustomBgBlur(parseInt(e.target.value, 10))}
            className="w-[140px]"
          />
          <span className="font-mono tabular-nums text-[10.5px] font-semibold text-accent-fg bg-surface-2 border border-line rounded-xs w-[44px] h-[20px] inline-flex items-center justify-center">
            {customBgBlur}px
          </span>
        </div>
      </div>

      {/* Row 4: Visibility */}
      <div
        className="h-[38px] px-3 flex items-center justify-between gap-3"
        title="Controls how prominently the wallpaper or ASCII canvas shines through (0%–100%)"
      >
        <span className="text-[12px] font-medium text-fg">Visibility</span>
        <div className="flex items-center space-x-2 shrink-0">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            disabled={disabled}
            aria-label="Wallpaper visibility"
            aria-valuetext={`${Math.round(customBgOpacity * 100)}%`}
            value={customBgOpacity}
            onChange={(e) => setCustomBgOpacity(parseFloat(e.target.value))}
            className="w-[140px]"
          />
          <span className="font-mono tabular-nums text-[10.5px] font-semibold text-accent-fg bg-surface-2 border border-line rounded-xs w-[44px] h-[20px] inline-flex items-center justify-center">
            {Math.round(customBgOpacity * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
  }
);

export const AppearanceTab: React.FC = () => {
  const themeMode = useSampleStore((s) => s.themeMode);
  const accentColor = useSampleStore((s) => s.accentColor);
  const accentAuto = useSampleStore((s) => s.accentAuto);
  const enableMica = useSampleStore((s) => s.enableMica);
  const sidebarCompactHover = useSampleStore((s) => s.sidebarCompactHover);
  const setThemeMode = useSampleStore((s) => s.setThemeMode);
  const setAccentColor = useSampleStore((s) => s.setAccentColor);
  const setAccentAuto = useSampleStore((s) => s.setAccentAuto);
  const setEnableMica = useSampleStore((s) => s.setEnableMica);
  const setSidebarCompactHover = useSampleStore(
    (s) => s.setSidebarCompactHover
  );
  const miniDockEdgePeek = useSampleStore((s) => s.miniDockEdgePeek);
  const miniDockEdgeSide = useSampleStore((s) => s.miniDockEdgeSide);
  const setMiniDockEdgePeek = useSampleStore((s) => s.setMiniDockEdgePeek);
  const setMiniDockEdgeSide = useSampleStore((s) => s.setMiniDockEdgeSide);

  const isContrast = themeMode === "contrast";

  return (
    <div className="space-y-3">
      {/* Unified Theme Mode & Accent Color Card */}
      <div className="bg-surface-1 border border-line rounded-md divide-y divide-line">
        <div className="min-h-[38px] px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="text-[12px] font-medium text-fg shrink-0">
              Theme mode
            </span>
            <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line">
              {(
                [
                  { id: "dark", title: "Dark", previewBg: "#0D0D0F" },
                  { id: "light", title: "Light", previewBg: "#E6E6E6" },
                  { id: "contrast", title: "Contrast", previewBg: "#000000" },
                ] as { id: ThemeMode; title: string; previewBg: string }[]
              ).map((m) => {
                const active = themeMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setThemeMode(m.id)}
                    className={`h-[22px] w-[74px] rounded-xs flex items-center justify-center space-x-1.5 text-[11px] font-medium border transition-colors cursor-pointer box-border ${
                      active
                        ? "bg-accent-soft text-accent-fg font-semibold border-accent/60"
                        : "text-fg-2 hover:text-fg border-transparent"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-[2px] border border-line-strong shrink-0"
                      style={{ backgroundColor: m.previewBg }}
                    />
                    <span>{m.title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <span className="text-[12px] font-medium text-fg shrink-0">
              Accent
            </span>
            <button
              type="button"
              onClick={() => setAccentAuto(!accentAuto)}
              aria-pressed={accentAuto}
              title={
                accentAuto
                  ? "Auto Accent is ON: matches active wallpaper or animated ASCII scene. Click to use manual color."
                  : "Enable Auto Accent to dynamically match your active wallpaper or animated ASCII scene."
              }
              className={`h-[26px] px-2 rounded-xs border flex items-center space-x-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                accentAuto
                  ? "bg-accent-soft border-accent text-accent-fg shadow-xs"
                  : "bg-surface-2 hover:bg-surface-3 border-line text-fg-2 hover:text-fg"
              }`}
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              <span>Auto</span>
            </button>
            <ColorPickerPopover
              color={accentColor}
              onChange={(hex) => setAccentColor(hex)}
              align="right"
              title={
                accentAuto
                  ? "Pick a custom accent color manually (turns off Auto)"
                  : "Customize Theme Accent Color (Presets + 16M Custom)"
              }
              customTrigger={
                <button
                  type="button"
                  className="h-[26px] px-2 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent rounded-xs flex items-center space-x-2 transition-all cursor-pointer group"
                >
                  <span
                    className="w-3.5 h-3.5 rounded-[3px] border border-line-strong shrink-0"
                    style={{ backgroundColor: accentColor }}
                  />
                  <span className="text-[11px] font-medium text-fg font-mono">
                    {accentAuto
                      ? `AUTO · ${accentColor.toUpperCase()}`
                      : accentColor.toUpperCase()}
                  </span>
                  <ChevronDown className="w-3 h-3 text-fg-2 group-hover:text-accent-fg transition-colors shrink-0" />
                </button>
              }
            />
          </div>
        </div>

        <div
          className="h-[38px] px-3 flex items-center justify-between gap-3"
          title="When the main sidebar is in Compact Mode, reveal panels smoothly on hover over the icon rail instead of expanding the layout"
        >
          <span className="text-[12px] font-medium text-fg">
            Compact sidebar hover
          </span>
          <ModernToggleSwitch
            checked={sidebarCompactHover}
            onChange={setSidebarCompactHover}
            title="Enable hover-peek overlay when the main sidebar is collapsed"
          />
        </div>

        <div
          className="h-[38px] px-3 flex items-center justify-between gap-3"
          title="Auto-hide Mini Dock into a slim theme-colored edge handle and reveal smoothly on hover"
        >
          <span className="text-[12px] font-medium text-fg">
            Mini Dock edge-peek
          </span>
          <div className="flex items-center space-x-2 shrink-0">
            <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line">
              {(
                [
                  { id: "left", label: "Left" },
                  { id: "right", label: "Right" },
                ] as const
              ).map((opt) => {
                const active = miniDockEdgeSide === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMiniDockEdgeSide(opt.id)}
                    className={`h-[20px] px-2 rounded-xs text-[10.5px] transition-colors cursor-pointer ${
                      active
                        ? "bg-accent-soft border border-accent/60 text-accent-fg font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent font-medium"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <ModernToggleSwitch
              checked={miniDockEdgePeek}
              onChange={setMiniDockEdgePeek}
              title="Enable Windows Edge-Peek auto-hide in Mini Dock"
            />
          </div>
        </div>
      </div>

      {/* 2-Column Middle Deck: Surface & Atmosphere Controls (Left) + Live Preview (Right) */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_256px] gap-3 items-stretch">
        <div className="bg-surface-1 border border-line rounded-md flex flex-col overflow-hidden">
          <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-1.5 font-mono text-[10.5px] uppercase tracking-wider font-semibold text-fg">
              <Sparkles className="w-3.5 h-3.5 text-accent-fg" />
              <span>SURFACE &amp; ATMOSPHERE</span>
            </div>
            <ModernToggleSwitch
              checked={!isContrast && enableMica}
              disabled={isContrast}
              onChange={setEnableMica}
              title={
                isContrast
                  ? "Disabled in High Contrast mode to keep opaque accessible surfaces"
                  : "Toggle Mica Translucent Glass (Backdrop blur & surface translucency)"
              }
            />
          </div>
          {isContrast && (
            <div className="px-3 py-1.5 bg-surface-2 border-b border-line text-[10.5px] text-fg-2">
              High Contrast keeps solid opaque surfaces. Switch to Dark or Light
              to customize Mica glass, tint, and wallpaper backdrops.
            </div>
          )}
          <SurfaceAtmosphereRows disabled={isContrast} />
        </div>

        <div className="bg-surface-1 border border-line rounded-md flex flex-col overflow-hidden">
          <div className="h-[34px] px-3 bg-surface-2 border-b border-line flex items-center justify-between shrink-0">
            <span className="font-mono text-[10.5px] uppercase tracking-wider font-semibold text-fg">
              PREVIEW
            </span>
          </div>
          <div className="flex-1 p-2.5 flex items-center justify-center">
            <AtmosphereMiniPreview />
          </div>
        </div>
      </div>

      {/* Bottom: Wallpapers Gallery */}
      <div
        className={isContrast ? "opacity-55 pointer-events-none select-none" : undefined}
        aria-disabled={isContrast || undefined}
      >
        <WallpaperCanvasControl />
      </div>
    </div>
  );
};
