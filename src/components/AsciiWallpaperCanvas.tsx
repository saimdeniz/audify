import React, { useEffect, useRef } from "react";
import { AsciiPresetId, ThemeMode, WallpaperKind } from "../types";
import {
  isAppWindowActive,
  subscribeAppActivity,
} from "../utils/appFocusMonitor";
import {
  getCachedAsciiPresetRenderer,
  loadAsciiPresetRenderer,
} from "../utils/asciiWallpaperEngine";

export interface AsciiWallpaperCanvasProps {
  wallpaperKind: WallpaperKind;
  asciiPreset: AsciiPresetId;
  motionSpeed: number;
  accentHex: string;
  themeMode: ThemeMode;
  isPlaying?: boolean;
  blurPx?: number;
  className?: string;
}

/**
 * High-efficiency 2D canvas renderer for Audify's procedural Animated ASCII
 * scenes. Runs at a smooth 30 FPS with smart backing-store DPR scaling and
 * pauses automatically when hidden or when Motion Speed is set to 0.
 */
export const AsciiWallpaperCanvas: React.FC<AsciiWallpaperCanvasProps> =
  React.memo(
    ({
      wallpaperKind,
      asciiPreset,
      motionSpeed,
      accentHex,
      themeMode,
      isPlaying,
      blurPx = 0,
      className = "",
    }) => {
      const canvasRef = useRef<HTMLCanvasElement | null>(null);
      const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
        width: 0,
        height: 0,
        dpr: 1,
      });
      const drawCurrentRef = useRef<((nowMs: number) => void) | null>(null);
      const syncSizeRef = useRef<(() => boolean) | null>(null);
      const ensureLoopRef = useRef<(() => void) | null>(null);
      const redrawRafIdRef = useRef<number | null>(null);

      const scheduleImmediateRedraw = () => {
        if (redrawRafIdRef.current !== null) return;
        redrawRafIdRef.current = requestAnimationFrame((nowMs) => {
          redrawRafIdRef.current = null;
          drawCurrentRef.current?.(nowMs);
        });
      };

      const blurTier = blurPx >= 8 ? 2 : blurPx >= 3 ? 1 : 0;
      const propsRef = useRef({
        wallpaperKind,
        asciiPreset,
        motionSpeed,
        accentHex,
        themeMode,
        isPlaying,
        blurTier,
      });
      propsRef.current = {
        wallpaperKind,
        asciiPreset,
        motionSpeed,
        accentHex,
        themeMode,
        isPlaying,
        blurTier,
      };

      // Lazy-load the category chunk whenever the active preset changes
      useEffect(() => {
        let active = true;
        if (wallpaperKind !== "ascii_preset") return;

        if (getCachedAsciiPresetRenderer(asciiPreset)) {
          scheduleImmediateRedraw();
          return;
        }

        void loadAsciiPresetRenderer(asciiPreset).then(() => {
          if (active) {
            scheduleImmediateRedraw();
          }
        });

        return () => {
          active = false;
        };
      }, [wallpaperKind, asciiPreset]);

      // ResizeObserver + 30 FPS requestAnimationFrame Scheduler
      useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        let rafId: number | null = null;
        let lastFrameMs = 0;
        let simTimeSec = 2.4;
        const frameIntervalMs = 33; // Locked 30 FPS

        const syncCanvasSize = (cssWidth: number, cssHeight: number) => {
          const width = Math.max(1, Math.floor(cssWidth));
          const height = Math.max(1, Math.floor(cssHeight));
          const rawDpr = window.devicePixelRatio || 1;
          const baseDpr =
            width > 640 ? Math.min(1.25, rawDpr) : Math.min(2, rawDpr);
          const tier = propsRef.current.blurTier;
          const dpr =
            tier === 2
              ? Math.min(0.5, baseDpr)
              : tier === 1
                ? Math.min(0.75, baseDpr)
                : baseDpr;
          if (
            sizeRef.current.width === width &&
            sizeRef.current.height === height &&
            sizeRef.current.dpr === dpr
          ) {
            return false;
          }
          sizeRef.current = { width, height, dpr };
          canvas.width = Math.max(1, Math.floor(width * dpr));
          canvas.height = Math.max(1, Math.floor(height * dpr));
          return true;
        };

        syncSizeRef.current = () => {
          const r = canvas.getBoundingClientRect();
          return syncCanvasSize(r.width, r.height);
        };

        const renderFrameAt = (nowMs: number) => {
          const { width, height, dpr } = sizeRef.current;
          if (width <= 0 || height <= 0) return;

          const {
            wallpaperKind: kind,
            asciiPreset: preset,
            motionSpeed: speed,
            accentHex: accent,
            themeMode: mode,
            isPlaying: playing,
          } = propsRef.current;

          if (lastFrameMs > 0 && speed > 0) {
            const dtSec = Math.min(0.1, (nowMs - lastFrameMs) / 1000);
            simTimeSec += dtSec * speed;
          }
          lastFrameMs = nowMs;

          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          if (kind === "ascii_preset") {
            const renderer = getCachedAsciiPresetRenderer(preset);
            if (renderer) {
              renderer({
                ctx,
                width,
                height,
                timeSec: simTimeSec,
                preset,
                accentHex: accent,
                themeMode: mode,
                isPlaying: playing,
              });
            }
          }

          ctx.restore();
        };

        drawCurrentRef.current = renderFrameAt;

        const rect = canvas.getBoundingClientRect();
        syncCanvasSize(rect.width, rect.height);
        renderFrameAt(performance.now());

        const resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          const changed = syncCanvasSize(
            entry.contentRect.width,
            entry.contentRect.height
          );
          if (changed) {
            renderFrameAt(performance.now());
          }
        });
        resizeObserver.observe(canvas);

        const reducedMotionQuery =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)")
            : null;

        const isMotionPaused = () =>
          !isAppWindowActive() ||
          propsRef.current.motionSpeed <= 0 ||
          Boolean(reducedMotionQuery?.matches);

        const tick = (nowMs: number) => {
          if (isMotionPaused()) {
            rafId = null;
            return;
          }
          if (nowMs - lastFrameMs >= frameIntervalMs) {
            renderFrameAt(nowMs);
          }
          rafId = requestAnimationFrame(tick);
        };

        const startLoopIfNeeded = () => {
          if (rafId === null && !isMotionPaused()) {
            lastFrameMs = performance.now();
            rafId = requestAnimationFrame(tick);
          }
        };
        ensureLoopRef.current = startLoopIfNeeded;

        const handleActivityChange = () => {
          if (isMotionPaused()) {
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
          } else {
            renderFrameAt(performance.now());
            startLoopIfNeeded();
          }
        };

        const unsubscribeActivity = subscribeAppActivity(handleActivityChange);
        reducedMotionQuery?.addEventListener?.("change", handleActivityChange);
        startLoopIfNeeded();

        return () => {
          drawCurrentRef.current = null;
          syncSizeRef.current = null;
          ensureLoopRef.current = null;
          if (redrawRafIdRef.current !== null) {
            cancelAnimationFrame(redrawRafIdRef.current);
            redrawRafIdRef.current = null;
          }
          resizeObserver.disconnect();
          unsubscribeActivity();
          reducedMotionQuery?.removeEventListener?.(
            "change",
            handleActivityChange
          );
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
          }
          canvas.width = 0;
          canvas.height = 0;
        };
      }, []);

      // Coalesce static redraws and restart the RAF loop when resuming from Pause
      useEffect(() => {
        syncSizeRef.current?.();
        scheduleImmediateRedraw();
        if (motionSpeed > 0) {
          ensureLoopRef.current?.();
        }
      }, [
        wallpaperKind,
        asciiPreset,
        motionSpeed,
        accentHex,
        themeMode,
        isPlaying,
        blurTier,
      ]);

      return (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={`w-full h-full block pointer-events-none select-none ${className}`}
        />
      );
    }
  );
