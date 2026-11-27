import type { LicenseGroup, SampleItem } from "../../types";
import { invokeCommand } from "../../utils/tauriCommands";
import {
  AUDIFY_STORAGE_KEYS,
  persistNavigationFilters,
  safeSetItem,
} from "../storageHelpers";
import type { StoreSliceContext } from "../types";

export function createLicenseActions(
  ctx: StoreSliceContext,
  registerClearToastTimer: (fn: () => void) => void
) {
  const { set, get, applyInstantMemoryFilter, getProfileEpoch } = ctx;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let licenseCountsSeq = 0;

  const clearToastTimer = () => {
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  };
  const scheduleCreditToastDismiss = (delayMs: number) => {
    clearToastTimer();
    toastTimer = setTimeout(() => {
      set({ creditToast: null });
    }, delayMs);
  };
  registerClearToastTimer(clearToastTimer);

  let cachedCrud: ReturnType<
    typeof import("./licenseCrudActions").createLicenseCrudActions
  > | null = null;
  const loadCrud = async () => {
    if (!cachedCrud) {
      const mod = await import("./licenseCrudActions");
      cachedCrud = mod.createLicenseCrudActions({
        ctx,
        clearToastTimer,
        scheduleCreditToastDismiss,
      });
    }
    return cachedCrud;
  };

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

    addLicenseGroup: async (groupData: Omit<LicenseGroup, "id">) =>
      (await loadCrud()).addLicenseGroup(groupData),

    updateLicenseGroup: async (
      groupId: string,
      patch: Partial<Omit<LicenseGroup, "id">>
    ) => (await loadCrud()).updateLicenseGroup(groupId, patch),

    deleteLicenseGroup: async (groupId: string) =>
      (await loadCrud()).deleteLicenseGroup(groupId),

    pickFolderForLicenseGroup: async () =>
      (await loadCrud()).pickFolderForLicenseGroup(),

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

    copyAttributionForSamples: async (targetSamples?: SampleItem[]) =>
      (await loadCrud()).copyAttributionForSamples(targetSamples),

    clearCreditToast: () => {
      clearToastTimer();
      set({ creditToast: null });
    },

    pauseCreditToast: () => {
      clearToastTimer();
    },

    resumeCreditToast: () => {
      scheduleCreditToastDismiss(2200);
    },
  };
}
