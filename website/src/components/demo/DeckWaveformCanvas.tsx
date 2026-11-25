import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";

interface DeckWaveformCanvasProps {
  peaks: readonly number[];
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  sliceStart: number;
  sliceEnd: number;
  onSeek: (ratio: number) => void;
  onSliceChange: (startRatio: number, endRatio: number) => void;
}

/**
 * Interactive top Waveform Deck matching Audify's exact filled bottom-anchored
 * silhouette, crisp time ruler, playhead needle, and drag-to-slice selection.
 */
export const DeckWaveformCanvas: React.FC<DeckWaveformCanvasProps> = ({
  peaks,
  duration,
  currentTime,
  isPlaying,
  sliceStart,
  sliceEnd,
  onSeek,
  onSliceChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { theme, accent } = useTheme();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 66 });
  const dragRef = useRef<{ active: boolean; anchorRatio: number; moved: boolean }>({
    active: false,
    anchorRatio: 0,
    moved: false,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(240, Math.floor(entry.contentRect.width));
      const h = Math.max(54, Math.floor(entry.contentRect.height));
      setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const isLight = theme === "light";
    const rulerH = 15;
    const waveTop = rulerH + 2;
    const waveH = h - waveTop - 1;

    // Subtle vertical time ruler grid (matching Audify's top deck)
    const ticks = Math.max(4, Math.min(9, Math.floor(w / 95)));
    ctx.font = '500 9.5px "JetBrains Mono", monospace';
    ctx.textBaseline = "top";

    for (let i = 1; i < ticks; i++) {
      const ratio = i / ticks;
      const x = Math.round(ratio * w) + 0.5;
      ctx.strokeStyle = isLight ? "rgba(17,18,22,0.08)" : "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.fillStyle = isLight ? "#525666" : "#808294";
      const label = `${(ratio * duration).toFixed(2)}s`;
      ctx.fillText(label, x + 4, 2);
    }

    // Active slice highlight region
    const hasSlice = sliceStart > 0.005 || sliceEnd < 0.995;
    const [ar, ag, ab] = accent.rgb.split(" ").map(Number);

    if (hasSlice) {
      const sx = sliceStart * w;
      const ex = sliceEnd * w;
      // Dim outside slice
      ctx.fillStyle = isLight ? "rgba(17,18,22,0.12)" : "rgba(0,0,0,0.48)";
      ctx.fillRect(0, waveTop, sx, waveH + 1);
      ctx.fillRect(ex, waveTop, w - ex, waveH + 1);

      // Soft accent tint inside slice
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.16)`;
      ctx.fillRect(sx, waveTop, ex - sx, waveH + 1);
    }

    // Filled waveform silhouette (matching Audify's crisp bright bottom-anchored peaks)
    const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const peakCount = peaks.length;

    const drawWavePath = () => {
      ctx.beginPath();
      ctx.moveTo(0, h - 1);
      for (let i = 0; i < peakCount; i++) {
        const x = (i / Math.max(1, peakCount - 1)) * w;
        const amp = Math.max(0.03, peaks[i] ?? 0);
        const y = h - 1 - amp * waveH;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h - 1);
      ctx.closePath();
    };

    // Unplayed waveform body
    drawWavePath();
    ctx.fillStyle = isLight ? "#363b4b" : theme === "contrast" ? "#FFFFFF" : "#D4D7E2";
    ctx.fill();

    // Played waveform progress fill in active accent
    if (progressRatio > 0.002) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, progressRatio * w, h);
      ctx.clip();
      drawWavePath();
      ctx.fillStyle = accent.hex;
      ctx.fill();
      ctx.restore();
    }

    // Slice handles
    if (hasSlice) {
      const sx = sliceStart * w;
      const ex = sliceEnd * w;
      ctx.fillStyle = accent.hex;
      ctx.fillRect(sx, waveTop, 1.5, waveH + 1);
      ctx.fillRect(ex - 1.5, waveTop, 1.5, waveH + 1);

      // Small corner handle tabs
      ctx.fillRect(sx, waveTop, 7, 4);
      ctx.fillRect(ex - 7, waveTop, 7, 4);
    }

    // Crisp playhead needle
    if (isPlaying || progressRatio > 0.002) {
      const px = Math.min(w - 1, Math.max(0, progressRatio * w));
      ctx.fillStyle = accent.hex;
      ctx.fillRect(px, 0, 1.5, h);
    }
  }, [peaks, duration, currentTime, isPlaying, sliceStart, sliceEnd, size, theme, accent]);

  const getRatioFromEvent = (clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ratio = getRatioFromEvent(e.clientX);
    dragRef.current = { active: true, anchorRatio: ratio, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const ratio = getRatioFromEvent(e.clientX);
    if (Math.abs(ratio - dragRef.current.anchorRatio) > 0.015) {
      dragRef.current.moved = true;
      const s = Math.min(dragRef.current.anchorRatio, ratio);
      const end = Math.max(dragRef.current.anchorRatio, ratio);
      onSliceChange(s, end);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    const ratio = getRatioFromEvent(e.clientX);
    if (!wasMoved) {
      onSeek(ratio);
    } else {
      const s = Math.min(dragRef.current.anchorRatio, ratio);
      onSeek(s);
    }
  };

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="relative h-[66px] w-full cursor-crosshair select-none overflow-hidden bg-surface-0"
      title="Click to seek · Drag horizontally to mark non-destructive slice"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
};
