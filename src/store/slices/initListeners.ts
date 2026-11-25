import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AUDIFY_STORAGE_KEY_PREFIX } from "../../constants/storageKeys";
import {
  AiDownloadProgressPayload,
  AiIndexProgressPayload,
  BatchJobProgressPayload,
  BpmKeyProgressPayload,
  DuplicateScanProgressPayload,
  Profile,
  ScanProgressPayload,
} from "../../types";
import { onError } from "../../utils/errors";
import { clearHiResPeaksCache } from "../../utils/hiResPeaks";
import { clearLocalEditedKeys } from "../../utils/localStorageSafe";
import { clearPeaksCache } from "../../utils/peaksStore";
import { clearSmartSearchCache } from "../../utils/smartSearch";
import { releaseSettingsWindowCaches } from "../../utils/wallpaperCleanup";
import {
  APPLY_MAIN_FILTER_EVENT,
  isLocalKeyRecentlyEdited,
  isStandaloneSettingsWindow,
  loadSavedSettingsTab,
  normalizeSettingsTab,
  subscribeCrossWindowSync,
} from "../storageHelpers";
import type { MainFilterRequest, StoreGet, StoreSet } from "../types";
import {
  applyLiveVisualPatch,
  applyRemoteSettingsFromStorage,
} from "./remoteVisualListeners";

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
        settingsTab: tabParam
          ? normalizeSettingsTab(tabParam)
          : loadSavedSettingsTab(),
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

  listen<BatchJobProgressPayload>("genre-detect-progress", (event) => {
    const p = event.payload;
    set({
      genreDetectProgress: p.done ? null : p,
      isDetectingGenres: !p.done,
    });
  }).catch(onError("genre-detect-progress listener"));

  listen<BatchJobProgressPayload>("auto-tag-progress", (event) => {
    const p = event.payload;
    set({
      autoTagProgress: p.done ? null : p,
      isApplyingAutoTags: !p.done,
    });
  }).catch(onError("auto-tag-progress listener"));
}
