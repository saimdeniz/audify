import type { SampleItem } from "../types";
import { folderNameFromPath, normalizePathForMatch } from "./pathHelpers";

export type BatchRenameMode = "direct" | "add" | "replace" | "pattern";
export type BatchRenameCaseMode = "keep" | "lower" | "upper" | "title" | "snake";

export interface BatchRenameConfig {
  mode: BatchRenameMode;
  directStem: string;
  prefix: string;
  suffix: string;
  trimSpaces: boolean;
  find: string;
  replaceWith: string;
  caseSensitive: boolean;
  replaceAll: boolean;
  pattern: string;
  startNumber: number;
  step: number;
  zeroPad: number;
  caseMode: BatchRenameCaseMode;
  autoDisambiguate: boolean;
}

const INVALID_WIN_STEM_CHARS = /[<>:"/\\|?*]/;
const RESERVED_WINDOWS_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function parentDirFromFilePath(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : "";
}

export function joinFolderAndFile(folder: string, fileName: string): string {
  return folder ? `${folder}/${fileName}` : fileName;
}

function sanitizeTokenValue(raw: string): string {
  return raw.replace(/[<>:"/\\|?*]/g, "_").trim();
}

export function validateAudioStemForBatch(rawStem: string): string | null {
  const trimmed = rawStem.trim();
  if (!trimmed) return "Filename cannot be empty";
  if (trimmed.length > 180) return "Filename exceeds 180 characters";
  if (INVALID_WIN_STEM_CHARS.test(trimmed)) {
    return 'Contains invalid characters (< > : " / \\ | ? *)';
  }
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) < 32) {
      return "Contains invalid control characters";
    }
  }
  if (trimmed.endsWith(".") || rawStem.endsWith(" ")) {
    return "Cannot end with a space or period";
  }
  const baseBeforeDot = trimmed.split(".")[0].toUpperCase();
  if (RESERVED_WINDOWS_NAMES.has(baseBeforeDot)) {
    return `"${trimmed}" is a reserved system filename`;
  }
  return null;
}

export function applyStemCaseTransform(
  stem: string,
  caseMode: BatchRenameCaseMode
): string {
  switch (caseMode) {
    case "lower":
      return stem.toLowerCase();
    case "upper":
      return stem.toUpperCase();
    case "title":
      return stem.replace(
        /\S+/g,
        (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      );
    case "snake":
      return stem
        .trim()
        .replace(/[\s-]+/g, "_")
        .replace(/_+/g, "_")
        .toLowerCase();
    default:
      return stem;
  }
}

function formatCounterNumber(
  index: number,
  startNumber: number,
  step: number,
  zeroPad: number
): string {
  const safeStart = Number.isFinite(startNumber) ? Math.trunc(startNumber) : 1;
  const safeStep = Number.isFinite(step) ? Math.trunc(step) : 1;
  const safePad = Math.max(0, Math.min(8, Math.trunc(zeroPad || 0)));
  const num = safeStart + index * safeStep;
  const str = String(Math.abs(num));
  const padded = safePad > 0 ? str.padStart(safePad, "0") : str;
  return num < 0 ? `-${padded}` : padded;
}

function applyPatternTemplate(
  sample: SampleItem,
  oldStem: string,
  extWithoutDot: string,
  index: number,
  config: BatchRenameConfig
): string {
  const tpl = config.pattern || "{name}";
  const parentDir = parentDirFromFilePath(sample.file_path);
  const folder = parentDir
    ? sanitizeTokenValue(folderNameFromPath(parentDir))
    : "";
  const genre = sanitizeTokenValue(sample.genre || "");
  const bpm =
    sample.bpm && Number.isFinite(sample.bpm)
      ? String(Math.round(sample.bpm))
      : "";
  const key = sanitizeTokenValue(sample.musical_key || "");

  return tpl.replace(
    /\{(name|folder|genre|bpm|key|ext|n(?::(\d+))?)\}/gi,
    (_match, tokenRaw: string, padSpec?: string) => {
      const lower = tokenRaw.toLowerCase();
      if (lower === "name") return oldStem;
      if (lower === "folder") return folder;
      if (lower === "genre") return genre;
      if (lower === "bpm") return bpm;
      if (lower === "key") return key;
      if (lower === "ext") return extWithoutDot;
      if (lower === "n" || lower.startsWith("n:")) {
        const padWidth = padSpec ? Number.parseInt(padSpec, 10) : config.zeroPad;
        return formatCounterNumber(
          index,
          config.startNumber,
          config.step,
          padWidth
        );
      }
      return "";
    }
  );
}

export function computeCandidateStem(
  sample: SampleItem,
  oldStem: string,
  extWithoutDot: string,
  index: number,
  config: BatchRenameConfig
): string {
  let out = oldStem;

  if (config.mode === "direct") {
    out = config.trimSpaces
      ? config.directStem.trim().replace(/\s+/g, " ")
      : config.directStem;
  } else if (config.mode === "add") {
    const base = config.trimSpaces
      ? oldStem.trim().replace(/\s+/g, " ")
      : oldStem;
    out = `${config.prefix}${base}${config.suffix}`;
  } else if (config.mode === "replace") {
    if (config.find.length > 0) {
      const flags = `${config.replaceAll ? "g" : ""}${
        config.caseSensitive ? "" : "i"
      }`;
      const escaped = config.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, flags);
      out = oldStem.replace(re, () => config.replaceWith);
    }
    if (config.trimSpaces) {
      out = out.trim().replace(/\s+/g, " ");
    }
  } else if (config.mode === "pattern") {
    out = applyPatternTemplate(sample, oldStem, extWithoutDot, index, config);
    if (config.trimSpaces) {
      out = out.trim().replace(/\s+/g, " ");
    }
  }

  return applyStemCaseTransform(out, config.caseMode);
}

export function allocateDisambiguatedStem(
  baseStem: string,
  folder: string,
  extWithDot: string,
  occupiedKeys: Set<string>,
  padWidth: number
): string {
  const effectivePad = Math.max(2, Math.min(4, padWidth || 2));
  for (let suffixIdx = 1; suffixIdx <= 9999; suffixIdx++) {
    const candidate = `${baseStem}_${String(suffixIdx).padStart(
      effectivePad,
      "0"
    )}`;
    if (validateAudioStemForBatch(candidate) !== null) continue;
    const candidateKey = normalizePathForMatch(
      joinFolderAndFile(folder, `${candidate}${extWithDot}`)
    );
    if (!occupiedKeys.has(candidateKey)) {
      return candidate;
    }
  }
  return baseStem;
}
