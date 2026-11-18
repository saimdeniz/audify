import React, { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getPlayheadSec, subscribePlayhead } from "../store/playheadClock";
import { useSampleStore } from "../store/useSampleStore";
import { ThemeMode, WaveformSensitivity, WaveformStyle } from "../types";
import {
  getCanvasThemePalette,
  parsePeaks,
  samplePeakRange,
} from "../utils/format";
import { usePeaksJson } from "../utils/peaksStore";

export interface WaveformDisplayConfig {
  accentColor: string;
  themeMode: ThemeMode;
  enableMica: boolean;
  waveformSensitivity: WaveformSensitivity;
  waveformStyle: WaveformStyle;
}

const UNSUBSCRIBED_DISPLAY_SENTINEL: WaveformDisplayConfig = {
  accentColor: "",
  themeMode: "dark",
  enableMica: false,
  waveformSensitivity: "logarithmic",
  waveformStyle: "solid_baseline",
};

interface MiniWaveformProps {
  sampleId: number;
  peaksJson?: string;
  isSelected: boolean;
  /** True only for the single currently loaded track in the transport deck */
  isActiveTrack?: boolean;
  /** Duration in seconds used to compute live playhead ratio when `isActiveTrack` is true */
  durationSec?: number;
  /** Optional static fallback progress ratio */
  progressRatio?: number;
  width?: number;
  displayConfig?: WaveformDisplayConfig;
  onScrubRatio?: (ratio: number) => void;
}

export const MiniWaveform: React.FC<MiniWaveformProps> = React.memo(
  ({
    sampleId,
    peaksJson: inlinePeaksJson,
    isSelected,
    isActiveTrack = false,
    durationSec = 0,
    progressRatio = 0,
    width: propWidth,
    displayConfig: propDisplayConfig,
    onScrubRatio,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const [measuredWidth, setMeasuredWidth] = useState<number>(184);

    const peaksJson = usePeaksJson(sampleId, inlinePeaksJson);
    const storeDisplayConfig = useSampleStore(
      useShallow((s): WaveformDisplayConfig =>
        propDisplayConfig
          ? UNSUBSCRIBED_DISPLAY_SENTINEL
          : {
              accentColor: s.accentColor,
              themeMode: s.themeMode,
              enableMica: s.enableMica,
              waveformSensitivity: s.waveformSensitivity,
              waveformStyle: s.waveformStyle,
            }
      )
    );
    const {
      accentColor,
      themeMode,
      enableMica,
      waveformSensitivity,
      waveformStyle,
    } = propDisplayConfig ?? storeDisplayConfig;

    useEffect(() => {
      if (propWidth !== undefined) return;
      const el = containerRef.current;
      if (!el) return;

      const updateWidth = () => {
        const w = Math.floor(el.getBoundingClientRect().width);
        if (w > 20) setMeasuredWidth(w);
      };

      updateWidth();

      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = Math.floor(entry.contentRect.width);
            if (w > 20) setMeasuredWidth(w);
          }
        });
        observer.observe(el);
        return () => observer.disconnect();
      }
    }, [propWidth]);

    const effectiveWidth = Math.max(48, propWidth ?? measuredWidth);

    const drawMini = useCallback(
      (livePlayheadSec?: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const width = effectiveWidth;
        const height = 22;

        const targetW = Math.floor(width * dpr);
        const targetH = Math.floor(height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const palette = getCanvasThemePalette(
          `${themeMode}:${enableMica}:${accentColor}`
        );
        const peaks = parsePeaks(peaksJson);
        const isSolidBaseline = waveformStyle !== "symmetric";
        const baselineY = height - 1;
        const maxWaveHeight = height - 2;
        const midY = Math.floor(height * 0.5);
        const maxHalfHeight = height * 0.5 * 0.85;

        const unplayedSelectedColor = palette.fg2;
        const passiveColor = palette.fg3;

        const activeRatio =
          isActiveTrack && durationSec > 0
            ? Math.max(
                0,
                Math.min(1, (livePlayheadSec ?? getPlayheadSec()) / durationSec)
              )
            : progressRatio;

        for (let x = 0; x < width; x++) {
          const r0 = x / width;
          const r1 = (x + 1) / width;
          const peakVal = samplePeakRange(peaks, r0, r1, waveformSensitivity);

          let color = passiveColor;
          const isPlayed = (isActiveTrack || isSelected) && r0 <= activeRatio && activeRatio > 0;
          if (isPlayed) {
            color = accentColor;
          } else if (isSelected) {
            color = unplayedSelectedColor;
          }

          ctx.fillStyle = color;

          if (isSolidBaseline) {
            const barHeight = Math.max(1, Math.round(peakVal * maxWaveHeight));
            ctx.fillRect(x, baselineY - barHeight, 1, barHeight);
          } else {
            const halfAmp = Math.max(0.4, peakVal * maxHalfHeight);
            ctx.fillRect(
              x,
              midY - halfAmp,
              1,
              Math.max(1, Math.round(halfAmp * 2))
            );
          }
        }

        ctx.restore();
      },
      [
        peaksJson,
        isSelected,
        isActiveTrack,
        durationSec,
        progressRatio,
        accentColor,
        themeMode,
        enableMica,
        waveformSensitivity,
        waveformStyle,
        effectiveWidth,
      ]
    );

    const drawMiniRef = useRef(drawMini);
    drawMiniRef.current = drawMini;

    useEffect(() => {
      drawMini();
    }, [drawMini]);

    useEffect(() => {
      const canvas = canvasRef.current;
      return () => {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      };
    }, []);

    // Subscribe ONLY the single currently loaded track to the 60Hz playhead clock!
    useEffect(() => {
      if (!isActiveTrack) return;
      return subscribePlayhead((sec) => {
        drawMiniRef.current(sec);
      });
    }, [isActiveTrack]);

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button === 0) {
        mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const downPos = mouseDownPosRef.current;
      mouseDownPosRef.current = null;
      if (
        downPos &&
        Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) >= 5
      ) {
        e.stopPropagation();
        return;
      }
      if (!onScrubRatio) return;
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      onScrubRatio(ratio);
    };

    return (
      <div
        ref={containerRef}
        className="w-full h-full flex items-center overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          style={{ width: `${effectiveWidth}px`, height: "22px" }}
          className="block cursor-pointer"
        />
      </div>
    );
  }
);
