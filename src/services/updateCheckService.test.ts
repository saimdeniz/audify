// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../constants/appInfo";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  checkForAppUpdates,
  dismissUpdateBanner,
  getAppUpdateSnapshot,
  openAudifyReleasesPage,
  resetAppUpdateStateForTest,
  setAutoCheckUpdates,
} from "./updateCheckService";

describe("updateCheckService", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
    resetAppUpdateStateForTest();
  });

  afterEach(() => {
    localStorage.clear();
    resetAppUpdateStateForTest();
  });

  it("caches update check results for 6 hours and skips duplicate network calls unless forced", async () => {
    invokeMock.mockResolvedValue({
      current_version: APP_VERSION,
      latest_version: "1.0.5",
      has_update: true,
      release_url: "https://github.com/saimdeniz/audify/releases/tag/v1.0.5",
      release_name: "Audify v1.0.5",
      published_at: "2026-11-27T00:00:00Z",
    });

    await checkForAppUpdates();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(getAppUpdateSnapshot().isBannerVisible).toBe(true);
    expect(getAppUpdateSnapshot().info?.latest_version).toBe("1.0.5");

    // Second non-forced check hits 6h cache
    await checkForAppUpdates({ force: false });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Forced check bypasses cache
    await checkForAppUpdates({ force: true });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("dismisses banner per-version and re-shows automatically when a newer release arrives", async () => {
    invokeMock.mockResolvedValueOnce({
      current_version: APP_VERSION,
      latest_version: "1.0.5",
      has_update: true,
      release_url: "https://github.com/saimdeniz/audify/releases/tag/v1.0.5",
      release_name: "v1.0.5",
      published_at: "",
    });
    await checkForAppUpdates({ force: true });
    expect(getAppUpdateSnapshot().isBannerVisible).toBe(true);

    dismissUpdateBanner("1.0.5");
    expect(getAppUpdateSnapshot().isBannerVisible).toBe(false);
    expect(getAppUpdateSnapshot().info?.has_update).toBe(true);

    // Newer version 1.0.6 re-shows banner cleanly
    invokeMock.mockResolvedValueOnce({
      current_version: APP_VERSION,
      latest_version: "1.0.6",
      has_update: true,
      release_url: "https://github.com/saimdeniz/audify/releases/tag/v1.0.6",
      release_name: "v1.0.6",
      published_at: "",
    });
    await checkForAppUpdates({ force: true });
    expect(getAppUpdateSnapshot().isBannerVisible).toBe(true);
  });

  it("persists auto-check toggle and forwards safe GitHub URLs to open_github_url", async () => {
    expect(getAppUpdateSnapshot().autoCheckEnabled).toBe(true);
    setAutoCheckUpdates(false);
    expect(getAppUpdateSnapshot().autoCheckEnabled).toBe(false);
    expect(localStorage.getItem(AUDIFY_STORAGE_KEYS.autoCheckUpdates)).toBe(
      "false"
    );

    invokeMock.mockResolvedValueOnce(undefined);
    await openAudifyReleasesPage("https://evil.example.com/phish");
    expect(invokeMock).toHaveBeenCalledWith("open_github_url", {
      url: "https://github.com/saimdeniz/audify/releases/latest",
    });
  });
});
