import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AiDownloadProgressPayload,
  AiIndexProgressPayload,
  BpmKeyProgressPayload,
  DuplicateScanProgressPayload,
  Profile,
  ScanProgressPayload,
  ThemeMode,
  WallpaperKind,
} from "../../types";
import { onError } from "../../utils/errors";
import { clearLocalEditedKeys } from "../../utils/localStorageSafe";
import { clearHiResPeaksCache } from "../../utils/hiResPeaks";
import { clearPeaksCache } from "../../utils/peaksStore";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import {
  releaseBackdropTransitionCaches,
  releaseSettingsWindowCaches,
} from "../../utils/wallpaperCleanup";
import { preserveRecentLocalProfileFields } from "../remoteSettingsSync";
import {
  AUDIFY_STORAGE_KEYS,
  AUDIFY_STORAGE_KEY_PREFIX,
} from "../../constants/storageKeys";
import {
  APPLY_MAIN_FILTER_EVENT,
  isLocalKeyRecentlyEdited,
  isStandaloneSettingsWindow,
  loadBootSettings,
  loadSavedAutoCreateCollectionSubfolders,
  loadSavedAutoRouteCollectionDrops,
  loadSavedBinSampleIds,
  loadSavedCollectionTemplates,
  loadSavedLicenseGroups,
  loadSavedSettingsTab,
  loadSavedShortcuts,
  normalizeAsciiMagicFit,
  normalizeAsciiMagicLook,
  normalizeAsciiMagicSlug,
  normalizeAsciiMotionSpeed,
  normalizeAsciiPreset,
  normalizeSettingsTab,
  normalizeWallpaperKind,
  subscribeCrossWindowSync,
} from "../storageHelpers";
import { applyThemeAndAccentToDom, applyVisualEffectsToDom } from "../themeDom";
import type { MainFilterRequest, StoreGet, StoreSet } from "../types";

let listenersRegistered = false;

interface ListenerSetupContext {
  set: StoreSet;
  get: StoreGet;
  applyProfileSettingsImmediately: (
    profile: Profile,
    opts?: { isInitialBoot?: boolean; isRemoteSync?: boolean }
  ) => void;
  bumpProfileEpoch: () => number;
  getProfileEpoch: () => number;
  resetFiltersOnProfileChange: (statusMessage: string) => void;
}

function applyRemoteSettingsFromStorage(get: StoreGet, set: StoreSet): void {
  const snap = loadBootSettings();
  const candidate = {
    themeMode: snap.themeMode,
    accentColor: snap.accentColor,
    accentAuto: snap.accentAuto,
    waveformSensitivity: snap.waveformSensitivity,
    waveformStyle: snap.waveformStyle,
    playheadLatencyMs: snap.playheadLatencyMs,
    audioOutputDeviceId: snap.audioOutputDeviceId,
    enableMica: snap.enableMica,
    sidebarCompactHover: snap.sidebarCompactHover,
    themeTintIntensity: snap.themeTintIntensity,
    customBgImage: snap.customBgImage,
    customBgBlur: snap.customBgBlur,
    customBgOpacity: snap.customBgOpacity,
    wallpaperKind: snap.wallpaperKind,
    asciiPreset: snap.asciiPreset,
    asciiMagicSlug: snap.asciiMagicSlug,
    asciiMagicLook: snap.asciiMagicLook,
    asciiMagicFit: snap.asciiMagicFit,
    asciiMotionSpeed: snap.asciiMotionSpeed,
    enableLicensesSystem: snap.enableLicenses,
    autoBinOnNleDrag: snap.autoBinOnNleDrag,
    customSliceExportPath: snap.customSliceExportPath,
    smartSearchSynonyms: snap.smartSearchSynonyms,
    autoPreview: snap.autoPreview,
    isLooping: snap.isLooping,
    isShuffle: snap.isShuffle,
    volume: snap.volume,
    sliceMicroFade: snap.sliceMicroFade,
    exportAudioPreset: snap.exportAudioPreset,
    exportLoudnessMode: snap.exportLoudnessMode,
    skipLeadingSilence: snap.skipLeadingSilence,
    miniDockEdgePeek: snap.miniDockEdgePeek,
    miniDockEdgeSide: snap.miniDockEdgeSide,
    normalizePreview: snap.normalizePreview,
    autoAnalyzeBpmKey: snap.autoAnalyzeBpmKey,
    enableAdvancedFileOps: snap.enableAdvancedFileOps,
    confirmBeforeTrash: snap.confirmBeforeTrash,
    enableLiveFolderWatch: snap.enableLiveFolderWatch,
    aiAutoAnalyzeOnScan: snap.aiAutoAnalyzeOnScan,
    aiTagConfidenceThreshold: snap.aiTagConfidenceThreshold,
    aiTaggingMode: snap.aiTaggingMode,
    aiKnnTagLearning: snap.aiKnnTagLearning,
    aiSimilarityMinScore: snap.aiSimilarityMinScore,
    aiSimilarityTopK: snap.aiSimilarityTopK,
    aiSimilarityScope: snap.aiSimilarityScope,
    aiSimilarityDurationMatch: snap.aiSimilarityDurationMatch,
    shortcuts: loadSavedShortcuts(),
    licenseGroups: loadSavedLicenseGroups(),
    collectionTemplates: loadSavedCollectionTemplates(),
    autoCreateCollectionSubfolders: loadSavedAutoCreateCollectionSubfolders(),
    autoRouteCollectionDrops: loadSavedAutoRouteCollectionDrops(),
    binSampleIds: loadSavedBinSampleIds(),
  };

  const initialProtected = preserveRecentLocalProfileFields(get(), candidate);
  applyThemeAndAccentToDom(
    initialProtected.themeMode,
    initialProtected.accentColor
  );
  applyVisualEffectsToDom(
    initialProtected.enableMica,
    initialProtected.themeTintIntensity
  );

  const prevKind = get().wallpaperKind;
  let nextKind: WallpaperKind = prevKind;
  set((state) => {
    const protectedPatch = preserveRecentLocalProfileFields(state, candidate);
    nextKind = protectedPatch.wallpaperKind;
    return {
      ...protectedPatch,
      ...(!isStandaloneSettingsWindow()
        ? { settingsTab: loadSavedSettingsTab() }
        : {}),
      activeProfile: state.activeProfile
        ? { ...state.activeProfile, color: protectedPatch.accentColor }
        : null,
    };
  });
  if (nextKind !== prevKind || nextKind === "none") {
    releaseBackdropTransitionCaches(prevKind, nextKind);
  }
}

function applyLiveVisualPatch(set: StoreSet, p: Record<string, unknown>): void {
  let prevKind: WallpaperKind | null = null;
  let resolvedNextKind: WallpaperKind | null = null;
  const isProtected = (key: string): boolean => isLocalKeyRecentlyEdited(key);
  set((state) => {
    prevKind = state.wallpaperKind;
    const nextTheme: ThemeMode =
      !isProtected(AUDIFY_STORAGE_KEYS.themeMode) &&
      (p.themeMode === "light" || p.themeMode === "contrast" || p.themeMode === "dark")
        ? p.themeMode
        : state.themeMode;
    const nextMica =
      !isProtected(AUDIFY_STORAGE_KEYS.enableMica) &&
      typeof p.enableMica === "boolean"
        ? p.enableMica
        : state.enableMica;
    const nextTint =
      !isProtected(AUDIFY_STORAGE_KEYS.themeTintIntensity) &&
      typeof p.themeTintIntensity === "number"
        ? p.themeTintIntensity
        : state.themeTintIntensity;
    const nextAccent =
      !isProtected(AUDIFY_STORAGE_KEYS.accentColor) &&
      typeof p.accentColor === "string"
        ? p.accentColor
        : state.accentColor;
    const nextAccentAuto =
      !isProtected(AUDIFY_STORAGE_KEYS.accentAuto) &&
      typeof p.accentAuto === "boolean"
        ? p.accentAuto
        : state.accentAuto;

    if (nextTheme !== state.themeMode || nextAccent !== state.accentColor) {
      applyThemeAndAccentToDom(nextTheme, nextAccent);
    }
    applyVisualEffectsToDom(nextMica, nextTint);

    const nextBgImage =
      !isProtected(AUDIFY_STORAGE_KEYS.customBgImage) &&
      typeof p.customBgImage === "string"
        ? p.customBgImage
        : state.customBgImage;
    const nextWallpaperKind =
      !isProtected(AUDIFY_STORAGE_KEYS.wallpaperKind) &&
      p.wallpaperKind !== undefined
        ? normalizeWallpaperKind(p.wallpaperKind, nextBgImage)
        : undefined;
    resolvedNextKind = nextWallpaperKind ?? state.wallpaperKind;

    return {
      ...(!isProtected(AUDIFY_STORAGE_KEYS.themeMode) && typeof p.themeMode === "string"
        ? { themeMode: nextTheme }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.enableMica) && typeof p.enableMica === "boolean"
        ? { enableMica: p.enableMica }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.themeTintIntensity) &&
      typeof p.themeTintIntensity === "number"
        ? { themeTintIntensity: p.themeTintIntensity }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.accentAuto) && typeof p.accentAuto === "boolean"
        ? { accentAuto: nextAccentAuto }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.accentColor) && typeof p.accentColor === "string"
        ? {
            accentColor: nextAccent,
            activeProfile: state.activeProfile
              ? { ...state.activeProfile, color: nextAccent }
              : null,
            profiles: state.profiles.map((prof) =>
              state.activeProfile && prof.id === state.activeProfile.id
                ? { ...prof, color: nextAccent }
                : prof
            ),
          }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.customBgImage) &&
      typeof p.customBgImage === "string"
        ? { customBgImage: p.customBgImage }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.customBgBlur) &&
      typeof p.customBgBlur === "number"
        ? { customBgBlur: p.customBgBlur }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.customBgOpacity) &&
      typeof p.customBgOpacity === "number"
        ? { customBgOpacity: p.customBgOpacity }
        : {}),
      ...(nextWallpaperKind !== undefined ? { wallpaperKind: nextWallpaperKind } : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiPreset) && p.asciiPreset !== undefined
        ? { asciiPreset: normalizeAsciiPreset(p.asciiPreset) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMagicSlug) &&
      p.asciiMagicSlug !== undefined
        ? { asciiMagicSlug: normalizeAsciiMagicSlug(p.asciiMagicSlug) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMagicLook) &&
      p.asciiMagicLook !== undefined
        ? { asciiMagicLook: normalizeAsciiMagicLook(p.asciiMagicLook) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMagicFit) &&
      p.asciiMagicFit !== undefined
        ? { asciiMagicFit: normalizeAsciiMagicFit(p.asciiMagicFit) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.asciiMotionSpeed) &&
      typeof p.asciiMotionSpeed === "number"
        ? { asciiMotionSpeed: normalizeAsciiMotionSpeed(p.asciiMotionSpeed) }
        : {}),
      ...(!isProtected(AUDIFY_STORAGE_KEYS.volume) && typeof p.volume === "number"
        ? { volume: p.volume }
        : {}),
    };
  });
  if (
    prevKind !== null &&
    resolvedNextKind !== null &&
    (resolvedNextKind !== prevKind || p.wallpaperKind === "none")
  ) {
    releaseBackdropTransitionCaches(prevKind, resolvedNextKind);
  }
}

export function registerStoreListenersOnce({
  set,
  get,
  applyProfileSettingsImmediately,
  bumpProfileEpoch,
  getProfileEpoch,
  resetFiltersOnProfileChange,
}: ListenerSetupContext): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  if (isStandaloneSettingsWindow() && typeof window !== "undefined") {
    try {
      const tabParam = new URLSearchParams(window.location.search).get("tab");
      set({
        settingsTab: tabParam ? normalizeSettingsTab(tabParam) : loadSavedSettingsTab(),
        isSettingsOpen: true,
      });
    } catch {
      // ignore URL parse error
    }
  }

  let pendingRemoteSettingsApply = false;
  const scheduleRemoteSettingsApply = () => {
    if (pendingRemoteSettingsApply) return;
    pendingRemoteSettingsApply = true;
    queueMicrotask(() => {
      pendingRemoteSettingsApply = false;
      applyRemoteSettingsFromStorage(get, set);
    });
  };

  let isHandlingRemoteSync = false;
  let queuedRemoteSyncKind: string | null = null;
  const seenSyncMsgIds = new Map<string, number>();
  const lastHandledSyncByKind = new Map<string, number>();
  const pruneSyncTimestamps = (now: number) => {
    for (const [id, ts] of seenSyncMsgIds) {
      if (now - ts > 8000) {
        seenSyncMsgIds.delete(id);
      }
    }
    for (const [k, ts] of lastHandledSyncByKind) {
      if (now - ts > 5000) {
        lastHandledSyncByKind.delete(k);
      }
    }
  };

  const handleRemoteCatalogOrProfileSync = (kind: string, msgId?: string) => {
    const now = Date.now();
    pruneSyncTimestamps(now);
    // Deduplicate dual transport (BroadcastChannel + Tauri IPC) by unique message ID
    // so rapid distinct user edits within <180ms are never dropped while twin echoes are skipped.
    if (msgId) {
      if (seenSyncMsgIds.has(msgId)) return;
      seenSyncMsgIds.set(msgId, now);
    } else {
      const prevTs = lastHandledSyncByKind.get(kind);
      if (prevTs !== undefined && now - prevTs < 180) return;
      lastHandledSyncByKind.set(kind, now);
    }

    if (kind === "backgrounds") {
      void get().loadCustomBgGallery();
      return;
    }
    if (isHandlingRemoteSync) {
      if (queuedRemoteSyncKind !== "catalog") {
        queuedRemoteSyncKind = kind;
      }
      return;
    }
    isHandlingRemoteSync = true;
    const startEpoch = getProfileEpoch();
    void invoke<Profile[]>("get_profiles")
      .then(async (profiles) => {
        if (startEpoch !== getProfileEpoch()) {
          return;
        }
        const prevActiveId = get().activeProfile?.id ?? null;
        const active = profiles.find((p) => p.is_active) || profiles[0] || null;
        const didSwitchProfile =
          active !== null && prevActiveId !== null && active.id !== prevActiveId;
        if (didSwitchProfile) {
          // Invalidate any stale query/pool hydration in flight and discard prior profile key grace TTL.
          bumpProfileEpoch();
          clearLocalEditedKeys();
        }
        if (active) {
          applyProfileSettingsImmediately(active, {
            isRemoteSync: !didSwitchProfile,
          });
        }
        const preservedAccent = get().accentColor;
        const syncedActive = active ? { ...active, color: preservedAccent } : null;
        const syncedProfiles = profiles.map((p) =>
          syncedActive && p.id === syncedActive.id
            ? { ...p, color: preservedAccent }
            : p
        );
        set({ profiles: syncedProfiles, activeProfile: syncedActive });
        if (didSwitchProfile && active) {
          resetFiltersOnProfileChange(
            `Switched workspace profile to "${active.name}"`
          );
        }
        if (kind === "catalog" || didSwitchProfile) {
          await get().refreshAfterCatalogMutation({ syncCatalog: false });
        }
      })
      .catch(() => {})
      .finally(() => {
        isHandlingRemoteSync = false;
        const nextKind = queuedRemoteSyncKind;
        queuedRemoteSyncKind = null;
        if (nextKind) {
          lastHandledSyncByKind.delete(nextKind);
          handleRemoteCatalogOrProfileSync(nextKind);
        }
      });
  };

  subscribeCrossWindowSync((msg) => {
    if (msg.kind === "settings") {
      scheduleRemoteSettingsApply();
    } else if (msg.kind === "live-visual" && msg.patch) {
      applyLiveVisualPatch(set, msg.patch);
    } else if (
      msg.kind === "catalog" ||
      msg.kind === "profile" ||
      msg.kind === "backgrounds"
    ) {
      handleRemoteCatalogOrProfileSync(msg.kind, msg.msgId);
    }
  });

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (
        !e.key ||
        !e.key.startsWith(AUDIFY_STORAGE_KEY_PREFIX) ||
        isLocalKeyRecentlyEdited(e.key)
      ) {
        return;
      }
      scheduleRemoteSettingsApply();
    });
  }

  if (isStandaloneSettingsWindow()) {
    listen<string>("audify:settings-select-tab", (event) => {
      if (event.payload) {
        set({
          settingsTab: normalizeSettingsTab(event.payload),
          isSettingsOpen: true,
          isSettingsWindowVisible: true,
        });
      }
    }).catch(() => {});

    listen<boolean>("audify:settings-visibility", (event) => {
      if (event.payload === false) {
        set({ isSettingsWindowVisible: false });
        releaseSettingsWindowCaches();
      } else if (event.payload === true) {
        set({ isSettingsWindowVisible: true, isSettingsOpen: true });
      }
    }).catch(() => {});
  }

  listen<{ source: string; kind: string; msgId?: string | null }>(
    "audify:cross-window-sync",
    (event) => {
      const selfLabel = isStandaloneSettingsWindow() ? "settings" : "main";
      if (event.payload && event.payload.source !== selfLabel) {
        handleRemoteCatalogOrProfileSync(
          event.payload.kind,
          event.payload.msgId ?? undefined
        );
      }
    }
  ).catch(() => {});

  if (!isStandaloneSettingsWindow()) {
    listen<MainFilterRequest>(APPLY_MAIN_FILTER_EVENT, (event) => {
      if (event.payload) {
        get().applyMainFilterRequest(event.payload);
      }
    }).catch(() => {});

    let watcherRefreshInFlight = false;
    let queuedWatcherPayload: {
      library_id: number;
      library_path: string;
      sample_count: number;
    } | null = null;
    const processWatcherRefresh = (payload: {
      library_id: number;
      library_path: string;
      sample_count: number;
    }) => {
      if (get().isScanning) return;
      if (watcherRefreshInFlight) {
        queuedWatcherPayload = payload;
        return;
      }
      watcherRefreshInFlight = true;
      clearPeaksCache();
      clearHiResPeaksCache();
      clearSmartSearchCache();
      void get()
        .refreshAfterCatalogMutation()
        .then(() => {
          const folderLeaf =
            payload.library_path.split(/[\\/]/).filter(Boolean).pop() ||
            "Library";
          set({
            statusMessage: `Live Watcher synced "${folderLeaf}" (${payload.sample_count} samples)`,
          });
        })
        .catch(() => {})
        .finally(() => {
          watcherRefreshInFlight = false;
          const next = queuedWatcherPayload;
          queuedWatcherPayload = null;
          if (next) {
            processWatcherRefresh(next);
          }
        });
    };

    listen<{
      library_id: number;
      library_path: string;
      sample_count: number;
    }>("audify:library-fs-changed", (event) => {
      if (event.payload) {
        processWatcherRefresh(event.payload);
      }
    }).catch(onError("audify:library-fs-changed listener"));

    // Progressive UI refresh during large incremental batch scans (throttled ~2.5s, non-overlapping)
    let scanBatchRefreshInFlight = false;
    let lastScanBatchRefreshAt = 0;
    listen<{ library_id: number; committed: number }>(
      "scan-batch-committed",
      () => {
        if (!get().isScanning || scanBatchRefreshInFlight) return;
        const now = Date.now();
        if (now - lastScanBatchRefreshAt < 2500) return;
        const startEpoch = getProfileEpoch();
        scanBatchRefreshInFlight = true;
        lastScanBatchRefreshAt = now;
        void get()
          .refreshAfterCatalogMutation({ syncCatalog: false })
          .catch(() => {})
          .finally(() => {
            scanBatchRefreshInFlight = false;
            if (startEpoch !== getProfileEpoch()) {
              lastScanBatchRefreshAt = 0;
            }
          });
      }
    ).catch(onError("scan-batch-committed listener"));
  }

  listen<ScanProgressPayload>("scan-progress", (event) => {
    set({
      scanProgress: event.payload,
      isScanning: event.payload.processed < event.payload.total,
    });
  }).catch(onError("scan-progress listener"));

  listen<BpmKeyProgressPayload>("bpm-key-progress", (event) => {
    set({
      bpmKeyProgress: event.payload,
      isAnalyzingBpmKey:
        event.payload.total > 0 && event.payload.processed < event.payload.total,
    });
  }).catch(onError("bpm-key-progress listener"));

  listen<AiDownloadProgressPayload>("ai-download-progress", (event) => {
    const stage = (event.payload.stage || "").toLowerCase();
    const isTerminal =
      stage === "done" ||
      stage === "complete" ||
      stage === "completed" ||
      stage === "cancelled" ||
      stage === "canceled" ||
      stage === "error" ||
      stage === "failed" ||
      event.payload.percentage >= 100;
    set({
      aiDownloadProgress: isTerminal ? null : event.payload,
      isDownloadingAiModel: !isTerminal,
    });
  }).catch(onError("ai-download-progress listener"));

  listen<AiIndexProgressPayload>("ai-index-progress", (event) => {
    set({
      aiIndexProgress: event.payload,
      isAnalyzingAi:
        event.payload.total > 0 && event.payload.processed < event.payload.total,
    });
  }).catch(onError("ai-index-progress listener"));

  listen<DuplicateScanProgressPayload>("duplicate-scan-progress", (event) => {
    set((state) =>
      state.isScanningDuplicates
        ? { duplicateScanProgress: event.payload }
        : state
    );
  }).catch(onError("duplicate-scan-progress listener"));
}
