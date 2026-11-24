import React, { useEffect, useRef, useState } from "react";
import { resolveAtmosphereStyle } from "../../constants/atmosphereStyles";
import {
  getAsciiMagicPreview,
  saveAsciiMagicPreview,
} from "../../services/asciiMagicService";
import { useSampleStore } from "../../store/useSampleStore";
import {
  releaseCanvasRenderCaches,
  renderPreviewThumbnail,
} from "../../utils/asciiMagic/frameRenderer";
import {
  loadAsciiPresetRenderer,
  renderAsciiPresetFrame,
} from "../../utils/asciiWallpaperEngine";
import {
  getCachedThumbnailUrl,
  getWallpaperThumbnailUrl,
} from "../../utils/thumbnailCache";

const PREVIEW_CSS_W = 320;
const PREVIEW_CSS_H = 180;
const PREVIEW_DPR = 1.5;

/**
 * Framed Studio Monitor Preview simulating Audify's surface, frosted Mica
 * chrome, wallpaper image, and static snapshot previews of ASCII scenes.
 */
export const AtmosphereMiniPreview: React.FC = React.memo(() => {
  const themeMode = useSampleStore((s) => s.themeMode);
  const enableMica = useSampleStore((s) => s.enableMica);
  const themeTintIntensity = useSampleStore((s) => s.themeTintIntensity);
  const customBgImage = useSampleStore((s) => s.customBgImage);
  const customBgBlur = useSampleStore((s) => s.customBgBlur);
  const customBgOpacity = useSampleStore((s) => s.customBgOpacity);
  const wallpaperKind = useSampleStore((s) => s.wallpaperKind);
  const asciiPreset = useSampleStore((s) => s.asciiPreset);
  const asciiMagicSlug = useSampleStore((s) => s.asciiMagicSlug);
  const asciiMagicLook = useSampleStore((s) => s.asciiMagicLook);
  const asciiMagicFit = useSampleStore((s) => s.asciiMagicFit);
  const accentColor = useSampleStore((s) => s.accentColor);

  const asciiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const needsImageUrl = wallpaperKind === "image" && !!customBgImage;
  const [thumbUrl, setThumbUrl] = useState<string>(() =>
    needsImageUrl ? getCachedThumbnailUrl(customBgImage) || "" : ""
  );

  useEffect(() => {
    let active = true;
    if (!needsImageUrl) {
      setThumbUrl("");
      return;
    }
    const cached = getCachedThumbnailUrl(customBgImage);
    if (cached) {
      setThumbUrl(cached);
    } else {
      getWallpaperThumbnailUrl(customBgImage).then((url) => {
        if (active) setThumbUrl(url);
      });
    }
    return () => {
      active = false;
    };
  }, [needsImageUrl, customBgImage]);

  const showAscii = wallpaperKind === "ascii_preset";
  const showMagic = wallpaperKind === "ascii_magic" && !!asciiMagicSlug;
  const showImage = wallpaperKind === "image" && !!thumbUrl;
  const hasBackdrop = showAscii || showMagic || showImage;

  useEffect(() => {
    const canvasEl = asciiCanvasRef.current;
    if (!showAscii && !showMagic) {
      releaseCanvasRenderCaches(canvasEl, true);
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;

    if (showAscii) {
      void loadAsciiPresetRenderer(asciiPreset).then(() => {
        if (cancelled) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (cancelled) return;
          const cv = asciiCanvasRef.current;
          if (!cv) return;
          const targetW = Math.round(PREVIEW_CSS_W * PREVIEW_DPR);
          const targetH = Math.round(PREVIEW_CSS_H * PREVIEW_DPR);
          if (cv.width !== targetW) cv.width = targetW;
          if (cv.height !== targetH) cv.height = targetH;
          const ctx = cv.getContext("2d", { alpha: false });
          if (!ctx) return;
          ctx.save();
          ctx.setTransform(PREVIEW_DPR, 0, 0, PREVIEW_DPR, 0, 0);
          renderAsciiPresetFrame({
            ctx,
            width: PREVIEW_CSS_W,
            height: PREVIEW_CSS_H,
            timeSec: 2.6,
            preset: asciiPreset,
            accentHex: accentColor,
            themeMode,
            isPlaying: false,
          });
          ctx.restore();
        });
      });
    } else if (showMagic) {
      void (async () => {
        let snap = await getAsciiMagicPreview(asciiMagicSlug);
        if (!snap && !cancelled) {
          try {
            const { asciiMagicSandbox } = await import(
              "../../utils/asciiMagic/sandboxBridge"
            );
            snap = await asciiMagicSandbox.capturePiecePreview(asciiMagicSlug);
            if (snap) {
              void saveAsciiMagicPreview(asciiMagicSlug, snap).catch(() => {});
            }
          } catch {
            // Best-effort static fallback preview
          }
        }
        if (cancelled || !snap) return;
        const cv = asciiCanvasRef.current;
        if (!cv) return;
        renderPreviewThumbnail(
          cv,
          snap,
          asciiMagicLook,
          themeMode,
          PREVIEW_CSS_W,
          PREVIEW_CSS_H,
          {
            fit: asciiMagicFit,
            margin: asciiMagicFit === "cover" ? 0 : 0.04,
          }
        );
      })();
    }

    return () => {
      cancelled = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      releaseCanvasRenderCaches(canvasEl, true);
    };
  }, [
    showAscii,
    showMagic,
    asciiPreset,
    accentColor,
    themeMode,
    asciiMagicSlug,
    asciiMagicLook,
    asciiMagicFit,
  ]);

  const resolvedStyle = resolveAtmosphereStyle({
    enableMica,
    themeTintIntensity,
    customBgBlur,
    customBgOpacity,
  });
  const tintPct = Math.round(themeTintIntensity * 100);
  const visPct = Math.round(customBgOpacity * 100);
  const metricsText = hasBackdrop
    ? `T ${tintPct}% · B ${customBgBlur}px · V ${visPct}%`
    : `Tint ${tintPct}%`;
  const footerTooltip = hasBackdrop
    ? `${resolvedStyle.name} · Tint ${tintPct}% · Blur ${customBgBlur}px · Visibility ${visPct}%`
    : `${resolvedStyle.name} · Tint ${tintPct}%`;
  const styleDotClass = enableMica
    ? "bg-ok"
    : resolvedStyle.id === "custom_style"
      ? "bg-accent"
      : "bg-fg-3";

  return (
    <div className="w-full rounded-sm border border-line bg-surface-0 overflow-hidden flex flex-col select-none shadow-xs">
      {/* Static Snapshot Viewport Area (16:9 monitor ratio) */}
      <div
        className="relative aspect-video w-full overflow-hidden bg-surface-0"
        style={{ clipPath: "inset(0)", isolation: "isolate" }}
      >
        {showAscii || showMagic ? (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ opacity: customBgOpacity }}
          >
            <canvas
              ref={asciiCanvasRef}
              aria-hidden="true"
              className="w-full h-full block"
            />
          </div>
        ) : showImage ? (
          <img
            src={thumbUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{ opacity: customBgOpacity }}
          />
        ) : (
          themeTintIntensity > 0 && (
            <div
              className="absolute inset-0"
              style={{
                opacity: enableMica
                  ? themeTintIntensity
                  : themeTintIntensity * 0.55,
                background: `radial-gradient(circle at 18% 18%, rgb(var(--accent-rgb) / 0.35) 0%, transparent 60%),
                             radial-gradient(circle at 82% 82%, rgb(var(--accent-rgb) / 0.25) 0%, transparent 55%)`,
              }}
            />
          )
        )}

        {hasBackdrop && customBgBlur > 0 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backdropFilter: `blur(${Math.min(customBgBlur, 14)}px)`,
              WebkitBackdropFilter: `blur(${Math.min(customBgBlur, 14)}px)`,
            }}
          />
        )}

        {/* Mini Audify Shell Wireframe (Frosted Frame Chrome + Clear Table Stage) */}
        <div className="absolute inset-0 flex flex-col p-2 gap-1.5 pointer-events-none z-10">
          <div
            className={`h-[24px] rounded-xs px-2 flex items-center justify-between border border-line bg-surface-1 ${
              hasBackdrop && enableMica && themeMode !== "contrast"
                ? "backdrop-blur-md"
                : ""
            }`}
          >
            <div className="flex items-center space-x-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: accentColor }}
              />
              <div className="w-12 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: "55%", backgroundColor: accentColor }}
                />
              </div>
            </div>

            <div className="flex items-end space-x-0.5 h-3">
              {[45, 80, 100, 60, 35, 90, 70, 50, 85, 40, 65, 95].map((h, i) => (
                <span
                  key={i}
                  className="w-0.5 rounded-xs"
                  style={{
                    height: `${h}%`,
                    backgroundColor:
                      i < 8 ? accentColor : "rgb(var(--fg-faint-rgb))",
                    opacity: i < 8 ? 0.9 : 0.5,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 flex gap-1.5 min-h-0">
            <div
              className={`w-[56px] rounded-xs p-1.5 flex flex-col gap-1.5 border border-line bg-surface-1 ${
                hasBackdrop && enableMica && themeMode !== "contrast"
                  ? "backdrop-blur-md"
                  : ""
              }`}
            >
              <div className="flex items-center space-x-1">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <div className="w-7 h-1 rounded-xs bg-fg-3 opacity-40" />
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-info/80" />
                <div className="w-6 h-1 rounded-xs bg-fg-3 opacity-30" />
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-ok/80" />
                <div className="w-5 h-1 rounded-xs bg-fg-3 opacity-30" />
              </div>
            </div>

            <div
              className={`flex-1 rounded-xs p-1.5 flex flex-col gap-1 border border-line overflow-hidden ${
                hasBackdrop ? "bg-transparent" : "bg-surface-sub"
              }`}
            >
              <div
                className={`h-[14px] px-1.5 rounded-xs flex items-center justify-between border ${
                  hasBackdrop ? "bg-accent-soft" : ""
                }`}
                style={{
                  borderColor: `${accentColor}66`,
                  ...(hasBackdrop
                    ? {}
                    : { backgroundColor: `${accentColor}22` }),
                }}
              >
                <div
                  className="w-14 h-1.5 rounded-xs"
                  style={{ backgroundColor: accentColor }}
                />
                <div className="w-4 h-1 rounded-xs bg-fg-2" />
              </div>
              <div
                className={`h-[12px] px-1.5 rounded-xs flex items-center justify-between ${
                  hasBackdrop ? "audify-row-surface" : ""
                }`}
              >
                <div className="w-12 h-1 rounded-xs bg-fg-3 opacity-60" />
                <div className="w-4 h-1 rounded-xs bg-fg-3 opacity-40" />
              </div>
              <div
                className={`h-[12px] px-1.5 rounded-xs flex items-center justify-between ${
                  hasBackdrop ? "audify-row-surface" : ""
                }`}
              >
                <div className="w-10 h-1 rounded-xs bg-fg-3 opacity-50" />
                <div className="w-5 h-1 rounded-xs bg-fg-3 opacity-35" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Single-Line Monitor Footer Bar */}
      <div
        data-testid="preview-footer-bar"
        className="h-[24px] px-2 bg-surface-2 border-t border-line flex items-center justify-between gap-2 whitespace-nowrap overflow-hidden font-mono text-[9px] leading-none text-fg-2"
        title={footerTooltip}
      >
        <span className="inline-flex items-center gap-1.5 shrink-0 min-w-0">
          <span
            data-testid="preview-style-dot"
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${styleDotClass}`}
          />
          <span
            data-testid="preview-style-label"
            className="font-semibold tracking-tight text-fg-2"
          >
            {resolvedStyle.previewLabel}
          </span>
        </span>
        <span
          data-testid="preview-metrics"
          className="text-fg-3 font-mono tabular-nums tracking-tight truncate min-w-0"
        >
          {metricsText}
        </span>
      </div>
    </div>
  );
});
