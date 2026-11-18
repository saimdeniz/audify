import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyThemeAndAccentToDom,
  computeFallbackRowBg,
  hexToRgbTriplet,
  normalizeAccentForTheme,
} from "./themeDom";

describe("themeDom Light & Dark contrast invariants", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes opaque pastel selection backgrounds in Light mode for custom accents", () => {
    const skyLight = computeFallbackRowBg("#38BDF8", "light");
    expect(skyLight.startsWith("rgb(")).toBe(true);
    expect(skyLight.startsWith("rgba(")).toBe(false);

    const nums = skyLight.match(/\d+/g)?.map(Number) ?? [];
    expect(nums).toHaveLength(3);
    // Pastel background should stay bright enough for dark ink text (#111216)
    expect(Math.min(...nums)).toBeGreaterThan(190);

    expect(computeFallbackRowBg("#FFFFFF", "light")).toBe("#E4E7EF");

    const skyDark = computeFallbackRowBg("#38BDF8", "dark");
    expect(skyDark.startsWith("rgb(")).toBe(true);
    expect(skyDark.startsWith("rgba(")).toBe(false);
  });

  it("normalizes near-white/black accents safely across theme modes", () => {
    expect(normalizeAccentForTheme("#FFFFFF", "light")).toBe("#3F3F46");
    expect(normalizeAccentForTheme("#000000", "dark")).toBe("#52525B");
  });

  it("applies high-contrast accent ink and opaque row selection variables in Light mode", () => {
    const styleProps = new Map<string, string>();
    const attrs = new Map<string, string>();
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
        style: {
          setProperty: (k: string, v: string) => styleProps.set(k, v),
        },
      },
    });

    applyThemeAndAccentToDom("light", "#38BDF8");

    expect(attrs.get("data-theme")).toBe("light");
    const rowBg = styleProps.get("--signal-accent-bg") ?? "";
    expect(rowBg.startsWith("rgb(")).toBe(true);
    expect(rowBg.startsWith("rgba(")).toBe(false);

    const fgTriplet = (styleProps.get("--accent-fg-rgb") ?? "")
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(fgTriplet).toHaveLength(3);
    // Bright sky cyan (#38BDF8 -> 56, 189, 248) must be darkened for Light mode readability
    expect(fgTriplet[1]).toBeLessThan(189);
    expect(fgTriplet[2]).toBeLessThan(248);
  });

  it("expands 3-digit shorthand hex codes accurately in hexToRgbTriplet", () => {
    expect(hexToRgbTriplet("#f0a")).toEqual([255, 0, 170]);
    expect(hexToRgbTriplet("09c")).toEqual([0, 153, 204]);
    expect(hexToRgbTriplet("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgbTriplet("invalid")).toEqual([245, 158, 11]);
  });

  it("sets data-theme-switching only when theme mode changes and removes it after two animation frames", () => {
    const styleProps = new Map<string, string>();
    const attrs = new Map<string, string>([["data-theme", "dark"]]);
    const rafQueue: FrameRequestCallback[] = [];

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
        style: {
          setProperty: (k: string, v: string) => styleProps.set(k, v),
        },
      },
    });

    // Same theme must not suppress transitions unnecessarily
    applyThemeAndAccentToDom("dark", "#F59E0B");
    expect(attrs.has("data-theme-switching")).toBe(false);

    // Changing theme activates suppression across two rAF ticks
    applyThemeAndAccentToDom("light", "#F59E0B");
    expect(attrs.get("data-theme")).toBe("light");
    expect(attrs.get("data-theme-switching")).toBe("true");
    expect(rafQueue).toHaveLength(1);

    rafQueue.shift()!(16);
    expect(attrs.get("data-theme-switching")).toBe("true");
    expect(rafQueue).toHaveLength(1);

    rafQueue.shift()!(32);
    expect(attrs.has("data-theme-switching")).toBe(false);
  });
});
