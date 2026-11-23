import { Profile } from "../types";
import type { AiSliceActions } from "./slices/aiSlice";
import type {
  SampleCatalogAndFileActions,
  SampleProfileAndLicenseActions,
  SampleSettingsAndMutationActions,
} from "./storeActionTypes";
import type {
  SampleFilterAndPlaybackActions,
  SampleStoreDataState,
} from "./storeStateFields";

export type {
  CreditToastPayload,
  FileOpHistoryItem,
  MainFilterRequest,
  PendingFileConflictPrompt,
  PendingTrashRequest,
  SettingsTab,
  StatusNoticePayload,
} from "./storePayloads";

export interface SampleStoreState
  extends SampleStoreDataState,
    SampleFilterAndPlaybackActions,
    SampleCatalogAndFileActions,
    SampleProfileAndLicenseActions,
    SampleSettingsAndMutationActions,
    AiSliceActions {}

export type StoreSet = (
  partial:
    | Partial<SampleStoreState>
    | ((state: SampleStoreState) => Partial<SampleStoreState>)
) => void;

export type StoreGet = () => SampleStoreState;

export type SidebarTab =
  | "folders"
  | "collections"
  | "tags"
  | "genres"
  | "licenses"
  | "bin"
  | "trash";

export interface FolderTreeNode {
  name: string;
  fullPath: string;
  count: number;
  depth: number;
  children: FolderTreeNode[];
}

export interface StoreSliceContext {
  set: StoreSet;
  get: StoreGet;
  applyInstantMemoryFilter: (opts?: { preserveMultiSelect?: boolean }) => boolean;
  applyProfileSettingsImmediately: (
    profile: Profile,
    opts?: { isInitialBoot?: boolean; isRemoteSync?: boolean }
  ) => void;
  buildCurrentProfileSettingsJson: () => string;
  bumpProfileEpoch: () => number;
  getProfileEpoch: () => number;
  prepareForProfileTransition: () => Promise<void>;
  resetFiltersOnProfileChange: (statusMessage: string) => void;
  emitNotice: (message: string, kind?: "info" | "success" | "error") => void;
}
