export const AUDIFY_STORAGE_KEY_PREFIX = "audify_";
export const LAST_SELECTED_SAMPLE_ID_KEY = "audify_last_selected_sample_id";
export const LAST_SELECTED_SAMPLE_PATH_KEY = "audify_last_selected_sample_path";
export const CROSS_WINDOW_SYNC_KEY = "audify_cross_window_sync";
export const SETTINGS_TAB_STORAGE_KEY = "audify_settings_tab";

/**
  * Single source of truth for all `audify_*` localStorage and cross-window sync keys.
  */
export const AUDIFY_STORAGE_KEYS = {
  // Appearance & Theme
  themeMode: "audify_theme_mode",
  accentColor: "audify_accent_color",
  manualAccentColor: "audify_manual_accent_color",
  accentAuto: "audify_accent_auto",
  enableMica: "audify_enable_mica",
  themeTintIntensity: "audify_theme_tint_intensity",
  customBgImage: "audify_custom_bg_image",
  customBgBlur: "audify_custom_bg_blur",
  customBgOpacity: "audify_custom_bg_opacity",
  wallpaperKind: "audify_wallpaper_kind",
  asciiPreset: "audify_ascii_preset",
  asciiMotionSpeed: "audify_ascii_motion_speed",
  asciiMagicSlug: "audify_ascii_magic_slug",
  asciiMagicLook: "audify_ascii_magic_look",
  asciiMagicFit: "audify_ascii_magic_fit",

  // Waveform & Audio
  waveformSensitivity: "audify_waveform_sensitivity",
  waveformStyle: "audify_waveform_style",
  playheadLatencyMs: "audify_playhead_latency_ms",
  audioOutputDeviceId: "audify_audio_output_device_id",
  autoPreview: "audify_auto_preview",
  isLooping: "audify_is_looping",
  isShuffle: "audify_is_shuffle",
  volume: "audify_volume",
  sliceMicroFade: "audify_slice_micro_fade",
  normalizePreview: "audify_normalize_preview",
  autoAnalyzeBpmKey: "audify_auto_analyze_bpm_key",

  // Navigation, Selection, Table Layout & Library State
  lastSelectedSampleId: LAST_SELECTED_SAMPLE_ID_KEY,
  lastSelectedSamplePath: LAST_SELECTED_SAMPLE_PATH_KEY,
  recentSampleIds: "audify_recent_sample_ids",
  sort: "audify_sort",
  smartSearchSynonyms: "audify_smart_search_synonyms",
  cachedFolderStats: "audify_cached_folder_stats",
  cachedTrashStatus: "audify_cached_trash_status",
  activeFolderFilter: "audify_active_folder_filter",
  activeLicenseGroupId: "audify_active_license_group_id",
  activeFavoriteOnly: "audify_active_favorite_only",
  activeCollectionId: "audify_active_collection_id",
  expandedLibIds: "audify_expanded_lib_ids",
  expandedFolderPaths: "audify_expanded_folder_paths",
  expandedColIds: "audify_expanded_col_ids",
  sidebarSmartCollectionsOpen: "audify_sidebar_smart_col_open",
  expandedLicenseIds: "audify_expanded_license_ids",
  expandedLicenseFolderPaths: "audify_expanded_license_folder_paths",
  visibleColumnsV2: "audify_visible_columns_v2",
  columnOrderV2: "audify_column_order_v2",
  columnWidthsV3: "audify_column_widths_v3",
  sliceColumnWidthsV1: "audify_slice_column_widths_v1",
  filterDrawerOpen: "audify_filter_drawer_open",
  filterDrawerTab: "audify_filter_drawer_tab",
  peaksV3Rms600: "audify_peaks_v3_rms_600",
  lastAutoBackupDate: "audify_last_auto_backup_date",

  // Session Bin, Dock, File Ops, Shortcuts, Licenses & Collections
  binSampleIds: "audify_bin_sample_ids",
  autoBinOnNleDrag: "audify_auto_bin_nle_drag",
  customSliceExportPath: "audify_custom_slice_export_path",
  miniDockBoundsV3: "audify_mini_dock_bounds_v3",
  miniDockPinned: "audify_mini_dock_pinned",
  shortcuts: "audify_shortcuts",
  enableLicenses: "audify_enable_licenses",
  licenseGroups: "audify_license_groups",
  collectionTemplates: "audify_collection_templates",
  autoCreateSubfolders: "audify_auto_create_subfolders",
  autoRouteCollectionDrops: "audify_auto_route_collection_drops",
  enableAdvancedFileOps: "audify_enable_advanced_file_ops",
  confirmBeforeTrash: "audify_confirm_before_trash",
  enableLiveFolderWatch: "audify_enable_live_folder_watch",

  // AI Settings
  aiAutoAnalyzeOnScan: "audify_ai_auto_analyze_on_scan",
  aiTagConfidenceThreshold: "audify_ai_tag_confidence_threshold",
  aiTaggingMode: "audify_ai_tagging_mode",
  aiKnnTagLearning: "audify_ai_knn_tag_learning",
  aiSimilarityMinScore: "audify_ai_similarity_min_score",
  aiSimilarityTopK: "audify_ai_similarity_top_k",
  aiSimilarityScope: "audify_ai_similarity_scope",
  aiSimilarityDurationMatch: "audify_ai_similarity_duration_match",

  // Cross-window sync & standalone settings UI
  crossWindowSync: CROSS_WINDOW_SYNC_KEY,
  settingsTab: SETTINGS_TAB_STORAGE_KEY,
} as const;
