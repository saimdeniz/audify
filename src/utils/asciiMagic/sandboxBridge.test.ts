// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const convertFileSrcMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (...args: unknown[]) => convertFileSrcMock(...args),
}));

import { asciiMagicSandbox } from "./sandboxBridge";

describe("AsciiMagicSandboxBridge origin validation", () => {
  afterEach(() => {
    asciiMagicSandbox.dispose();
    convertFileSrcMock.mockReset();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("rejects empty or opaque 'null' runner origins instead of falling back to wildcard postMessage", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};

    convertFileSrcMock.mockReturnValueOnce("about:blank");
    await expect(asciiMagicSandbox.loadPiece("koi-pond")).rejects.toThrow(
      "Invalid ASCII sandbox runner origin"
    );

    convertFileSrcMock.mockReturnValueOnce("");
    await expect(asciiMagicSandbox.loadPiece("koi-pond")).rejects.toThrow(
      "Invalid ASCII sandbox runner origin"
    );

    convertFileSrcMock.mockReturnValueOnce(`${window.location.origin}/runner.html`);
    await expect(asciiMagicSandbox.loadPiece("koi-pond")).rejects.toThrow(
      "Invalid ASCII sandbox runner origin"
    );
  });
});
