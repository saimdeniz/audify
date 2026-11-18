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
}

export const AsciiMagicCanvas: React.FC<AsciiMagicCanvasProps> = React.memo(
  ({ slug, look, motionSpeed, themeMode, fit = "cover" }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const metaRef = useRef<AsciiMagicPieceMeta | null>(null);
    const frameRef = useRef<AsciiMagicFrame | null>(null);
    const versionRef = useRef<string>("");
    const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
      width: 0,
      height: 0,
      dpr: 1,
    });
    const configRef = useRef({
      slug,
      look,
      motionSpeed,
      themeMode,
      fit,
    });
    configRef.current = { slug, look, motionSpeed, themeMode, fit };
    const warnedSlugErrorRef = useRef<string | null>(null);

    const paintCurrent = () => {
      const canvas = canvasRef.current;
      const meta = metaRef.current;
      const frame = frameRef.current;
      if (!canvas || !meta || !frame) return;
      const ctx = canvas.getContext("2d");
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

    const clearCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
    };

    // Track canvas CSS + device-pixel geometry with ResizeObserver.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const updateSize = () => {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(0, Math.round(rect.width));
        const height = Math.max(0, Math.round(rect.height));
        const rawDpr = window.devicePixelRatio || 1;
        const dpr =
          width > 640 ? Math.min(1.25, rawDpr) : Math.min(1.5, rawDpr);
        const targetW = Math.max(1, Math.round(width * dpr));
        const targetH = Math.max(1, Math.round(height * dpr));
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        sizeRef.current = { width, height, dpr };
        paintCurrent();
      };

      asciiMagicSandbox.retainConsumer();
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(canvas);
      return () => {
        observer.disconnect();
        releaseCanvasRenderCaches(canvas, true);
        asciiMagicSandbox.releaseConsumer();
      };
    }, []);

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
        versionRef.current = loadVersion;
        void asciiMagicSandbox
          .loadPiece(slug, loadVersion)
          .then((loaded) => {
            if (cancelled || configRef.current.slug !== slug) return;
            warnedSlugErrorRef.current = null;
            metaRef.current = loaded.meta;
            frameRef.current = loaded.frame;
            paintCurrent();
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
      if (!slug || motionSpeed <= 0) return;

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
        if (isMotionPaused()) {
          rafId = 0;
          lastTickMs = now;
          return;
        }
        rafId = requestAnimationFrame(tick);

        const meta = metaRef.current;
        if (!meta || meta.still) return;

        const targetFps = Math.max(1, Math.min(60, (meta.fps || 15) * motionSpeed));
        const intervalMs = 1000 / targetFps;
        if (now - lastDrawMs < intervalMs || inFlight) {
          return;
        }

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
        lastTickMs = performance.now();
        rafId = requestAnimationFrame(tick);
      };

      const handlePauseChange = () => {
        if (isMotionPaused()) {
          if (rafId !== 0) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
        } else {
          startLoopIfNeeded();
        }
      };

      const unsubscribeActivity = subscribeAppActivity(handlePauseChange);
      reducedMotionQuery?.addEventListener?.("change", handlePauseChange);
      startLoopIfNeeded();
      return () => {
        cancelled = true;
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
