import { AsciiPresetCategory, AsciiPresetId, AsciiPresetMeta } from "../../types";

export function defineAsciiPreset(
  id: AsciiPresetId,
  category: AsciiPresetCategory,
  name: string,
  subtitle: string,
  bgTop: string,
  bgBottom: string,
  previewGlyphs: [string, string, string],
  previewTint: string,
  autoAccentHex: string,
  lightOverride?: { bgTop: string; bgBottom: string; tint?: string }
): AsciiPresetMeta {
  return {
    id,
    category,
    name,
    subtitle,
    swatchGradient: `linear-gradient(155deg, ${bgTop} 0%, ${bgBottom} 100%)`,
    swatchGradientLight: lightOverride
      ? `linear-gradient(155deg, ${lightOverride.bgTop} 0%, ${lightOverride.bgBottom} 100%)`
      : undefined,
    previewGlyphs,
    previewTint,
    previewTintLight: lightOverride?.tint,
    autoAccentHex,
  };
}
