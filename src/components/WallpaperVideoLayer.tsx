import React, { useEffect, useRef } from "react";
import {
  isAppWindowActive,
  subscribeAppActivity,
} from "../utils/appFocusMonitor";

export interface WallpaperVideoLayerProps {
  src: string;
  opacity: number;
}

/**
 * Hardware-decoded muted looping MP4/WebM wallpaper layer.
 * Automatically pauses when Audify loses OS focus, is hidden, or when
 * `prefers-reduced-motion` is enabled, and releases its decoder surface on unmount.
 */
export const WallpaperVideoLayer: React.FC<WallpaperVideoLayerProps> =
  React.memo(({ src, opacity }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const reducedMotionQuery =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-reduced-motion: reduce)")
          : null;

      const syncPlayback = () => {
        const shouldPlay =
          Boolean(src) &&
          isAppWindowActive() &&
          !reducedMotionQuery?.matches;
        if (shouldPlay) {
          if (video.paused) {
            void video.play().catch(() => {
              // Autoplay can settle once metadata is ready
            });
          }
        } else if (!video.paused) {
          video.pause();
        }
      };

      const unsubActivity = subscribeAppActivity(syncPlayback);
      reducedMotionQuery?.addEventListener?.("change", syncPlayback);
      video.addEventListener("canplay", syncPlayback);
      syncPlayback();

      return () => {
        unsubActivity();
        reducedMotionQuery?.removeEventListener?.("change", syncPlayback);
        video.removeEventListener("canplay", syncPlayback);
        try {
          video.pause();
          video.removeAttribute("src");
          video.load();
        } catch {
          // ignore non-browser test cleanup
        }
      };
    }, [src]);

    return (
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        autoPlay
        disablePictureInPicture
        controls={false}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
        style={{ opacity, willChange: "opacity" }}
      />
    );
  });
