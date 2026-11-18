import { AsciiPresetId, ThemeMode } from "../../types";

export interface AsciiRenderParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  timeSec: number;
  preset: AsciiPresetId;
  accentHex: string;
  themeMode: ThemeMode;
  isPlaying?: boolean;
}
