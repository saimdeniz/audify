import { invoke } from "@tauri-apps/api/core";
import type { AutoTagRule, ImportReport, Profile } from "../../types";
import type { AutoTagActionsDeps } from "./autoTagActions";
import type { BackupExportDeps } from "./backupExportActions";
import type { ProfileCrudDeps } from "./profileCrudActions";
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
  | "upgradeLegacyAutoTagRules"
  | "reapplyAutoTagRules"
  | "refreshAutoTagImpactPreview"
  | "undoLastAutoTagApply"
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

  let cachedProfileCrudActions: ReturnType<
    typeof import("./profileCrudActions").createProfileCrudActions
  > | null = null;
  const loadProfileCrudActions = async () => {
    if (!cachedProfileCrudActions) {
      const mod = await import("./profileCrudActions");
      const deps: ProfileCrudDeps = {
        set,
        get,
        applyProfileSettingsImmediately,
        buildCurrentProfileSettingsJson,
        bumpProfileEpoch,
        getProfileEpoch: ctx.getProfileEpoch,
        prepareForProfileTransition,
        resetFiltersOnProfileChange,
        emitNotice,
        flushPendingPersist,
        enqueueProfileTransition,
      };
      cachedProfileCrudActions = mod.createProfileCrudActions(deps);
    }
    return cachedProfileCrudActions;
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

    switchProfile: async (profileId: number) =>
      (await loadProfileCrudActions()).switchProfile(profileId),

    createProfile: async (name: string, color: string) =>
      (await loadProfileCrudActions()).createProfile(name, color),

    duplicateProfile: async (sourceProfileId: number, newName: string) =>
      (await loadProfileCrudActions()).duplicateProfile(sourceProfileId, newName),

    updateProfileInfo: async (
      profileId: number,
      name: string,
      color: string
    ) =>
      (await loadProfileCrudActions()).updateProfileInfo(profileId, name, color),

    deleteProfile: async (profileId: number) =>
      (await loadProfileCrudActions()).deleteProfile(profileId),

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
    upgradeLegacyAutoTagRules: async () =>
      (await loadAutoTagActions()).upgradeLegacyAutoTagRules(),
    reapplyAutoTagRules: async () =>
      (await loadAutoTagActions()).reapplyAutoTagRules(),
    refreshAutoTagImpactPreview: async () =>
      (await loadAutoTagActions()).refreshAutoTagImpactPreview(),
    undoLastAutoTagApply: async () =>
      (await loadAutoTagActions()).undoLastAutoTagApply(),
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
