// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../../types";

const invokeMock = vi.fn();
let syncHandler: ((msg: { kind: string; patch?: Record<string, unknown> }) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../storageHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storageHelpers")>();
  return {
    ...actual,
    isStandaloneSettingsWindow: () => false,
    subscribeCrossWindowSync: (handler: (msg: { kind: string }) => void) => {
      syncHandler = handler;
      return () => {
        syncHandler = null;
      };
    },
  };
});

import { preserveRecentLocalProfileFields } from "../remoteSettingsSync";
import { AUDIFY_STORAGE_KEYS, safeRemoveItem, safeSetItem } from "../storageHelpers";
import { useSampleStore } from "../useSampleStore";
import { registerStoreListenersOnce } from "./initListeners";

describe("initListeners remote profile sync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("bumps profile epoch, resets active view filters, and refreshes catalog when Settings switches profiles", async () => {
    const profileA: Profile = {
      id: 1,
      name: "Studio",
      color: "#F59E0B",
      settings_json: "{}",
      is_active: true,
      created_at: "2026-10-27",
    };
    const profileB: Profile = {
      id: 2,
      name: "Editor",
      color: "#38BDF8",
      settings_json: "{}",
      is_active: true,
      created_at: "2026-11-15",
    };

    const refreshAfterCatalogMutation = vi.fn().mockResolvedValue(undefined);
    const bumpProfileEpoch = vi.fn(() => 2);
    const resetFiltersOnProfileChange = vi.fn();
    const applyProfileSettingsImmediately = vi.fn();

    useSampleStore.setState({
      activeProfile: profileA,
      profiles: [profileA],
      accentColor: "#F59E0B",
      favoriteOnly: true,
      refreshAfterCatalogMutation,
    });

    registerStoreListenersOnce({
      set: useSampleStore.setState,
      get: useSampleStore.getState,
      applyProfileSettingsImmediately,
      bumpProfileEpoch,
      resetFiltersOnProfileChange,
    });

    invokeMock.mockResolvedValueOnce([{ ...profileA, is_active: false }, profileB]);
    expect(syncHandler).not.toBeNull();
    syncHandler?.({ kind: "catalog" });

    await vi.waitFor(() => {
      expect(refreshAfterCatalogMutation).toHaveBeenCalledTimes(1);
    });

    expect(bumpProfileEpoch).toHaveBeenCalledTimes(1);
    expect(resetFiltersOnProfileChange).toHaveBeenCalledWith(
      'Switched workspace profile to "Editor"'
    );
    expect(useSampleStore.getState().activeProfile?.id).toBe(2);
  });

  it("applies remote live-visual themeMode patches and protects recently edited non-visual/AI settings from snap-back", () => {
    const prevTheme = document.documentElement.getAttribute("data-theme");

    try {
      useSampleStore.setState({
        themeMode: "dark",
        accentColor: "#F59E0B",
        volume: 0.25,
        aiTagConfidenceThreshold: 0.85,
      });

      registerStoreListenersOnce({
        set: useSampleStore.setState,
        get: useSampleStore.getState,
        applyProfileSettingsImmediately: vi.fn(),
        bumpProfileEpoch: vi.fn(() => 3),
        resetFiltersOnProfileChange: vi.fn(),
      });

      expect(syncHandler).not.toBeNull();
      syncHandler?.({ kind: "live-visual", patch: { themeMode: "light" } });
      expect(useSampleStore.getState().themeMode).toBe("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");

      // Mark volume & AI threshold as recently edited locally while remote state differs
      safeSetItem(AUDIFY_STORAGE_KEYS.volume, "0.25", { broadcast: false });
      safeSetItem(AUDIFY_STORAGE_KEYS.aiTagConfidenceThreshold, "0.85", {
        broadcast: false,
      });
      const guarded = preserveRecentLocalProfileFields(useSampleStore.getState(), {
        volume: 0.9,
        preMuteVolume: 0.9,
        aiTagConfidenceThreshold: 0.55,
        waveformSensitivity: "linear" as const,
      });
      expect(guarded.volume).toBe(0.25);
      expect(guarded.aiTagConfidenceThreshold).toBe(0.85);
      expect(guarded.waveformSensitivity).toBe("linear");
    } finally {
      if (prevTheme === null) {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", prevTheme);
      }
      safeRemoveItem(AUDIFY_STORAGE_KEYS.volume, {
        broadcast: false,
        markEdited: false,
      });
      safeRemoveItem(AUDIFY_STORAGE_KEYS.aiTagConfidenceThreshold, {
        broadcast: false,
        markEdited: false,
      });
    }
  });
});
