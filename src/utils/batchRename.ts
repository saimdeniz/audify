import type { SampleItem } from "../types";
import { splitFileNameAndExt } from "./format";
import { normalizePathForMatch } from "./pathHelpers";
import {
  allocateDisambiguatedStem,
  applyStemCaseTransform,
  BatchRenameCaseMode,
  BatchRenameConfig,
  BatchRenameMode,
  computeCandidateStem,
  joinFolderAndFile,
  parentDirFromFilePath,
  validateAudioStemForBatch,
} from "./batchRenameHelpers";

export { applyStemCaseTransform, validateAudioStemForBatch };
export type { BatchRenameCaseMode, BatchRenameConfig, BatchRenameMode };

export const DEFAULT_BATCH_RENAME_CONFIG: BatchRenameConfig = {
  mode: "add",
  directStem: "",
  prefix: "",
  suffix: "",
  trimSpaces: false,
  find: "",
  replaceWith: "",
  caseSensitive: false,
  replaceAll: true,
  pattern: "{name}_{n}",
  startNumber: 1,
  step: 1,
  zeroPad: 2,
  caseMode: "keep",
  autoDisambiguate: false,
};

export function createInitialBatchRenameConfig(
  isSingle: boolean,
  initialStem = ""
): BatchRenameConfig {
  return isSingle
    ? {
        ...DEFAULT_BATCH_RENAME_CONFIG,
        mode: "direct",
        directStem: initialStem,
      }
    : DEFAULT_BATCH_RENAME_CONFIG;
}

export type BatchRenameRowStatus =
  | "ready"
  | "unchanged"
  | "duplicate"
  | "invalid"
  | "vault_locked";

export interface BatchRenamePreviewRow {
  sample: SampleItem;
  oldStem: string;
  ext: string;
  oldFileName: string;
  rawNewStem: string;
  finalStem: string;
  newFileName: string;
  newPath: string;
  status: BatchRenameRowStatus;
  reason?: string;
  isChanged: boolean;
}

export interface BatchRenamePreviewResult {
  rows: BatchRenamePreviewRow[];
  readyRows: BatchRenamePreviewRow[];
  changedCount: number;
  collisionCount: number;
  invalidCount: number;
  lockedCount: number;
  canApply: boolean;
}

/**
 * Generates deterministic live batch-rename preview rows with cross-item collision checks,
 * Windows reserved-filename validation, existing-catalog conflicts, and optional auto-numbering.
 */
export function buildBatchRenamePreview(
  samples: readonly SampleItem[],
  config: BatchRenameConfig,
  opts?: {
    readOnlyLibraryIds?: ReadonlySet<number>;
    catalogSamples?: readonly SampleItem[];
  }
): BatchRenamePreviewResult {
  const readOnlyIds = opts?.readOnlyLibraryIds;
  const selectedIds = new Set(samples.map((s) => s.id));

  // Track files on disk/catalog in the same folders that are NOT part of this batch.
  const externalOccupiedKeys = new Set<string>();
  if (opts?.catalogSamples) {
    for (const s of opts.catalogSamples) {
      if (!selectedIds.has(s.id)) {
        externalOccupiedKeys.add(normalizePathForMatch(s.file_path));
      }
    }
  }

  // First pass: compute raw stems and lock vault-protected entries at their original paths.
  const draft = samples.map((sample, index) => {
    const { stem: oldStem, ext } = splitFileNameAndExt(sample.file_name);
    const extNoDot = ext.startsWith(".") ? ext.slice(1) : ext;
    const folder = parentDirFromFilePath(sample.file_path);
    const isLocked = Boolean(readOnlyIds?.has(sample.library_id));

    if (isLocked) {
      externalOccupiedKeys.add(normalizePathForMatch(sample.file_path));
      return {
        sample,
        oldStem,
        ext,
        folder,
        rawNewStem: oldStem,
        finalStem: oldStem,
        isLocked: true,
        validationError: null as string | null,
      };
    }

    const rawNewStem = computeCandidateStem(
      sample,
      oldStem,
      extNoDot,
      index,
      config
    );
    const validationError = validateAudioStemForBatch(rawNewStem);

    return {
      sample,
      oldStem,
      ext,
      folder,
      rawNewStem,
      finalStem: rawNewStem,
      isLocked: false,
      validationError,
    };
  });

  // Second pass: resolve collisions if autoDisambiguate is ON, else detect duplicates cleanly.
  if (config.autoDisambiguate) {
    const occupiedKeys = new Set<string>(externalOccupiedKeys);
    // Reserve stems that remain unchanged first so active files aren't renamed around them.
    for (const item of draft) {
      if (
        !item.isLocked &&
        item.validationError === null &&
        item.rawNewStem === item.oldStem
      ) {
        const key = normalizePathForMatch(
          joinFolderAndFile(item.folder, `${item.rawNewStem}${item.ext}`)
        );
        if (!occupiedKeys.has(key)) {
          occupiedKeys.add(key);
        }
      }
    }

    const countsByTargetKey = new Map<string, number>();
    for (const item of draft) {
      if (item.isLocked || item.validationError !== null) continue;
      const key = normalizePathForMatch(
        joinFolderAndFile(item.folder, `${item.rawNewStem}${item.ext}`)
      );
      countsByTargetKey.set(key, (countsByTargetKey.get(key) ?? 0) + 1);
    }

    for (const item of draft) {
      if (item.isLocked || item.validationError !== null) continue;
      const desiredKey = normalizePathForMatch(
        joinFolderAndFile(item.folder, `${item.rawNewStem}${item.ext}`)
      );
      const isOwnUnchanged = item.rawNewStem === item.oldStem;
      const rawCollisionCount = countsByTargetKey.get(desiredKey) ?? 0;

      if (
        (isOwnUnchanged && !externalOccupiedKeys.has(desiredKey)) ||
        (!occupiedKeys.has(desiredKey) && rawCollisionCount <= 1)
      ) {
        item.finalStem = item.rawNewStem;
        occupiedKeys.add(desiredKey);
      } else if (!occupiedKeys.has(desiredKey) && rawCollisionCount > 1 && !externalOccupiedKeys.has(desiredKey)) {
        // First claimant gets _01 when duplicates exist so all identical names are consistently numbered.
        item.finalStem = allocateDisambiguatedStem(
          item.rawNewStem,
          item.folder,
          item.ext,
          occupiedKeys,
          config.zeroPad
        );
        const allocatedKey = normalizePathForMatch(
          joinFolderAndFile(item.folder, `${item.finalStem}${item.ext}`)
        );
        occupiedKeys.add(allocatedKey);
      } else {
        item.finalStem = allocateDisambiguatedStem(
          item.rawNewStem,
          item.folder,
          item.ext,
          occupiedKeys,
          config.zeroPad
        );
        const allocatedKey = normalizePathForMatch(
          joinFolderAndFile(item.folder, `${item.finalStem}${item.ext}`)
        );
        occupiedKeys.add(allocatedKey);
      }
    }
  }

  // Final pass: count target occurrences across batch to detect any collisions accurately.
  const targetKeyCounts = new Map<string, number>();
  for (const item of draft) {
    if (item.isLocked || item.validationError !== null) continue;
    const key = normalizePathForMatch(
      joinFolderAndFile(item.folder, `${item.finalStem}${item.ext}`)
    );
    targetKeyCounts.set(key, (targetKeyCounts.get(key) ?? 0) + 1);
  }

  let changedCount = 0;
  let collisionCount = 0;
  let invalidCount = 0;
  let lockedCount = 0;
  const readyRows: BatchRenamePreviewRow[] = [];

  const rows: BatchRenamePreviewRow[] = draft.map((item) => {
    const newFileName = `${item.finalStem}${item.ext}`;
    const newPath = joinFolderAndFile(item.folder, newFileName);
    const key = normalizePathForMatch(newPath);
    const isChanged = item.finalStem !== item.oldStem;

    if (item.isLocked) {
      lockedCount += 1;
      return {
        sample: item.sample,
        oldStem: item.oldStem,
        ext: item.ext,
        oldFileName: item.sample.file_name,
        rawNewStem: item.rawNewStem,
        finalStem: item.oldStem,
        newFileName: item.sample.file_name,
        newPath: item.sample.file_path,
        status: "vault_locked",
        reason: "Library is locked as a Protected Vault",
        isChanged: false,
      };
    }

    if (item.validationError !== null) {
      invalidCount += 1;
      return {
        sample: item.sample,
        oldStem: item.oldStem,
        ext: item.ext,
        oldFileName: item.sample.file_name,
        rawNewStem: item.rawNewStem,
        finalStem: item.finalStem,
        newFileName,
        newPath,
        status: "invalid",
        reason: item.validationError,
        isChanged,
      };
    }

    const batchDupes = (targetKeyCounts.get(key) ?? 0) > 1;
    const externalConflict = isChanged && externalOccupiedKeys.has(key);
    if (batchDupes || externalConflict) {
      collisionCount += 1;
      return {
        sample: item.sample,
        oldStem: item.oldStem,
        ext: item.ext,
        oldFileName: item.sample.file_name,
        rawNewStem: item.rawNewStem,
        finalStem: item.finalStem,
        newFileName,
        newPath,
        status: "duplicate",
        reason: externalConflict
          ? `Already exists in folder: ${newFileName}`
          : `Multiple selected files resolve to ${newFileName}`,
        isChanged,
      };
    }

    if (!isChanged) {
      return {
        sample: item.sample,
        oldStem: item.oldStem,
        ext: item.ext,
        oldFileName: item.sample.file_name,
        rawNewStem: item.rawNewStem,
        finalStem: item.finalStem,
        newFileName,
        newPath,
        status: "unchanged",
        isChanged: false,
      };
    }

    changedCount += 1;
    const row: BatchRenamePreviewRow = {
      sample: item.sample,
      oldStem: item.oldStem,
      ext: item.ext,
      oldFileName: item.sample.file_name,
      rawNewStem: item.rawNewStem,
      finalStem: item.finalStem,
      newFileName,
      newPath,
      status: "ready",
      isChanged: true,
    };
    readyRows.push(row);
    return row;
  });

  return {
    rows,
    readyRows,
    changedCount,
    collisionCount,
    invalidCount,
    lockedCount,
    canApply:
      readyRows.length > 0 && collisionCount === 0 && invalidCount === 0,
  };
}
