import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_AUTO_TAG_RULES } from "../../constants/autoTagRules";
import { DEFAULT_COLLECTION_TEMPLATES } from "../../constants/collections";
import type { Profile, ProfileSettings } from "../../types";
import {
  AUDIFY_STORAGE_KEYS,
  parseProfileSettings,
  safeSetItem,
} from "../storageHelpers";
import { applyThemeAndAccentToDom } from "../themeDom";
import type { StoreSliceContext } from "../types";

export interface ProfileCrudDeps {
  set: StoreSliceContext["set"];
  get: StoreSliceContext["get"];
  applyProfileSettingsImmediately: StoreSliceContext["applyProfileSettingsImmediately"];
  buildCurrentProfileSettingsJson: StoreSliceContext["buildCurrentProfileSettingsJson"];
  bumpProfileEpoch: StoreSliceContext["bumpProfileEpoch"];
  getProfileEpoch: StoreSliceContext["getProfileEpoch"];
  prepareForProfileTransition: StoreSliceContext["prepareForProfileTransition"];
  resetFiltersOnProfileChange: StoreSliceContext["resetFiltersOnProfileChange"];
  emitNotice: StoreSliceContext["emitNotice"];
  flushPendingPersist: () => Promise<void>;
  enqueueProfileTransition: <T>(task: () => Promise<T>) => Promise<T>;
}

export function createProfileCrudActions(deps: ProfileCrudDeps) {
  const {
    set,
    get,
    applyProfileSettingsImmediately,
    buildCurrentProfileSettingsJson,
    bumpProfileEpoch,
    getProfileEpoch,
    prepareForProfileTransition,
    resetFiltersOnProfileChange,
    emitNotice,
    flushPendingPersist,
    enqueueProfileTransition,
  } = deps;

  return {
    switchProfile: (profileId: number) =>
      enqueueProfileTransition(async () => {
        await prepareForProfileTransition();
        await flushPendingPersist();
        const epoch = bumpProfileEpoch();

        try {
          const activated = await invoke<Profile>("switch_profile", {
            profileId,
          });
          if (epoch !== getProfileEpoch()) return;
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
          if (epoch !== getProfileEpoch()) return;
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
          if (epoch !== getProfileEpoch()) return;
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

    updateProfileInfo: (profileId: number, name: string, color: string) =>
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
          if (epoch !== getProfileEpoch()) return;
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
  };
}
