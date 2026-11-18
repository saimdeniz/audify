import { AsciiPresetCategory, AsciiPresetMeta } from "../types";
import { CORE_ASCII_PRESETS } from "./asciiPresetsCore";
import { EXTENDED_ASCII_PRESETS } from "./asciiPresetsExtended";

export const ASCII_CATEGORY_LABELS: {
  id: AsciiPresetCategory;
  label: string;
}[] = [
  { id: "nature", label: "Nature" },
  { id: "camp", label: "Camp" },
  { id: "zen", label: "Zen" },
  { id: "ocean", label: "Ocean" },
  { id: "space", label: "Space" },
  { id: "cyber", label: "Cyber" },
  { id: "city", label: "City" },
  { id: "retro", label: "Retro" },
  { id: "studio", label: "Studio" },
];

export const ASCII_PRESETS: AsciiPresetMeta[] = [
  ...CORE_ASCII_PRESETS,
  ...EXTENDED_ASCII_PRESETS,
];
