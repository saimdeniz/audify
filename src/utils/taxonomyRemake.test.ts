import { beforeEach, describe, expect, it } from "vitest";
import { computeVisibleBadgeLimit } from "../components/sample-table/SampleTableRowCells";
import type { AutoTagRule, SampleItem, Tag, TagFacet } from "../types";
import { createCatalogWorkerKernel } from "../workers/catalogWorkerKernel";
import {
  detectLegacyFlatAutoTagRules,
  upgradeLegacyAutoTagRuleset,
} from "./autoTagRuleUpgrade";
import { getSearchAutocompleteSuggestions } from "./search/searchAutocomplete";
import {
  clearSmartSearchCache,
  executeSmartSearch,
  setSmartSearchTaxonomy,
} from "./smartSearch";
import {
  deriveChildTonalColor,
  generateDeterministicFullSpectrumColor,
  generateRandomStudioHex,
  hexToHsl,
} from "./taxonomyColor";
import {
  buildDistinctiveTopTags,
  buildTaxonomyIndex,
  getFacetsForDomain,
  getValidParentCandidates,
  isFacetHierarchical,
  resolveFacetDomain,
  serializeTaxonomyForWorker,
} from "./taxonomyTree";

const TAXONOMY_TAGS: Tag[] = [
  {
    id: 1,
    name: "Animals",
    color: "#22C55E",
    effective_color: "#22C55E",
    sample_count: 0,
    rollup_count: 3,
    facet_id: 1,
    facet_slug: "category",
    parent_id: null,
    path: "/1/",
    is_system: true,
  },
  {
    id: 2,
    name: "Dog",
    color: "#22C55E",
    effective_color: "#22C55E",
    sample_count: 2,
    rollup_count: 2,
    facet_id: 1,
    facet_slug: "category",
    parent_id: 1,
    path: "/1/2/",
    color_inherited: true,
  },
  {
    id: 3,
    name: "Bird",
    color: "#22C55E",
    effective_color: "#22C55E",
    sample_count: 1,
    rollup_count: 1,
    facet_id: 1,
    facet_slug: "category",
    parent_id: 1,
    path: "/1/3/",
    color_inherited: true,
  },
  {
    id: 4,
    name: "Vocal",
    color: "#8B5CF6",
    effective_color: "#8B5CF6",
    sample_count: 1,
    rollup_count: 1,
    facet_id: 1,
    facet_slug: "category",
    parent_id: null,
    path: "/4/",
    aliases: ["Voice", "Speech"],
  },
  {
    id: 10,
    name: "Cinematic",
    color: "#3B82F6",
    effective_color: "#3B82F6",
    sample_count: 2,
    rollup_count: 2,
    facet_id: 2,
    facet_slug: "genre",
    parent_id: null,
    path: "/10/",
  },
  {
    id: 11,
    name: "Ambient",
    color: "#3B82F6",
    effective_color: "#3B82F6",
    sample_count: 1,
    rollup_count: 1,
    facet_id: 2,
    facet_slug: "genre",
    parent_id: null,
    path: "/11/",
  },
  {
    id: 20,
    name: "Dark",
    color: "#EC4899",
    effective_color: "#EC4899",
    sample_count: 2,
    rollup_count: 2,
    facet_id: 3,
    facet_slug: "mood",
    parent_id: null,
    path: "/20/",
  },
  {
    id: 21,
    name: "Horror",
    color: "#EC4899",
    effective_color: "#EC4899",
    sample_count: 1,
    rollup_count: 1,
    facet_id: 3,
    facet_slug: "mood",
    parent_id: null,
    path: "/21/",
  },
  {
    id: 30,
    name: "Pokemon",
    color: "#64748B",
    effective_color: "#64748B",
    sample_count: 1,
    rollup_count: 1,
    facet_id: 4,
    facet_slug: "source",
    parent_id: null,
    path: "/30/",
  },
];

function makeSample(
  id: number,
  fileName: string,
  tagIds: number[],
  genre = ""
): SampleItem {
  const byId = new Map(TAXONOMY_TAGS.map((t) => [t.id, t]));
  return {
    id,
    library_id: 1,
    file_path: `D:/SFX/${fileName}`,
    file_name: fileName,
    folder_path: "D:/SFX",
    extension: "wav",
    duration_ms: 1200,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 48000,
    is_favorite: false,
    is_loop: false,
    genre,
    artist: "",
    album: "",
    year: "",
    peaks_json: "",
    created_at: "2026-11-24",
    tags: tagIds.map((tid) => {
      const t = byId.get(tid)!;
      return { id: t.id, name: t.name, color: t.effective_color || t.color };
    }),
  };
}

const SAMPLE_POOL: SampleItem[] = [
  makeSample(1, "hound_growl.wav", [2, 10, 20], "Cinematic"), // Dog + Cinematic + Dark
  makeSample(2, "pika_bark.wav", [2, 30, 21], "Horror"), // Dog + Pokemon + Horror
  makeSample(3, "forest_robin.wav", [3, 11], "Ambient"), // Bird + Ambient
  makeSample(4, "whisper_choir.wav", [4, 10, 20], "Cinematic"), // Vocal(Voice) + Cinematic + Dark
];

describe("Faceted & Nested Taxonomy Engine (Worker, Search & Autocomplete)", () => {
  beforeEach(() => {
    clearSmartSearchCache();
    setSmartSearchTaxonomy(serializeTaxonomyForWorker(TAXONOMY_TAGS));
  });

  it("applies default AND (all) and optional OR-within-facet (any), parent rollup, and Alt+Click exclude in Catalog Worker", () => {
    const kernel = createCatalogWorkerKernel();
    kernel.handleMessage({ type: "set_pool", poolEpoch: 1, samples: SAMPLE_POOL });
    kernel.handleMessage({
      type: "set_taxonomy",
      taxonomy: serializeTaxonomyForWorker(TAXONOMY_TAGS),
    });

    const run = (
      selectedTagIds: number[],
      excludedTagIds: number[] = [],
      tagMatchMode: "all" | "any" = "all"
    ) => {
      const res = kernel.handleMessage({
        type: "filter_query",
        requestSeq: 1,
        poolEpoch: 1,
        params: {
          folderFilter: null,
          favoriteOnly: false,
          recentOnly: false,
          recentSampleIds: [],
          selectedTagIds,
          excludedTagIds,
          tagMatchMode,
          selectedGenre: null,
          selectedLicenseGroupId: null,
          licenseGroups: [],
          binFilterActive: false,
          binSampleIds: [],
          duplicateOrderIds: null,
          smartQuery: "",
          searchQuery: "",
          smartSearchSynonyms: false,
          typeFilter: "all",
          srFilter: null,
          sortKey: null,
          sortDir: "asc",
          similarity: null,
        },
      });
      if (res.response.type !== "filter_result") throw new Error("unexpected");
      return Array.from(res.response.filteredIds).sort((a, b) => a - b);
    };

    // Parent rollup: Animals (1) matches Dog (1,2) and Bird (3)
    expect(run([1])).toEqual([1, 2, 3]);
    // Default AND ("all"): Dog (2) AND Bird (3) -> empty; Animals (1) AND Dog (2) -> narrows to Dog (1, 2)
    expect(run([2, 3])).toEqual([]);
    expect(run([1, 2])).toEqual([1, 2]);
    // Optional OR within same facet ("any"): Dog (2) OR Bird (3) -> 1, 2, 3
    expect(run([2, 3], [], "any")).toEqual([1, 2, 3]);
    // Cross-facet AND: Animals (1) AND Dark (20) -> 1 only
    expect(run([1, 20])).toEqual([1]);
    // Multi-genre OR in "any" mode: Cinematic (10) OR Ambient (11) -> 1, 3, 4
    expect(run([10, 11], [], "any")).toEqual([1, 3, 4]);
    // Alt+Click Exclude: Animals (1) NOT Pokemon (30) -> 1, 3
    expect(run([1], [30])).toEqual([1, 3]);
    // Alt+Click Exclude parent: NOT Animals (1) excludes Dog & Bird -> 4 only
    expect(run([], [1])).toEqual([4]);
  });

  it("supports hierarchical tag:animals/dog, ancestor rollup, alias search, mood:, source:, and negative operators", () => {
    // Ancestor rollup: tag:animals matches Dog & Bird
    expect(
      executeSmartSearch(SAMPLE_POOL, "tag:animals", false)
        .map((s) => s.id)
        .sort()
    ).toEqual([1, 2, 3]);

    // Specific path: tag:animals/dog matches ONLY Dog (1, 2), NOT Bird (3)
    expect(
      executeSmartSearch(SAMPLE_POOL, "tag:animals/dog", false)
        .map((s) => s.id)
        .sort()
    ).toEqual([1, 2]);

    // Exclusion + mood + source operators
    expect(
      executeSmartSearch(SAMPLE_POOL, "tag:animals -source:pokemon mood:dark", false).map(
        (s) => s.id
      )
    ).toEqual([1]);
    expect(
      executeSmartSearch(SAMPLE_POOL, "tag:animals -mood:horror", false)
        .map((s) => s.id)
        .sort()
    ).toEqual([1, 3]);
    expect(
      executeSmartSearch(SAMPLE_POOL, "genre:cinematic mood:dark", false)
        .map((s) => s.id)
        .sort()
    ).toEqual([1, 4]);

    // Alias matching: searching `tag:voice` or plain `voice` finds Vocal (sample 4)
    expect(executeSmartSearch(SAMPLE_POOL, "tag:voice", false).map((s) => s.id)).toEqual([4]);
    expect(executeSmartSearch(SAMPLE_POOL, "voice", false).map((s) => s.id)).toEqual([4]);
  });

  it("returns hierarchical breadcrumbs, facet badges, and mood:/source: suggestions in autocomplete", () => {
    const tagCtx = getSearchAutocompleteSuggestions("tag:dog", 7, TAXONOMY_TAGS, []);
    expect(tagCtx).not.toBeNull();
    expect(tagCtx?.items[0].label).toBe("Animals ▸ Dog");
    expect(tagCtx?.items[0].insertToken).toBe("tag:Animals/Dog");
    expect(tagCtx?.items[0].facetBadge).toBe("CAT");

    const moodCtx = getSearchAutocompleteSuggestions("mood:", 5, TAXONOMY_TAGS, []);
    expect(moodCtx?.items.map((i) => i.label)).toContain("Dark");
    expect(moodCtx?.items.every((i) => i.facetBadge === "MOOD")).toBe(true);

    const srcCtx = getSearchAutocompleteSuggestions("source:", 7, TAXONOMY_TAGS, []);
    expect(srcCtx?.items.map((i) => i.label)).toEqual(["Pokemon"]);
    expect(srcCtx?.items[0].facetBadge).toBe("SRC");
  });

  it("hides >75% overly broad parent root categories in Distinctive Top Tag Cloud", () => {
    const bloated: Tag[] = [
      { ...TAXONOMY_TAGS[0], rollup_count: 90, sample_count: 90 }, // Animals 90% of 100
      { ...TAXONOMY_TAGS[1], rollup_count: 35, sample_count: 35 }, // Dog
      { ...TAXONOMY_TAGS[2], rollup_count: 30, sample_count: 30 }, // Bird
      { ...TAXONOMY_TAGS[3], rollup_count: 25, sample_count: 25 }, // Vocal
      { ...TAXONOMY_TAGS[8], rollup_count: 15, sample_count: 15 }, // Pokemon
    ];
    const top = buildDistinctiveTopTags(bloated, 100, 4);
    expect(top.map((t) => t.name)).not.toContain("Animals");
    expect(top.map((t) => t.name)).toContain("Dog");
  });

  it("derives harmonious parent-hue tonal shades for inherited sub-tags and full-spectrum 16M custom colors", () => {
    const parentBlue = "#3B82F6";
    const parentHsl = hexToHsl(parentBlue);
    const dogShade = deriveChildTonalColor(parentBlue, "Dog", 2);
    const birdShade = deriveChildTonalColor(parentBlue, "Bird", 2);
    expect(dogShade).not.toBe(parentBlue);
    expect(dogShade).not.toBe(birdShade);

    for (const hex of [dogShade, birdShade]) {
      const hsl = hexToHsl(hex);
      let deltaH = Math.abs(hsl.h - parentHsl.h);
      if (deltaH > 180) deltaH = 360 - deltaH;
      expect(deltaH).toBeLessThanOrEqual(16.5);
      expect(hsl.s).toBeGreaterThanOrEqual(0.42);
      expect(hsl.l).toBeGreaterThanOrEqual(0.42);
      expect(hsl.l).toBeLessThanOrEqual(0.75);
    }

    // Dynamic cascade through buildTaxonomyIndex when parent color changes
    const indexPink = buildTaxonomyIndex([
      { ...TAXONOMY_TAGS[0], color: "#EC4899", effective_color: "#EC4899" },
      { ...TAXONOMY_TAGS[1], color_inherited: true },
    ]);
    const dogPink = indexPink.effectiveColorByTagId.get(2);
    expect(dogPink).toBe(deriveChildTonalColor("#EC4899", "Dog", 2));
    expect(dogPink).not.toBe(dogShade);

    // 16M deterministic & random generators exceed old 8/32 cap
    const unique = new Set<string>();
    for (let i = 0; i < 32; i++) {
      unique.add(generateDeterministicFullSpectrumColor(`CustomTag_${i}`));
    }
    expect(unique.size).toBeGreaterThan(16);
    expect(generateRandomStudioHex()).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("detects and non-destructively upgrades legacy flat auto-tag rules while preserving custom rules", () => {
    const legacyRules: AutoTagRule[] = [
      {
        id: "r1",
        tag_name: "Combat",
        tag_color: "#EF4444",
        keywords: ["combat", "custom_slash"],
        enabled: true,
        category: "SFX",
        include_paths: ["D:/SFX"],
        exclude_paths: [],
      },
      {
        id: "r2",
        tag_name: "Animals",
        tag_color: "#84CC16",
        keywords: ["animals", "dog"],
        enabled: true,
        category: "SFX",
        include_paths: [],
        exclude_paths: [],
      },
      {
        id: "r3",
        tag_name: "Pokemon",
        tag_color: "#F59E0B",
        keywords: ["pokemon", "pikachu"],
        enabled: true,
        category: "SFX",
        include_paths: [],
        exclude_paths: [],
      },
      {
        id: "r-custom",
        tag_name: "MyStudioPack",
        tag_color: "#12AB34",
        keywords: ["mystudio"],
        enabled: true,
        category: "Custom",
        include_paths: [],
        exclude_paths: [],
      },
    ];

    expect(detectLegacyFlatAutoTagRules(legacyRules)).toBe(true);
    const { rules } = upgradeLegacyAutoTagRuleset(legacyRules, []);
    expect(detectLegacyFlatAutoTagRules(rules)).toBe(false);

    const impactRule = rules.find((r) => r.tag_name === "Impact");
    expect(impactRule?.parent_tag_name).toBe("Action & Combat");
    expect(impactRule?.keywords).toContain("custom_slash");
    expect(impactRule?.include_paths).toEqual(["D:/SFX"]);

    const pokemonRule = rules.find((r) => r.tag_name === "Pokemon");
    expect(pokemonRule?.facet_slug).toBe("source");

    expect(rules.some((r) => r.tag_name === "Dog" && r.parent_tag_name === "Animals")).toBe(true);
    expect(rules.some((r) => r.tag_name === "MyStudioPack")).toBe(true);
  });

  it("computes width-aware visible chip limits so narrow GENRE/TAGS cells never squish into hollow frames", () => {
    // Narrow 115px GENRE column with 4 genres/moods shows 1 legible chip + "+3"
    expect(computeVisibleBadgeLimit(115, 4, 2)).toBe(1);
    expect(computeVisibleBadgeLimit(130, 2, 2)).toBe(1);
    // Wide 185px column comfortably shows 2 chips + "+2"
    expect(computeVisibleBadgeLimit(185, 4, 2)).toBe(2);
    expect(computeVisibleBadgeLimit(150, 2, 2)).toBe(2);
  });

  it("supports nested sub-genres and custom flat/nested facets across domains and worker queries", () => {
    const customFacets: TagFacet[] = [
      { id: 1, slug: "category", name: "Category", color: "#3B82F6", sort_order: 0, is_system: true, domain: "tags", allow_nesting: true },
      { id: 2, slug: "genre", name: "Genre", color: "#8B5CF6", sort_order: 1, is_system: true, domain: "genres", allow_nesting: true },
      { id: 3, slug: "mood", name: "Mood", color: "#EC4899", sort_order: 2, is_system: true, domain: "genres", allow_nesting: false },
      { id: 4, slug: "source", name: "Source / Pack", color: "#64748B", sort_order: 3, is_system: true, domain: "tags", allow_nesting: false },
      { id: 5, slug: "material", name: "Material", color: "#14B8A6", sort_order: 4, is_system: false, domain: "tags", allow_nesting: true },
      { id: 6, slug: "era", name: "Era", color: "#F59E0B", sort_order: 5, is_system: false, domain: "genres", allow_nesting: false },
    ];

    expect(getFacetsForDomain(customFacets, "tags").map((f) => f.slug)).toEqual([
      "category",
      "source",
      "material",
    ]);
    expect(getFacetsForDomain(customFacets, "genres").map((f) => f.slug)).toEqual([
      "genre",
      "mood",
      "era",
    ]);
    expect(isFacetHierarchical("genre", customFacets)).toBe(true);
    expect(isFacetHierarchical("mood", customFacets)).toBe(false);
    expect(isFacetHierarchical("material", customFacets)).toBe(true);
    expect(isFacetHierarchical("era", customFacets)).toBe(false);
    expect(resolveFacetDomain("material", customFacets)).toBe("tags");
    expect(resolveFacetDomain("era", customFacets)).toBe("genres");

    const extendedTags: Tag[] = [
      ...TAXONOMY_TAGS,
      {
        id: 100,
        name: "Electronic",
        color: "#8B5CF6",
        effective_color: "#8B5CF6",
        sample_count: 0,
        rollup_count: 2,
        facet_id: 2,
        facet_slug: "genre",
        parent_id: null,
        path: "/100/",
      },
      {
        id: 101,
        name: "Synthwave",
        color: "#8B5CF6",
        effective_color: "#8B5CF6",
        sample_count: 1,
        rollup_count: 2,
        facet_id: 2,
        facet_slug: "genre",
        parent_id: 100,
        path: "/100/101/",
        color_inherited: true,
      },
      {
        id: 102,
        name: "DarkSynth",
        color: "#8B5CF6",
        effective_color: "#8B5CF6",
        sample_count: 1,
        rollup_count: 1,
        facet_id: 2,
        facet_slug: "genre",
        parent_id: 101,
        path: "/100/101/102/",
        color_inherited: true,
      },
      {
        id: 200,
        name: "Metal",
        color: "#14B8A6",
        effective_color: "#14B8A6",
        sample_count: 0,
        rollup_count: 1,
        facet_id: 5,
        facet_slug: "material",
        parent_id: null,
        path: "/200/",
      },
      {
        id: 201,
        name: "Steel",
        color: "#14B8A6",
        effective_color: "#14B8A6",
        sample_count: 1,
        rollup_count: 1,
        facet_id: 5,
        facet_slug: "material",
        parent_id: 200,
        path: "/200/201/",
        color_inherited: true,
      },
      {
        id: 300,
        name: "80s",
        color: "#F59E0B",
        effective_color: "#F59E0B",
        sample_count: 1,
        rollup_count: 1,
        facet_id: 6,
        facet_slug: "era",
        parent_id: null,
        path: "/300/",
      },
    ];

    const index = buildTaxonomyIndex(extendedTags, customFacets);
    expect(index.domainByTagId.get(102)).toBe("genres");
    expect(index.domainByTagId.get(201)).toBe("tags");
    expect(index.domainByTagId.get(300)).toBe("genres");
    expect(index.breadcrumbByTagId.get(102)).toBe("Electronic ▸ Synthwave ▸ DarkSynth");
    expect(index.descendantsByTagId.get(100)?.includes(102)).toBe(true);
    expect(index.effectiveColorByTagId.get(101)).toBe(
      deriveChildTonalColor("#8B5CF6", "Synthwave", 2)
    );

    // Depth-3 guard on nested genre: DarkSynth (depth 3) cannot accept children under maxDepth=3
    const genreCandidates = getValidParentCandidates(
      extendedTags,
      10,
      "genre",
      customFacets
    );
    expect(genreCandidates.map((t) => t.id)).toContain(100);
    expect(genreCandidates.map((t) => t.id)).toContain(101);
    expect(genreCandidates.map((t) => t.id)).not.toContain(102);

    // Flat custom facet ("era") has no parent candidates
    expect(
      getValidParentCandidates(
        extendedTags,
        300,
        "era",
        customFacets
      )
    ).toEqual([]);

    // Catalog Worker supports rollup on nested genres + AND with custom facet
    const byId = new Map(extendedTags.map((t) => [t.id, t]));
    const customPool: SampleItem[] = [
      {
        ...SAMPLE_POOL[0],
        id: 50,
        file_name: "neon_blade.wav",
        tags: [102, 201, 300].map((id) => {
          const t = byId.get(id)!;
          return { id: t.id, name: t.name, color: t.color };
        }),
      },
      {
        ...SAMPLE_POOL[1],
        id: 51,
        file_name: "retro_pad.wav",
        tags: [101, 300].map((id) => {
          const t = byId.get(id)!;
          return { id: t.id, name: t.name, color: t.color };
        }),
      },
    ];
    const kernel = createCatalogWorkerKernel();
    kernel.handleMessage({ type: "set_pool", poolEpoch: 1, samples: customPool });
    kernel.handleMessage({
      type: "set_taxonomy",
      taxonomy: serializeTaxonomyForWorker(extendedTags, customFacets),
    });

    const queryIds = (selectedTagIds: number[]) => {
      const res = kernel.handleMessage({
        type: "filter_query",
        requestSeq: 1,
        poolEpoch: 1,
        params: {
          folderFilter: null,
          favoriteOnly: false,
          recentOnly: false,
          recentSampleIds: [],
          selectedTagIds,
          excludedTagIds: [],
          selectedGenre: null,
          selectedLicenseGroupId: null,
          licenseGroups: [],
          binFilterActive: false,
          binSampleIds: [],
          duplicateOrderIds: null,
          smartQuery: "",
          searchQuery: "",
          smartSearchSynonyms: false,
          typeFilter: "all",
          srFilter: null,
          sortKey: null,
          sortDir: "asc",
          similarity: null,
        },
      });
      if (res.response.type !== "filter_result") throw new Error("unexpected");
      return Array.from(res.response.filteredIds).sort((a, b) => a - b);
    };

    // Electronic (100) rolls up Synthwave (51) + DarkSynth (50)
    expect(queryIds([100])).toEqual([50, 51]);
    // Electronic (100) AND Metal (200 -> rolls up Steel on 50) -> 50 only
    expect(queryIds([100, 200])).toEqual([50]);
    // Custom genre-domain facet Era (300) matches both 50 and 51
    expect(queryIds([300])).toEqual([50, 51]);
  });
});
