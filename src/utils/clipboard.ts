import { SampleItem } from "../types";
import { resolveSamplesByIds } from "./sampleLookup";

/**
 * Resolves the active sample list for sample-targeted actions: explicit targets,
 * multi-selection IDs (preserving selection order), or the primary selected sample.
 */
export function resolveTargetSamples(
  allProfileSamples: SampleItem[],
  visibleSamples: SampleItem[],
  selectedSampleIds: number[],
  selectedSample: SampleItem | null,
  targetSamples?: SampleItem[]
): SampleItem[] {
  if (targetSamples && targetSamples.length > 0) {
    return targetSamples;
  }
  if (selectedSampleIds.length > 0) {
    return resolveSamplesByIds(
      selectedSampleIds,
      visibleSamples,
      allProfileSamples
    );
  }
  return selectedSample ? [selectedSample] : [];
}

/**
 * Converts stored forward-slash local drive paths (`F:/Audio/kick.wav`)
 * into OS-native clipboard paths (`F:\Audio\kick.wav`) on Windows.
 */
export function toOsDisplayPath(filePath: string): string {
  const trimmed = filePath.trim();
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed.replace(/\//g, "\\");
  }
  return trimmed;
}

/**
 * Formats one or more sample paths for clipboard copy, deduplicating identical paths
 * and joining multiple paths on separate lines.
 */
export function formatPathsForClipboard(filePaths: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of filePaths) {
    const formatted = toOsDisplayPath(raw);
    if (!formatted || seen.has(formatted)) continue;
    seen.add(formatted);
    lines.push(formatted);
  }
  return lines.join("\n");
}

/**
 * Copies plain text to the system clipboard with an off-screen textarea fallback
 * when Async Clipboard permissions are unavailable in embedded WebViews.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback
  }
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
  return false;
}
