import type {
  BatchRenameRecord,
  FileCollisionItem,
  MovedSampleRecord,
} from "../types";
import type { MainFilterRequest, SettingsTab } from "../utils/windowContext";

export type { MainFilterRequest, SettingsTab };

export interface CreditToastPayload {
  title: string;
  subtitle?: string;
  previewText?: string;
  isWarning?: boolean;
  seq: number;
}

export interface StatusNoticeAction {
  label: string;
  onClick: () => void;
}

export interface StatusNoticePayload {
  message: string;
  kind: "info" | "success" | "error";
  seq: number;
  actionLabel?: string;
  onAction?: () => void;
}

export type FileOpHistoryItem =
  | {
      kind: "rename";
      sampleId: number;
      oldStem: string;
      newStem: string;
      oldFileName: string;
      newFileName: string;
    }
  | {
      kind: "batch_rename";
      entries: Array<{
        sampleId: number;
        oldStem: string;
        newStem: string;
        oldFileName: string;
        newFileName: string;
      }>;
      records?: BatchRenameRecord[];
    }
  | {
      kind: "trash";
      sampleIds: number[];
      label: string;
    }
  | {
      kind: "restore";
      sampleIds: number[];
      label: string;
    }
  | {
      kind: "move";
      moves: MovedSampleRecord[];
      label: string;
    };

export type PendingTrashRequest =
  | {
      kind: "samples";
      sampleIds: number[];
      sampleNames: string[];
    }
  | {
      kind: "folder";
      libraryId: number;
      folderPath: string;
      folderName: string;
      sampleCount: number;
    };

export type PendingFileConflictPrompt =
  | {
      mode: "move";
      sampleIds: number[];
      targetLibraryId: number;
      targetFolderPath: string;
      conflicts: FileCollisionItem[];
      skippedDuplicates: string[];
    }
  | {
      mode: "import";
      libraryId: number;
      targetFolderPath: string;
      externalPaths: string[];
      conflicts: FileCollisionItem[];
      skippedDuplicates: string[];
    };
