import { describe, expect, it } from "vitest";
import { Collection, SampleItem } from "../types";
import { createCatalogWorkerKernel } from "./catalogWorkerKernel";
import { CATALOG_WORKER_THRESHOLD } from "./catalogWorkerProtocol";

function buildSyntheticPool(count: number): SampleItem[] {
  const pool = new Array<SampleItem>(count);
  const genres = ["SFX", "Ambience", "Drums", "Synth", "Foley"];
  const srChoices = [44100, 48000, 96000];
  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const isStereo = i % 3 !== 0;
    const isTargetHero = i % 100 === 42;
    pool[i] = {
      id,
      library_id: (i % 2) + 1,
      file_path: isTargetHero
        ? `F:/Audio/SFX/SciFi_Whoosh_${id}.wav`
        : `F:/Audio/${genres[i % genres.length]}/clip_${id}.wav`,
      file_name: isTargetHero ? `SciFi_Whoosh_${id}.wav` : `clip_${id}.wav`,
      folder_path: isTargetHero
        ? "F:/Audio/SFX"
        : `F:/Audio/${genres[i % genres.length]}`,
      extension: i % 5 === 0 ? "flac" : "wav",
      duration_ms: isTargetHero ? 1850 : 400 + (i % 6000),
      sample_rate: isTargetHero ? 48000 : srChoices[i % srChoices.length],
      channels: isTargetHero ? 2 : isStereo ? 2 : 1,
      bit_depth: isTargetHero ? 24 : i % 2 === 0 ? 24 : 16,
      file_size: isTargetHero ? 2_400_000 : 120_000 + (i % 8_000_000),
      file_modified_at: 1_700_000_000_000 + i,
      is_favorite: i % 20 === 0,
      is_loop: i % 7 === 0,
      genre: genres[i % genres.length],
      artist: i % 4 === 0 ? "AudifyStudio" : "",
      album: "",
      year: "2026",
      bpm: i % 3 === 0 ? 120 + (i % 20) : null,
      musical_key: "",
      camelot_key: "",
      peaks_json: "",
      created_at: "2026-11-17 00:00:00",
      tags:
        i % 50 === 0
          ? [{ id: 1, name: "Whoosh", color: "#38BDF8" }]
          : [],
    };
  }
  return pool;
}

const BENCHMARK_COLLECTIONS: Collection[] = [
  {
    id: 1,
    name: "HD Stereo Shots",
    color: "#38BDF8",
    icon: "zap",
    created_at: "2026-11-17",
    sample_count: 0,
    parent_id: null,
    smart_query: "channels:stereo sr:>=48k bit:24 <3s",
  },
  {
    id: 2,
    name: "Whoosh SFX",
    color: "#F59E0B",
    icon: "zap",
    created_at: "2026-11-17",
    sample_count: 0,
    parent_id: null,
    smart_query: "whoosh size:>1mb",
  },
  {
    id: 3,
    name: "Tagged Favorites",
    color: "#10B981",
    icon: "zap",
    created_at: "2026-11-17",
    sample_count: 0,
    parent_id: null,
    smart_query: "tag:whoosh is:fav",
  },
];

describe("Catalog Web Worker Kernel (50k & 150k scale)", () => {
  it("exposes expected worker offload threshold above small libraries", () => {
    expect(CATALOG_WORKER_THRESHOLD).toBeGreaterThanOrEqual(2000);
  });

  it("filters, searches with technical operators, and counts smart collections cleanly on 50k synthetic samples", () => {
    const kernel = createCatalogWorkerKernel();
    const pool = buildSyntheticPool(50_000);

    const tPoolStart = performance.now();
    const ack = kernel.handleMessage({
      type: "set_pool",
      poolEpoch: 1,
      samples: pool,
    });
    expect(ack.response).toEqual({ type: "pool_ack", poolEpoch: 1 });
    expect(kernel.getPoolSize()).toBe(50_000);

    const tFilterStart = performance.now();
    const queryRes = kernel.handleMessage({
      type: "filter_query",
      requestSeq: 10,
      poolEpoch: 1,
      params: {
        folderFilter: null,
        favoriteOnly: false,
        recentOnly: false,
        recentSampleIds: [],
        selectedTagIds: [],
        selectedGenre: null,
        selectedLicenseGroupId: null,
        licenseGroups: [],
        binFilterActive: false,
        binSampleIds: [],
        duplicateOrderIds: null,
        smartQuery: "",
        searchQuery: "whoosh channels:stereo sr:48k bit:24 size:>=1mb",
        smartSearchSynonyms: false,
        typeFilter: "oneshot",
        srFilter: 48000,
        sortKey: "name",
        sortDir: "asc",
        similarity: null,
      },
    });
    const filterElapsedMs = performance.now() - tFilterStart;

    expect(queryRes.response.type).toBe("filter_result");
    if (queryRes.response.type !== "filter_result") return;
    expect(queryRes.response.matched).toBe(true);
    // 50,000 samples / 100 hero cadence = 500 hero samples; i % 7 === 0 are loops -> ~429 oneshots
    expect(queryRes.response.filteredIds.length).toBeGreaterThan(400);
    expect(queryRes.response.filteredIds.length).toBeLessThanOrEqual(500);
    expect(queryRes.transfer.length).toBe(2);

    const tCountsStart = performance.now();
    const countsRes = kernel.handleMessage({
      type: "smart_counts",
      requestSeq: 11,
      poolEpoch: 1,
      collections: BENCHMARK_COLLECTIONS,
      enableSynonyms: true,
    });
    const countsElapsedMs = performance.now() - tCountsStart;

    expect(countsRes.response.type).toBe("smart_counts_result");
    if (countsRes.response.type !== "smart_counts_result") return;
    expect(countsRes.response.matched).toBe(true);
    expect(countsRes.response.counts[2]).toBe(500);
    expect(countsRes.response.counts[3]).toBeGreaterThan(0);

    const totalElapsedMs = performance.now() - tPoolStart;
    expect(filterElapsedMs).toBeLessThan(15000);
    expect(countsElapsedMs).toBeLessThan(15000);
    expect(totalElapsedMs).toBeLessThan(25000);
  });

  it("handles 150k synthetic archive queries and rejects stale poolEpoch requests", () => {
    const kernel = createCatalogWorkerKernel();
    const pool = buildSyntheticPool(150_000);

    kernel.handleMessage({
      type: "set_pool",
      poolEpoch: 7,
      samples: pool,
    });
    expect(kernel.getPoolSize()).toBe(150_000);

    const stale = kernel.handleMessage({
      type: "filter_query",
      requestSeq: 1,
      poolEpoch: 6,
      params: {
        folderFilter: null,
        favoriteOnly: false,
        recentOnly: false,
        recentSampleIds: [],
        selectedTagIds: [],
        selectedGenre: null,
        selectedLicenseGroupId: null,
        licenseGroups: [],
        binFilterActive: false,
        binSampleIds: [],
        duplicateOrderIds: null,
        smartQuery: "",
        searchQuery: "whoosh",
        smartSearchSynonyms: false,
        typeFilter: "all",
        srFilter: null,
        sortKey: null,
        sortDir: "asc",
        similarity: null,
      },
    });
    expect(stale.response.type).toBe("filter_result");
    if (stale.response.type === "filter_result") {
      expect(stale.response.matched).toBe(false);
      expect(stale.response.filteredIds.length).toBe(0);
    }

    const res = kernel.handleMessage({
      type: "filter_query",
      requestSeq: 2,
      poolEpoch: 7,
      params: {
        folderFilter: "F:/Audio/SFX",
        favoriteOnly: false,
        recentOnly: false,
        recentSampleIds: [],
        selectedTagIds: [],
        selectedGenre: null,
        selectedLicenseGroupId: null,
        licenseGroups: [],
        binFilterActive: false,
        binSampleIds: [],
        duplicateOrderIds: null,
        smartQuery: "",
        searchQuery: "whoosh",
        smartSearchSynonyms: false,
        typeFilter: "all",
        srFilter: null,
        sortKey: null,
        sortDir: "asc",
        similarity: null,
      },
    });
    expect(res.response.type).toBe("filter_result");
    if (res.response.type === "filter_result") {
      expect(res.response.matched).toBe(true);
      // 150k / 100 hero stems (1500) + 150k / 50 SFX folder samples tagged "Whoosh" (3000) = 4500
      expect(res.response.filteredIds.length).toBe(4500);
    }
  });

  it("supports incremental patch_pool updates and clear_search_cache without full pool replacement", () => {
    const kernel = createCatalogWorkerKernel();
    const pool = buildSyntheticPool(200);
    kernel.handleMessage({ type: "set_pool", poolEpoch: 1, samples: pool });

    const target = pool[5];
    expect(target.is_favorite).toBe(false);
    const patched = { ...target, is_favorite: true };
    const patchAck = kernel.handleMessage({
      type: "patch_pool",
      poolEpoch: 2,
      updates: [{ index: 5, sample: patched }],
    });
    expect(patchAck.response).toEqual({ type: "pool_ack", poolEpoch: 2 });

    const favRes = kernel.handleMessage({
      type: "filter_query",
      requestSeq: 1,
      poolEpoch: 2,
      params: {
        folderFilter: null,
        favoriteOnly: true,
        recentOnly: false,
        recentSampleIds: [],
        selectedTagIds: [],
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
    expect(favRes.response.type).toBe("filter_result");
    if (favRes.response.type === "filter_result") {
      expect(favRes.response.matched).toBe(true);
      expect(Array.from(favRes.response.filteredIds)).toContain(target.id);
    }

    const clearAck = kernel.handleMessage({ type: "clear_search_cache" });
    expect(clearAck.response).toEqual({ type: "pool_ack", poolEpoch: 2 });

    const removeAck = kernel.handleMessage({
      type: "remove_ids",
      poolEpoch: 3,
      ids: [target.id, pool[0].id],
    });
    expect(removeAck.response).toEqual({ type: "pool_ack", poolEpoch: 3 });
    expect(kernel.getPoolSize()).toBe(198);

    const afterRemove = kernel.handleMessage({
      type: "filter_query",
      requestSeq: 2,
      poolEpoch: 3,
      params: {
        folderFilter: null,
        favoriteOnly: true,
        recentOnly: false,
        recentSampleIds: [],
        selectedTagIds: [],
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
    expect(afterRemove.response.type).toBe("filter_result");
    if (afterRemove.response.type === "filter_result") {
      expect(afterRemove.response.matched).toBe(true);
      expect(Array.from(afterRemove.response.filteredIds)).not.toContain(
        target.id
      );
    }
  });

  it("filters and sorts by virtual external similarity anchor (anchorSampleId === -1)", () => {
    const kernel = createCatalogWorkerKernel();
    const pool = buildSyntheticPool(25);
    kernel.handleMessage({ type: "set_pool", poolEpoch: 1, samples: pool });

    const res = kernel.handleMessage({
      type: "filter_query",
      requestSeq: 1,
      poolEpoch: 1,
      params: {
        folderFilter: null,
        favoriteOnly: false,
        recentOnly: false,
        recentSampleIds: [],
        selectedTagIds: [],
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
        sortKey: "match",
        sortDir: "desc",
        similarity: {
          anchorSampleId: -1,
          minScore: 0.75,
          scoresEntries: [
            [pool[3].id, 0.81],
            [pool[10].id, 0.95],
            [pool[14].id, 0.62],
          ],
        },
      },
    });

    expect(res.response.type).toBe("filter_result");
    if (res.response.type === "filter_result") {
      expect(res.response.matched).toBe(true);
      expect(Array.from(res.response.filteredIds)).toEqual([
        pool[10].id,
        pool[3].id,
      ]);
    }
  });
});
