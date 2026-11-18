import type { AsciiMagicFit, AsciiMagicLook } from "../types";
import { AUDIFY_STORAGE_KEYS } from "./storageKeys";

export const ASCII_MAGIC_SLUG_STORAGE_KEY = AUDIFY_STORAGE_KEYS.asciiMagicSlug;
export const ASCII_MAGIC_LOOK_STORAGE_KEY = AUDIFY_STORAGE_KEYS.asciiMagicLook;
export const ASCII_MAGIC_FIT_STORAGE_KEY = AUDIFY_STORAGE_KEYS.asciiMagicFit;

export interface AsciiMagicFitOption {
  id: AsciiMagicFit;
  label: string;
}

export const ASCII_MAGIC_FIT_OPTIONS: readonly AsciiMagicFitOption[] = [
  { id: "contain", label: "Fit Tiles" },
  { id: "cover", label: "Fill" },
];

export const ASCII_MAGIC_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;

export interface AsciiMagicLookOption {
  id: AsciiMagicLook;
  label: string;
}

export const ASCII_MAGIC_LOOK_OPTIONS: readonly AsciiMagicLookOption[] = [
  { id: "original", label: "Original" },
  { id: "dots", label: "Halftone Dots" },
  { id: "ascii", label: "ASCII" },
  { id: "dense", label: "Dense" },
  { id: "blocks", label: "Blocks" },
  { id: "dither", label: "Dither" },
];

const VALID_LOOKS = new Set<string>(ASCII_MAGIC_LOOK_OPTIONS.map((o) => o.id));

export function normalizeAsciiMagicLook(raw: unknown): AsciiMagicLook {
  if (typeof raw === "string" && VALID_LOOKS.has(raw)) {
    return raw as AsciiMagicLook;
  }
  return "original";
}

export function normalizeAsciiMagicSlug(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().toLowerCase();
  return ASCII_MAGIC_SLUG_RE.test(trimmed) ? trimmed : "";
}

export function normalizeAsciiMagicFit(raw: unknown): AsciiMagicFit {
  return raw === "cover" ? "cover" : "contain";
}
