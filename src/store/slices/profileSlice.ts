import { invoke } from "@tauri-apps/api/core";
import type { AutoTagRule } from "../../types";
import type { AutoTagActionsDeps } from "./autoTagActions";
import type { BackupExportDeps } from "./backupExportActions";
import { DEFAULT_AUTO_TAG_RULES } from "../../constants/autoTagRules";
import { DEFAULT_COLLECTION_TEMPLATES } from "../../constants/collections";
import {
  ImportReport,
  Profile,
  ProfileSettings,
} from "../../types";
import {
  AUDIFY_STORAGE_KEYS,
  parseProfileSettings,
  safeSetItem,
} from "../storageHelpers";
import { applyThemeAndAccentToDom } from "../themeDom";
import { SampleStoreState, StoreSliceContext } from "../types";

export type ImportedProfile = Profile & { report?: ImportReport };

let inFlightProfileTransition: Promise<void> = Promise.resolve();

function enqueueProfileTransition<T>(task: () => Promise<T>): Promise<T> {
  const run = inFlightProfileTransition.then(task, task);
  inFlightProfileTransition = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function describeImportReport(report?: ImportReport): string {
  if (!report) return "";
  const parts = [`${report.matched} linked`];
  if (report.unmatched > 0) parts.push(`${report.unmatched} not found`);
  if (report.ambiguous > 0) parts.push(`${report.ambiguous} ambiguous (skipped)`);
  return ` — ${parts.join(", ")}`;
}

const PERSIST_DEBOUNCE_MS = 350;

export function createProfileSlice(
  ctx: StoreSliceContext
): Pick<
  SampleStoreState,
  | "persistActiveProfileSettings"
  | "switchProfile"
  | "createProfile"
  | "duplicateProfile"
  | "updateProfileInfo"
  | "deleteProfile"
  | "addAutoTagRule"
  | "previewAutoTagRule"
  | "updateAutoTagRule"
  | "deleteAutoTagRule"
  | "resetAutoTagRules"
  | "reapplyAutoTagRules"
  | "setAutoTagCategoryPaths"
  | "addAutoTagCategory"
  | "renameAutoTagCategory"
  | "deleteAutoTagCategory"
  | "fetchLocalBackups"
  | "createQuickBackup"
  | "createFullSnapshotBackup"
  | "restoreLocalBackup"
  | "deleteLocalBackup"
  | "openBackupsFolder"
  | "exportSettingsJson"
  | "importSettingsJson"
  | "exportProfileJson"
  | "importProfileJson"
  | "exportFullSnapshot"
  | "openFullSnapshotRestorePrompt"
  | "clearPendingSnapshotRestore"
  | "confirmFullSnapshotRestore"
> {
  const {
    set,
    get,
    applyProfileSettingsImmediately,
    buildCurrentProfileSettingsJson,
    bumpProfileEpoch,
    prepareForProfileTransition,
    resetFiltersOnProfileChange,
    emitNotice,
  } = ctx;

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledPersistProfileId: number | null = null;
  let debouncedWaiters: Array<() => void> = [];
  let flushWaiters: Array<() => void> = [];
  let inFlightPersist: Promise<void> | null = null;
  let dirtyWhileInFlight = false;

  const promoteDebouncedWaiters = () => {
    if (debouncedWaiters.length === 0) return;
    flushWaiters.push(...debouncedWaiters);
    debouncedWaiters = [];
  };

  const resolveFlushWaiters = () => {
    const waiters = flushWaiters;
    flushWaiters = [];
    waiters.forEach((w) => w());
  };

  const flushPendingPersist = async (): Promise<void> => {
    if (persistTimer) {
      await get().persistActiveProfileSettings(true);
    } else if (inFlightPersist) {
      await inFlightPersist;
    }
  };

  const flushPersistQueue = (): Promise<void> => {
    if (inFlightPersist) {
      dirtyWhileInFlight = true;
      return inFlightPersist;
    }

    inFlightPersist = (async () => {
      do {
        dirtyWhileInFlight = false;
        const waiters = flushWaiters;
        flushWaiters = [];
        try {
          const { activeProfile, accentColor } = get();
          if (!activeProfile) {
            waiters.forEach((w) => w());
            continue;
          }
          const targetProfileId = activeProfile.id;
          const targetColor = accentColor;
          const settingsJson = buildCurrentProfileSettingsJson();
          const updated = await invoke<Profile>("update_profile", {
            profileId: targetProfileId,
            name: null,
            color: targetColor,
            settingsJson,
          });
          set((state) => ({
            // Only overwrite activeProfile if user hasn't switched away while update_profile was in flight!
            activeProfile:
              state.activeProfile?.id === updated.id
                ? updated
                : state.activeProfile,
            profiles: state.profiles.map((p) =>
              p.id === updated.id ? updated : p
            ),
          }));
        } catch (err) {
          console.error("Failed to persist active profile settings:", err);
        } finally {
          waiters.forEach((w) => w());
        }
      } while (dirtyWhileInFlight || flushWaiters.length > 0);
    })().finally(() => {
      inFlightPersist = null;
    });

    return inFlightPersist;
  };

  let cachedAutoTagActions: ReturnType<
    typeof import("./autoTagActions").createAutoTagActions
  > | null = null;
  const loadAutoTagActions = async () => {
    if (!cachedAutoTagActions) {
      const mod = await import("./autoTagActions");
      const deps: AutoTagActionsDeps = { set, get, emitNotice };
      cachedAutoTagActions = mod.createAutoTagActions(deps);
    }
    return cachedAutoTagActions;
  };

  let cachedBackupExportActions: ReturnType<
    typeof import("./backupExportActions").createBackupExportActions
  > | null = null;
  const loadBackupExportActions = async () => {
    if (!cachedBackupExportActions) {
      const mod = await import("./backupExportActions");
      const deps: BackupExportDeps = {
        set,
        get,
        applyProfileSettingsImmediately,
        buildCurrentProfileSettingsJson,
        bumpProfileEpoch,
        getProfileEpoch: ctx.getProfileEpoch,
        prepareForProfileTransition,
        emitNotice,
        flushPendingPersist,
        enqueueProfileTransition,
        resetFiltersOnProfileChange,
        describeImportReport,
      };
      cachedBackupExportActions = mod.createBackupExportActions(deps);
    }
    return cachedBackupExportActions;
  };

  return {
    // Debounced by default so slider drags (volume, blur, tint) do not hit SQLite per pixel.
    // Pass `true` when the caller needs the write to be durable before continuing.
    persistActiveProfileSettings: (immediate = false) =>
      new Promise<void>((resolve) => {
        if (persistTimer) {
          clearTimeout(persistTimer);
          persistTimer = null;
        }

        const expectedProfileId = get().activeProfile?.id ?? null;
        const fire = (isImmediate: boolean, profileAtSchedule: number | null) => {
          persistTimer = null;
          scheduledPersistProfileId = null;
          promoteDebouncedWaiters();
          // Guard against a debounced write waking up after a cross-window switch changed activeProfile.
          if (
            !isImmediate &&
            profileAtSchedule !== null &&
            get().activeProfile?.id !== profileAtSchedule
          ) {
            resolveFlushWaiters();
            return;
          }
          void flushPersistQueue();
        };

        if (immediate) {
          flushWaiters.push(resolve);
          scheduledPersistProfileId = null;
          fire(true, expectedProfileId);
        } else {
          debouncedWaiters.push(resolve);
          scheduledPersistProfileId = expectedProfileId;
          persistTimer = setTimeout(() => {
            fire(false, scheduledPersistProfileId);
          }, PERSIST_DEBOUNCE_MS);
        }
      }),

    switchProfile: (profileId: number) =>
      enqueueProfileTransition(async () => {
        await prepareForProfileTransition();
        await flushPendingPersist();
        const epoch = bumpProfileEpoch();

        try {
          const activated = await invoke<Profile>("switch_profile", {
            profileId,
          });
          if (epoch !== ctx.getProfileEpoch()) return;
          applyProfileSettingsImmediately(activated);
          resetFiltersOnProfileChange(
            `Switched workspace profile to "${activated.name}"`
          );
          await get().refreshAfterCatalogMutation();
          void get().fetchAiModelStatus();
        } catch (err) {
          console.error("Failed to switch profile:", err);
          emitNotice(`Profile switch error: ${String(err)}`, "error");
        }
      }),

    createProfile: (name: string, color: string) =>
      enqueueProfileTransition(async () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
          emitNotice("Profile name cannot be empty", "error");
          return;
        }
        await prepareForProfileTransition();
        await flushPendingPersist();
        const epoch = bumpProfileEpoch();

        try {
          const cleanColor = color || "#F59E0B";
          const defaultSettings: ProfileSettings = {
            themeMode: get().themeMode,
            accentColor: cleanColor,
            accentAuto: get().accentAuto,
            waveformSensitivity: get().waveformSensitivity,
            waveformStyle: get().waveformStyle,
            playheadLatencyMs: get().playheadLatencyMs,
            audioOutputDeviceId: get().audioOutputDeviceId,
            sliceMicroFade: get().sliceMicroFade,
            exportAudioPreset: get().exportAudioPreset,
            exportLoudnessMode: get().exportLoudnessMode,
            skipLeadingSilence: get().skipLeadingSilence,
            miniDockEdgePeek: get().miniDockEdgePeek,
            miniDockEdgeSide: get().miniDockEdgeSide,
            normalizePreview: get().normalizePreview,
            autoAnalyzeBpmKey: get().autoAnalyzeBpmKey,
            autoPreview: get().autoPreview,
            isLooping: get().isLooping,
            isShuffle: get().isShuffle,
            volume: get().volume,
            smartSearchSynonyms: get().smartSearchSynonyms,
            autoBinOnNleDrag: get().autoBinOnNleDrag,
            binSampleIds: [],
            enableMica: get().enableMica,
            sidebarCompactHover: get().sidebarCompactHover,
            themeTintIntensity: get().themeTintIntensity,
            customBgImage: "",
            customBgBlur: 0,
            customBgOpacity: 0.6,
            wallpaperKind: "none",
            asciiPreset: "moonlit",
            asciiMagicSlug: "",
            asciiMagicLook: "original",
            asciiMagicFit: get().asciiMagicFit,
            asciiMotionSpeed: 1,
            shortcuts: get().shortcuts,
            autoTagRules: [...DEFAULT_AUTO_TAG_RULES],
            autoTagCategories: [
              { name: "SFX", include_paths: [], exclude_paths: [] },
              { name: "Ambience", include_paths: [], exclude_paths: [] },
              { name: "Music", include_paths: [], exclude_paths: [] },
            ],
            enableLicensesSystem: false,
            licenseGroups: [],
            collectionTemplates: [...DEFAULT_COLLECTION_TEMPLATES],
            autoCreateCollectionSubfolders: false,
            autoRouteCollectionDrops: true,
            customSliceExportPath: "",
            enableAdvancedFileOps: get().enableAdvancedFileOps,
            confirmBeforeTrash: get().confirmBeforeTrash,
            enableLiveFolderWatch: get().enableLiveFolderWatch,
            aiAutoAnalyzeOnScan: get().aiAutoAnalyzeOnScan,
            aiTagConfidenceThreshold: get().aiTagConfidenceThreshold,
            aiTaggingMode: get().aiTaggingMode,
            aiKnnTagLearning: get().aiKnnTagLearning,
            aiSimilarityMinScore: get().aiSimilarityMinScore,
            aiSimilarityTopK: get().aiSimilarityTopK,
            aiSimilarityScope: get().aiSimilarityScope,
            aiSimilarityDurationMatch: get().aiSimilarityDurationMatch,
          };
          const created = await invoke<Profile>("create_profile", {
            name: trimmedName,
            color: cleanColor,
            settingsJson: JSON.stringify(defaultSettings),
          });
          if (epoch !== ctx.getProfileEpoch()) return;
          applyProfileSettingsImmediately(created);
          resetFiltersOnProfileChange(
            `Created and activated profile "${created.name}"`
          );
          emitNotice(`Created profile "${created.name}"`, "success");
          await get().refreshAfterCatalogMutation();
          void get().fetchAiModelStatus();
        } catch (err) {
          console.error("Failed to create profile:", err);
          emitNotice(`Create profile error: ${String(err)}`, "error");
        }
      }),

    duplicateProfile: (sourceProfileId: number, newName: string) =>
      enqueueProfileTransition(async () => {
        const trimmedName = newName.trim();
        if (!trimmedName) {
          emitNotice("Duplicate profile name cannot be empty", "error");
          return;
        }
        await prepareForProfileTransition();
        await flushPendingPersist();
        const epoch = bumpProfileEpoch();

        try {
          const duplicated = await invoke<Profile>("duplicate_profile", {
            sourceProfileId,
            newName: trimmedName,
          });
          if (epoch !== ctx.getProfileEpoch()) return;
          applyProfileSettingsImmediately(duplicated);
          resetFiltersOnProfileChange(
            `Duplicated profile as "${duplicated.name}"`
          );
          emitNotice(`Duplicated profile "${duplicated.name}"`, "success");
          await get().refreshAfterCatalogMutation();
          void get().fetchAiModelStatus();
        } catch (err) {
          console.error("Failed to duplicate profile:", err);
          emitNotice(`Duplicate profile error: ${String(err)}`, "error");
        }
      }),

    updateProfileInfo: (
      profileId: number,
      name: string,
      color: string
    ) =>
      enqueueProfileTransition(async () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
          emitNotice("Profile name cannot be empty", "error");
          return;
        }
        try {
          const isCurrentActive = get().activeProfile?.id === profileId;
          let settingsJson: string | null = null;
          if (isCurrentActive) {
            await flushPendingPersist();
            safeSetItem(AUDIFY_STORAGE_KEYS.accentColor, color);
            applyThemeAndAccentToDom(get().themeMode, color);
            set({ accentColor: color });
            settingsJson = buildCurrentProfileSettingsJson();
          } else {
            const target = get().profiles.find((p) => p.id === profileId);
            if (target) {
              const parsed = parseProfileSettings(target.settings_json);
              parsed.accentColor = color;
              settingsJson = JSON.stringify(parsed);
            }
          }

          const updated = await invoke<Profile>("update_profile", {
            profileId,
            name: trimmedName,
            color,
            settingsJson,
          });
          await get().refreshSidebarData();
          if (get().activeProfile?.id === profileId) {
            set({ activeProfile: updated });
          }
          set({ statusMessage: `Updated profile "${updated.name}"` });
        } catch (err) {
          console.error("Failed to update profile info:", err);
          emitNotice(`Update profile error: ${String(err)}`, "error");
        }
      }),

    deleteProfile: (profileId: number) =>
      enqueueProfileTransition(async () => {
        await prepareForProfileTransition();
        await flushPendingPersist();
        const epoch = bumpProfileEpoch();

        try {
          const nextActive = await invoke<Profile>("delete_profile", {
            profileId,
          });
          if (epoch !== ctx.getProfileEpoch()) return;
          applyProfileSettingsImmediately(nextActive);
          resetFiltersOnProfileChange(
            `Profile deleted. Active profile: "${nextActive.name}"`
          );
          emitNotice(
            `Profile deleted — switched to "${nextActive.name}"`,
            "info"
          );
          await get().refreshAfterCatalogMutation();
          void get().fetchAiModelStatus();
        } catch (err) {
          console.error("Failed to delete profile:", err);
          emitNotice(`Delete profile error: ${String(err)}`, "error");
        }
      }),

    addAutoTagRule: async (
      tagName: string,
      tagColor: string,
      keywordsCsv: string,
      category?: string,
      includePathsCsv?: string,
      excludePathsCsv?: string,
      minDurationMs?: number,
      maxDurationMs?: number
    ) =>
      (await loadAutoTagActions()).addAutoTagRule(
        tagName,
        tagColor,
        keywordsCsv,
        category,
        includePathsCsv,
        excludePathsCsv,
        minDurationMs,
        maxDurationMs
      ),
    previewAutoTagRule: async (rule: AutoTagRule) =>
      (await loadAutoTagActions()).previewAutoTagRule(rule),
    updateAutoTagRule: async (ruleId: string, patch: Partial<AutoTagRule>) =>
      (await loadAutoTagActions()).updateAutoTagRule(ruleId, patch),
    deleteAutoTagRule: async (ruleId: string) =>
      (await loadAutoTagActions()).deleteAutoTagRule(ruleId),
    resetAutoTagRules: async () =>
      (await loadAutoTagActions()).resetAutoTagRules(),
    reapplyAutoTagRules: async () =>
      (await loadAutoTagActions()).reapplyAutoTagRules(),
    setAutoTagCategoryPaths: async (
      categoryName: string,
      includePaths: string[],
      excludePaths: string[]
    ) =>
      (await loadAutoTagActions()).setAutoTagCategoryPaths(
        categoryName,
        includePaths,
        excludePaths
      ),
    addAutoTagCategory: async (name: string) =>
      (await loadAutoTagActions()).addAutoTagCategory(name),
    renameAutoTagCategory: async (oldName: string, newName: string) =>
      (await loadAutoTagActions()).renameAutoTagCategory(oldName, newName),
    deleteAutoTagCategory: async (name: string) =>
      (await loadAutoTagActions()).deleteAutoTagCategory(name),

    fetchLocalBackups: async () =>
      (await loadBackupExportActions()).fetchLocalBackups(),
    createQuickBackup: async (isAuto?: boolean, includeAiTags?: boolean) =>
      (await loadBackupExportActions()).createQuickBackup(isAuto, includeAiTags),
    createFullSnapshotBackup: async () =>
      (await loadBackupExportActions()).createFullSnapshotBackup(),
    restoreLocalBackup: async (filePath: string) =>
      (await loadBackupExportActions()).restoreLocalBackup(filePath),
    deleteLocalBackup: async (filePath: string) =>
      (await loadBackupExportActions()).deleteLocalBackup(filePath),
    openBackupsFolder: async () =>
      (await loadBackupExportActions()).openBackupsFolder(),
    exportSettingsJson: async () =>
      (await loadBackupExportActions()).exportSettingsJson(),
    importSettingsJson: async () =>
      (await loadBackupExportActions()).importSettingsJson(),
    exportProfileJson: async (
      profileId?: number,
      options?: boolean | { shareSafe?: boolean; includeAiTags?: boolean }
    ) =>
      (await loadBackupExportActions()).exportProfileJson(profileId, options),
    importProfileJson: async () =>
      (await loadBackupExportActions()).importProfileJson(),
    exportFullSnapshot: async () =>
      (await loadBackupExportActions()).exportFullSnapshot(),
    openFullSnapshotRestorePrompt: async (filePath?: string) =>
      (await loadBackupExportActions()).openFullSnapshotRestorePrompt(filePath),
    clearPendingSnapshotRestore: () => set({ pendingSnapshotRestore: null }),
    confirmFullSnapshotRestore: async () =>
      (await loadBackupExportActions()).confirmFullSnapshotRestore(),
  };
}
