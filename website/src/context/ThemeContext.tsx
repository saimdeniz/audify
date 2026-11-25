import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  ACCENT_PRESETS,
  type AccentPreset,
  type AsciiPresetId,
  type ThemeMode,
} from "../config/siteConfig";

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  accent: AccentPreset;
  setAccentById: (id: string) => void;
  asciiEnabled: boolean;
  setAsciiEnabled: (enabled: boolean) => void;
  asciiPreset: AsciiPresetId;
  setAsciiPreset: (preset: AsciiPresetId) => void;
}

const STORAGE_KEY = "audify_web_theme_v1";

interface PersistedPrefs {
  theme?: ThemeMode;
  accentId?: string;
  asciiEnabled?: boolean;
  asciiPreset?: AsciiPresetId;
}

function loadPrefs(): PersistedPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedPrefs;
  } catch {
    return {};
  }
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = useMemo(() => loadPrefs(), []);
  const [theme, setTheme] = useState<ThemeMode>(initial.theme ?? "dark");
  const [accentId, setAccentId] = useState<string>(initial.accentId ?? ACCENT_PRESETS[0].id);
  const [asciiEnabled, setAsciiEnabled] = useState<boolean>(initial.asciiEnabled ?? false);
  const [asciiPreset, setAsciiPreset] = useState<AsciiPresetId>(initial.asciiPreset ?? "isobars");

  const accent = useMemo(
    () => ACCENT_PRESETS.find((a) => a.id === accentId) ?? ACCENT_PRESETS[0],
    [accentId]
  );

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.style.setProperty("--accent-rgb", accent.rgb);
    root.style.setProperty(
      "--accent-fg-rgb",
      theme === "light" ? accent.lightFgRgb : accent.rgb
    );
    root.style.setProperty("--c-accent-on", theme === "contrast" ? "#000000" : accent.onHex);

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme, accentId: accent.id, asciiEnabled, asciiPreset })
      );
    } catch {
      // Ignore storage quota errors in private browsing
    }
  }, [theme, accent, asciiEnabled, asciiPreset]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      accent,
      setAccentById: setAccentId,
      asciiEnabled,
      setAsciiEnabled,
      asciiPreset,
      setAsciiPreset,
    }),
    [theme, accent, asciiEnabled, asciiPreset]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
