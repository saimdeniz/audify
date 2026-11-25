import { AccentColorOption } from "../types";
import { generateDeterministicFullSpectrumColor } from "../utils/taxonomyColor";

export const ACCENT_COLORS: AccentColorOption[] = [
  {
    id: "amber",
    name: "Signal Amber",
    hex: "#F59E0B",
    rowBgDark: "#242016",
    rowBgLight: "#FDE68A",
  },
  {
    id: "te-orange",
    name: "Teenage Orange",
    hex: "#FF6B00",
    rowBgDark: "#291A12",
    rowBgLight: "#FED7AA",
  },
  {
    id: "studio-blue",
    name: "Studio Blue",
    hex: "#3B82F6",
    rowBgDark: "#131E33",
    rowBgLight: "#DBEAFE",
  },
  {
    id: "resolve-teal",
    name: "Resolve Teal",
    hex: "#06B6D4",
    rowBgDark: "#112429",
    rowBgLight: "#CFFAFE",
  },
  {
    id: "matrix-green",
    name: "Matrix Green",
    hex: "#10B981",
    rowBgDark: "#11261F",
    rowBgLight: "#D1FAE5",
  },
  {
    id: "royal-purple",
    name: "Royal Purple",
    hex: "#8B5CF6",
    rowBgDark: "#1E1633",
    rowBgLight: "#EDE9FE",
  },
  {
    id: "cyber-pink",
    name: "Cyber Pink",
    hex: "#EC4899",
    rowBgDark: "#291421",
    rowBgLight: "#FBCFE8",
  },
  {
    id: "crimson-red",
    name: "Crimson Red",
    hex: "#EF4444",
    rowBgDark: "#2A1517",
    rowBgLight: "#FEE2E2",
  },
];

export const FAMILY_COLOR_PALETTE: string[] = [
  "#22C55E", // Nature / Animals
  "#EF4444", // Action & Combat
  "#F59E0B", // Foley & Material
  "#14B8A6", // Nature & Ambience
  "#0EA5E9", // Sci-Fi & Tech
  "#8B5CF6", // Voice & Music
  "#EC4899", // Mood / Dramatic
  "#64748B", // Neutral / Source
];

export const STUDIO_COLOR_PALETTE: string[] = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16", "#22C55E",
  "#10B981", "#14B8A6", "#06B6D4", "#0EA5E9", "#3B82F6", "#6366F1",
  "#8B5CF6", "#A855F7", "#D946EF", "#EC4899", "#F43F5E", "#FB7185",
  "#38BDF8", "#2DD4BF", "#4ADE80", "#A3E635", "#FACC15", "#FB923C",
  "#F87171", "#E879F9", "#C084FC", "#818CF8", "#60A5FA", "#0284C7",
  "#0D9488", "#059669",
];

export function deterministicColorForName(name: string): string {
  if (!name || !name.trim()) return FAMILY_COLOR_PALETTE[0];
  return generateDeterministicFullSpectrumColor(name);
}
