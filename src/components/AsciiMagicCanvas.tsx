import React, { useEffect, useRef } from "react";
import { subscribeAsciiMagicUpdated } from "../services/asciiMagicService";
import type {
  AsciiMagicFrame,
  AsciiMagicLook,
  AsciiMagicPieceMeta,
  ThemeMode,
} from "../types";
import {
  isAppWindowActive,
  subscribeAppActivity,
} from "../utils/appFocusMonitor";
import {
  releaseCanvasRenderCaches,
  renderAsciiMagicFrame,
} from "../utils/asciiMagic/frameRenderer";
import { asciiMagicSandbox } from "../utils/asciiMagic/sandboxBridge";

export interface AsciiMagicCanvasProps {
  slug: string;
  look: AsciiMagicLook;
  motionSpeed: number;
  themeMode: ThemeMode;
  fit?: "cover" | "contain";
  blurPx?: number;
}

export const AsciiMagicCanvas: React.FC<AsciiMagicCanvasProps> = React.memo(
  ({ slug, look, motionSpeed, themeMode, fit = "cover", blurPx = 0 }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const metaRef = useRef<AsciiMagicPieceMeta | null>(null);
    const frameRef = useRef<AsciiMagicFrame | null>(null);
    const versionRef = useRef<string>("");
    const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
      width: 0,
      height: 0,
      dpr: 1,
    });
    const blurTier = blurPx >= 8 ? 2 : blurPx >= 3 ? 1 : 0;
    const configRef = useRef({
      slug,
      look,
      motionSpeed,
      themeMode,
      fit,
      blurTier,
    });
    configRef.current = { slug, look, motionSpeed, themeMode, fit, blurTier };
    const warnedSlugErrorRef = useRef<string | null>(null);
    const sandboxRetainedRef = useRef(false);
    const idleReleaseTimerRef = useRef<number | null>(null);
    const resumeLoopRef = useRef<(() => void) | null>(null);
    const syncSizeRef = useRef<(() => boolean) | null>(null);
    const redrawRafIdRef = useRef<number | null>(null);
    const prevBlurTierRef = useRef<number>(blurTier);

    const ensureSandboxRetained = () => {
      if (idleReleaseTimerRef.current !== null) {
        window.clearTimeout(idleReleaseTimerRef.current);
        idleReleaseTimerRef.current = null;
      }
      if (!sandboxRetainedRef.current) {
        asciiMagicSandbox.retainConsumer();
        sandboxRetainedRef.current = true;
      }
    };

    const scheduleIdleSandboxRelease = () => {
      if (idleReleaseTimerRef.current !== null || !sandboxRetainedRef.current) {
        return;
      }
      idleReleaseTimerRef.current = window.setTimeout(() => {
        idleReleaseTimerRef.current = null;
        if (sandboxRetainedRef.current) {
          asciiMagicSandbox.releaseConsumer();
          sandboxRetainedRef.current = false;
        }
      }, 8000);
    };

    const paintCurrent = () => {
      const canvas = canvasRef.current;
      const meta = metaRef.current;
      const frame = frameRef.current;
      if (!canvas || !meta || !frame) return;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      const { width, height, dpr } = sizeRef.current;
      if (width <= 0 || height <= 0) return;
      const cfg = configRef.current;
      renderAsciiMagicFrame(ctx, width, height, dpr, meta, frame, {
        look: cfg.look,
        themeMode: cfg.themeMode,
        fit: cfg.fit,
      });
    };
    const paintCurrentRef = useRef(paintCurrent);
    paintCurrentRef.current = paintCurrent;

    const clearCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      const { width, height, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
    };

    const scheduleImmediateRedraw = () => {
      if (redrawRafIdRef.current !== null) return;
      if (typeof requestAnimationFrame === "function") {
        redrawRafIdRef.current = requestAnimationFrame(() => {
          redrawRafIdRef.current = null;
          paintCurrentRef.current();
        });
      } else {
        paintCurrentRef.current();
      }
    };

    // Track canvas CSS + device-pixel geometry with ResizeObserver (mount/unmount only).
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const applyBackingSize = (cssWidth: number, cssHeight: number): boolean => {
        const width = Math.max(0, Math.round(cssWidth));
        const height = Math.max(0, Math.round(cssHeight));
        const rawDpr = window.devicePixelRatio || 1;
        const tier = configRef.current.blurTier;
        const baseDpr =
          width > 640 ? Math.min(1.25, rawDpr) : Math.min(1.5, rawDpr);
        const dpr =
          tier === 2
            ? Math.min(0.5, baseDpr)
            : tier === 1
              ? Math.min(0.75, baseDpr)
              : baseDpr;
        const targetW = Math.max(1, Math.round(width * dpr));
        const targetH = Math.max(1, Math.round(height * dpr));
        const prev = sizeRef.current;
        if (
          prev.width === width &&
          prev.height === height &&
          prev.dpr === dpr &&
          canvas.width === targetW &&
          canvas.height === targetH
        ) {
          return false;
        }
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        sizeRef.current = { width, height, dpr };
        return true;
      };

      syncSizeRef.current = () => {
        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          return applyBackingSize(width, height);
        }
        const rect = canvas.getBoundingClientRect();
        return applyBackingSize(rect.width, rect.height);
      };

      ensureSandboxRetained();
      const initialRect = canvas.getBoundingClientRect();
      applyBackingSize(initialRect.width, initialRect.height);
      paintCurrent();

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const changed = applyBackingSize(
          entry.contentRect.width,
          entry.contentRect.height
        );
        if (changed) {
          scheduleImmediateRedraw();
        }
      });
      observer.observe(canvas);
      return () => {
        syncSizeRef.current = null;
        if (redrawRafIdRef.current !== null) {
          cancelAnimationFrame(redrawRafIdRef.current);
          redrawRafIdRef.current = null;
        }
        observer.disconnect();
        if (idleReleaseTimerRef.current !== null) {
          window.clearTimeout(idleReleaseTimerRef.current);
          idleReleaseTimerRef.current = null;
        }
        releaseCanvasRenderCaches(canvas, true);
        if (sandboxRetainedRef.current) {
          asciiMagicSandbox.releaseConsumer();
          sandboxRetainedRef.current = false;
        }
      };
    }, []);

    // Settle backing-store DPR smoothly across discrete blur tiers without
    // tearing down ResizeObserver, sandbox retention, or warm glyph caches.
    useEffect(() => {
      if (prevBlurTierRef.current === blurTier) return;
      prevBlurTierRef.current = blurTier;
      const delayMs = blurTier === 0 ? 80 : 140;
      const timer = window.setTimeout(() => {
        if (syncSizeRef.current?.()) {
          scheduleImmediateRedraw();
        }
      }, delayMs);
      return () => {
        window.clearTimeout(timer);
      };
    }, [blurTier]);

    // Load active piece in sandbox & subscribe to install updates for this slug.
    useEffect(() => {
      releaseCanvasRenderCaches(canvasRef.current, false);
      if (!slug) {
        metaRef.current = null;
        frameRef.current = null;
        clearCanvas();
        return;
      }

      let cancelled = false;
      let loadVersion = "";

      const loadTarget = () => {
        ensureSandboxRetained();
        versionRef.current = loadVersion;
        void asciiMagicSandbox
          .loadPiece(slug, loadVersion)
          .then((loaded) => {
            if (cancelled || configRef.current.slug !== slug) return;
            warnedSlugErrorRef.current = null;
            metaRef.current = loaded.meta;
            frameRef.current = loaded.frame;
            paintCurrent();
            if (loaded.meta.still || configRef.current.motionSpeed <= 0) {
              scheduleIdleSandboxRelease();
            } else {
              resumeLoopRef.current?.();
            }
          })
          .catch((err) => {
            if (cancelled) return;
            if (warnedSlugErrorRef.current !== slug) {
              warnedSlugErrorRef.current = slug;
              console.warn(`[AsciiMagic] Failed to load piece "${slug}":`, err);
            }
            metaRef.current = null;
            frameRef.current = null;
            clearCanvas();
          });
      };

      loadTarget();
      const unsub = subscribeAsciiMagicUpdated((updatedSlug) => {
        if (updatedSlug === slug) {
          loadVersion = String(Date.now());
          loadTarget();
        }
      });

      return () => {
        cancelled = true;
        unsub();
      };
    }, [slug]);

    // Repaint immediately when look, fit, or theme changes without waiting for next tick.
    useEffect(() => {
      paintCurrent();
    }, [look, themeMode, fit]);

    // Drive smooth animation loop throttled by piece FPS x motionSpeed.
    useEffect(() => {
      if (!slug || motionSpeed <= 0) {
        resumeLoopRef.current = null;
        scheduleIdleSandboxRelease();
        return;
      }

      const reducedMotionQuery =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-reduced-motion: reduce)")
          : null;

      let cancelled = false;
      let rafId = 0;
      let inFlight = false;
      let elapsedSec = 0;
      let lastTickMs = performance.now();
      let lastDrawMs = 0;

      const isMotionPaused = () =>
        !isAppWindowActive() ||
        Boolean(reducedMotionQuery?.matches);

      const tick = (now: number) => {
        if (cancelled) return;
        const meta = metaRef.current;
        if (!meta || meta.still) {
          rafId = 0;
          if (meta?.still) scheduleIdleSandboxRelease();
          return;
        }
        if (isMotionPaused()) {
          rafId = 0;
          lastTickMs = now;
          scheduleIdleSandboxRelease();
          return;
        }
        rafId = requestAnimationFrame(tick);

        const targetFps = Math.max(1, Math.min(60, (meta.fps || 15) * motionSpeed));
        const intervalMs = 1000 / targetFps;
        if (now - lastDrawMs < intervalMs || inFlight) {
          return;
        }

        ensureSandboxRetained();
        const dt = Math.min(0.25, Math.max(0, (now - lastTickMs) / 1000));
        lastTickMs = now;
        elapsedSec += dt * motionSpeed;
        lastDrawMs = now;
        inFlight = true;

        void asciiMagicSandbox
          .computeFrame(slug, elapsedSec, versionRef.current)
          .then((frame) => {
            if (cancelled || configRef.current.slug !== slug) return;
            frameRef.current = frame;
            paintCurrent();
          })
          .catch((err) => {
            if (!cancelled && warnedSlugErrorRef.current !== slug) {
              warnedSlugErrorRef.current = slug;
              console.warn(`[AsciiMagic] Frame error in "${slug}":`, err);
            }
          })
          .finally(() => {
            inFlight = false;
          });
      };

      const startLoopIfNeeded = () => {
        if (cancelled || rafId !== 0 || isMotionPaused()) return;
        const meta = metaRef.current;
        if (!meta || meta.still) return;
        ensureSandboxRetained();
        lastTickMs = performance.now();
        rafId = requestAnimationFrame(tick);
      };
      resumeLoopRef.current = startLoopIfNeeded;

      const handlePauseChange = () => {
        if (isMotionPaused()) {
          if (rafId !== 0) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          scheduleIdleSandboxRelease();
        } else {
          startLoopIfNeeded();
        }
      };

      const unsubscribeActivity = subscribeAppActivity(handlePauseChange);
      reducedMotionQuery?.addEventListener?.("change", handlePauseChange);
      startLoopIfNeeded();
      return () => {
        cancelled = true;
        resumeLoopRef.current = null;
        unsubscribeActivity();
        reducedMotionQuery?.removeEventListener?.("change", handlePauseChange);
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
        }
      };
    }, [slug, motionSpeed]);

    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="w-full h-full block pointer-events-none"
      />
    );
  }
);

export default AsciiMagicCanvas;
