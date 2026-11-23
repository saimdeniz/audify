import {
  AsciiMagicFit,
  AsciiMagicLook,
  AsciiPresetId,
  AutoTagPreviewResult,
  AutoTagRule,
  BatchRenameRecord,
  Collection,
  CollectionRuleTemplate,
  DuplicateScanMode,
  ExportAudioPreset,
  FolderDropResult,
  Genre,
  KeyboardShortcuts,
  LicenseGroup,
  MiniDockEdgeSide,
  SampleItem,
  SliceHistoryEntry,
  SliceSortKey,
  SliceTrashSummary,
  SubfolderRenameSummary,
  Tag,
  ThemeMode,
  TrashActionSummary,
  TrashViewTab,
  WallpaperKind,
  WaveformSensitivity,
  WaveformStyle,
} from "../types";
import type { SettingsTab } from "./storePayloads";

export interface SampleCatalogAndFileActions {
  initialize: () => Promise<void>;
  refreshSidebarData: (opts?: { broadcastCatalog?: boolean }) => Promise<void>;
  reloadProfileSamples: (opts?: { skipFolderStats?: boolean }) => Promise<void>;
  refreshAfterCatalogMutation: (opts?: {
    reloadSamples?: boolean;
    refreshTrash?: boolean;
    syncCatalog?: boolean;
  }) => Promise<void>;
  fetchSamples: (opts?: { preserveMultiSelect?: boolean }) => Promise<void>;
  addAndScanFolder: () => Promise<void>;
  scanSpecificPath: (path: string, forceRebuild?: boolean) => Promise<void>;
  syncFolderIncremental: (
    libraryPath: string,
    targetFolder?: string
  ) => Promise<void>;
  setLibraryProfileScope: (
    libraryId: number,
    isGlobal: boolean,
    assignedToProfile: boolean
  ) => Promise<void>;
  setLibraryReadOnly: (
    libraryId: number,
    isReadOnly: boolean
  ) => Promise<void>;
  removeLibrary: (libraryId: number) => Promise<void>;
  relinkLibraryFolder: (libraryId: number) => Promise<void>;
  analyzeLibraryBpmAndKey: (
    libraryId?: number | null,
    overwrite?: boolean
  ) => Promise<void>;
  rebuildAllLibraries: () => Promise<void>;
  fetchFolderStats: () => Promise<void>;
  syncAllLibrariesBackground: () => Promise<void>;

  setEnableAdvancedFileOps: (enabled: boolean) => void;
  setConfirmBeforeTrash: (enabled: boolean) => void;
  setTrashFilterActive: (active: boolean) => void;
  setTrashViewTab: (tab: TrashViewTab) => void;
  refreshTrashStatus: () => Promise<void>;
  renameSampleFile: (
    sampleId: number,
    newStem: string,
    opts?: { isHistoryReplay?: boolean }
  ) => Promise<SampleItem | null>;
  openBatchRenameModal: (sampleIds: number[]) => void;
  closeBatchRenameModal: () => void;
  setDuplicatesFilterActive: (active: boolean) => void;
  setDuplicateScope: (
    modeOverride?: DuplicateScanMode,
    libraryIdOverride?: number | null,
    minSimilarityPctOverride?: number
  ) => void;
  setDuplicateExtrasMinPct: (pct: number) => void;
  scanDuplicates: (
    modeOverride?: DuplicateScanMode,
    libraryIdOverride?: number | null,
    minSimilarityPctOverride?: number
  ) => Promise<void>;
  selectSuggestedDuplicateExtras: (minSimilarityPctOverride?: number) => void;
  batchRenameSamples: (
    entries: Array<{ sample_id: number; new_stem: string }>,
    opts?: { isHistoryReplay?: boolean }
  ) => Promise<BatchRenameRecord[]>;
  undoRenameSampleFile: (sampleId: number) => Promise<SampleItem | null>;
  requestMoveSamplesToTrash: (sampleIds: number[]) => Promise<void>;
  requestTrashSubfolder: (
    libraryId: number,
    folderPath: string,
    folderName: string,
    sampleCount: number
  ) => void;
  confirmPendingTrashRequest: (dontAskAgain?: boolean) => Promise<void>;
  cancelPendingTrashRequest: () => void;
  resolvePendingFileConflict: (
    policy: "skip" | "keep_both" | "cancel"
  ) => Promise<void>;
  moveSamplesToTrash: (
    sampleIds: number[],
    opts?: { isHistoryReplay?: boolean }
  ) => Promise<TrashActionSummary | null>;
  restoreSamplesFromTrash: (
    sampleIds?: number[],
    opts?: { isHistoryReplay?: boolean }
  ) => Promise<TrashActionSummary | null>;
  emptyAudifyTrash: (
    sampleIds?: number[]
  ) => Promise<TrashActionSummary | null>;
  createPhysicalSubfolder: (
    libraryId: number,
    parentFolderPath: string,
    newFolderName: string
  ) => Promise<string | null>;
  renamePhysicalSubfolder: (
    libraryId: number,
    folderPath: string,
    newFolderName: string
  ) => Promise<SubfolderRenameSummary | null>;
  trashPhysicalSubfolder: (
    libraryId: number,
    folderPath: string
  ) => Promise<TrashActionSummary | null>;
  moveSamplesToFolder: (
    sampleIds: number[],
    targetLibraryId: number,
    targetFolderPath: string,
    conflictPolicy?: "prompt" | "skip" | "keep_both"
  ) => Promise<FolderDropResult | null>;
  importExternalFilesToFolder: (
    libraryId: number,
    targetFolderPath: string,
    externalPaths: string[],
    conflictPolicy?: "prompt" | "skip" | "keep_both"
  ) => Promise<FolderDropResult | null>;
  undoLastFileOp: () => Promise<boolean>;
  redoLastFileOp: () => Promise<boolean>;
}

export interface SampleProfileAndLicenseActions {
  persistActiveProfileSettings: (immediate?: boolean) => Promise<void>;
  switchProfile: (profileId: number) => Promise<void>;
  createProfile: (name: string, color: string) => Promise<void>;
  duplicateProfile: (sourceProfileId: number, newName: string) => Promise<void>;
  updateProfileInfo: (
    profileId: number,
    name: string,
    color: string
  ) => Promise<void>;
  deleteProfile: (profileId: number) => Promise<void>;
  addAutoTagRule: (
    tagName: string,
    tagColor: string,
    keywordsCsv: string,
    category?: string,
    includePathsCsv?: string,
    excludePathsCsv?: string,
    min_duration_ms?: number,
    max_duration_ms?: number
  ) => Promise<void>;
  previewAutoTagRule: (rule: AutoTagRule) => Promise<AutoTagPreviewResult>;
  updateAutoTagRule: (
    ruleId: string,
    patch: Partial<AutoTagRule>
  ) => Promise<void>;
  deleteAutoTagRule: (ruleId: string) => Promise<void>;
  resetAutoTagRules: () => Promise<void>;
  reapplyAutoTagRules: () => Promise<void>;
  setAutoTagCategoryPaths: (
    categoryName: string,
    includePaths: string[],
    excludePaths: string[]
  ) => Promise<void>;
  addAutoTagCategory: (name: string) => Promise<void>;
  renameAutoTagCategory: (oldName: string, newName: string) => Promise<void>;
  deleteAutoTagCategory: (name: string) => Promise<void>;
  fetchLocalBackups: () => Promise<void>;
  createQuickBackup: (isAuto?: boolean, includeAiTags?: boolean) => Promise<void>;
  createFullSnapshotBackup: () => Promise<void>;
  restoreLocalBackup: (filePath: string) => Promise<void>;
  deleteLocalBackup: (filePath: string) => Promise<void>;
  openBackupsFolder: () => Promise<void>;
  exportSettingsJson: () => Promise<void>;
  importSettingsJson: () => Promise<void>;
  exportProfileJson: (
    profileId?: number,
    options?: boolean | { shareSafe?: boolean; includeAiTags?: boolean }
  ) => Promise<void>;
  importProfileJson: () => Promise<void>;
  exportFullSnapshot: () => Promise<void>;
  openFullSnapshotRestorePrompt: (filePath?: string) => Promise<void>;
  clearPendingSnapshotRestore: () => void;
  confirmFullSnapshotRestore: () => Promise<void>;

  setEnableLicensesSystem: (enabled: boolean) => void;
  addLicenseGroup: (group: Omit<LicenseGroup, "id">) => Promise<LicenseGroup>;
  updateLicenseGroup: (
    groupId: string,
    patch: Partial<Omit<LicenseGroup, "id">>
  ) => Promise<void>;
  deleteLicenseGroup: (groupId: string) => Promise<void>;
  pickFolderForLicenseGroup: () => Promise<string | null>;
  setLicenseGroupFilter: (
    groupId: string | null,
    subFolder?: string | null
  ) => void;
  copyAttributionForSamples: (targetSamples?: SampleItem[]) => Promise<void>;
  copySamplePaths: (targetSamples?: SampleItem[]) => Promise<void>;
  clearCreditToast: () => void;
  pauseCreditToast: () => void;
  resumeCreditToast: () => void;
}

export interface SampleSettingsAndMutationActions {
  addSamplesToBin: (sampleIds: number[]) => void;
  removeSampleFromBin: (sampleId: number) => void;
  removeSamplesFromBin: (sampleIds: number[]) => void;
  clearBin: () => void;
  setAutoBinOnNleDrag: (enabled: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCompactHover: (enabled: boolean) => void;
  setBinFilterActive: (active: boolean) => void;
  setCustomSliceExportPath: (path: string) => void;
  pickCustomSliceExportPath: () => Promise<void>;
  openSlicesFolder: () => Promise<void>;
  setSlicesFilterActive: (active: boolean) => void;
  setSliceHideMissing: (hide: boolean) => void;
  setSliceFavoriteOnly: (favOnly: boolean) => void;
  setSlicePitchOnly: (pitchOnly: boolean) => void;
  cycleSliceSort: (key: SliceSortKey) => void;
  setSliceSelection: (
    ids: number[],
    activeId: number | null,
    lastIndex: number | null
  ) => void;
  selectAllSlices: () => void;
  selectRelativeSlice: (delta: number) => void;
  openBatchRenameSlicesModal: (sliceIds: number[]) => void;
  closeBatchRenameSlicesModal: () => void;
  fetchSliceHistory: () => Promise<void>;
  saveActiveSlice: (customName?: string) => Promise<SliceHistoryEntry | null>;
  recordSliceExport: (payload: {
    slicePath: string;
    sourceSampleId?: number | null;
    sourceFilePath: string;
    startSec: number;
    endSec: number;
    pitchSemitones?: number;
    applyMicroFade?: boolean;
  }) => Promise<SliceHistoryEntry | null>;
  toggleSliceFavorite: (sliceId: number) => Promise<void>;
  toggleSliceFavoritesBatch: (
    sliceIds: number[],
    isFavorite: boolean
  ) => Promise<void>;
  batchRenameSlices: (
    entries: Array<{ slice_id: number; new_stem: string }>,
    opts?: { isHistoryReplay?: boolean }
  ) => Promise<void>;
  clearMissingSlices: () => Promise<number>;
  trashSliceFiles: (
    sliceIds: number[],
    opts?: { isHistoryReplay?: boolean }
  ) => Promise<void>;
  fetchSliceTrashStatus: () => Promise<void>;
  fetchTrashedSlices: () => Promise<void>;
  restoreTrashedSlices: (
    sliceIds?: number[],
    opts?: { isHistoryReplay?: boolean }
  ) => Promise<SliceHistoryEntry[]>;
  emptyTrashedSlices: (
    sliceIds?: number[]
  ) => Promise<SliceTrashSummary | null>;
  undoLastSliceOp: () => Promise<void>;
  redoLastSliceOp: () => Promise<void>;
  selectSliceForPreview: (
    entry: SliceHistoryEntry,
    shouldPlay?: boolean
  ) => void;
  jumpToSliceSource: (entry: SliceHistoryEntry) => Promise<void>;

  setSettingsOpen: (open: boolean, tab?: SettingsTab) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (hex: string) => void;
  setAccentAuto: (enabled: boolean) => void;
  setWaveformSensitivity: (sens: WaveformSensitivity) => void;
  setWaveformStyle: (style: WaveformStyle) => void;
  setPlayheadLatencyMs: (ms: number | null) => void;
  setAudioOutputDeviceId: (deviceId: string) => void;
  setSliceMicroFade: (enabled: boolean) => void;
  setExportAudioPreset: (preset: ExportAudioPreset) => void;
  setSkipLeadingSilence: (enabled: boolean) => void;
  setNormalizePreview: (enabled: boolean) => void;
  setAutoAnalyzeBpmKey: (enabled: boolean) => void;
  setEnableLiveFolderWatch: (enabled: boolean) => void;
  toggleMiniDock: () => Promise<void>;
  setMiniDockPinned: (pinned: boolean) => Promise<void>;
  setMiniDockEdgePeek: (enabled: boolean) => void;
  setMiniDockEdgeSide: (side: MiniDockEdgeSide) => void;
  setEnableMica: (enabled: boolean) => void;
  setThemeTintIntensity: (intensity: number) => void;
  setCustomBgImage: (pathOrUrl: string) => void;
  loadCustomBgGallery: () => Promise<void>;
  openCustomBgFolder: () => Promise<void>;
  deleteCustomBgImage: (filePath: string) => Promise<void>;
  selectCustomBgImageFile: () => Promise<void>;
  setCustomBgBlur: (blurPx: number) => void;
  setCustomBgOpacity: (opacity: number) => void;
  setWallpaperKind: (kind: WallpaperKind) => void;
  setAsciiPreset: (preset: AsciiPresetId) => void;
  setAsciiMagicSlug: (slug: string, activate?: boolean) => void;
  setAsciiMagicLook: (look: AsciiMagicLook) => void;
  setAsciiMagicFit: (fit: AsciiMagicFit) => void;
  setAsciiMotionSpeed: (speed: number) => void;
  setShortcut: (action: keyof KeyboardShortcuts, key: string) => void;
  resetShortcuts: () => void;

  toggleFavorite: (sampleId: number) => Promise<void>;
  toggleSampleLoop: (sampleId: number) => Promise<void>;
  toggleFavoritesBatch: (
    sampleIds: number[],
    favorite: boolean
  ) => Promise<void>;
  ensureFavorite: (sample: SampleItem) => Promise<void>;
  createTag: (name: string, color: string) => Promise<Tag | null>;
  assignTag: (sampleId: number, tagId: number) => Promise<void>;
  unassignTag: (sampleId: number, tagId: number) => Promise<void>;
  assignTagBatch: (sampleIds: number[], tagId: number) => Promise<void>;
  clearSampleTags: (sampleIds: number[]) => Promise<void>;
  renameTag: (tagId: number, newName: string) => Promise<void>;
  updateTagColor: (tagId: number, newColor: string) => Promise<void>;
  deleteTag: (tagId: number) => Promise<void>;
  createGenre: (name: string, color: string) => Promise<Genre | null>;
  renameGenre: (genreId: number, newName: string) => Promise<void>;
  updateGenreColor: (genreId: number, newColor: string) => Promise<void>;
  deleteGenre: (genreId: number) => Promise<void>;
  assignGenre: (sampleId: number, genreName: string) => Promise<void>;
  assignGenreBatch: (sampleIds: number[], genreName: string) => Promise<void>;
  autoDetectGenres: () => Promise<void>;
  setSampleBpmKey: (
    sampleIds: number[],
    opts: {
      bpm?: number | null;
      clearBpm?: boolean;
      musicalKey?: string | null;
      clearKey?: boolean;
    }
  ) => Promise<void>;
  createCollection: (
    name: string,
    color?: string,
    icon?: string,
    parentId?: number | null,
    rulePath?: string | null,
    smartQuery?: string | null
  ) => Promise<Collection | null>;
  addToCollection: (collectionId: number, sampleId: number) => Promise<void>;
  addSamplesToCollectionBatch: (
    collectionId: number,
    sampleIds: number[]
  ) => Promise<void>;
  addAutoRoutedSamplesToCollection: (
    targetCollectionId: number,
    samplesToAdd: SampleItem[]
  ) => Promise<void>;
  removeSamplesFromCollection: (
    collectionId: number,
    sampleIds: number[]
  ) => Promise<void>;
  renameCollection: (
    collectionId: number,
    newName: string,
    newColor?: string,
    newIcon?: string,
    newRulePath?: string | null,
    newSmartQuery?: string | null
  ) => Promise<Collection | null>;
  deleteCollection: (collectionId: number) => Promise<void>;
  addCollectionTemplate: (
    template: Omit<CollectionRuleTemplate, "id">
  ) => Promise<void>;
  updateCollectionTemplate: (
    id: string,
    patch: Partial<CollectionRuleTemplate>
  ) => Promise<void>;
  deleteCollectionTemplate: (id: string) => Promise<void>;
  resetCollectionTemplates: () => Promise<void>;
  setAutoCreateCollectionSubfolders: (enabled: boolean) => void;
  setAutoRouteCollectionDrops: (enabled: boolean) => void;
  applyTemplatesToExistingCollection: (
    collectionId: number
  ) => Promise<void>;
  pickFolderForCollectionTemplate: () => Promise<string | null>;
  setStatusMessage: (msg: string | null) => void;
  showStatusNotice: (
    message: string,
    kind?: "info" | "success" | "error"
  ) => void;
  clearStatusNotice: () => void;
}
