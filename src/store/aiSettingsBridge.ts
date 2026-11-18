import {
  AI_STORAGE_KEYS,
  clampAiConfidence,
  clampAiSimilarityScore,
  clampAiSimilarityTopK,
  DEFAULT_AI_AUTO_ANALYZE_ON_SCAN,
  DEFAULT_AI_CONFIDENCE_THRESHOLD,
  DEFAULT_AI_KNN_TAG_LEARNING,
  DEFAULT_AI_SIMILARITY_DURATION_MATCH,
  DEFAULT_AI_SIMILARITY_MIN_SCORE,
  DEFAULT_AI_SIMILARITY_SCOPE,
  DEFAULT_AI_SIMILARITY_TOP_K,
  DEFAULT_AI_TAGGING_MODE,
  normalizeAiSimilarityScope,
  normalizeAiTaggingMode,
} from "../constants/aiConfig";
import type { AiSimilarityScope, AiTaggingMode, ProfileSettings } from "../types";
import { safeGetItem } from "./localStorageSafe";

export interface AiBootSettingsSnapshot {
  aiAutoAnalyzeOnScan: boolean;
  aiTagConfidenceThreshold: number;
  aiTaggingMode: AiTaggingMode;
  aiKnnTagLearning: boolean;
  aiSimilarityMinScore: number;
  aiSimilarityTopK: number;
  aiSimilarityScope: AiSimilarityScope;
  aiSimilarityDurationMatch: boolean;
}

export function loadAiBootSettings(): AiBootSettingsSnapshot {
  const autoScanRaw = safeGetItem(AI_STORAGE_KEYS.autoAnalyzeOnScan);
  const confRaw = safeGetItem(AI_STORAGE_KEYS.tagConfidenceThreshold);
  const modeRaw = safeGetItem(AI_STORAGE_KEYS.taggingMode);
  const knnRaw = safeGetItem(AI_STORAGE_KEYS.knnTagLearning);
  const simScoreRaw = safeGetItem(AI_STORAGE_KEYS.similarityMinScore);
  const topKRaw = safeGetItem(AI_STORAGE_KEYS.similarityTopK);
  const scopeRaw = safeGetItem(AI_STORAGE_KEYS.similarityScope);
  const durationMatchRaw = safeGetItem(AI_STORAGE_KEYS.similarityDurationMatch);

  return {
    aiAutoAnalyzeOnScan: autoScanRaw === "true" ? true : DEFAULT_AI_AUTO_ANALYZE_ON_SCAN,
    aiTagConfidenceThreshold: confRaw
      ? clampAiConfidence(Number(confRaw))
      : DEFAULT_AI_CONFIDENCE_THRESHOLD,
    aiTaggingMode: modeRaw ? normalizeAiTaggingMode(modeRaw) : DEFAULT_AI_TAGGING_MODE,
    aiKnnTagLearning: knnRaw !== null ? knnRaw === "true" : DEFAULT_AI_KNN_TAG_LEARNING,
    aiSimilarityMinScore: simScoreRaw
      ? clampAiSimilarityScore(Number(simScoreRaw))
      : DEFAULT_AI_SIMILARITY_MIN_SCORE,
    aiSimilarityTopK: topKRaw
      ? clampAiSimilarityTopK(Number(topKRaw))
      : DEFAULT_AI_SIMILARITY_TOP_K,
    aiSimilarityScope: scopeRaw
      ? normalizeAiSimilarityScope(scopeRaw)
      : DEFAULT_AI_SIMILARITY_SCOPE,
    aiSimilarityDurationMatch:
      durationMatchRaw !== null
        ? durationMatchRaw === "true"
        : DEFAULT_AI_SIMILARITY_DURATION_MATCH,
  };
}

export function sanitizeAiProfileSettings(out: Record<string, unknown>): void {
  if (
    out.aiAutoAnalyzeOnScan !== undefined &&
    typeof out.aiAutoAnalyzeOnScan !== "boolean"
  ) {
    delete out.aiAutoAnalyzeOnScan;
  }
  if (out.aiTagConfidenceThreshold !== undefined) {
    if (
      typeof out.aiTagConfidenceThreshold !== "number" ||
      !Number.isFinite(out.aiTagConfidenceThreshold)
    ) {
      delete out.aiTagConfidenceThreshold;
    } else {
      out.aiTagConfidenceThreshold = clampAiConfidence(out.aiTagConfidenceThreshold);
    }
  }
  if (out.aiTaggingMode !== undefined) {
    out.aiTaggingMode = normalizeAiTaggingMode(out.aiTaggingMode);
  }
  if (out.aiSimilarityMinScore !== undefined) {
    if (
      typeof out.aiSimilarityMinScore !== "number" ||
      !Number.isFinite(out.aiSimilarityMinScore)
    ) {
      delete out.aiSimilarityMinScore;
    } else {
      out.aiSimilarityMinScore = clampAiSimilarityScore(out.aiSimilarityMinScore);
    }
  }
  if (out.aiSimilarityTopK !== undefined) {
    if (
      typeof out.aiSimilarityTopK !== "number" ||
      !Number.isFinite(out.aiSimilarityTopK)
    ) {
      delete out.aiSimilarityTopK;
    } else {
      out.aiSimilarityTopK = clampAiSimilarityTopK(out.aiSimilarityTopK);
    }
  }
  if (out.aiSimilarityScope !== undefined) {
    out.aiSimilarityScope = normalizeAiSimilarityScope(out.aiSimilarityScope);
  }
  if (
    out.aiSimilarityDurationMatch !== undefined &&
    typeof out.aiSimilarityDurationMatch !== "boolean"
  ) {
    delete out.aiSimilarityDurationMatch;
  }
  if (
    out.aiKnnTagLearning !== undefined &&
    typeof out.aiKnnTagLearning !== "boolean"
  ) {
    delete out.aiKnnTagLearning;
  }
}

export interface ResolvedAiProfileFields {
  aiAutoAnalyzeOnScan: boolean;
  aiTagConfidenceThreshold: number;
  aiTaggingMode: AiTaggingMode;
  aiKnnTagLearning: boolean;
  aiSimilarityMinScore: number;
  aiSimilarityTopK: number;
  aiSimilarityScope: AiSimilarityScope;
  aiSimilarityDurationMatch: boolean;
}

export function resolveAiSettingsFields(
  parsed: ProfileSettings,
  isBoot: boolean,
  cur: ResolvedAiProfileFields
): {
  fields: ResolvedAiProfileFields;
  storagePairs: Array<[string, string]>;
} {
  const aiAutoAnalyzeOnScan =
    parsed.aiAutoAnalyzeOnScan ??
    (isBoot ? cur.aiAutoAnalyzeOnScan : DEFAULT_AI_AUTO_ANALYZE_ON_SCAN);
  const aiTagConfidenceThreshold =
    parsed.aiTagConfidenceThreshold !== undefined
      ? clampAiConfidence(parsed.aiTagConfidenceThreshold)
      : isBoot
      ? cur.aiTagConfidenceThreshold
      : DEFAULT_AI_CONFIDENCE_THRESHOLD;
  const aiTaggingMode =
    parsed.aiTaggingMode !== undefined
      ? normalizeAiTaggingMode(parsed.aiTaggingMode)
      : isBoot
      ? cur.aiTaggingMode
      : DEFAULT_AI_TAGGING_MODE;
  const aiKnnTagLearning =
    parsed.aiKnnTagLearning ??
    (isBoot ? cur.aiKnnTagLearning : DEFAULT_AI_KNN_TAG_LEARNING);
  const aiSimilarityMinScore =
    parsed.aiSimilarityMinScore !== undefined
      ? clampAiSimilarityScore(parsed.aiSimilarityMinScore)
      : isBoot
      ? cur.aiSimilarityMinScore
      : DEFAULT_AI_SIMILARITY_MIN_SCORE;
  const aiSimilarityTopK =
    parsed.aiSimilarityTopK !== undefined
      ? clampAiSimilarityTopK(parsed.aiSimilarityTopK)
      : isBoot
      ? cur.aiSimilarityTopK
      : DEFAULT_AI_SIMILARITY_TOP_K;
  const aiSimilarityScope =
    parsed.aiSimilarityScope !== undefined
      ? normalizeAiSimilarityScope(parsed.aiSimilarityScope)
      : isBoot
      ? cur.aiSimilarityScope
      : DEFAULT_AI_SIMILARITY_SCOPE;
  const aiSimilarityDurationMatch =
    parsed.aiSimilarityDurationMatch ??
    (isBoot ? cur.aiSimilarityDurationMatch : DEFAULT_AI_SIMILARITY_DURATION_MATCH);

  const fields: ResolvedAiProfileFields = {
    aiAutoAnalyzeOnScan,
    aiTagConfidenceThreshold,
    aiTaggingMode,
    aiKnnTagLearning,
    aiSimilarityMinScore,
    aiSimilarityTopK,
    aiSimilarityScope,
    aiSimilarityDurationMatch,
  };

  const storagePairs: Array<[string, string]> = [
    [AI_STORAGE_KEYS.autoAnalyzeOnScan, String(aiAutoAnalyzeOnScan)],
    [AI_STORAGE_KEYS.tagConfidenceThreshold, String(aiTagConfidenceThreshold)],
    [AI_STORAGE_KEYS.taggingMode, aiTaggingMode],
    [AI_STORAGE_KEYS.knnTagLearning, String(aiKnnTagLearning)],
    [AI_STORAGE_KEYS.similarityMinScore, String(aiSimilarityMinScore)],
    [AI_STORAGE_KEYS.similarityTopK, String(aiSimilarityTopK)],
    [AI_STORAGE_KEYS.similarityScope, aiSimilarityScope],
    [AI_STORAGE_KEYS.similarityDurationMatch, String(aiSimilarityDurationMatch)],
  ];

  return { fields, storagePairs };
}
