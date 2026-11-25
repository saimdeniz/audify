import React, { useEffect, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import { readLiveSpectrumBins } from "../services/demoAudioBridge";

/**
 * Art-directed minimalist Studio ASCII Atmosphere.
 * Three clean, architectural presets (Isobars, Spectrum, Horizon) designed to frame
 * the workspace like a precision audio instrument without ever obscuring readability.
 */
export const AsciiAtmosphere: React.FC = () => {
  const { theme, accent, asciiEnabled, asciiPreset } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: -9999,
    y: -9999,
    active: false,
  });

  // Automatically suppress in High Contrast mode (matches Audify DESIGN.md)
  const shouldRender = asciiEnabled && theme !== "contrast";

  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [ar, ag, ab] = accent.rgb.split(" ").map(Number);
    const isLight = theme === "light";
    const baseRgb = isLight ? [72, 76, 94] : [154, 158, 178];

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });

    const onMove = (e: MouseEvent) => {
      pointerRef.current.x = e.clientX;
      pointerRef.current.y = e.clientY;
      pointerRef.current.active = true;
    };
    const onLeave = () => {
      pointerRef.current.active = false;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave, { passive: true });

    let rafId = 0;
    let lastDraw = 0;
    const startTime = performance.now();

    const drawFrame = (now: number) => {
      if (!prefersReducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
      // Smooth 30fps studio cadence (zero wasted CPU/GPU)
      if (!prefersReducedMotion && now - lastDraw < 33) return;
      if (document.hidden) return;
      lastDraw = now;

      const t = prefersReducedMotion ? 2.4 : (now - startTime) * 0.00055;
      ctx.clearRect(0, 0, width, height);

      const cellW = 14;
      const cellH = 20;
      const cols = Math.ceil(width / cellW) + 1;
      const rows = Math.ceil(height / cellH) + 1;

      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const px = pointerRef.current.x;
      const py = pointerRef.current.y;
      const pointerOn = pointerRef.current.active;

      if (asciiPreset === "isobars") {
        // Minimalist architectural topographic acoustic contour lines
        for (let r = 0; r < rows; r++) {
          const y = r * cellH + cellH * 0.5;
          const ny = y / height;
          for (let c = 0; c < cols; c++) {
            const x = c * cellW + cellW * 0.5;
            const nx = x / width;

            // Gentle edge-weighted radial mask so central typography breathes cleanly
            const dxCenter = (nx - 0.5) * 1.45;
            const dyCenter = (ny - 0.45) * 1.25;
            const edgeWeight = Math.min(1, 0.24 + Math.hypot(dxCenter, dyCenter) * 0.85);

            // Smooth dual-harmonic acoustic elevation field
            const field =
              Math.sin(nx * 5.2 + t * 0.9) * Math.cos(ny * 4.4 - t * 0.65) +
              0.55 * Math.sin((nx * 3.1 - ny * 2.6) * 2.4 + t * 0.5) +
              0.3 * Math.cos(Math.hypot(nx - 0.5, ny - 0.5) * 9.0 - t * 1.1);

            // Extract thin clean contour bands (isobars) rather than noisy filled blobs
            const band = Math.abs(((field * 3.2) % 1 + 1) % 1 - 0.5);
            if (band > 0.13) {
              // Sparse micro-grid registration dots every 6 cells
              if (r % 6 === 0 && c % 8 === 0) {
                const dotAlpha = (isLight ? 0.16 : 0.12) * edgeWeight;
                ctx.fillStyle = `rgba(${baseRgb[0]},${baseRgb[1]},${baseRgb[2]},${dotAlpha.toFixed(3)})`;
                ctx.fillText("+", x, y);
              }
              continue;
            }

            let ch = "·";
            if (band < 0.028) ch = field > 0.45 ? "∘" : "─";
            else if (band < 0.06) ch = field > 0 ? "╱" : "╲";
            else if (band < 0.095) ch = "∙";

            // Subtle cursor illumination toward active accent color
            let accentMix = Math.max(0, (field - 0.65) * 0.55);
            if (pointerOn) {
              const dist = Math.hypot(x - px, y - py);
              if (dist < 210) {
                accentMix = Math.min(1, accentMix + (1 - dist / 210) * 0.9);
              }
            }

            const cr = Math.round(baseRgb[0] + (ar - baseRgb[0]) * accentMix);
            const cg = Math.round(baseRgb[1] + (ag - baseRgb[1]) * accentMix);
            const cb = Math.round(baseRgb[2] + (ab - baseRgb[2]) * accentMix);
            const alpha =
              ((isLight ? 0.28 : 0.24) + accentMix * (isLight ? 0.34 : 0.42)) *
              edgeWeight *
              (1 - band / 0.14);

            ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
            ctx.fillText(ch, x, y);
          }
        }
      } else if (asciiPreset === "spectrum") {
        // Minimalist vertical Braille harmonic field (reacts live to Live Demo Web Audio FFT!)
        const fft = readLiveSpectrumBins();
        const brailleRamp = ["·", "⠁", "⠃", "⠇", "⠏", "⠟", "⠿"];
        const stepC = 2;

        for (let c = 0; c < cols; c += stepC) {
          const x = c * cellW + cellW * 0.5;
          const nx = x / width;
          const sym = Math.abs(nx - 0.5) * 2; // 0 center -> 1 edge

          let amp =
            0.16 +
            0.14 * Math.sin(nx * 14 + t * 1.8) * Math.cos(nx * 5 - t * 0.9) +
            0.1 * Math.sin(nx * 26 - t * 2.4);

          if (fft && fft.length > 0) {
            const idx = Math.min(fft.length - 1, Math.floor(sym * (fft.length - 1)));
            amp = Math.max(amp, fft[idx] * 0.68);
          }

          const centerRow = Math.floor(rows * 0.52);
          const halfSpan = Math.max(2, Math.floor(amp * rows * 0.48));
          const edgeBoost = 0.35 + sym * 0.65;

          for (let dr = -halfSpan; dr <= halfSpan; dr++) {
            const r = centerRow + dr;
            if (r < 0 || r >= rows) continue;
            const y = r * cellH + cellH * 0.5;
            const normDist = Math.abs(dr) / Math.max(1, halfSpan);
            const glyphIdx = Math.min(
              brailleRamp.length - 1,
              Math.max(0, Math.round((1 - normDist) * (brailleRamp.length - 1)))
            );

            const accentMix = Math.max(0, 1 - normDist * 1.4) * (fft ? 0.95 : 0.48);
            const cr = Math.round(baseRgb[0] + (ar - baseRgb[0]) * accentMix);
            const cg = Math.round(baseRgb[1] + (ag - baseRgb[1]) * accentMix);
            const cb = Math.round(baseRgb[2] + (ab - baseRgb[2]) * accentMix);
            const alpha =
              ((isLight ? 0.14 : 0.12) + (1 - normDist) * (isLight ? 0.24 : 0.26)) * edgeBoost;

            ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
            ctx.fillText(brailleRamp[glyphIdx], x, y);
          }
        }
      } else {
        // "horizon": Minimalist Braun/Teenage-Engineering architectural wireframe horizon
        const horizonRow = Math.floor(rows * 0.46);

        for (let c = 0; c < cols; c++) {
          const x = c * cellW + cellW * 0.5;
          const nx = x / width;

          // Subtle acoustic ridge silhouette resting cleanly on the horizon
          const ridgeHeight = Math.round(
            (Math.sin(nx * 9.5 + t * 0.45) * 0.5 +
              Math.sin(nx * 21.0 - t * 0.7) * 0.25 +
              Math.cos(nx * 4.2 + 1.1) * 0.65 +
              1.4) *
              2.6
          );

          for (let h = 0; h <= ridgeHeight; h++) {
            const r = horizonRow - h;
            if (r < 1) continue;
            const y = r * cellH + cellH * 0.5;
            const isCrest = h === ridgeHeight;
            const ch = isCrest ? "─" : h % 2 === 0 ? "·" : "╵";
            const accentMix = isCrest ? 0.85 : 0.22;
            const cr = Math.round(baseRgb[0] + (ar - baseRgb[0]) * accentMix);
            const cg = Math.round(baseRgb[1] + (ag - baseRgb[1]) * accentMix);
            const cb = Math.round(baseRgb[2] + (ab - baseRgb[2]) * accentMix);
            const alpha = isCrest ? (isLight ? 0.46 : 0.48) : (isLight ? 0.14 : 0.13);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
            ctx.fillText(ch, x, y);
          }
        }

        // Clean perspective floor ticks below horizon
        for (let r = horizonRow + 1; r < rows; r++) {
          const y = r * cellH + cellH * 0.5;
          const depth = (r - horizonRow) / Math.max(1, rows - horizonRow);
          const isMajorRow = (r - horizonRow) % 3 === 0;
          const rowAlpha = (isLight ? 0.11 : 0.1) + depth * (isLight ? 0.15 : 0.14);

          for (let c = 0; c < cols; c++) {
            const x = c * cellW + cellW * 0.5;
            const centered = (x - width * 0.5) / (width * 0.5);
            // Perspective converging spokes
            const spokePhase = Math.abs(((centered / (0.28 + depth * 1.1)) * 4) % 1);
            const isSpoke = spokePhase < 0.065 || spokePhase > 0.935;

            if (!isMajorRow && !isSpoke) continue;
            const ch = isMajorRow && isSpoke ? "+" : isMajorRow ? "─" : "│";
            const accentMix = isMajorRow && isSpoke ? 0.65 : 0.1;
            const cr = Math.round(baseRgb[0] + (ar - baseRgb[0]) * accentMix);
            const cg = Math.round(baseRgb[1] + (ag - baseRgb[1]) * accentMix);
            const cb = Math.round(baseRgb[2] + (ab - baseRgb[2]) * accentMix);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${rowAlpha.toFixed(3)})`;
            ctx.fillText(ch, x, y);
          }
        }
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [shouldRender, theme, accent, asciiPreset]);

  if (!shouldRender) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
};
