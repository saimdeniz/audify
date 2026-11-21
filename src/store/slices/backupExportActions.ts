import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BackupFileInfo,
  FullSnapshotManifest,
  FullSnapshotRestoreResult,
  Profile,
} from "../../types";
import { postCrossWindowSync } from "../crossWindowSync";
import type { StoreSliceContext } from "../types";
import type { ImportedProfile } from "./profileSlice";

export interface BackupExportDeps {
  set: StoreSliceContext["set"];
  get: StoreSliceContext["get"];
  applyProfileSettingsImmediately: StoreSliceContext["applyProfileSettingsImmediately"];
  buildCurrentProfileSettingsJson: StoreSliceContext["buildCurrentProfileSettingsJson"];
  bumpProfileEpoch: StoreSliceContext["bumpProfileEpoch"];
  getProfileEpoch: StoreSliceContext["getProfileEpoch"];
  prepareForProfileTransition: StoreSliceContext["prepareForProfileTransition"];
  emitNotice: StoreSliceContext["emitNotice"];
  flushPendingPersist: () => Promise<void>;
  enqueueProfileTransition: <T>(task: () => Promise<T>) => Promise<T>;
  resetFiltersOnProfileChange: (statusMessage: string) => void;
  describeImportReport: (report?: ImportedProfile["report"]) => string;
}

export function createBackupExportActions(deps: BackupExportDeps) {
  const {
    set,
    get,
    applyProfileSettingsImmediately,
    buildCurrentProfileSettingsJson,
    bumpProfileEpoch,
    getProfileEpoch,
    prepareForProfileTransition,
    emitNotice,
    flushPendingPersist,
    enqueueProfileTransition,
    resetFiltersOnProfileChange,
    describeImportReport,
  } = deps;

  return {
    fetchLocalBackups: async () => {
      try {
        const backups = await invoke<BackupFileInfo[]>("list_backups");
        set({ localBackups: backups });
      } catch (err) {
        console.error("Failed to list backups:", err);
      }
    },

    createQuickBackup: async (isAuto = false, includeAiTags = true) => {
      try {
        const activePid = get().activeProfile?.id;
        const backup = await invoke<BackupFileInfo>("create_quick_backup", {
          profileId: activePid,
          isAuto,
          includeAiTags,
        });
        const backups = await invoke<BackupFileInfo[]>("list_backups");
        set({
          localBackups: backups,
          statusMessage: `${isAuto ? "Auto" : "Quick"} profile backup saved (${backup.file_name})`,
        });
        if (!isAuto) {
          emitNotice(`Profile backup saved (${backup.file_name})`, "success");
        }
      } catch (err) {
        console.error("Failed to create quick backup:", err);
        emitNotice(`Quick backup error: ${String(err)}`, "error");
      }
    },

    createFullSnapshotBackup: async () => {
      try {
        const backup = await invoke<BackupFileInfo>("create_full_snapshot_backup");
        const backups = await invoke<BackupFileInfo[]>("list_backups");
        set({
          localBackups: backups,
          statusMessage: `Full DB snapshot saved (${backup.file_name})`,
        });
        emitNotice(
          `Full DB snapshot saved (${backup.sample_count ?? 0} samples)`,
          "success"
        );
      } catch (err) {
        console.error("Failed to create full snapshot:", err);
        emitNotice(`Full DB snapshot error: ${String(err)}`, "error");
      }
    },

    restoreLocalBackup: (filePath: string) =>
      enqueueProfileTransition(async () => {
        await prepareForProfileTransition();
        await flushPendingPersist();
        const epoch = bumpProfileEpoch();

        try {
          const imported = await invoke<ImportedProfile>(
            "import_profile_from_file",
            {
              filePath,
            }
          );
          if (epoch !== getProfileEpoch()) return;
          applyProfileSettingsImmediately(imported);
          const msg = `Restored workspace profile "${imported.name}" from backup${describeImportReport(imported.report)}`;
          resetFiltersOnProfileChange(msg);
          emitNotice(msg, "success");
          await get().refreshAfterCatalogMutation();
        } catch (err) {
          console.error("Failed to restore backup:", err);
          emitNotice(`Restore backup failed: ${String(err)}`, "error");
        }
      }),

    deleteLocalBackup: async (filePath: string) => {
      try {
        await invoke("delete_backup_file", { filePath });
        const backups = await invoke<BackupFileInfo[]>("list_backups");
        set({
          localBackups: backups,
          statusMessage: "Backup file deleted",
        });
      } catch (err) {
        console.error("Failed to delete backup file:", err);
        emitNotice(`Delete backup failed: ${String(err)}`, "error");
      }
    },

    openBackupsFolder: async () => {
      try {
        await invoke("open_backups_folder");
      } catch (err) {
        console.error("Failed to open backups folder:", err);
        emitNotice(`Open backups folder failed: ${String(err)}`, "error");
      }
    },

    exportSettingsJson: async () => {
      try {
        const filePath = await save({
          title: "Export Audify Settings (.audify-settings.json)",
          defaultPath: "audify-settings.audify-settings.json",
          filters: [
            {
              name: "Audify Settings JSON",
              extensions: ["json", "audify-settings.json"],
            },
          ],
        });
        if (!filePath) return;

        const settingsJson = buildCurrentProfileSettingsJson();
        await invoke("export_settings_to_file", {
          filePath,
          settingsJson,
        });
        emitNotice(`Exported settings to ${filePath}`, "success");
      } catch (err) {
        console.error("Failed to export settings:", err);
        emitNotice(`Export settings failed: ${String(err)}`, "error");
      }
    },

    importSettingsJson: async () => {
      try {
        const selected = await open({
          multiple: false,
          directory: false,
          title: "Import Audify Settings (.audify-settings.json)",
          filters: [
            {
              name: "Audify Settings JSON",
              extensions: ["json"],
            },
          ],
        });
        if (!selected || typeof selected !== "string") return;

        await flushPendingPersist();
        const epoch = getProfileEpoch();
        const updatedProfile = await invoke<Profile>(
          "import_settings_from_file",
          {
            filePath: selected,
          }
        );
        if (epoch !== getProfileEpoch()) return;
        applyProfileSettingsImmediately(updatedProfile);
        await get().refreshAfterCatalogMutation();
        emitNotice(
          `Imported settings into profile "${updatedProfile.name}"`,
          "success"
        );
      } catch (err) {
        console.error("Failed to import settings:", err);
        emitNotice(`Import settings failed: ${String(err)}`, "error");
      }
    },

    exportProfileJson: async (
      profileId?: number,
      options?: boolean | { shareSafe?: boolean; includeAiTags?: boolean }
    ) => {
      const shareSafe =
        typeof options === "boolean" ? options : Boolean(options?.shareSafe);
      const includeAiTags =
        typeof options === "object" && options !== null
          ? Boolean(options.includeAiTags)
          : false;
      const targetId = profileId || get().activeProfile?.id;
      if (!targetId) return;
      const targetProfile =
        get().profiles.find((p) => p.id === targetId) || get().activeProfile;
      const safeSlug = (targetProfile?.name || "profile")
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-");

      try {
        await get().persistActiveProfileSettings(true);
        const suffix = includeAiTags ? "-with-ai" : "";
        const filePath = await save({
          title: includeAiTags
            ? "Export Workspace Profile + AI Tags (.audify-profile)"
            : "Export Workspace Profile (.audify-profile)",
          defaultPath: `${safeSlug}${suffix}.audify-profile`,
          filters: [
            {
              name: "Audify Workspace Profile (Compressed)",
              extensions: ["audify-profile"],
            },
            {
              name: "Audify Profile JSON (Uncompressed)",
              extensions: ["audify-profile.json", "json"],
            },
          ],
        });
        if (!filePath) return;

        await invoke("export_profile_to_file", {
          profileId: targetId,
          filePath,
          shareSafe,
          includeAiTags,
        });
        const detail = shareSafe
          ? " (share-safe, no personal paths)"
          : includeAiTags
          ? " (with AI-approved tags)"
          : "";
        emitNotice(
          `Exported profile "${targetProfile?.name}"${detail} to ${filePath}`,
          "success"
        );
      } catch (err) {
        console.error("Failed to export profile:", err);
        emitNotice(`Export profile failed: ${String(err)}`, "error");
      }
    },

    importProfileJson: async () => {
      try {
        const selected = await open({
          multiple: false,
          directory: false,
          title: "Import Audify Workspace Profile",
          filters: [
            {
              name: "Audify Workspace Profiles",
              extensions: ["audify-profile", "json", "zip"],
            },
          ],
        });
        if (!selected || typeof selected !== "string") return;

        await enqueueProfileTransition(async () => {
          await prepareForProfileTransition();
          await flushPendingPersist();
          const epoch = bumpProfileEpoch();

          const imported = await invoke<ImportedProfile>(
            "import_profile_from_file",
            {
              filePath: selected,
            }
          );
          if (epoch !== getProfileEpoch()) return;
          applyProfileSettingsImmediately(imported);
          const msg = `Imported & activated workspace profile "${imported.name}"${describeImportReport(imported.report)}`;
          resetFiltersOnProfileChange(msg);
          emitNotice(msg, "success");
          if (imported.report && imported.report.unmatched > 0) {
            console.info(
              "[Audify] Import: samples not found in current libraries:",
              imported.report.unmatched_samples
            );
          }
          await get().refreshAfterCatalogMutation({ syncCatalog: true });
        });
      } catch (err) {
        console.error("Failed to import profile:", err);
        emitNotice(`Import profile failed: ${String(err)}`, "error");
      }
    },

    exportFullSnapshot: async () => {
      try {
        await get().persistActiveProfileSettings(true);
        const stamp = new Date().toISOString().slice(0, 10);
        const filePath = await save({
          title: "Export Full Library Snapshot (.audify-backup.zip)",
          defaultPath: `audify-library-snapshot-${stamp}.audify-backup.zip`,
          filters: [
            {
              name: "Audify Full Library Snapshot",
              extensions: ["audify-backup.zip", "zip"],
            },
          ],
        });
        if (!filePath) return;

        const manifest = await invoke<FullSnapshotManifest>(
          "export_full_snapshot_to_file",
          { filePath }
        );
        emitNotice(
          `Saved full DB snapshot (${manifest.profile_count} profiles, ${manifest.sample_count.toLocaleString()} samples)`,
          "success"
        );
      } catch (err) {
        console.error("Failed to export full snapshot:", err);
        emitNotice(`Export full snapshot failed: ${String(err)}`, "error");
      }
    },

    openFullSnapshotRestorePrompt: async (explicitFilePath?: string) => {
      try {
        let targetPath = explicitFilePath;
        if (!targetPath) {
          const selected = await open({
            multiple: false,
            directory: false,
            title: "Select Full Library Snapshot (.audify-backup.zip)",
            filters: [
              {
                name: "Audify Full Library Snapshot",
                extensions: ["zip", "audify-backup.zip"],
              },
            ],
          });
          if (!selected || typeof selected !== "string") return;
          targetPath = selected;
        }
        const manifest = await invoke<FullSnapshotManifest>(
          "inspect_full_snapshot_file",
          { filePath: targetPath }
        );
        set({
          pendingSnapshotRestore: {
            filePath: targetPath,
            manifest,
          },
        });
      } catch (err) {
        console.error("Failed to inspect full snapshot:", err);
        emitNotice(`Invalid snapshot archive: ${String(err)}`, "error");
      }
    },

    clearPendingSnapshotRestore: () => {
      set({ pendingSnapshotRestore: null });
    },

    confirmFullSnapshotRestore: () =>
      enqueueProfileTransition(async () => {
        const pending = get().pendingSnapshotRestore;
        if (!pending) return;

        await prepareForProfileTransition();
        await flushPendingPersist();
        const epoch = bumpProfileEpoch();

        try {
          const res = await invoke<FullSnapshotRestoreResult>(
            "restore_full_snapshot_from_file",
            { filePath: pending.filePath }
          );
          if (epoch !== getProfileEpoch()) return;

          set({ pendingSnapshotRestore: null });
          applyProfileSettingsImmediately(res.active_profile);
          const msg = `Restored full snapshot (${res.profile_count} profiles, ${res.sample_count.toLocaleString()} samples)`;
          resetFiltersOnProfileChange(msg);
          emitNotice(msg, "success");

          await get().fetchLocalBackups();
          void get().loadCustomBgGallery();
          postCrossWindowSync("backgrounds");
          await get().refreshAfterCatalogMutation({
            syncCatalog: true,
            refreshTrash: true,
          });
        } catch (err) {
          console.error("Failed to restore full snapshot:", err);
          emitNotice(`Full snapshot restore failed: ${String(err)}`, "error");
        }
      }),
  };
}
