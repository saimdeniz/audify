export type AtmosphereStyleId =
  | "studio_pure"
  | "mica_glass"
  | "wallpaper_focus"
  | "custom_style";

export interface AtmosphereStylePreset {
  readonly id: Exclude<AtmosphereStyleId, "custom_style">;
  readonly name: string;
  readonly previewLabel: string;
  readonly tagline: string;
  readonly enableMica: boolean;
  readonly tint: number;
  readonly blur: number;
  readonly opacity: number;
}

export interface AtmosphereCustomStyleMeta {
  readonly id: "custom_style";
  readonly name: string;
  readonly previewLabel: string;
  readonly tagline: string;
}

export interface AtmosphereSurfaceState {
  readonly enableMica: boolean;
  readonly themeTintIntensity: number;
  readonly customBgBlur: number;
  readonly customBgOpacity: number;
}

export interface ResolvedAtmosphereStyle {
  readonly id: AtmosphereStyleId;
  readonly name: string;
  readonly previewLabel: string;
  readonly enableMica: boolean;
}

/** Curated one-click Surface & Atmosphere style presets (Single Source of Truth). */
export const ATMOSPHERE_STYLE_PRESETS: readonly AtmosphereStylePreset[] = [
  {
    id: "studio_pure",
    name: "Studio Matte",
    previewLabel: "STUDIO MATTE",
    tagline:
      "Solid high-contrast studio surface (15% Tint · 0px Blur · 75% Visibility)",
    enableMica: false,
    tint: 0.15,
    blur: 0,
    opacity: 0.75,
  },
  {
    id: "mica_glass",
    name: "Frosted Mica",
    previewLabel: "FROSTED MICA",
    tagline:
      "Frosted sidebar & titlebar glass with crisp backdrop (45% Tint · 0px Blur · 75% Visibility)",
    enableMica: true,
    tint: 0.45,
    blur: 0,
    opacity: 0.75,
  },
  {
    id: "wallpaper_focus",
    name: "Soft Ambient",
    previewLabel: "SOFT AMBIENT",
    tagline:
      "Softened ambient backdrop with rich frosted chrome (25% Tint · 6px Blur · 85% Visibility)",
    enableMica: true,
    tint: 0.25,
    blur: 6,
    opacity: 0.85,
  },
];

/** Fallback custom style definition when controls diverge from curated presets. */
export const ATMOSPHERE_CUSTOM_STYLE: AtmosphereCustomStyleMeta = {
  id: "custom_style",
  name: "Custom",
  previewLabel: "CUSTOM",
  tagline:
    "Freely customize Mica, Tint (0–100%), Backdrop blur (0–40px), and Visibility (0–100%)",
};

/**
 * Resolves the active atmosphere style (`Studio Matte`, `Frosted Mica`,
 * `Soft Ambient`, or `Custom`) from live surface controls so `Style` buttons
 * and the monitor preview always match.
 */
export function resolveAtmosphereStyle(
  state: AtmosphereSurfaceState
): ResolvedAtmosphereStyle {
  const matched = ATMOSPHERE_STYLE_PRESETS.find(
    (preset) =>
      preset.enableMica === state.enableMica &&
      Math.abs(state.themeTintIntensity - preset.tint) < 0.01 &&
      state.customBgBlur === preset.blur &&
      Math.abs(state.customBgOpacity - preset.opacity) < 0.01
  );

  if (matched) {
    return {
      id: matched.id,
      name: matched.name,
      previewLabel: matched.previewLabel,
      enableMica: state.enableMica,
    };
  }

  return {
    id: ATMOSPHERE_CUSTOM_STYLE.id,
    name: ATMOSPHERE_CUSTOM_STYLE.name,
    previewLabel: ATMOSPHERE_CUSTOM_STYLE.previewLabel,
    enableMica: state.enableMica,
  };
}
