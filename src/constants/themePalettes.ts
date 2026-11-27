import { ACCENT_COLORS } from "./palettes";
import type { ThemeMode } from "../types";

export interface CanvasThemeBaseTokens {
  surface2: string;
  surface3: string;
  line: string;
  lineSubtle: string;
  lineStrong: string;
  fg: string;
  fg2: string;
  fg3: string;
  fgHead: string;
  okRgb: string;
  okOn: string;
}

export interface CanvasThemePalette {
  surface2: string;
  surface3: string;
  line: string;
  lineSubtle: string;
  lineStrong: string;
  fg: string;
  fg2: string;
  fg3: string;
  fgHead: string;
  accentColor: string;
  accentFillSoft: string;
  accentFillHover: string;
  accentOn: string;
  okOn: string;
  okColor: string;
  okFillSoft: string;
  okFillHover: string;
}

/**
 * Pure JS mirror of `src/index.css` surface/line/foreground/status tokens so canvas
 * renderers never trigger synchronous `getComputedStyle(document.documentElement)`.
 */
export const THEME_CANVAS_PALETTES: Readonly<
  Record<ThemeMode, { solid: CanvasThemeBaseTokens; mica: CanvasThemeBaseTokens }>
> = {
  dark: {
    solid: {
      surface2: "#18181C",
      surface3: "#1C1C21",
      line: "#26262C",
      lineSubtle: "#18181C",
      lineStrong: "#2E2E38",
      fg: "#F4F4F8",
      fg2: "#C8C8D4",
      fg3: "#9E9EAE",
      fgHead: "#B8B8C6",
      okRgb: "16, 185, 129",
      okOn: "#0D0D0F",
    },
    mica: {
      surface2: "rgba(24, 24, 29, 0.78)",
      surface3: "rgba(29, 29, 36, 0.80)",
      line: "rgba(255, 255, 255, 0.08)",
      lineSubtle: "rgba(255, 255, 255, 0.05)",
      lineStrong: "rgba(255, 255, 255, 0.14)",
      fg: "#F4F4F8",
      fg2: "#C8C8D4",
      fg3: "#9E9EAE",
      fgHead: "#B8B8C6",
      okRgb: "16, 185, 129",
      okOn: "#0D0D0F",
    },
  },
  light: {
    solid: {
      surface2: "#FAFAFC",
      surface3: "#FFFFFF",
      line: "#CBCDD8",
      lineSubtle: "#DFDFE8",
      lineStrong: "#B0B4C2",
      fg: "#111216",
      fg2: "#363945",
      fg3: "#525666",
      fgHead: "#484C5B",
      okRgb: "4, 120, 87",
      okOn: "#FFFFFF",
    },
    mica: {
      surface2: "rgba(255, 255, 255, 0.90)",
      surface3: "rgba(255, 255, 255, 0.94)",
      line: "rgba(15, 23, 42, 0.12)",
      lineSubtle: "rgba(15, 23, 42, 0.07)",
      lineStrong: "rgba(15, 23, 42, 0.20)",
      fg: "#111216",
      fg2: "#363945",
      fg3: "#525666",
      fgHead: "#484C5B",
      okRgb: "4, 120, 87",
      okOn: "#FFFFFF",
    },
  },
  contrast: {
    solid: {
      surface2: "#0A0A0A",
      surface3: "#121212",
      line: "#525252",
      lineSubtle: "#262626",
      lineStrong: "#666666",
      fg: "#FFFFFF",
      fg2: "#D4D4D4",
      fg3: "#A3A3A3",
      fgHead: "#CCCCCC",
      okRgb: "52, 211, 153",
      okOn: "#000000",
    },
    mica: {
      surface2: "rgba(16, 16, 18, 0.88)",
      surface3: "rgba(24, 24, 28, 0.90)",
      line: "rgba(255, 255, 255, 0.28)",
      lineSubtle: "rgba(255, 255, 255, 0.14)",
      lineStrong: "rgba(255, 255, 255, 0.45)",
      fg: "#FFFFFF",
      fg2: "#D4D4D4",
      fg3: "#A3A3A3",
      fgHead: "#CCCCCC",
      okRgb: "52, 211, 153",
      okOn: "#000000",
    },
  },
};

export function hexToRgbTriplet(hex: string): [number, number, number] {
  const raw = hex.replace("#", "").trim();
  const clean =
    raw.length === 3 ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}` : raw;
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0,
    ];
  }
  return [245, 158, 11];
}

export function normalizeAccentForTheme(hex: string, themeMode: ThemeMode): string {
  const [r, g, b] = hexToRgbTriplet(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const isMonochrome = Math.abs(r - g) < 16 && Math.abs(g - b) < 16;

  if (themeMode === "dark" || themeMode === "contrast") {
    if (lum < 0.25) {
      if (isMonochrome) {
        // Pure black or dark monochrome accent: normalize to zinc-600 (#52525B)
        // so button borders, focus rings, and badges have clear contrast
        return "#52525B";
      }
      const boost = 0.32 / Math.max(0.04, lum);
      const nr = Math.min(255, Math.max(45, Math.round(r * boost + 25)));
      const ng = Math.min(255, Math.max(45, Math.round(g * boost + 25)));
      const nb = Math.min(255, Math.max(45, Math.round(b * boost + 25)));
      return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
    }
  } else if (themeMode === "light") {
    if (lum > 0.78) {
      if (isMonochrome) {
        // Pure white or very bright monochrome in light mode: normalize to zinc-700 (#3F3F46)
        return "#3F3F46";
      }
      const dim = 0.65 / lum;
      const nr = Math.max(0, Math.min(210, Math.round(r * dim)));
      const ng = Math.max(0, Math.min(210, Math.round(g * dim)));
      const nb = Math.max(0, Math.min(210, Math.round(b * dim)));
      return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
    }
  }
  return hex;
}

export function computeFallbackRowBg(hex: string, themeMode: ThemeMode): string {
  const clean = hex.replace("#", "").trim();
  if (/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean)) {
    const [r, g, b] = hexToRgbTriplet(clean);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const isMonochrome = Math.abs(r - g) < 16 && Math.abs(g - b) < 16;
    if (themeMode === "light") {
      if (isMonochrome || lum > 0.78) {
        return "#E4E7EF";
      }
      const mix = 0.2;
      const pr = Math.round(255 * (1 - mix) + r * mix);
      const pg = Math.round(255 * (1 - mix) + g * mix);
      const pb = Math.round(255 * (1 - mix) + b * mix);
      return `rgb(${pr}, ${pg}, ${pb})`;
    }
    if (lum < 0.15 || (isMonochrome && lum < 0.35)) {
      return "#1F2026";
    }
    const mix = 0.14;
    const dr = Math.round(16 * (1 - mix) + r * mix);
    const dg = Math.round(17 * (1 - mix) + g * mix);
    const db = Math.round(22 * (1 - mix) + b * mix);
    return `rgb(${dr}, ${dg}, ${db})`;
  }
  return themeMode === "light" ? "#FDE68A" : "#242016";
}

export function resolveAccentPresetRowBg(
  effectiveAccent: string,
  themeMode: ThemeMode
): string {
  if (themeMode === "contrast") return "#1F1F1F";
  const preset = ACCENT_COLORS.find(
    (a) => a.hex.toLowerCase() === effectiveAccent.toLowerCase()
  );
  if (preset) {
    return themeMode === "light" ? preset.rowBgLight : preset.rowBgDark;
  }
  return computeFallbackRowBg(effectiveAccent, themeMode);
}

function linearizeSrgbChannel(channel255: number): number {
  const c = Math.max(0, Math.min(255, channel255)) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance (0.0 = black, 1.0 = white) using linearized sRGB. */
export function srgbRelativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * linearizeSrgbChannel(r) +
    0.7152 * linearizeSrgbChannel(g) +
    0.0722 * linearizeSrgbChannel(b)
  );
}

/** WCAG 2.1 contrast ratio between two relative luminances (1.0 .. 21.0). */
export function wcagContrastRatio(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const DARK_INK_LUMINANCE = srgbRelativeLuminance(13, 13, 15);

export function computeAccentOnColor(
  themeMode: ThemeMode,
  accentHex: string
): string {
  const effectiveAccent = normalizeAccentForTheme(accentHex, themeMode);
  const [r, g, b] = hexToRgbTriplet(effectiveAccent);
  const accentLum = srgbRelativeLuminance(r, g, b);
  const darkHex = themeMode === "contrast" ? "#000000" : "#0D0D0F";
  const darkLum = themeMode === "contrast" ? 0 : DARK_INK_LUMINANCE;
  const contrastWithDark = wcagContrastRatio(accentLum, darkLum);
  const contrastWithWhite = wcagContrastRatio(accentLum, 1);
  return contrastWithDark >= contrastWithWhite ? darkHex : "#FFFFFF";
}

export function normalizeThemeModeValue(raw: unknown): ThemeMode {
  if (raw === "light" || raw === "contrast" || raw === "dark") {
    return raw;
  }
  return "dark";
}

export function resolveCanvasThemePalette(
  themeMode: ThemeMode,
  enableMica: boolean,
  accentHex = "#F59E0B"
): CanvasThemePalette {
  const tokens = THEME_CANVAS_PALETTES[themeMode][enableMica ? "mica" : "solid"];
  const effectiveAccent = normalizeAccentForTheme(accentHex, themeMode);
  const [ar, ag, ab] = hexToRgbTriplet(effectiveAccent);
  const accentRgb = `${ar}, ${ag}, ${ab}`;
  return {
    surface2: tokens.surface2,
    surface3: tokens.surface3,
    line: tokens.line,
    lineSubtle: tokens.lineSubtle,
    lineStrong: tokens.lineStrong,
    fg: tokens.fg,
    fg2: tokens.fg2,
    fg3: tokens.fg3,
    fgHead: tokens.fgHead,
    accentColor: `rgb(${accentRgb})`,
    accentFillSoft: `rgba(${accentRgb}, 0.16)`,
    accentFillHover: `rgba(${accentRgb}, 0.25)`,
    accentOn: computeAccentOnColor(themeMode, accentHex),
    okOn: tokens.okOn,
    okColor: `rgb(${tokens.okRgb})`,
    okFillSoft: `rgba(${tokens.okRgb}, 0.16)`,
    okFillHover: `rgba(${tokens.okRgb}, 0.25)`,
  };
}
