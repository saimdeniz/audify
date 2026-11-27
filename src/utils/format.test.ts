import { describe, expect, it } from "vitest";
import {
  cleanTrackTitle,
  computeRelativeScopePaths,
  findLicenseFolderMatch,
  folderNameFromPath,
  formatBackupDateLabel,
  formatLicenseGroupLine,
  formatSampleTimestamp,
  formatShortJournalTimestamp,
  generateBatchAttributionCredits,
  getCanvasThemePalette,
  isPathInsideFolder,
  isSampleInLicenseGroup,
  matchSampleToLicenseGroup,
  normalizePathForMatch,
  parseSqliteUtcMs,
  samplePeakRange,
  stripAudioExtension,
} from "./format";
import type { LicenseGroup, SampleItem } from "../types";

describe("samplePeakRange bin-center alignment", () => {
  it("returns the first bin value at the center of the first bin", () => {
    const peaks = [0.2, 0.4, 0.6, 0.8];
    expect(samplePeakRange(peaks, 0.125, 0.125, "linear")).toBeCloseTo(
      Math.pow(0.2, 1.25),
      5
    );
  });

  it("interpolates halfway between adjacent bin centers", () => {
    const peaks = [0, 1, 0, 0];
    // Centers: 0.125, 0.375 ... ratio 0.25 is exactly between bin 0 and bin 1.
    expect(samplePeakRange(peaks, 0.25, 0.25, "linear")).toBeCloseTo(
      Math.pow(0.5, 1.25),
      5
    );
  });

  it("clamps to the edge bins and handles empty arrays", () => {
    expect(samplePeakRange([], 0, 1)).toBe(0);
    expect(samplePeakRange([0.5, 0.5], 0, 0, "linear")).toBeCloseTo(
      Math.pow(0.5, 1.25),
      5
    );
    expect(samplePeakRange([0.5, 0.5], 1, 1, "linear")).toBeCloseTo(
      Math.pow(0.5, 1.25),
      5
    );
  });
});

const group = (over: Partial<LicenseGroup> = {}): LicenseGroup => ({
  id: "g1",
  name: "Alexander Nakarada",
  color: "#F59E0B",
  folders: ["D:/Music/Alexander Nakarada"],
  template: '"{title}" by {artist}',
  quoteMode: "auto",
  ...over,
});

const sample = (file_path: string, file_name: string): SampleItem =>
  ({
    id: Math.floor(Math.random() * 1e9),
    library_id: 1,
    file_path,
    file_name,
    folder_path: file_path.slice(0, file_path.lastIndexOf("/")),
    extension: "mp3",
    duration_ms: 1000,
    sample_rate: 44100,
    channels: 2,
    bit_depth: 16,
    file_size: 1,
    is_favorite: false,
    is_loop: false,
    peaks_json: "",
    created_at: "",
    tags: [],
    genre: "",
    artist: "",
    album: "",
    year: "",
  } as SampleItem);

describe("stripAudioExtension", () => {
  it("removes known audio extensions case-insensitively", () => {
    expect(stripAudioExtension("Song.mp3")).toBe("Song");
    expect(stripAudioExtension("Song.WAV")).toBe("Song");
    expect(stripAudioExtension("  Song.flac  ")).toBe("Song");
  });

  it("never truncates titles that merely contain dots", () => {
    expect(stripAudioExtension("Vol. 2 Intro")).toBe("Vol. 2 Intro");
    expect(stripAudioExtension("Mr. Brightside")).toBe("Mr. Brightside");
    expect(stripAudioExtension("Track v1.2")).toBe("Track v1.2");
  });
});

describe("cleanTrackTitle", () => {
  it("turns underscores into spaces and drops the extension", () => {
    expect(cleanTrackTitle("Emotional_Guitar_Improvisation.mp3")).toBe(
      "Emotional Guitar Improvisation"
    );
  });

  it("collapses repeated whitespace", () => {
    expect(cleanTrackTitle("A__B   C.wav")).toBe("A B C");
  });

  it("keeps dotted metadata titles intact", () => {
    expect(cleanTrackTitle("Vol. 2 Intro")).toBe("Vol. 2 Intro");
  });
});

describe("path matching", () => {
  it("normalizes slashes, trailing slash and case", () => {
    expect(normalizePathForMatch("D:\\Music\\Rock\\")).toBe("d:/music/rock");
  });

  it("matches the folder itself and descendants but not prefix siblings", () => {
    expect(isPathInsideFolder("D:/Music/Rock/a.mp3", "D:/Music/Rock")).toBe(true);
    expect(isPathInsideFolder("D:/Music/Rock/Sub/a.mp3", "D:/Music/Rock")).toBe(true);
    expect(isPathInsideFolder("D:/Music/Rock Ballads/a.mp3", "D:/Music/Rock")).toBe(false);
  });

  it("is case-insensitive and tolerant of backslashes", () => {
    expect(isPathInsideFolder("d:\\music\\ROCK\\a.mp3", "D:/Music/Rock")).toBe(true);
  });

  it("picks the most specific (longest) linked folder", () => {
    const broad = group({ id: "broad", folders: ["D:/Music"] });
    const narrow = group({ id: "narrow", folders: ["D:/Music/Nakarada"] });
    const match = matchSampleToLicenseGroup("D:/Music/Nakarada/x.mp3", [broad, narrow]);
    expect(match?.id).toBe("narrow");
  });

  it("returns null when nothing matches", () => {
    expect(matchSampleToLicenseGroup("E:/other/x.mp3", [group()])).toBeNull();
  });

  it("matches across different drives via drive-agnostic fallback", () => {
    // Template created on F:, sample moved to D: on portable installation
    expect(
      isPathInsideFolder(
        "D:/data/sounds/sfx/impacts/punch.wav",
        "F:/data/sounds/sfx"
      )
    ).toBe(true);
    expect(
      isPathInsideFolder(
        "D:\\data\\sounds\\sfx\\impacts\\punch.wav",
        "F:\\data\\sounds\\sfx"
      )
    ).toBe(true);
    // Should NOT match completely different paths
    expect(
      isPathInsideFolder(
        "D:/other/music/song.mp3",
        "F:/data/sounds/sfx"
      )
    ).toBe(false);
  });
});

describe("findLicenseFolderMatch / isSampleInLicenseGroup", () => {
  it("prefers the absolute folder and reports it", () => {
    const g = group({ folders: ["D:/Music/Scott"], rel_folders: ["music/Scott"] });
    const m = findLicenseFolderMatch("D:/Music/Scott/a.mp3", g);
    expect(m?.folder).toBe("D:/Music/Scott");
  });

  it("falls back to rel_folders when the library moved drives", () => {
    const g = group({ folders: ["C:/Old/music/Scott"], rel_folders: ["music/Scott"] });
    const m = findLicenseFolderMatch("E:/Vault/music/Scott/a.mp3", g);
    expect(m?.folder).toBe("music/Scott");
    expect(isSampleInLicenseGroup("E:/Vault/music/Scott/a.mp3", g)).toBe(true);
  });

  it("does not match sibling folders that merely share a prefix", () => {
    const g = group({ folders: [], rel_folders: ["music/Scott"] });
    expect(isSampleInLicenseGroup("E:/Vault/music/Scott Buckley/a.mp3", g)).toBe(false);
  });

  it("an empty group matches nothing", () => {
    expect(isSampleInLicenseGroup("E:/x/a.mp3", group({ folders: [] }))).toBe(false);
  });
});

describe("formatLicenseGroupLine", () => {
  it("quotes each title when the template quotes {title}", () => {
    const line = formatLicenseGroupLine(group(), ["Track_One.mp3", "Track_Two.mp3"]);
    expect(line).toBe('"Track One", "Track Two" by Alexander Nakarada');
  });

  it("respects quoteMode=never", () => {
    const line = formatLicenseGroupLine(group({ quoteMode: "never" }), ["A.mp3"]);
    expect(line).toBe("A by Alexander Nakarada");
  });

  it("quotes only on multi-select with quoteMode=multi_only", () => {
    const g = group({ template: "{title} by {artist}", quoteMode: "multi_only" });
    expect(formatLicenseGroupLine(g, ["A.mp3"])).toBe("A by Alexander Nakarada");
    expect(formatLicenseGroupLine(g, ["A.mp3", "B.mp3"])).toBe(
      '"A", "B" by Alexander Nakarada'
    );
  });

  it("de-duplicates repeated titles", () => {
    const line = formatLicenseGroupLine(group({ quoteMode: "never" }), ["A.mp3", "A.wav"]);
    expect(line).toBe("A by Alexander Nakarada");
  });

  it("substitutes {artist} and {folder}", () => {
    const g = group({ template: "{title} - {artist} ({folder})", quoteMode: "never" });
    expect(formatLicenseGroupLine(g, ["A.mp3"], "Cinematic")).toBe(
      "A - Alexander Nakarada (Cinematic)"
    );
  });

  it("returns an empty string when there are no titles", () => {
    expect(formatLicenseGroupLine(group(), [])).toBe("");
  });
});

describe("generateBatchAttributionCredits", () => {
  const a = group({ id: "a", name: "Artist A", folders: ["D:/A"], quoteMode: "never" });
  const b = group({ id: "b", name: "Artist B", folders: ["D:/B"], quoteMode: "never" });

  it("groups tracks by artist and emits one line per artist", () => {
    const res = generateBatchAttributionCredits(
      [
        sample("D:/A/one.mp3", "one.mp3"),
        sample("D:/B/two.mp3", "two.mp3"),
        sample("D:/A/three.mp3", "three.mp3"),
      ],
      [a, b]
    );
    expect(res.artistCount).toBe(2);
    expect(res.matchedSampleCount).toBe(3);
    expect(res.text.split("\n")).toEqual([
      "one, three by Artist A",
      "two by Artist B",
    ]);
  });

  it("counts unmatched tracks and skips them", () => {
    const res = generateBatchAttributionCredits(
      [sample("D:/A/one.mp3", "one.mp3"), sample("E:/x/y.mp3", "y.mp3")],
      [a]
    );
    expect(res.unmatchedCount).toBe(1);
    expect(res.matchedSampleCount).toBe(1);
  });

  it("prefers embedded metadata titles over file names", () => {
    const s = sample("D:/A/Uplifting_Ballad.mp3", "Uplifting_Ballad.mp3");
    const res = generateBatchAttributionCredits([s], [a], {
      "D:/A/Uplifting_Ballad.mp3": "Uplifting Ballad (Remastered)",
    });
    expect(res.text).toBe("Uplifting Ballad (Remastered) by Artist A");
  });

  it("returns empty output when no track matches", () => {
    const res = generateBatchAttributionCredits([sample("E:/x.mp3", "x.mp3")], [a]);
    expect(res.text).toBe("");
    expect(res.artistCount).toBe(0);
  });
});

describe("folderNameFromPath and computeRelativeScopePaths", () => {
  it("extracts leaf names across forward and backward slashes", () => {
    expect(folderNameFromPath("C:\\Audio\\Packs\\SFX\\")).toBe("SFX");
    expect(folderNameFromPath("/Volumes/SoundLib/Music")).toBe("Music");
    expect(folderNameFromPath("", "fallback")).toBe("fallback");
  });

  it("computes library-relative scope paths case-insensitively", () => {
    const rels = computeRelativeScopePaths(
      ["c:\\Audio\\Packs\\SFX\\Whoosh", "D:/Outside/Other"],
      [{ path: "C:/audio/packs" }]
    );
    expect(rels).toEqual(["SFX/Whoosh"]);
  });
});

describe("backup & operation history timestamp formatting", () => {
  it("extracts readable date & time from backup stem when timestamp_ms is unavailable", () => {
    expect(formatBackupDateLabel("auto_studio_2026-11-13_03-08-22")).toBe(
      "2026-11-13 · 03:08"
    );
  });

  it("formats local mtime when timestamp_ms is supplied", () => {
    const dt = new Date(2026, 10, 13, 3, 8, 22);
    expect(
      formatBackupDateLabel("auto_studio_2026-11-13_03-08-22", dt.getTime())
    ).toBe("2026-11-13 · 03:08");
  });

  it("formats SQLite journal created_at into MM-DD HH:mm:ss", () => {
    expect(formatShortJournalTimestamp("2026-11-13 21:29:09")).toBe(
      "11-13 21:29:09"
    );
    expect(formatShortJournalTimestamp("fallback")).toBe("fallback");
  });
});

describe("sample timestamp parsing and formatting", () => {
  it("parses SQLite UTC datetime strings and rejects invalid inputs", () => {
    expect(parseSqliteUtcMs("2026-11-15 01:30:45")).toBe(
      Date.UTC(2026, 10, 15, 1, 30, 45)
    );
    expect(parseSqliteUtcMs("")).toBe(0);
    expect(parseSqliteUtcMs(null)).toBe(0);
    expect(parseSqliteUtcMs("not-a-date")).toBe(0);
  });

  it("formats timestamps concisely relative to reference clock and supplies full tooltip", () => {
    const now = new Date(2026, 10, 15, 14, 0, 0).getTime();
    const todayDt = new Date(2026, 10, 15, 9, 5, 7).getTime();
    const sameYearDt = new Date(2026, 4, 3, 21, 40, 12).getTime();
    const priorYearDt = new Date(2025, 0, 9, 6, 4, 59).getTime();

    expect(formatSampleTimestamp(todayDt, now)).toEqual({
      short: "Today 09:05",
      full: "2026-11-15 09:05:07",
    });
    expect(formatSampleTimestamp(sameYearDt, now)).toEqual({
      short: "03.05 21:40",
      full: "2026-05-03 21:40:12",
    });
    expect(formatSampleTimestamp(priorYearDt, now)).toEqual({
      short: "09.01.25 06:04",
      full: "2025-01-09 06:04:59",
    });
    expect(formatSampleTimestamp(null, now)).toEqual({ short: "—", full: "" });
    expect(formatSampleTimestamp(0, now)).toEqual({ short: "—", full: "" });
  });
});

describe("getCanvasThemePalette pure JS theme tokens", () => {
  it("resolves Dark, Light, Contrast, and Mica canvas palettes cleanly without DOM style lookups", () => {
    const dark = getCanvasThemePalette("dark:false:#F59E0B");
    expect(dark.surface2).toBe("#18181C");
    expect(dark.okOn).toBe("#0D0D0F");
    expect(dark.accentOn).toBe("#0D0D0F");

    const light = getCanvasThemePalette("light:false:#2563EB");
    expect(light.surface2).toBe("#FAFAFC");
    expect(light.fg).toBe("#111216");
    expect(light.okOn).toBe("#FFFFFF");
    expect(light.accentOn).toBe("#FFFFFF");

    const contrastMica = getCanvasThemePalette("contrast:true:#38BDF8");
    expect(contrastMica.surface2).toBe("rgba(16, 16, 18, 0.88)");
    expect(contrastMica.fg).toBe("#FFFFFF");
    expect(contrastMica.okOn).toBe("#000000");
  });
});
