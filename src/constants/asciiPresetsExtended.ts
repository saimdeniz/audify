import { AsciiPresetMeta } from "../types";
import { EXTENDED_ASCII_PRESETS_PART_1 } from "./asciiPresets/extendedPart1";
import { EXTENDED_ASCII_PRESETS_PART_2 } from "./asciiPresets/extendedPart2";

export const EXTENDED_ASCII_PRESETS: AsciiPresetMeta[] = [
  ...EXTENDED_ASCII_PRESETS_PART_1,
  ...EXTENDED_ASCII_PRESETS_PART_2,
];
