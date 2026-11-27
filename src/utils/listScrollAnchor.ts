import type { SampleItem } from "../types";

export interface SharedListScrollAnchor {
  topSampleId: number | null;
  topIndex: number;
  hasRecorded: boolean;
}

export interface RestoredScrollTarget {
  index: number;
  align: "start" | "center";
}

let sharedScrollAnchor: SharedListScrollAnchor = {
  topSampleId: null,
  topIndex: 0,
  hasRecorded: false,
};

export function getSharedListScrollAnchor(): Readonly<SharedListScrollAnchor> {
  return sharedScrollAnchor;
}

export function recordSharedListScrollAnchor(
  topSampleId: number | null,
  topIndex: number
): void {
  sharedScrollAnchor = {
    topSampleId,
    topIndex: Math.max(0, Math.floor(topIndex)),
    hasRecorded: true,
  };
}

export function resetSharedListScrollAnchor(): void {
  sharedScrollAnchor = {
    topSampleId: null,
    topIndex: 0,
    hasRecorded: false,
  };
}

/**
 * Resolves where a newly mounted list view (Normal SampleTable or Mini Dock)
 * should scroll so switching between views feels completely seamless:
 *
 * 1. If a track is actively playing (`isPlaying && selectedSampleId`), center on that playing track.
 * 2. Otherwise (paused/stopped or nothing selected), restore the exact scroll anchor
 *    (`topSampleId`) recorded before switching views so browsing position is preserved.
 * 3. If no valid scroll anchor exists in the current list, fall back to centering `selectedSampleId`.
 */
export function resolveRestoredScrollTarget(params: {
  samples: readonly SampleItem[];
  selectedSampleId: number | null;
  isPlaying: boolean;
  anchor: Readonly<SharedListScrollAnchor>;
}): RestoredScrollTarget | null {
  const { samples, selectedSampleId, isPlaying, anchor } = params;
  if (samples.length === 0) return null;

  if (isPlaying && selectedSampleId !== null) {
    const playingIdx = samples.findIndex((s) => s.id === selectedSampleId);
    if (playingIdx >= 0) {
      return { index: playingIdx, align: "center" };
    }
  }

  if (anchor.hasRecorded) {
    if (anchor.topSampleId !== null) {
      const anchorIdx = samples.findIndex((s) => s.id === anchor.topSampleId);
      if (anchorIdx >= 0) {
        return { index: anchorIdx, align: "start" };
      }
    } else if (anchor.topIndex > 0 && anchor.topIndex < samples.length) {
      return { index: anchor.topIndex, align: "start" };
    }
  }

  if (selectedSampleId !== null) {
    const selectedIdx = samples.findIndex((s) => s.id === selectedSampleId);
    if (selectedIdx >= 0) {
      return { index: selectedIdx, align: "center" };
    }
  }

  return null;
}
