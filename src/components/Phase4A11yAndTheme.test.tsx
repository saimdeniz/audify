// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCENT_COLORS } from "../constants/palettes";
import {
  computeAccentOnColor,
  hexToRgbTriplet,
  normalizeAccentForTheme,
  srgbRelativeLuminance,
  wcagContrastRatio,
} from "../constants/themePalettes";
import { applyThemeAndAccentToDom } from "../store/themeDom";
import { useSampleStore } from "../store/useSampleStore";
import type { ThemeMode } from "../types";
import { EmptyTrashConfirmModal } from "./modals/EmptyTrashConfirmModal";
import { BatchRenameModal } from "./modals/BatchRenameModal";
import { QuickCreatePopover } from "./QuickCreatePopover";
import { useActiveDrawerFilterCount } from "./sample-table/FilterDrawer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function FilterCountProbe() {
  const count = useActiveDrawerFilterCount();
  return <span data-testid="drawer-filter-count">{count}</span>;
}

describe("Phase 4: WCAG 2.1 AA contrast, dialog a11y, and UI consistency", () => {
  beforeEach(() => {
    useSampleStore.setState({
      favoriteOnly: false,
      recentOnly: false,
      binFilterActive: false,
      slicesFilterActive: false,
      layersFilterActive: false,
      duplicatesFilterActive: false,
      trashFilterActive: false,
      typeFilter: "all",
      srFilter: null,
      selectedGenre: null,
      selectedTagIds: [],
      excludedTagIds: [],
      searchQuery: "",
      batchRenameSampleIds: null,
      batchRenameSliceIds: null,
      batchRenameLayerIds: null,
      layerHistory: [],
    });
  });

  it("achieves WCAG 2.1 AA (>= 4.5:1) for computeAccentOnColor across every accent preset and theme mode", () => {
    const modes: ThemeMode[] = ["dark", "light", "contrast"];
    for (const mode of modes) {
      for (const preset of ACCENT_COLORS) {
        const effective = normalizeAccentForTheme(preset.hex, mode);
        const [ar, ag, ab] = hexToRgbTriplet(effective);
        const accentLum = srgbRelativeLuminance(ar, ag, ab);
        const onHex = computeAccentOnColor(mode, preset.hex);
        const [or, og, ob] = hexToRgbTriplet(onHex);
        const onLum = srgbRelativeLuminance(or, og, ob);
        const ratio = wcagContrastRatio(accentLum, onLum);
        expect(
          ratio,
          `${preset.name} (${effective}) on ${mode} with ${onHex}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("guarantees --accent-fg-rgb meets WCAG 2.1 AA (>= 4.5:1) across dark, light, and contrast surfaces", () => {
    const surfaceLumByMode: Record<ThemeMode, number> = {
      dark: srgbRelativeLuminance(24, 24, 28), // #18181C
      light: srgbRelativeLuminance(234, 236, 239), // #EAECEF
      contrast: srgbRelativeLuminance(5, 5, 5), // #050505
    };

    for (const mode of ["dark", "light", "contrast"] as ThemeMode[]) {
      for (const preset of ACCENT_COLORS) {
        applyThemeAndAccentToDom(mode, preset.hex);
        const raw = document.documentElement.style
          .getPropertyValue("--accent-fg-rgb")
          .trim();
        const [r, g, b] = raw.split(/\s+/).map(Number);
        const ratio = wcagContrastRatio(
          srgbRelativeLuminance(r, g, b),
          surfaceLumByMode[mode]
        );
        expect(
          ratio,
          `${preset.name} --accent-fg-rgb (${raw}) on ${mode}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("renders EmptyTrashConfirmModal as alertdialog and focuses Cancel instead of destructive Empty", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <EmptyTrashConfirmModal
        isOpen={true}
        trashedCount={4}
        trashedTotalBytes={2048}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    const alertDialog = screen.getByRole("alertdialog", {
      name: "Empty Recycle Bin",
    });
    expect(alertDialog).toBeTruthy();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it("renders BatchRenameModal with layer-specific header and DAW relink warning in layer mode", () => {
    useSampleStore.setState({
      batchRenameLayerIds: [42],
      layerHistory: [
        {
          id: 42,
          layer_name: "Impact_Boom.wav",
          layer_path: "F:\\Audify\\user\\layers\\Impact_Boom.wav",
          duration_ms: 1800,
          lane_count: 2,
          clip_count: 2,
          sample_rate: 48000,
          channels: 2,
          bit_depth: 24,
          recipe_json: "{}",
          peaks_json: "[]",
          is_favorite: false,
          created_at: "2026-11-27T00:00:00Z",
          updated_at: "2026-11-27T00:00:00Z",
          file_exists: true,
        },
      ],
    });
    render(<BatchRenameModal />);
    expect(screen.getByText("RENAME LAYER")).toBeTruthy();
    expect(
      screen.getByText(/DAW timeline clips referencing the old name may need relinking/i)
    ).toBeTruthy();
  });

  it("counts layersFilterActive in useActiveDrawerFilterCount", () => {
    render(<FilterCountProbe />);
    expect(screen.getByTestId("drawer-filter-count").textContent).toBe("0");
    act(() => {
      useSampleStore.setState({ layersFilterActive: true });
    });
    expect(screen.getByTestId("drawer-filter-count").textContent).toBe("1");
  });

  it("uses dynamic Save submit label on QuickCreatePopover when title starts with Save", () => {
    render(
      <QuickCreatePopover
        title="Save Slice"
        defaultValue="kick_01"
        onCreated={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Slice" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
