// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { APP_VERSION } from "../../constants/appInfo";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

describe("SettingsSidebarNav UI component", () => {
  afterEach(() => {
    cleanup();
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
    expect(screen.getByText(`v${APP_VERSION}`)).toBeTruthy();
  });
});
