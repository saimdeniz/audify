import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS } from "../constants/shortcuts";
import {
  canonicalizeShortcut,
  formatShortcutDisplay,
  isHardwareMediaKey,
  isSafeGlobalShortcutInTextEntry,
  isTextEntryTarget,
  matchesShortcut,
  shouldBlurSearchInputOnPointerDown,
} from "./shortcuts";

describe("shortcuts matching & target guards", () => {
  it("matches single Space (' ') play/pause shortcut and ignores range sliders as text inputs", () => {
    const spaceDown = {
      key: " ",
      code: "Space",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchesShortcut(spaceDown, DEFAULT_SHORTCUTS.playPause)).toBe(true);
    expect(matchesShortcut(spaceDown, "Space")).toBe(true);
    expect(matchesShortcut({ ...spaceDown, ctrlKey: true }, " ")).toBe(false);
    expect(matchesShortcut({ ...spaceDown, ctrlKey: true }, "Ctrl+Space")).toBe(
      true
    );
    expect(
      matchesShortcut(
        {
          key: "m",
          code: "KeyM",
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        "Ctrl+M"
      )
    ).toBe(true);

    // Range sliders and buttons must NOT block global Space / Arrow shortcuts
    expect(
      isTextEntryTarget({
        tagName: "INPUT",
        type: "range",
        isContentEditable: false,
      } as unknown as HTMLElement)
    ).toBe(false);
    expect(
      isTextEntryTarget({
        tagName: "INPUT",
        type: "text",
        isContentEditable: false,
      } as unknown as HTMLElement)
    ).toBe(true);
    expect(
      isTextEntryTarget({
        tagName: "BUTTON",
        isContentEditable: false,
      } as unknown as HTMLElement)
    ).toBe(false);
  });

  it("matches Shift+Enter similarity shortcut and formats shortcuts cleanly", () => {
    const enterDown = {
      key: "Enter",
      code: "Enter",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
    };
    expect(matchesShortcut(enterDown, DEFAULT_SHORTCUTS.findSimilar!)).toBe(
      true
    );
    expect(matchesShortcut({ ...enterDown, shiftKey: false }, "Shift+Enter")).toBe(
      false
    );
    expect(matchesShortcut(enterDown, "Enter")).toBe(true);

    expect(formatShortcutDisplay(DEFAULT_SHORTCUTS.findSimilar)).toBe(
      "Shift+Enter"
    );
    expect(formatShortcutDisplay("b", { compact: true })).toBe("B");
    expect(formatShortcutDisplay("Delete", { compact: true })).toBe("Del");
    expect(formatShortcutDisplay("Delete")).toBe("Delete");
    expect(formatShortcutDisplay(" ")).toBe("SPACE");
    expect(formatShortcutDisplay(" ", { compact: true })).toBe("Space");
    expect(formatShortcutDisplay("Ctrl+Shift+M", { compact: true })).toBe(
      "Ctrl+Shift+M"
    );
  });

  it("allows hardware media keys, function keys, and non-editing modifier chords inside text inputs", () => {
    const baseEvent = {
      key: " ",
      code: "Space",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };

    expect(isHardwareMediaKey("MediaPlayPause")).toBe(true);
    expect(isHardwareMediaKey(" ")).toBe(false);

    // Bare Space and Shift-only combos must stay owned by search text typing
    expect(isSafeGlobalShortcutInTextEntry(baseEvent, " ")).toBe(false);
    expect(
      isSafeGlobalShortcutInTextEntry({ ...baseEvent, shiftKey: true }, "Shift+Space")
    ).toBe(false);

    // Custom modifier/F-key transport bindings and hardware media keys pass cleanly
    expect(
      isSafeGlobalShortcutInTextEntry({ ...baseEvent, ctrlKey: true }, "Ctrl+Space")
    ).toBe(true);
    expect(
      isSafeGlobalShortcutInTextEntry({ ...baseEvent, key: "p", code: "KeyP", altKey: true }, "Alt+P")
    ).toBe(true);
    expect(
      isSafeGlobalShortcutInTextEntry({ ...baseEvent, key: "F8", code: "F8" }, "F8")
    ).toBe(true);
    expect(
      isSafeGlobalShortcutInTextEntry(
        { ...baseEvent, key: "MediaPlayPause", code: "MediaPlayPause" },
        "MediaPlayPause"
      )
    ).toBe(true);

    // Standard clipboard/selection chords must NEVER be hijacked
    expect(
      isSafeGlobalShortcutInTextEntry({ ...baseEvent, key: "a", code: "KeyA", ctrlKey: true }, "Ctrl+A")
    ).toBe(false);
    expect(
      isSafeGlobalShortcutInTextEntry({ ...baseEvent, key: "z", code: "KeyZ", ctrlKey: true }, "Ctrl+Z")
    ).toBe(false);
  });

  it("blurs search inputs only when pointerdown hits outside keep-focus search wrapper", () => {
    const searchInput = {
      tagName: "INPUT",
      dataset: { searchInput: "true" },
      closest: () => null,
    } as unknown as Element;

    expect(shouldBlurSearchInputOnPointerDown(null, null)).toBe(false);
    // Mocked object isn't `instanceof HTMLElement`, verify guard stays safe without DOM globals
    expect(shouldBlurSearchInputOnPointerDown(searchInput, searchInput)).toBe(false);
  });

  it("canonicalizes and matches plus-key and modifier-plus chords cleanly", () => {
    expect(canonicalizeShortcut("Ctrl++")).toBe("ctrl++");
    expect(canonicalizeShortcut("Control++")).toBe("ctrl++");
    expect(canonicalizeShortcut("Control+Space")).toBe("ctrl+space");
    expect(canonicalizeShortcut("Ctrl+ ")).toBe("ctrl+space");
    expect(canonicalizeShortcut("Space")).toBe("space");
    expect(canonicalizeShortcut(" ")).toBe("space");
    expect(canonicalizeShortcut("Delete")).toBe("delete");
    expect(canonicalizeShortcut("")).toBe("");

    const plusDown = {
      key: "+",
      code: "Equal",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchesShortcut(plusDown, "+")).toBe(true);
    expect(matchesShortcut({ ...plusDown, ctrlKey: true }, "Ctrl++")).toBe(true);
    expect(matchesShortcut(plusDown, "Ctrl++")).toBe(false);
    expect(
      matchesShortcut(
        {
          key: " ",
          code: "Space",
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        "Ctrl+ "
      )
    ).toBe(true);
  });
});
