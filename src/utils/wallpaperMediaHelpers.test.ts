// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  getVideoWallpaperExtBadge,
  isGifWallpaperPath,
  isVideoWallpaperPath,
} from "./thumbnailCache";
import {
  canPreBlurWallpaper,
  clearBlurredWallpaperCache,
  getCachedBlurredWallpaperUrl,
} from "./wallpaperBlurCache";

describe("wallpaper media helpers & pre-blur eligibility", () => {
  afterEach(() => {
    clearBlurredWallpaperCache();
  });

  it("detects mp4/webm video wallpaper paths and badges cleanly", () => {
    expect(isVideoWallpaperPath("C:/Audify/user/images/videos/loop.mp4")).toBe(true);
    expect(isVideoWallpaperPath("C:/Audify/user/images/videos/rain.WEBM?v=1")).toBe(true);
    expect(isVideoWallpaperPath("C:/Audify/user/images/gifs/spark.gif")).toBe(false);
    expect(isVideoWallpaperPath("C:/Audify/user/images/bg.png")).toBe(false);

    expect(getVideoWallpaperExtBadge("loop.mp4")).toBe("MP4");
    expect(getVideoWallpaperExtBadge("rain.webm")).toBe("WEBM");
    expect(getVideoWallpaperExtBadge("spark.gif")).toBeNull();
    expect(isGifWallpaperPath("spark.GIF#frame")).toBe(true);
  });

  it("only enables offscreen pre-blur for static local image wallpapers with blur > 0", () => {
    expect(canPreBlurWallpaper("C:/Audify/user/images/studio.jpg", 12)).toBe(true);
    expect(canPreBlurWallpaper("C:/Audify/user/images/studio.png", 0)).toBe(false);
    expect(canPreBlurWallpaper("C:/Audify/user/images/gifs/spark.gif", 12)).toBe(false);
    expect(canPreBlurWallpaper("C:/Audify/user/images/videos/loop.mp4", 12)).toBe(false);
    expect(canPreBlurWallpaper("C:/Audify/user/images/videos/loop.webm", 12)).toBe(false);
    expect(canPreBlurWallpaper("data:image/png;base64,abc", 8)).toBe(false);
    expect(getCachedBlurredWallpaperUrl("C:/Audify/user/images/studio.jpg", 12)).toBeNull();
  });
});
