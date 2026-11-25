import React, { useEffect, useRef } from "react";
import { useTheme } from "../../context/ThemeContext";

interface MiniWaveformCanvasProps {
  peaks: readonly number[];
  isActive: boolean;
  progressRatio: number;
  width?: number;
  height?: number;
}

/**
 * Bottom-anchored Audify Mini Waveform canvas matching the real Audify SampleTable rows.
 */
export const MiniWaveformCanvas: React.FC<MiniWaveformCanvasProps> = React.memo(
  ({ peaks, isActive, progressRatio, width = 180, height = 22 }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const { theme, accent } = useTheme();

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const isLight = theme === "light";
      const baseColor = isLight ? "#4b5163" : isActive ? "#d8dce8" : "#9a9fb2";
      const accentColor = accent.hex;
      const baselineColor = isLight ? "rgba(17,18,22,0.16)" : "rgba(255,255,255,0.14)";

      // Subtle baseline
      ctx.fillStyle = baselineColor;
      ctx.fillRect(0, height - 1, width, 1);

      const barCount = Math.min(90, peaks.length);
      const step = peaks.length / barCount;
      const barW = width / barCount;

      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor(i * step);
        const amp = Math.max(0.06, peaks[idx] ?? 0);
        const h = Math.max(1.5, amp * (height - 3));
        const x = i * barW;
        const ratio = i / barCount;

        ctx.fillStyle = isActive && progressRatio > 0 && ratio <= progressRatio ? accentColor : baseColor;
        ctx.fillRect(x, height - h - 1, Math.max(1, barW - 0.5), h);
      }

      if (isActive && progressRatio > 0) {
        const px = Math.min(width - 1, Math.max(0, progressRatio * width));
        ctx.fillStyle = accentColor;
        ctx.fillRect(px, 0, 1.5, height);
      }
    }, [peaks, isActive, progressRatio, width, height, theme, accent]);

    return (
      <canvas
        ref={canvasRef}
        style={{ width: `${width}px`, height: `${height}px` }}
        className="block shrink-0"
      />
    );
  }
);
MiniWaveformCanvas.displayName = "MiniWaveformCanvas";
