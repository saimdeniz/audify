import {
  type CanvasThemePalette,
  normalizeThemeModeValue,
  resolveCanvasThemePalette,
} from "../constants/themePalettes";
import { Library } from "../types";

export {
  clearParsedPeaksCache,
  parsePeaks,
  samplePeakRange,
} from "./waveformPeaks";
export {
  cleanTrackTitle,
  computeRelativeScopePaths,
  folderNameFromPath,
  isPathInsideFolder,
  normalizePathForMatch,
  stripAudioExtension,
} from "./pathHelpers";
export {
  type BatchAttributionResult,
  findLicenseArtistMatch,
  findLicenseFolderMatch,
  formatLicenseGroupLine,
  generateBatchAttributionCredits,
  isSampleInLicenseGroup,
  type LicenseFolderMatch,
  matchSampleToLicenseGroup,
} from "./licenseFormat";

export function foldSearchText(input: string): string {
  if (!input) return "";
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    switch (ch) {
      case "İ":
      case "I":
      case "ı":
      case "i":
      case "î":
      case "Î":
        out += "i";
        break;
      case "Ş":
      case "ş":
        out += "s";
        break;
      case "Ğ":
      case "ğ":
        out += "g";
        break;
      case "Ü":
      case "ü":
      case "û":
      case "Û":
        out += "u";
        break;
      case "Ö":
      case "ö":
      case "ô":
      case "Ô":
        out += "o";
        break;
      case "Ç":
      case "ç":
        out += "c";
        break;
      case "â":
      case "Â":
      case "á":
      case "à":
      case "ä":
      case "Á":
      case "À":
      case "Ä":
        out += "a";
        break;
      case "é":
      case "è":
      case "ê":
      case "ë":
      case "É":
      case "È":
      case "Ê":
      case "Ë":
        out += "e";
        break;
      default: {
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90) {
          out += String.fromCharCode(code + 32);
        } else {
          out += ch.toLowerCase();
        }
      }
    }
  }
  return out;
}

export function filterVisibleLibraries(libraries: Library[]): Library[] {
  return libraries.filter(
    (l) => l.is_global !== false || l.assigned_to_profile !== false
  );
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "00:00.00";
  }
  const totalSeconds = durationMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const cc = String(hundredths).padStart(2, "0");
  return `${mm}:${ss}.${cc}`;
}

export function formatSecondsCode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00.00";
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds - Math.floor(seconds)) * 100);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const cc = String(hundredths).padStart(2, "0");
  return `${mm}:${ss}.${cc}`;
}

export function formatSampleRateKhz(sampleRate: number): string {
  return (sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1);
}

export function formatSampleRateCompact(
  sampleRate: number,
  bitDepth: number
): string {
  const srKhz =
    sampleRate >= 1000
      ? `${formatSampleRateKhz(sampleRate)}k`
      : `${sampleRate}`;
  const bits = bitDepth > 0 ? `${bitDepth}b` : "16b";
  return `${srKhz}/${bits}`;
}

export function formatSampleSpecsFull(
  sampleRate: number,
  bitDepth: number,
  channels: number
): string {
  const sr = (sampleRate / 1000).toFixed(1);
  const ch =
    channels === 1 ? "MONO" : channels === 2 ? "STEREO" : `${channels}CH`;
  return `${sr} kHz / ${bitDepth}-bit / ${ch}`;
}

export function formatVolumeDb(volume01: number): string {
  if (volume01 <= 0.001) return "-∞ dB";
  const db = 20 * Math.log10(volume01);
  if (Math.abs(db) < 0.05) return "0.0dB";
  return `${db.toFixed(1)}dB`;
}

export function splitFileNameAndExt(fileName: string): {
  stem: string;
  ext: string;
} {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return { stem: fileName, ext: "" };
  }
  return {
    stem: fileName.slice(0, lastDot),
    ext: fileName.slice(lastDot),
  };
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

const EMBEDDED_TS_RE =
  /(\d{4})-(\d{2})-(\d{2})[_T ](\d{2})[-:](\d{2})(?:[-:](\d{2}))?/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Formats a backup snapshot timestamp into a concise `YYYY-MM-DD · HH:mm` label,
 * using filesystem mtime when available and falling back to embedded filename timestamps.
 */
export function formatBackupDateLabel(
  createdAt?: string | null,
  timestampMs?: number
): string {
  if (typeof timestampMs === "number" && Number.isFinite(timestampMs) && timestampMs > 0) {
    const dt = new Date(timestampMs);
    if (!Number.isNaN(dt.getTime())) {
      return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(
        dt.getDate()
      )} · ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
    }
  }
  const match = (createdAt || "").match(EMBEDDED_TS_RE);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]} · ${match[4]}:${match[5]}`;
  }
  return createdAt || "—";
}

/**
 * Formats a SQLite journal `created_at` string into `MM-DD HH:mm:ss`
 * so multi-day operation logs remain distinguishable in narrow history rows.
 */
export function formatShortJournalTimestamp(createdAt: string): string {
  const match = createdAt.match(EMBEDDED_TS_RE);
  if (match) {
    const sec = match[6] || "00";
    return `${match[2]}-${match[3]} ${match[4]}:${match[5]}:${sec}`;
  }
  return createdAt;
}

const SQLITE_UTC_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;

/**
 * Parses a SQLite UTC `datetime('now')` string (`"YYYY-MM-DD HH:MM:SS"`) or ISO string
 * into Unix epoch milliseconds, returning `0` when missing or invalid.
 */
export function parseSqliteUtcMs(raw?: string | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const m = trimmed.match(SQLITE_UTC_RE);
  if (m) {
    const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Formats an epoch millisecond timestamp into a compact localized label for dense table cells
 * alongside a full `YYYY-MM-DD HH:mm:ss` tooltip string.
 */
export function formatSampleTimestamp(
  epochMs?: number | null,
  nowMs = Date.now()
): { short: string; full: string } {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs) || epochMs <= 0) {
    return { short: "—", full: "" };
  }
  const dt = new Date(epochMs);
  if (Number.isNaN(dt.getTime())) {
    return { short: "—", full: "" };
  }
  const now = new Date(nowMs);
  const sameYear = dt.getFullYear() === now.getFullYear();
  const sameDay =
    sameYear &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();

  const hhmm = `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
  const full = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(
    dt.getDate()
  )} ${hhmm}:${pad2(dt.getSeconds())}`;
  const short = sameDay
    ? `Today ${hhmm}`
    : sameYear
    ? `${pad2(dt.getDate())}.${pad2(dt.getMonth() + 1)} ${hhmm}`
    : `${pad2(dt.getDate())}.${pad2(dt.getMonth() + 1)}.${String(
        dt.getFullYear()
      ).slice(-2)} ${hhmm}`;

  return { short, full };
}



export type { CanvasThemePalette };

let cachedPaletteKey = "";
let cachedPalette: CanvasThemePalette | null = null;

export function getCanvasThemePalette(themeKey = ""): CanvasThemePalette {
  if (themeKey && cachedPalette && cachedPaletteKey === themeKey) {
    return cachedPalette;
  }

  let themeMode = normalizeThemeModeValue(undefined);
  let enableMica = false;
  let accentHex = "#F59E0B";

  if (themeKey) {
    const [rawMode, rawMica, rawAccent] = themeKey.split(":");
    themeMode = normalizeThemeModeValue(rawMode);
    enableMica = rawMica === "true";
    if (rawAccent && rawAccent.startsWith("#")) {
      accentHex = rawAccent;
    }
  } else if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (typeof root?.getAttribute === "function") {
      themeMode = normalizeThemeModeValue(root.getAttribute("data-theme"));
    }
    if (typeof root?.hasAttribute === "function") {
      enableMica = root.hasAttribute("data-mica");
    }
  }

  const palette = resolveCanvasThemePalette(themeMode, enableMica, accentHex);
  if (themeKey) {
    cachedPaletteKey = themeKey;
    cachedPalette = palette;
  }

  return palette;
}
