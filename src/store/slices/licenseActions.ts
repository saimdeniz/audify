import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { LicenseGroup, SampleItem } from "../../types";
import { copyTextToClipboard, resolveTargetSamples } from "../../utils/clipboard";
import { generateBatchAttributionCredits } from "../../utils/format";
import { invokeCommand } from "../../utils/tauriCommands";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";

const MAX_METADATA_TITLES = 2000;

export function createLicenseActions(
  ctx: StoreSliceContext,
  registerClearToastTimer: (fn: () => void) => void
) {
  const { set, get, applyInstantMemoryFilter, emitNotice, getProfileEpoch } = ctx;
  const metadataTitleCache = new Map<string, string>();
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let licenseCountsSeq = 0;

  const clearToastTimer = () => {
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  };
  registerClearToastTimer(clearToastTimer);

  return {
    setEnableLicensesSystem: (enableLicensesSystem: boolean) => {
      safeSetItem(
        AUDIFY_STORAGE_KEYS.enableLicenses,
        String(enableLicensesSystem)
      );
      const shouldResetLicenseFilter =
        !enableLicensesSystem && get().selectedLicenseGroupId !== null;
      if (shouldResetLicenseFilter) {
        persistNavigationFilters(
          null,
          null,
          get().favoriteOnly,
          get().selectedCollectionId
        );
      }
      set({
        enableLicensesSystem,
        ...(shouldResetLicenseFilter
          ? { selectedLicenseGroupId: null, folderFilter: null }
          : {}),
        statusMessage: enableLicensesSystem
          ? "Enabled Licenses & Credits Attribution system"
          : "Disabled Licenses & Credits Attribution system",
      });
      if (shouldResetLicenseFilter) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }
      void get().persistActiveProfileSettings();
    },

    addLicenseGroup: async (groupData: Omit<LicenseGroup, "id">) => {
      const baseName = groupData.name.trim() || "Untitled Artist";
      let uniqueName = baseName;
      let suffix = 2;
      const existingLower = new Set(
        get().licenseGroups.map((g) => g.name.trim().toLowerCase())
      );
      while (existingLower.has(uniqueName.toLowerCase())) {
        uniqueName = `${baseName} (${suffix++})`;
      }

      const created: LicenseGroup = {
        ...groupData,
        id: `lic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: uniqueName,
        color: groupData.color || "#F59E0B",
        folders: groupData.folders || [],
        artists: groupData.artists || [],
        template: groupData.template.trim() || '"{title}" by {artist}',
        quoteMode: groupData.quoteMode || "auto",
      };
      const next = [...get().licenseGroups, created];
      safeSetItem(AUDIFY_STORAGE_KEYS.licenseGroups, JSON.stringify(next));
      set({
        licenseGroups: next,
        statusMessage: `Created license group "${created.name}"`,
      });
      await get().persistActiveProfileSettings(true);
      void get().refreshLicenseGroupCounts();
      return created;
    },

    updateLicenseGroup: async (
      groupId: string,
      patch: Partial<Omit<LicenseGroup, "id">>
    ) => {
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (trimmed) {
          const duplicate = get().licenseGroups.find(
            (g) =>
              g.id !== groupId &&
              g.name.trim().toLowerCase() === trimmed.toLowerCase()
          );
          if (duplicate) {
            emitNotice(`License group "${trimmed}" already exists`, "error");
            return;
          }
        }
      }
      const next = get().licenseGroups.map((g) =>
        g.id === groupId ? { ...g, ...patch } : g
      );
      safeSetItem(AUDIFY_STORAGE_KEYS.licenseGroups, JSON.stringify(next));
      set({ licenseGroups: next });
      if (get().selectedLicenseGroupId === groupId) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: true })) {
          void get().fetchSamples({ preserveMultiSelect: true });
        }
      }
      if (
        patch.folders !== undefined ||
        patch.rel_folders !== undefined ||
        patch.artists !== undefined
      ) {
        void get().refreshLicenseGroupCounts();
      }
      await get().persistActiveProfileSettings();
    },

    deleteLicenseGroup: async (groupId: string) => {
      const target = get().licenseGroups.find((g) => g.id === groupId);
      const next = get().licenseGroups.filter((g) => g.id !== groupId);
      safeSetItem(AUDIFY_STORAGE_KEYS.licenseGroups, JSON.stringify(next));
      const wasActive = get().selectedLicenseGroupId === groupId;
      if (wasActive) {
        persistNavigationFilters(
          null,
          null,
          get().favoriteOnly,
          get().selectedCollectionId
        );
      }
      set({
        licenseGroups: next,
        ...(wasActive
          ? { selectedLicenseGroupId: null, folderFilter: null }
          : {}),
        statusMessage: target
          ? `Deleted license group "${target.name}"`
          : "Deleted license group",
      });
      if (wasActive) {
        if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
          void get().fetchSamples({ preserveMultiSelect: false });
        }
      }
      void get().refreshLicenseGroupCounts();
      await get().persistActiveProfileSettings(true);
    },

    pickFolderForLicenseGroup: async () => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Select Artist / License Folder (Includes Subfolders)",
        });
        if (!selected || typeof selected !== "string") return null;
        return selected;
      } catch (err) {
        console.error("Failed to pick license folder:", err);
        return null;
      }
    },

    setLicenseGroupFilter: (
      groupId: string | null,
      subFolder: string | null = null
    ) => {
      persistNavigationFilters(subFolder, groupId, false, null);
      set({
        selectedLicenseGroupId: groupId,
        folderFilter: subFolder,
        favoriteOnly: false,
        recentOnly: false,
        binFilterActive: false,
        trashFilterActive: false,
        duplicatesFilterActive: false,
        slicesFilterActive: false,
        selectedCollectionId: null,
      });
      if (!applyInstantMemoryFilter({ preserveMultiSelect: false })) {
        void get().fetchSamples({ preserveMultiSelect: false });
      }
    },

    refreshLicenseGroupCounts: async () => {
      const groups = get().licenseGroups;
      const hasArtistLinked = groups.some((g) => (g.artists?.length ?? 0) > 0);
      if (!hasArtistLinked) {
        if (Object.keys(get().licenseGroupMatchCounts).length > 0) {
          set({ licenseGroupMatchCounts: {} });
        }
        return;
      }
      const reqSeq = ++licenseCountsSeq;
      const epoch = getProfileEpoch();
      try {
        const counts = await invokeCommand("count_license_group_matches", {
          groups: groups.map((g) => ({
            id: g.id,
            folders: g.folders,
            rel_folders: g.rel_folders ?? [],
            artists: g.artists ?? [],
          })),
        });
        if (reqSeq !== licenseCountsSeq || epoch !== getProfileEpoch()) {
          return;
        }
        set({
          licenseGroupMatchCounts:
            counts && typeof counts === "object" ? counts : {},
        });
      } catch (err) {
        console.error("Failed to compute license group match counts:", err);
      }
    },

    copyAttributionForSamples: async (targetSamples?: SampleItem[]) => {
      const {
        allProfileSamples,
        samples,
        selectedSampleIds,
        selectedSample,
        licenseGroups,
        creditToast,
      } = get();

      const list = resolveTargetSamples(
        allProfileSamples,
        samples,
        selectedSampleIds,
        selectedSample,
        targetSamples
      );

      if (list.length === 0) return;

      const metadataTitlesByPath: Record<string, string> = {};
      const missingPaths: string[] = [];
      for (const item of list) {
        const cached = metadataTitleCache.get(item.file_path);
        if (cached !== undefined) {
          metadataTitleCache.delete(item.file_path);
          metadataTitleCache.set(item.file_path, cached);
          metadataTitlesByPath[item.file_path] = cached;
        } else {
          missingPaths.push(item.file_path);
        }
      }

      if (missingPaths.length > 0) {
        try {
          const resolved = await invoke<Record<string, string>>(
            "resolve_metadata_titles",
            { filePaths: missingPaths }
          );
          for (const [path, title] of Object.entries(resolved)) {
            if (metadataTitleCache.size >= MAX_METADATA_TITLES) {
              const oldest = metadataTitleCache.keys().next().value;
              if (oldest !== undefined) metadataTitleCache.delete(oldest);
            }
            metadataTitleCache.set(path, title);
            metadataTitlesByPath[path] = title;
          }
        } catch {
          // Fallback to cleaned file_name
        }
      }

      const result = generateBatchAttributionCredits(
        list,
        licenseGroups,
        metadataTitlesByPath
      );
      const nextSeq = (creditToast?.seq || 0) + 1;
      clearToastTimer();

      if (result.matchedSampleCount === 0 || !result.text) {
        set({
          creditToast: {
            title: "No license rule matched selected track(s)",
            subtitle:
              "Link this artist folder or artist name in Settings > Licenses to generate attribution credits.",
            isWarning: true,
            seq: nextSeq,
          },
          statusMessage:
            "No matching license group found for selected track(s)",
        });
        toastTimer = setTimeout(() => {
          set({ creditToast: null });
        }, 4200);
        return;
      }

      await copyTextToClipboard(result.text);

      const trackWord = result.matchedSampleCount === 1 ? "track" : "tracks";
      const artistWord = result.artistCount === 1 ? "artist" : "artists";
      const summaryTitle = `Copied credits for ${result.matchedSampleCount} ${trackWord} (${result.artistCount} ${artistWord})`;
      const artistListLabel = result.groupsSummary
        .map((g) => `${g.group.name} (${g.titles.length})`)
        .join(" • ");
      const subtitle =
        result.unmatchedCount > 0
          ? `${artistListLabel} — ${result.unmatchedCount} unmatched skipped`
          : artistListLabel;

      set({
        creditToast: {
          title: summaryTitle,
          subtitle,
          previewText: result.text,
          isWarning: false,
          seq: nextSeq,
        },
        statusMessage: summaryTitle,
      });

      toastTimer = setTimeout(() => {
        set({ creditToast: null });
      }, 4500);
    },

    clearCreditToast: () => {
      clearToastTimer();
      set({ creditToast: null });
    },

    pauseCreditToast: () => {
      clearToastTimer();
    },

    resumeCreditToast: () => {
      clearToastTimer();
      toastTimer = setTimeout(() => {
        set({ creditToast: null });
      }, 2200);
    },
  };
}
