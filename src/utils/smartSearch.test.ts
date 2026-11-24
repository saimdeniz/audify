import { describe, expect, it, beforeEach } from "vitest";
import { applySort } from "../store/filterEngine";
import { SampleItem } from "../types";
import { getMatchingSynonymsForQuery } from "./sfxThesaurus";
import { transposeMusicalKey } from "./search/musicalKey";
import {
  applyAutocompleteSuggestion,
  getSearchAutocompleteSuggestions,
} from "./search/searchAutocomplete";
import {
  clearSmartSearchCache,
  executeSmartSearch,
  foldSearchText,
  parseSmartSearchQuery,
  tokenizeSearchWords,
} from "./smartSearch";

function makeSample(overrides: Partial<SampleItem> & { id: number; file_name: string }): SampleItem {
  const extIdx = overrides.file_name.lastIndexOf(".");
  const ext = extIdx >= 0 ? overrides.file_name.slice(extIdx + 1) : "wav";
  return {
    library_id: 1,
    file_path: `D:/SFX/${overrides.file_name}`,
    folder_path: "D:/SFX",
    extension: ext,
    duration_ms: 1500,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 48000,
    is_favorite: false,
    is_loop: false,
    genre: "",
    artist: "",
    album: "",
    year: "",
    peaks_json: "",
    created_at: "2026-10-01",
    tags: [],
    ...overrides,
  };
}

describe("smartSearch engine", () => {
  beforeEach(() => {
    clearSmartSearchCache();
  });

  it("folds Turkish and Latin characters cleanly", () => {
    expect(foldSearchText("Rüzgar İçi Şarkı ĞÜŞİÖÇ ıİ")).toBe(
      "ruzgar ici sarki gusioc ii"
    );
  });

  it("tokenizes camelCase, PascalCase, and number boundaries", () => {
    const tokens = tokenizeSearchWords("SciFiWhoosh_01");
    expect(tokens).toContain("sci");
    expect(tokens).toContain("fi");
    expect(tokens).toContain("whoosh");
    expect(tokens).toContain("01");
  });

  it("supports quoted multi-word phrases and quoted field operators", () => {
    const parsed = parseSmartSearchQuery(
      '"heavy kick" tag:"sci fi" -tag:"ui sound" -folder:"raw takes"'
    );
    expect(parsed.positiveOrGroups).toEqual([
      [{ value: "heavy kick", isPhrase: true, exactQuoted: true }],
    ]);
    expect(parsed.tagTerms).toEqual(["sci fi"]);
    expect(parsed.excludeTagTerms).toEqual(["ui sound"]);
    expect(parsed.excludeFolderTerms).toEqual(["raw takes"]);

    const samples = [
      makeSample({
        id: 1,
        file_name: "Heavy_Kick_Punch.wav",
        tags: [{ id: 10, name: "Sci Fi", color: "#06B6D4" }],
      }),
      makeSample({
        id: 2,
        file_name: "Kick_Heavy_Punch.wav",
        tags: [{ id: 10, name: "Sci Fi", color: "#06B6D4" }],
      }),
      makeSample({
        id: 3,
        file_name: "Heavy_Kick_UI.wav",
        tags: [
          { id: 10, name: "Sci Fi", color: "#06B6D4" },
          { id: 11, name: "UI Sound", color: "#38BDF8" },
        ],
      }),
    ];

    const res = executeSmartSearch(
      samples,
      '"heavy kick" tag:"sci fi" -tag:"ui sound"'
    );
    expect(res.map((s) => s.id)).toEqual([1]);
  });

  it("supports boolean OR and pipe | operators without treating OR as a literal word", () => {
    const samples = [
      makeSample({ id: 1, file_name: "Acoustic_Kick_01.wav" }),
      makeSample({ id: 2, file_name: "Tight_Snare_02.wav" }),
      makeSample({ id: 3, file_name: "Closed_Hat_03.wav" }),
    ];

    const resOr = executeSmartSearch(samples, "kick OR snare");
    expect(resOr.map((s) => s.id).sort()).toEqual([1, 2]);

    const resPipe = executeSmartSearch(samples, "kick|hat");
    expect(resPipe.map((s) => s.id).sort()).toEqual([1, 3]);
  });

  it("supports negated field operators (-tag:, -genre:, -ext:, -is:loop)", () => {
    const samples = [
      makeSample({
        id: 1,
        file_name: "Braam_01.wav",
        genre: "Cinematic",
        is_loop: false,
        tags: [{ id: 1, name: "Trailer", color: "#f00" }],
      }),
      makeSample({
        id: 2,
        file_name: "Braam_02.mp3",
        extension: "mp3",
        genre: "Cinematic",
        is_loop: false,
        tags: [{ id: 1, name: "Trailer", color: "#f00" }],
      }),
      makeSample({
        id: 3,
        file_name: "Braam_Loop_03.wav",
        genre: "Cinematic",
        is_loop: true,
        tags: [{ id: 2, name: "UI", color: "#0f0" }],
      }),
    ];

    expect(executeSmartSearch(samples, "braam -ext:mp3 -tag:ui").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "braam -is:loop -ext:mp3").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "-genre:cinematic").map((s) => s.id)).toEqual([]);
  });

  it("intersects multiple duration bounds and supports bare unit ranges", () => {
    const samples = [
      makeSample({ id: 1, file_name: "short.wav", duration_ms: 500 }),
      makeSample({ id: 2, file_name: "mid.wav", duration_ms: 2500 }),
      makeSample({ id: 3, file_name: "long.wav", duration_ms: 8000 }),
    ];

    expect(executeSmartSearch(samples, ">1s <5s").map((s) => s.id)).toEqual([2]);
    expect(executeSmartSearch(samples, "1-4s").map((s) => s.id)).toEqual([2]);
    // Intersecting two min bounds keeps the stricter (>2s and >5s -> >5s)
    expect(executeSmartSearch(samples, "dur:>2s dur:>5s").map((s) => s.id)).toEqual([3]);
  });

  it("invalidates sampleIndexCache when a tag is renamed or swapped 1-for-1", () => {
    const sampleV1 = makeSample({
      id: 42,
      file_name: "Mystery_Sound.wav",
      tags: [{ id: 1, name: "UI", color: "#38BDF8" }],
    });

    expect(executeSmartSearch([sampleV1], "tag:ui").length).toBe(1);
    expect(executeSmartSearch([sampleV1], "tag:hud").length).toBe(0);

    // Same sample id and same tags.length === 1, but tag renamed from UI -> HUD
    const sampleV2: SampleItem = {
      ...sampleV1,
      tags: [{ id: 1, name: "HUD", color: "#38BDF8" }],
    };

    expect(executeSmartSearch([sampleV2], "tag:ui").length).toBe(0);
    expect(executeSmartSearch([sampleV2], "tag:hud").length).toBe(1);
  });

  it("searches artist, album, year, decimal BPM, and studio synonyms", () => {
    const samples = [
      makeSample({
        id: 1,
        file_name: "Synth_Arp_128.5bpm.wav",
        artist: "Gölgehan",
        album: "Neon Pack",
        year: "2026",
      }),
      makeSample({
        id: 2,
        file_name: "Epic_Uplifter_01.wav",
      }),
    ];

    expect(executeSmartSearch(samples, "artist:golgehan bpm:128").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "pack:neon year:2026").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "riser", true).map((s) => s.id)).toEqual([2]);
    expect(executeSmartSearch(samples, "riser", false).map((s) => s.id)).toEqual([]);
  });

  it("supports bilingual TR <-> EN UCS synonyms and disables synonyms inside exact quotes", () => {
    const samples = [
      makeSample({ id: 1, file_name: "Cinematic_Whoosh_Fast.wav" }),
      makeSample({ id: 2, file_name: "Swish_Transition_02.wav" }),
      makeSample({ id: 3, file_name: "Concrete_Footsteps_Walk.wav" }),
      makeSample({ id: 4, file_name: "Massive_Explosion_Debris.wav" }),
    ];

    // Turkish query matches English UCS sound design files
    expect(
      executeSmartSearch(samples, "geçiş", true)
        .map((s) => s.id)
        .sort()
    ).toEqual([1, 2]);
    expect(executeSmartSearch(samples, "ayak", true).map((s) => s.id)).toEqual([3]);
    expect(executeSmartSearch(samples, "patlama", true).map((s) => s.id)).toEqual([4]);

    // Exact quotes strictly disable synonym expansion even when expandSynonyms = true
    expect(executeSmartSearch(samples, '"whoosh"', true).map((s) => s.id)).toEqual([1]);
    expect(getMatchingSynonymsForQuery('"whoosh"')).toEqual([]);
    expect(getMatchingSynonymsForQuery("whoosh").length).toBeGreaterThan(0);
  });

  it("supports BPM column values, exact Musical/Camelot key:, and harmonic key:~8A mixing", () => {
    const samples = [
      makeSample({
        id: 1,
        file_name: "Pad_Warm.wav",
        bpm: 124.0,
        musical_key: "Am",
        camelot_key: "8A",
      }),
      makeSample({
        id: 2,
        file_name: "Bass_Groove.wav",
        bpm: 125.0,
        musical_key: "Em",
        camelot_key: "9A",
      }),
      makeSample({
        id: 3,
        file_name: "Lead_Hook.wav",
        bpm: 126.0,
        musical_key: "C",
        camelot_key: "8B",
      }),
      makeSample({
        id: 4,
        file_name: "Clashing_Synth.wav",
        bpm: 140.0,
        musical_key: "Ebm",
        camelot_key: "2A",
      }),
      makeSample({
        id: 5,
        file_name: "Dry_Impact_SFX.wav",
        bpm: null,
        musical_key: "",
        camelot_key: "",
      }),
    ];

    expect(executeSmartSearch(samples, "bpm:125").map((s) => s.id)).toEqual([1, 2, 3]);
    expect(executeSmartSearch(samples, "key:am").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "key:8a").map((s) => s.id)).toEqual([1]);
    // Harmonic mix around 8A includes 8A (Am), 9A (Em), 7A (Dm), and 8B (C), excluding 2A and keyless SFX
    expect(
      executeSmartSearch(samples, "key:~8a")
        .map((s) => s.id)
        .sort()
    ).toEqual([1, 2, 3]);
    expect(
      executeSmartSearch(samples, "key:~am -key:9a")
        .map((s) => s.id)
        .sort()
    ).toEqual([1, 3]);

    // Sorting by BPM and Camelot Key keeps empty SFX rows at the bottom in both asc & desc
    expect(applySort(samples, "bpm", "asc").map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(applySort(samples, "bpm", "desc").map((s) => s.id)).toEqual([4, 3, 2, 1, 5]);
    expect(applySort(samples, "key", "asc").map((s) => s.id)).toEqual([4, 1, 3, 2, 5]);
    expect(applySort(samples, "key", "desc").map((s) => s.id)).toEqual([2, 3, 1, 4, 5]);
  });

  it("filters accurately by technical metadata operators (channels:, sr:, bit:, size:)", () => {
    const samples = [
      makeSample({
        id: 1,
        file_name: "Kick_Mono_44.wav",
        channels: 1,
        sample_rate: 44100,
        bit_depth: 16,
        file_size: 256 * 1024,
      }),
      makeSample({
        id: 2,
        file_name: "Pad_Stereo_48.wav",
        channels: 2,
        sample_rate: 48000,
        bit_depth: 24,
        file_size: 2 * 1024 * 1024,
      }),
      makeSample({
        id: 3,
        file_name: "Atmos_Surround_96.wav",
        channels: 6,
        sample_rate: 96000,
        bit_depth: 32,
        file_size: 12 * 1024 * 1024,
      }),
    ];

    expect(executeSmartSearch(samples, "channels:mono").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "ch:stereo").map((s) => s.id)).toEqual([2]);
    expect(executeSmartSearch(samples, "-channels:mono").map((s) => s.id)).toEqual([2, 3]);
    expect(executeSmartSearch(samples, "channels:multi").map((s) => s.id)).toEqual([3]);

    expect(executeSmartSearch(samples, "sr:44.1k").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "sr:>=48k").map((s) => s.id)).toEqual([2, 3]);
    expect(executeSmartSearch(samples, "sr:>48k").map((s) => s.id)).toEqual([3]);

    expect(executeSmartSearch(samples, "bit:24").map((s) => s.id)).toEqual([2]);
    expect(executeSmartSearch(samples, "bit:>=24").map((s) => s.id)).toEqual([2, 3]);

    expect(executeSmartSearch(samples, "size:<500kb").map((s) => s.id)).toEqual([1]);
    expect(executeSmartSearch(samples, "size:>5mb").map((s) => s.id)).toEqual([3]);
    expect(executeSmartSearch(samples, "size:1-5mb").map((s) => s.id)).toEqual([2]);

    // Combined expression usable in Smart Collections too
    expect(
      executeSmartSearch(samples, "pad channels:stereo sr:48k bit:24").map((s) => s.id)
    ).toEqual([2]);
  });

  it("transposes musical & Camelot keys accurately across positive, negative, and octave shifts", () => {
    expect(transposeMusicalKey("Am", 3)).toEqual({
      fromKey: "Am",
      fromCamelot: "8A",
      toKey: "Cm",
      toCamelot: "5A",
    });
    expect(transposeMusicalKey("8A", -2)).toEqual({
      fromKey: "Am",
      fromCamelot: "8A",
      toKey: "Gm",
      toCamelot: "6A",
    });
    expect(transposeMusicalKey("8B", -2)).toEqual({
      fromKey: "C",
      fromCamelot: "8B",
      toKey: "Bb",
      toCamelot: "6B",
    });
    expect(transposeMusicalKey("C", 12)).toEqual({
      fromKey: "C",
      fromCamelot: "8B",
      toKey: "C",
      toCamelot: "8B",
    });
    expect(transposeMusicalKey("F#m", -12)).toEqual({
      fromKey: "F#m",
      fromCamelot: "11A",
      toKey: "F#m",
      toCamelot: "11A",
    });
    expect(transposeMusicalKey("", 3)).toBeNull();
    expect(transposeMusicalKey("NotAKey", 2)).toBeNull();
  });

  it("provides Smart Search inline autocomplete for tag:, genre:, key:~, and operators while ignoring plain keywords", () => {
    const tags = [
      { id: 1, name: "Impact", color: "#F59E0B", sample_count: 120 },
      { id: 2, name: "Sci Fi", color: "#38BDF8", sample_count: 80 },
      { id: 3, name: "Işık", color: "#10B981", sample_count: 15 },
    ];
    const genres = [
      { id: 1, name: "Ambient", color: "#8B5CF6", sample_count: 200 },
      { id: 2, name: "Jazz", color: "#EC4899", sample_count: 50 },
    ];

    // Plain keyword must never interrupt normal searching
    expect(getSearchAutocompleteSuggestions("whoosh", 6, tags, genres)).toBeNull();

    // tag: prefix with Turkish folding + auto-quoting multi-word tags
    const tagCtx = getSearchAutocompleteSuggestions("whoosh tag:sci", 14, tags, genres);
    expect(tagCtx?.items[0].label).toBe("Sci Fi");
    const applied = applyAutocompleteSuggestion("whoosh tag:sci", tagCtx!, tagCtx!.items[0]);
    expect(applied.nextQuery).toBe('whoosh tag:"Sci Fi" ');

    // Negated genre: and harmonic key:~
    const genreCtx = getSearchAutocompleteSuggestions("-genre:ja", 9, tags, genres);
    expect(genreCtx?.items[0].insertToken).toBe("-genre:Jazz");

    const keyCtx = getSearchAutocompleteSuggestions("key:~8a", 7, tags, genres);
    expect(keyCtx?.items[0].insertToken).toBe("key:~Am");
    expect(keyCtx?.items[0].meta).toBe("8A");

    // Static audio operator ext:
    const extCtx = getSearchAutocompleteSuggestions("ext:fl", 6, tags, genres);
    expect(extCtx?.items[0].insertToken).toBe("ext:flac");

    // type: offers loop/oneshot/fav (never invalid wav/mp3) and supports is:/format:/size:
    const typeCtx = getSearchAutocompleteSuggestions("type:", 5, tags, genres);
    expect(typeCtx?.items.map((i) => i.label)).toEqual([
      "type:loop",
      "type:oneshot",
      "type:fav",
    ]);
    const isCtx = getSearchAutocompleteSuggestions("is:fa", 5, tags, genres);
    expect(isCtx?.items[0].insertToken).toBe("is:fav");
    const fmtCtx = getSearchAutocompleteSuggestions("format:wa", 9, tags, genres);
    expect(fmtCtx?.items[0].insertToken).toBe("format:wav");

    // Quoted multi-word tag preserves active token across spaces
    const quotedCtx = getSearchAutocompleteSuggestions('tag:"Sci ', 9, tags, genres);
    expect(quotedCtx?.items[0].label).toBe("Sci Fi");

    // Exact completed token auto-dismisses popup
    expect(getSearchAutocompleteSuggestions("ext:wav", 7, tags, genres)).toBeNull();
    expect(getSearchAutocompleteSuggestions("tag:Impact", 10, tags, genres)).toBeNull();

    // Dynamic folder: / -path: autocomplete with auto-quoting for multi-word folder names
    const folderStats = [
      { library_id: 1, folder_path: "D:/SFX/Ambient", count: 146 },
      { library_id: 1, folder_path: "D:/SFX/Scott Buckley", count: 81 },
    ];
    const folderCtx = getSearchAutocompleteSuggestions(
      "folder:sco",
      10,
      tags,
      genres,
      folderStats
    );
    expect(folderCtx?.items[0].label).toBe("Scott Buckley");
    expect(folderCtx?.items[0].insertToken).toBe('folder:"Scott Buckley"');
    const negPathCtx = getSearchAutocompleteSuggestions(
      "-path:amb",
      9,
      tags,
      genres,
      folderStats
    );
    expect(negPathCtx?.items[0].insertToken).toBe("-path:Ambient");
  });
});
