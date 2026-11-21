import { ASCII_PRESETS } from "../constants/asciiPresets";
import { AsciiPresetCategory, AsciiPresetId } from "../types";
import type { AsciiRenderParams } from "./asciiPresets/shared";

export type { AsciiRenderParams } from "./asciiPresets/shared";

type PresetRenderer = (params: AsciiRenderParams) => void;

const PRESET_TO_CATEGORY = new Map<AsciiPresetId, AsciiPresetCategory>(
  ASCII_PRESETS.map((p) => [p.id, p.category])
);

const categoryModuleCache = new Map<AsciiPresetCategory, PresetRenderer>();
const categoryModulePromises = new Map<
  AsciiPresetCategory,
  Promise<PresetRenderer>
>();

export function getCategoryForPreset(preset: AsciiPresetId): AsciiPresetCategory {
  return PRESET_TO_CATEGORY.get(preset) ?? "nature";
}

async function loadCategoryModule(
  category: AsciiPresetCategory
): Promise<PresetRenderer> {
  const cached = categoryModuleCache.get(category);
  if (cached) return cached;

  const inflight = categoryModulePromises.get(category);
  if (inflight) return inflight;

  const loaderPromise = (async (): Promise<PresetRenderer> => {
    switch (category) {
      case "nature": {
        const mod = await import("./asciiPresets/nature");
        return mod.renderNaturePreset;
      }
      case "camp": {
        const mod = await import("./asciiPresets/camp");
        return mod.renderCampPreset;
      }
      case "zen": {
        const mod = await import("./asciiPresets/zen");
        return mod.renderZenPreset;
      }
      case "ocean": {
        const mod = await import("./asciiPresets/ocean");
        return mod.renderOceanPreset;
      }
      case "space": {
        const mod = await import("./asciiPresets/space");
        return mod.renderSpacePreset;
      }
      case "cyber": {
        const mod = await import("./asciiPresets/cyber");
        return mod.renderCyberPreset;
      }
      case "city": {
        const mod = await import("./asciiPresets/city");
        return mod.renderCityPreset;
      }
      case "retro": {
        const mod = await import("./asciiPresets/retro");
        return mod.renderRetroPreset;
      }
      case "studio": {
        const mod = await import("./asciiPresets/studio");
        return mod.renderStudioPreset;
      }
    }
  })()
    .then((renderer) => {
      categoryModuleCache.set(category, renderer);
      return renderer;
    })
    .catch((err) => {
      if (categoryModulePromises.get(category) === loaderPromise) {
        categoryModulePromises.delete(category);
      }
      throw err;
    });

  categoryModulePromises.set(category, loaderPromise);
  return loaderPromise;
}

export function getCachedAsciiPresetRenderer(
  preset: AsciiPresetId
): PresetRenderer | undefined {
  return categoryModuleCache.get(getCategoryForPreset(preset));
}

export async function loadAsciiPresetRenderer(
  preset: AsciiPresetId
): Promise<PresetRenderer> {
  return loadCategoryModule(getCategoryForPreset(preset));
}

export async function renderAsciiPresetFrame(
  params: AsciiRenderParams
): Promise<void> {
  const renderer = await loadAsciiPresetRenderer(params.preset);
  renderer(params);
}
