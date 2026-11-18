import { invoke } from "@tauri-apps/api/core";
import {
  computeAccentOnColor,
  computeFallbackRowBg,
  hexToRgbTriplet,
  normalizeAccentForTheme,
  resolveAccentPresetRowBg,
} from "../constants/themePalettes";
import { ThemeMode } from "../types";

export { computeFallbackRowBg, hexToRgbTriplet, normalizeAccentForTheme };

let lastSyncedWindowTheme: ThemeMode | null = null;
let themeSwitchRaf1: number | null = null;
let themeSwitchRaf2: number | null = null;

function suppressThemeSwitchTransitions(root: HTMLElement): void {
  if (typeof root.removeAttribute !== "function") return;
  root.setAttribute("data-theme-switching", "true");
  if (typeof cancelAnimationFrame === "function") {
    if (themeSwitchRaf1 !== null) cancelAnimationFrame(themeSwitchRaf1);
    if (themeSwitchRaf2 !== null) cancelAnimationFrame(themeSwitchRaf2);
  }
  themeSwitchRaf1 = null;
  themeSwitchRaf2 = null;

  if (typeof requestAnimationFrame === "function") {
    themeSwitchRaf1 = requestAnimationFrame(() => {
      themeSwitchRaf1 = null;
      themeSwitchRaf2 = requestAnimationFrame(() => {
        themeSwitchRaf2 = null;
        root.removeAttribute("data-theme-switching");
      });
    });
  } else {
    root.removeAttribute("data-theme-switching");
  }
}

export function applyThemeAndAccentToDom(themeMode: ThemeMode, accentHex: string): void {
  if (typeof document === "undefined") return;

  const effectiveAccent = normalizeAccentForTheme(accentHex, themeMode);
  const root = document.documentElement;
  const hasGetAttr = typeof root.getAttribute === "function";
  const currentAttr = hasGetAttr ? root.getAttribute("data-theme") : null;
  if (currentAttr !== themeMode) {
    if (hasGetAttr && currentAttr !== null) {
      suppressThemeSwitchTransitions(root);
    }
    root.setAttribute("data-theme", themeMode);
  }
  root.style.setProperty("--signal-accent", effectiveAccent);
  root.style.setProperty("--accent-hex", effectiveAccent);
  if (lastSyncedWindowTheme !== themeMode) {
    lastSyncedWindowTheme = themeMode;
    void invoke("sync_window_theme_bg", { theme: themeMode }).catch(() => {});
  }

  // Accent channels (enable Tailwind opacity modifiers: border-accent/40)
  const [r, g, b] = hexToRgbTriplet(effectiveAccent);
  root.style.setProperty("--accent-rgb", `${r} ${g} ${b}`);

  // Compute slightly brighter/darker hover variant for solid bg-accent buttons
  const hoverFactor = themeMode === "light" ? 0.9 : 1.08;
  const hr = Math.max(0, Math.min(255, Math.round(r * hoverFactor)));
  const hg = Math.max(0, Math.min(255, Math.round(g * hoverFactor)));
  const hb = Math.max(0, Math.min(255, Math.round(b * hoverFactor)));
  root.style.setProperty(
    "--c-accent-hover",
    `#${hr.toString(16).padStart(2, "0")}${hg.toString(16).padStart(2, "0")}${hb.toString(16).padStart(2, "0")}`
  );

  // Dynamic luminance for text-on-accent and text-accent-fg:
  const accentLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const isMonochrome = Math.abs(r - g) < 16 && Math.abs(g - b) < 16;

  root.style.setProperty("--c-accent-on", computeAccentOnColor(themeMode, accentHex));

  // Accent used as text/icon on surface background:
  let fgR = r;
  let fgG = g;
  let fgB = b;

  if (themeMode === "dark" || themeMode === "contrast") {
    if (accentLum < 0.42) {
      if (isMonochrome) {
        fgR = 244;
        fgG = 244;
        fgB = 245;
      } else {
        const boost = 0.55 / Math.max(0.08, accentLum);
        fgR = Math.min(255, Math.round(r * boost + 35));
        fgG = Math.min(255, Math.round(g * boost + 35));
        fgB = Math.min(255, Math.round(b * boost + 35));
      }
    }
  } else if (themeMode === "light") {
    if (isMonochrome) {
      fgR = 24;
      fgG = 24;
      fgB = 27;
    } else if (accentLum > 0.24) {
      // Scale luminance into WCAG AA readable ink range on white/pastel Light surfaces
      const scale = Math.min(0.76, Math.sqrt(0.24 / Math.max(0.05, accentLum)) * 0.72);
      fgR = Math.max(0, Math.round(r * scale));
      fgG = Math.max(0, Math.round(g * scale));
      fgB = Math.max(0, Math.round(b * scale));
    }
  }

  root.style.setProperty("--accent-fg-rgb", `${fgR} ${fgG} ${fgB}`);

  const rowBg = resolveAccentPresetRowBg(effectiveAccent, themeMode);
  root.style.setProperty("--signal-accent-bg", rowBg);
}

let tintRafId: number | null = null;

function writeTintProperties(root: HTMLElement, t: number): void {
  root.style.setProperty("--tint-scale", String(t));
  root.style.setProperty("--tint-s0", `${(t * 11).toFixed(1)}%`);
  root.style.setProperty("--tint-s1", `${(t * 14).toFixed(1)}%`);
  root.style.setProperty("--tint-s2", `${(t * 16).toFixed(1)}%`);
  root.style.setProperty("--tint-s3", `${(t * 18).toFixed(1)}%`);
  root.style.setProperty("--tint-rail", `${(t * 16).toFixed(1)}%`);
  root.style.setProperty("--tint-head", `${(t * 16).toFixed(1)}%`);
  root.style.setProperty("--tint-badge", `${(t * 19).toFixed(1)}%`);
  root.style.setProperty("--tint-hover", `${(t * 21).toFixed(1)}%`);
  root.style.setProperty("--tint-line", `${(t * 30).toFixed(1)}%`);
  root.style.setProperty("--tint-line-subtle", `${(t * 22).toFixed(1)}%`);
  root.style.setProperty("--tint-line-strong", `${(t * 38).toFixed(1)}%`);
}

export function applyVisualEffectsToDom(
  enableMica: boolean,
  themeTintIntensity = 0
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (enableMica) {
    root.setAttribute("data-mica", "true");
  } else {
    root.removeAttribute("data-mica");
  }

  const t = Math.max(0, Math.min(1, themeTintIntensity));
  if (typeof requestAnimationFrame === "function") {
    if (tintRafId !== null) {
      cancelAnimationFrame(tintRafId);
    }
    tintRafId = requestAnimationFrame(() => {
      tintRafId = null;
      writeTintProperties(root, t);
    });
  } else {
    writeTintProperties(root, t);
  }
}
