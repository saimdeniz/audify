import { AsciiPresetMeta } from "../types";
import { CORE_ASCII_PRESETS_PART_1 } from "./asciiPresets/corePart1";
import { CORE_ASCII_PRESETS_PART_2 } from "./asciiPresets/corePart2";
import { defineAsciiPreset } from "./asciiPresets/shared";

export { defineAsciiPreset };

export const CORE_ASCII_PRESETS: AsciiPresetMeta[] = [
  ...CORE_ASCII_PRESETS_PART_1,
  ...CORE_ASCII_PRESETS_PART_2,
];
