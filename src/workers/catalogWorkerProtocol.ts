import {
  Collection,
  LicenseGroup,
  SampleItem,
  SampleRateFilter,
  SortDir,
  SortKey,
  TypeFilter,
} from "../types";

/** Threshold at which filtering, sorting & smart collection counts run off the UI thread. */
export const CATALOG_WORKER_THRESHOLD = 4000;

export interface CatalogWorkerSimilarityFilter {
  anchorSampleId: number;
  minScore: number;
  scoresEntries: Array<[number, number]>;
}

export interface CatalogFilterQueryParams {
  folderFilter: string | null;
  favoriteOnly: boolean;
  recentOnly: boolean;
  recentSampleIds: number[];
  selectedTagIds: number[];
  selectedGenre: string | null;
  selectedLicenseGroupId: string | null;
  licenseGroups: LicenseGroup[];
  binFilterActive: boolean;
  binSampleIds: number[];
  duplicateOrderIds: number[] | null;
  smartQuery: string;
  searchQuery: string;
  smartSearchSynonyms: boolean;
  typeFilter: TypeFilter;
  srFilter: SampleRateFilter;
  sortKey: SortKey | null;
  sortDir: SortDir;
  similarity: CatalogWorkerSimilarityFilter | null;
}

export interface CatalogPoolPatchEntry {
  index: number;
  sample: SampleItem;
}

export type CatalogWorkerRequest =
  | {
      type: "set_pool";
      poolEpoch: number;
      samples: SampleItem[];
    }
  | {
      type: "patch_pool";
      poolEpoch: number;
      updates: CatalogPoolPatchEntry[];
    }
  | {
      type: "patch_mtimes";
      poolEpoch: number;
      ids: Int32Array;
      mtimes: Float64Array;
    }
  | {
      type: "remove_ids";
      poolEpoch: number;
      ids: number[];
    }
  | {
      type: "clear_search_cache";
    }
  | {
      type: "filter_query";
      requestSeq: number;
      poolEpoch: number;
      params: CatalogFilterQueryParams;
    }
  | {
      type: "smart_counts";
      requestSeq: number;
      poolEpoch: number;
      collections: Collection[];
      enableSynonyms: boolean;
    };

export type CatalogWorkerResponse =
  | {
      type: "pool_ack";
      poolEpoch: number;
    }
  | {
      type: "filter_result";
      requestSeq: number;
      poolEpoch: number;
      matched: boolean;
      rawIds: Int32Array;
      filteredIds: Int32Array;
    }
  | {
      type: "smart_counts_result";
      requestSeq: number;
      poolEpoch: number;
      matched: boolean;
      counts: Record<number, number>;
    };
