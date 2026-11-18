import type { AiSimilarityScope, AiTaggingMode } from "../types";
import { AUDIFY_STORAGE_KEYS } from "./storageKeys";

export const AI_STORAGE_KEYS = {
  autoAnalyzeOnScan: AUDIFY_STORAGE_KEYS.aiAutoAnalyzeOnScan,
  tagConfidenceThreshold: AUDIFY_STORAGE_KEYS.aiTagConfidenceThreshold,
  taggingMode: AUDIFY_STORAGE_KEYS.aiTaggingMode,
  knnTagLearning: AUDIFY_STORAGE_KEYS.aiKnnTagLearning,
  similarityMinScore: AUDIFY_STORAGE_KEYS.aiSimilarityMinScore,
  similarityTopK: AUDIFY_STORAGE_KEYS.aiSimilarityTopK,
  similarityScope: AUDIFY_STORAGE_KEYS.aiSimilarityScope,
  similarityDurationMatch: AUDIFY_STORAGE_KEYS.aiSimilarityDurationMatch,
} as const;

export const DEFAULT_AI_AUTO_ANALYZE_ON_SCAN = false;
export const DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.72;
export const DEFAULT_AI_TAGGING_MODE: AiTaggingMode = "suggest";
export const DEFAULT_AI_KNN_TAG_LEARNING = true;
export const DEFAULT_AI_SIMILARITY_MIN_SCORE = 0.7;
export const DEFAULT_AI_SIMILARITY_TOP_K = 100;
export const DEFAULT_AI_SIMILARITY_SCOPE: AiSimilarityScope = "profile";

export const AI_CONFIDENCE_BOUNDS = { min: 0.25, max: 0.98 } as const;
export const AI_SIMILARITY_SCORE_BOUNDS = { min: 0.35, max: 0.95 } as const;
export const AI_SIMILARITY_TOP_K_BOUNDS = { min: 10, max: 500 } as const;

export function clampAiConfidence(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_AI_CONFIDENCE_THRESHOLD;
  return Number(
    Math.max(
      AI_CONFIDENCE_BOUNDS.min,
      Math.min(AI_CONFIDENCE_BOUNDS.max, n)
    ).toFixed(2)
  );
}

export function clampAiSimilarityScore(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_AI_SIMILARITY_MIN_SCORE;
  return Number(
    Math.max(
      AI_SIMILARITY_SCORE_BOUNDS.min,
      Math.min(AI_SIMILARITY_SCORE_BOUNDS.max, n)
    ).toFixed(2)
  );
}

export function clampAiSimilarityTopK(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_AI_SIMILARITY_TOP_K;
  return Math.round(
    Math.max(
      AI_SIMILARITY_TOP_K_BOUNDS.min,
      Math.min(AI_SIMILARITY_TOP_K_BOUNDS.max, n)
    )
  );
}

export const DEFAULT_AI_SIMILARITY_DURATION_MATCH = false;

export function normalizeAiTaggingMode(raw: unknown): AiTaggingMode {
  if (raw === "vectors_only") return "vectors_only";
  if (raw === "auto_apply") return "auto_apply";
  return "suggest";
}

export function normalizeAiSimilarityScope(raw: unknown): AiSimilarityScope {
  return raw === "folder" ? "folder" : "profile";
}
