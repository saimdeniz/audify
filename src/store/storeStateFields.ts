import {
  AiDownloadProgressPayload,
  AiIndexProgressPayload,
  AiModelStatus,
  AiSimilarityScope,
  AiTagSuggestionItem,
  AiTaggingMode,
  AsciiMagicFit,
  AsciiMagicLook,
  AsciiPresetId,
  AutoTagCategoryConfig,
  AutoTagImpactPreview,
  AutoTagRule,
  BackupFileInfo,
  BatchJobProgressPayload,
  BpmKeyProgressPayload,
  Collection,
  CollectionRuleTemplate,
  DuplicateScanMode,
  DuplicateScanProgressPayload,
  DuplicateScanResult,
  ExportAudioPreset,
  ExportLoudnessMode,
  FileOpJournalEntry,
  TrashOpStatus,
  FolderStat,
  Genre,
  KeyboardShortcuts,
  Library,
  LicenseGroup,
  MiniDockEdgeSide,
  PendingSnapshotRestore,
  Profile,
  SampleItem,
  SampleRateFilter,
  ScanProgressPayload,
  SimilaritySession,
  SliceHistoryEntry,
  SliceOpHistoryItem,
  SliceRange,
  SliceSortKey,
  SortDir,
  SortKey,
  Tag,
  TagFacet,
  ThemeMode,
  TrashViewTab,
  TypeFilter,
  WallpaperKind,
  WaveformSensitivity,
  WaveformStyle,
} from "../types";
import type {
  CreditToastPayload,
  FileOpHistoryItem,
  MainFilterRequest,
  PendingFileConflictPrompt,
  PendingTrashRequest,
  SettingsTab,
  StatusNoticePayload,
} from "./storePayloads";

export interface SampleStoreDataState {
  // Profiles & Data
  hasInitialized: boolean;
  profiles: Profile[];
  activeProfile: Profile | null;
  libraries: Library[];
  allProfileSamples: SampleItem[];
  trashedProfileSamples: SampleItem[];
  rawSamples: SampleItem[];
  samples: SampleItem[];
  favoritesCount: number;
  knownSampleIds: ReadonlySet<number>;
  tagFacets: TagFacet[];
  tags: Tag[];
  genres: Genre[];
  collections: Collection[];
  smartCollectionCounts: Record<number, number>;
  folderStats: FolderStat[];

  // Filter state
  searchQuery: string;
  smartSearchSynonyms: boolean;
  folderFilter: string | null;
  favoriteOnly: boolean;
  recentOnly: boolean;
  recentSampleIds: number[];
  selectedTagIds: number[];
  excludedTagIds: number[];
  tagMatchMode: import("../types").TagMatchMode;
  selectedGenre: string | null;
  isDetectingGenres: boolean;
  genreDetectProgress: BatchJobProgressPayload | null;
  selectedCollectionId: number | null;
  selectedLicenseGroupId: string | null;
  binFilterActive: boolean;
  trashFilterActive: boolean;
  sortKey: SortKey | null;
  sortDir: SortDir;
  typeFilter: TypeFilter;
  srFilter: SampleRateFilter;

  // Phase E: Advanced File Ops, Quarantine Trash & Rename
  enableAdvancedFileOps: boolean;
  confirmBeforeTrash: boolean;
  pendingTrashRequest: PendingTrashRequest | null;
  pendingFileConflictPrompt: PendingFileConflictPrompt | null;
  trashedCount: number;
  trashedTotalBytes: number;
  trashedSliceCount: number;
  trashedSliceTotalBytes: number;
  trashViewTab: TrashViewTab;
  trashOpStatus: TrashOpStatus | null;
  fileOpJournal: FileOpJournalEntry[];
  fileOpUndoStack: FileOpHistoryItem[];
  fileOpRedoStack: FileOpHistoryItem[];
  batchRenameSampleIds: number[] | null;
  duplicatesFilterActive: boolean;
  duplicateScanMode: DuplicateScanMode;
  duplicateLibraryId: number | null;
  duplicateMinSimilarityPct: number;
  duplicateExtrasMinPct: number;
  isScanningDuplicates: boolean;
  duplicateScanProgress: DuplicateScanProgressPayload | null;
  duplicateScanResult: DuplicateScanResult | null;
  duplicateScanCache: Record<string, DuplicateScanResult>;
  duplicateScanError: string | null;

  // Session Bin (Temporary Scratchpad / Crate) & Slice Export
  binSampleIds: number[];
  autoBinOnNleDrag: boolean;
  customSliceExportPath: string;
  slicesFilterActive: boolean;
  sliceHistory: SliceHistoryEntry[];
  trashedSliceHistory: SliceHistoryEntry[];
  isLoadingSliceHistory: boolean;
  sliceHideMissing: boolean;
  sliceFavoriteOnly: boolean;
  slicePitchOnly: boolean;
  sliceSortKey: SliceSortKey | null;
  sliceSortDir: SortDir;
  selectedSliceIds: number[];
  activeSliceId: number | null;
  lastSelectedSliceIndex: number | null;
  batchRenameSliceIds: number[] | null;
  sliceOpUndoStack: SliceOpHistoryItem[];
  sliceOpRedoStack: SliceOpHistoryItem[];

  // Playback, Multi-Select & Deck state
  selectedSample: SampleItem | null;
  selectedSampleIds: number[];
  lastSelectedIndex: number | null;
  isPlaying: boolean;
  isLooping: boolean;
  isShuffle: boolean;
  shuffleHistory: number[];
  autoPreview: boolean;
  volume: number;
  preMuteVolume: number;
  pitchSemitones: number;
  currentTimeSec: number;
  durationSec: number;
  sliceRange: SliceRange | null;
  seekRequest: { timeSec: number; seq: number } | null;
  playTriggerSeq: number;

  // Settings, Theme, Visual Customization, Audio, Shortcuts, Auto-Tag & Licenses
  sidebarCollapsed: boolean;
  sidebarCompactHover: boolean;
  isSettingsOpen: boolean;
  isSettingsWindowVisible: boolean;
  settingsTab: SettingsTab;
  themeMode: ThemeMode;
  accentColor: string;
  accentAuto: boolean;
  waveformSensitivity: WaveformSensitivity;
  waveformStyle: WaveformStyle;
  /** Manual playhead latency offset in ms; null = auto (AudioContext output latency). */
  playheadLatencyMs: number | null;
  audioOutputDeviceId: string;
  sliceMicroFade: boolean;
  exportAudioPreset: ExportAudioPreset;
  exportLoudnessMode: ExportLoudnessMode;
  skipLeadingSilence: boolean;
  normalizePreview: boolean;
  autoAnalyzeBpmKey: boolean;
  enableLiveFolderWatch: boolean;
  isAnalyzingBpmKey: boolean;
  bpmKeyProgress: BpmKeyProgressPayload | null;
  isMiniDock: boolean;
  isMiniDockPinned: boolean;
  miniDockEdgePeek: boolean;
  miniDockEdgeSide: MiniDockEdgeSide;
  enableMica: boolean;
  themeTintIntensity: number;
  customBgImage: string;
  customBgGallery: string[];
  customBgBlur: number;
  customBgOpacity: number;
  wallpaperKind: WallpaperKind;
  asciiPreset: AsciiPresetId;
  asciiMagicSlug: string;
  asciiMagicLook: AsciiMagicLook;
  asciiMagicFit: AsciiMagicFit;
  asciiMotionSpeed: number;
  shortcuts: KeyboardShortcuts;
  autoTagRules: AutoTagRule[];
  autoTagCategories: AutoTagCategoryConfig[];
  autoTagRulesDirty: boolean;
  isApplyingAutoTags: boolean;
  autoTagProgress: BatchJobProgressPayload | null;
  autoTagImpactPreview: AutoTagImpactPreview | null;
  canUndoAutoTagApply: boolean;
  localBackups: BackupFileInfo[];
  pendingSnapshotRestore: PendingSnapshotRestore | null;
  enableLicensesSystem: boolean;
  licenseGroups: LicenseGroup[];
  creditToast: CreditToastPayload | null;
  statusNotice: StatusNoticePayload | null;
  collectionTemplates: CollectionRuleTemplate[];
  autoCreateCollectionSubfolders: boolean;
  autoRouteCollectionDrops: boolean;

  // In-App Drag-and-Drop state
  inAppDragSample: SampleItem | null;
  inAppDragSamples: SampleItem[];
  inAppDragOrigin: "list" | "deck-header" | null;

  // Scanner & Diagnostics
  isScanning: boolean;
  scanProgress: ScanProgressPayload | null;
  statusMessage: string | null;

  // Local AI Audio Intelligence & Similarity Search (FAZ D)
  aiModelStatus: AiModelStatus | null;
  aiDownloadProgress: AiDownloadProgressPayload | null;
  isDownloadingAiModel: boolean;
  isVerifyingAiModel: boolean;
  aiAutoAnalyzeOnScan: boolean;
  aiTagConfidenceThreshold: number;
  aiTaggingMode: AiTaggingMode;
  aiKnnTagLearning: boolean;
  aiSimilarityMinScore: number;
  aiSimilarityTopK: number;
  aiSimilarityScope: AiSimilarityScope;
  aiSimilarityDurationMatch: boolean;
  isAnalyzingAi: boolean;
  aiIndexProgress: AiIndexProgressPayload | null;
  similaritySession: SimilaritySession | null;
  externalSimilarityPendingFile: string | null;
  aiSuggestionsBySampleId: Record<number, AiTagSuggestionItem[]>;
  pendingAiSuggestionsCount: number;
}

export interface SampleFilterAndPlaybackActions {
  setSearchQuery: (q: string) => void;
  setSmartSearchSynonyms: (enabled: boolean) => void;
  setFolderFilter: (folder: string | null) => void;
  setFavoriteOnly: (fav: boolean) => void;
  setRecentOnly: (recent: boolean) => void;
  clearRecentSamples: () => void;
  toggleTagFilter: (tagId: number) => void;
  selectOrToggleTagFilter: (tagId: number, append: boolean) => void;
  toggleExcludeTagFilter: (tagId: number) => void;
  setTagMatchMode: (mode: import("../types").TagMatchMode) => void;
  toggleTagMatchMode: () => void;
  clearExcludedTagFilters: () => void;
  clearTagFilters: (facetSlugs?: readonly import("../types").TaxonomyFacetSlug[]) => void;
  setSelectedGenre: (genre: string | null) => void;
  setCollectionFilter: (collectionId: number | null) => void;
  setTypeFilter: (type: TypeFilter) => void;
  setSrFilter: (sr: SampleRateFilter) => void;
  selectAllFiles: () => void;
  resetAllFilters: () => void;
  applyMainFilterRequest: (req: MainFilterRequest) => void;
  cycleSort: (key: SortKey) => void;

  selectSample: (sample: SampleItem, shouldPlay?: boolean) => void;
  handleRowSelect: (
    sample: SampleItem,
    index: number,
    opts?: { ctrlKey?: boolean; shiftKey?: boolean }
  ) => void;
  selectAllSamples: () => void;
  clearMultiSelection: () => void;
  selectRelativeSample: (delta: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlayPause: () => void;
  stopPlayback: () => void;
  toggleLooping: () => void;
  toggleShuffle: () => void;
  toggleAutoPreview: () => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setPitchSemitones: (semitones: number) => void;
  setCurrentTimeSec: (sec: number) => void;
  setDurationSec: (sec: number) => void;
  requestSeek: (timeSec: number, playImmediately?: boolean) => void;
  setSliceRange: (range: SliceRange | null) => void;
  setInAppDragSample: (
    sample: SampleItem | null,
    opts?: { single?: boolean; origin?: "list" | "deck-header" }
  ) => void;
  showInFolder: (filePath: string) => Promise<void>;
}
