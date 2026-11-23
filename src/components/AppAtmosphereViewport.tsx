import React, { Suspense, lazy, useEffect, useState } from "react";
import { useSampleStore } from "../store/useSampleStore";
import {
  isAppWindowActive,
  subscribeAppActivity,
} from "../utils/appFocusMonitor";
import {
  getCachedViewportUrl,
  getWallpaperViewportUrl,
  isGifWallpaperPath,
  isVideoWallpaperPath,
} from "../utils/thumbnailCache";
import {
  canPreBlurWallpaper,
  getBlurredWallpaperUrl,
  getCachedBlurredWallpaperUrl,
} from "../utils/wallpaperBlurCache";
import { WallpaperVideoLayer } from "./WallpaperVideoLayer";

const LazyAsciiWallpaperCanvas = lazy(() =>
  import("./AsciiWallpaperCanvas").then((m) => ({
    default: m.AsciiWallpaperCanvas,
  }))
);

const LazyAsciiMagicCanvas = lazy(() =>
  import("./AsciiMagicCanvas").then((m) => ({
    default: m.AsciiMagicCanvas,
  }))
);

/**
 * Isolated atmosphere layer. Subscribes specifically to visual theme variables
 * so dragging sliders (tint, blur, opacity) or rendering animated ASCII never
 * triggers full App re-renders. Disabled automatically in High Contrast mode.
 */
export const AppAtmosphereViewport: React.FC = React.memo(() => {
  const themeMode = useSampleStore((s) => s.themeMode);
  const accentColor = useSampleStore((s) => s.accentColor);
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
  const asciiMotionSpeed = useSampleStore((s) => s.asciiMotionSpeed);
  const isPlaying = useSampleStore((s) => s.isPlaying);

  const needsMediaUrl = wallpaperKind === "image" && !!customBgImage;
  const isVideoBg = needsMediaUrl && isVideoWallpaperPath(customBgImage);
  const isGifBg = needsMediaUrl && !isVideoBg && isGifWallpaperPath(customBgImage);
  const [gifPlaybackActive, setGifPlaybackActive] = useState<boolean>(() =>
    isAppWindowActive()
  );

  useEffect(() => {
    if (!isGifBg) return;
    setGifPlaybackActive(isAppWindowActive());
    return subscribeAppActivity(() => {
      setGifPlaybackActive(isAppWindowActive());
    });
  }, [isGifBg]);

  const [bgMediaUrl, setBgMediaUrl] = useState<string>(() =>
    needsMediaUrl ? getCachedViewportUrl(customBgImage) || "" : ""
  );

  useEffect(() => {
    let active = true;
    if (!needsMediaUrl || themeMode === "contrast") {
      setBgMediaUrl("");
      return;
    }
    const cached = getCachedViewportUrl(customBgImage);
    if (cached) {
      setBgMediaUrl(cached);
    } else {
      void getWallpaperViewportUrl(customBgImage).then((url) => {
        if (active) setBgMediaUrl(url);
      });
    }
    return () => {
      active = false;
    };
  }, [needsMediaUrl, customBgImage, themeMode]);

  const roundedBlur = Math.round(customBgBlur);
  const preBlurEligible =
    needsMediaUrl &&
    themeMode !== "contrast" &&
    canPreBlurWallpaper(customBgImage, roundedBlur);
  const blurRequestKey = preBlurEligible
    ? `${customBgImage}|${roundedBlur}`
    : "";

  const [preBlurred, setPreBlurred] = useState<{
    key: string;
    url: string;
  } | null>(() => {
    if (!preBlurEligible) return null;
    const cached = getCachedBlurredWallpaperUrl(customBgImage, roundedBlur);
    return cached ? { key: blurRequestKey, url: cached } : null;
  });

  useEffect(() => {
    if (!preBlurEligible) {
      setPreBlurred(null);
      return;
    }
    const cached = getCachedBlurredWallpaperUrl(customBgImage, roundedBlur);
    if (cached) {
      setPreBlurred({ key: blurRequestKey, url: cached });
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void getBlurredWallpaperUrl(customBgImage, roundedBlur).then((url) => {
        if (active && url) {
          setPreBlurred({ key: blurRequestKey, url });
        }
      });
    }, 90);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [preBlurEligible, customBgImage, roundedBlur, blurRequestKey]);

  if (themeMode === "contrast") {
    return null;
  }

  const showAsciiLayer = wallpaperKind === "ascii_preset";
  const showMagicLayer = wallpaperKind === "ascii_magic" && !!asciiMagicSlug;
  const showVideoLayer = isVideoBg && !!bgMediaUrl;
  const showImageLayer = wallpaperKind === "image" && !isVideoBg && !!bgMediaUrl;
  const hasBackdrop =
    showAsciiLayer || showMagicLayer || showVideoLayer || showImageLayer;

  const activePreBlurredUrl =
    showImageLayer && preBlurred?.key === blurRequestKey ? preBlurred.url : "";
  const effectiveImageUrl = activePreBlurredUrl || bgMediaUrl;
  const needsLiveBlur =
    hasBackdrop && customBgBlur > 0 && !activePreBlurredUrl;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-[1px] overflow-hidden pointer-events-none z-0 bg-surface-0"
      style={{ clipPath: "inset(0)", isolation: "isolate" }}
    >
      {themeTintIntensity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            opacity: enableMica
              ? themeTintIntensity
              : themeTintIntensity * 0.55,
            background: `
              radial-gradient(circle at 16% 14%, rgb(var(--accent-rgb) / 0.32) 0%, transparent 52%),
              radial-gradient(circle at 78% 12%, rgb(var(--accent-rgb) / 0.25) 0%, transparent 48%),
              radial-gradient(circle at 85% 88%, rgb(var(--accent-rgb) / 0.22) 0%, transparent 55%),
              radial-gradient(circle at 12% 82%, rgb(var(--ok-rgb) / 0.14) 0%, transparent 45%),
              linear-gradient(135deg, rgb(var(--accent-rgb) / 0.14) 0%, transparent 50%, rgb(var(--accent-rgb) / 0.10) 100%)
            `,
          }}
        />
      )}

      {/* Dedicated isolation group keeps live backdrop-filter scoped strictly to media */}
      <div className="absolute inset-0" style={{ isolation: "isolate" }}>
        {showAsciiLayer && (
          <div
            className="absolute inset-0"
            style={{ opacity: customBgOpacity, willChange: "opacity" }}
          >
            <Suspense fallback={null}>
              <LazyAsciiWallpaperCanvas
                wallpaperKind={wallpaperKind}
                asciiPreset={asciiPreset}
                motionSpeed={asciiMotionSpeed}
                accentHex={accentColor}
                themeMode={themeMode}
                isPlaying={isPlaying}
                blurPx={customBgBlur}
              />
            </Suspense>
          </div>
        )}

        {showMagicLayer && (
          <div
            className="absolute inset-0"
            style={{ opacity: customBgOpacity, willChange: "opacity" }}
          >
            <Suspense fallback={null}>
              <LazyAsciiMagicCanvas
                slug={asciiMagicSlug}
                look={asciiMagicLook}
                motionSpeed={asciiMotionSpeed}
                themeMode={themeMode}
                fit={asciiMagicFit}
                blurPx={customBgBlur}
              />
            </Suspense>
          </div>
        )}

        {showVideoLayer && (
          <WallpaperVideoLayer src={bgMediaUrl} opacity={customBgOpacity} />
        )}

        {showImageLayer && (!isGifBg || gifPlaybackActive) && (
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url("${effectiveImageUrl}")`,
              opacity: customBgOpacity,
              willChange: "opacity",
            }}
          />
        )}

        {/* Live optical blur only mounts for motion backdrops or while pre-blur settles */}
        {needsLiveBlur && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backdropFilter: `blur(${customBgBlur}px)`,
              WebkitBackdropFilter: `blur(${customBgBlur}px)`,
            }}
          />
        )}
      </div>

      {hasBackdrop && (
        <div
          className="absolute inset-0"
          style={{
            background:
              themeMode === "light"
                ? "radial-gradient(ellipse at 60% 45%, transparent 55%, rgba(15, 23, 42, 0.06) 100%)"
                : "radial-gradient(ellipse at 60% 45%, transparent 45%, rgba(8, 9, 13, 0.22) 100%)",
          }}
        />
      )}
    </div>
  );
});
