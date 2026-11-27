// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { APP_VERSION, AUDIFY_RELEASES_LATEST_URL } from "../../constants/appInfo";
import { AUDIFY_STORAGE_KEYS } from "../../constants/storageKeys";
import { resetAppUpdateStateForTest } from "../../services/updateCheckService";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("SettingsSidebarNav UI component", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    resetAppUpdateStateForTest();
    invokeMock.mockClear();
  });

  it("renders settings groups in General -> Library & Tags -> Local AI -> System order", () => {
    const onSelectTab = vi.fn();
    const { container } = render(
      <SettingsSidebarNav
        settingsTab="ai"
        enableLicensesSystem={true}
        enableAdvancedFileOps={false}
        onSelectTab={onSelectTab}
      />
    );

    const groupTitles = ["GENERAL", "LIBRARY & TAGS", "LOCAL AI", "SYSTEM"];
    const textOrder = container.textContent ?? "";
    let prevPos = -1;
    for (const title of groupTitles) {
      const idx = textOrder.indexOf(title);
      expect(idx).toBeGreaterThan(prevPos);
      prevPos = idx;
    }

    fireEvent.click(screen.getByRole("button", { name: "Licenses" }));
    expect(onSelectTab).toHaveBeenCalledWith("licenses");

    const versionBtn = screen.getByText(`v${APP_VERSION}`).closest("button")!;
    fireEvent.click(versionBtn);
    expect(invokeMock).toHaveBeenCalledWith("open_github_url", {
      url: AUDIFY_RELEASES_LATEST_URL,
    });
  });

  it("displays a minimal Update button above the version row when a newer GitHub release is cached", () => {
    localStorage.setItem(
      AUDIFY_STORAGE_KEYS.updateCheckCacheV1,
      JSON.stringify({
        checkedAt: Date.now(),
        info: {
          current_version: APP_VERSION,
          latest_version: "1.0.5",
          has_update: true,
          release_url: "https://github.com/saimdeniz/audify/releases/tag/v1.0.5",
          release_name: "v1.0.5",
          published_at: "",
        },
      })
    );
    resetAppUpdateStateForTest();

    render(
      <SettingsSidebarNav
        settingsTab="advanced"
        enableLicensesSystem={false}
        enableAdvancedFileOps={false}
        onSelectTab={vi.fn()}
      />
    );

    const updateBtn = screen.getByText("Update · v1.0.5").closest("button")!;
    fireEvent.click(updateBtn);
    expect(invokeMock).toHaveBeenCalledWith("open_github_url", {
      url: "https://github.com/saimdeniz/audify/releases/tag/v1.0.5",
    });
  });
});
