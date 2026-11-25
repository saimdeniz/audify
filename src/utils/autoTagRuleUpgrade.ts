import { DEFAULT_AUTO_TAG_RULES } from "../constants/autoTagRules";
import type { AutoTagCategoryConfig, AutoTagRule } from "../types";

const LEGACY_FLAT_NAMES = new Set([
  "combat",
  "whoosh",
  "explosion",
  "weapons",
  "magic",
  "fire",
  "water",
  "sci-fi",
  "ui",
  "animals",
  "pokemon",
  "footsteps",
  "weather",
  "ambience",
  "music",
]);

export function buildDefaultAutoTagCategories(
  rules: readonly AutoTagRule[] = DEFAULT_AUTO_TAG_RULES
): AutoTagCategoryConfig[] {
  const seen = new Set<string>();
  const out: AutoTagCategoryConfig[] = [];
  for (const r of rules) {
    const name = (r.category || r.parent_tag_name || "General").trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push({ name, include_paths: [], exclude_paths: [] });
    }
  }
  return out;
}

/**
 * Returns true when a profile's saved auto-tag rules still use the pre-taxonomy flat
 * structure (e.g. `SFX: Combat, Animals, Pokemon` with no `facet_slug`/`parent_tag_name`).
 */
export function detectLegacyFlatAutoTagRules(
  rules: readonly AutoTagRule[]
): boolean {
  if (rules.length === 0) return false;
  const hasSpeciesSubRules = rules.some(
    (r) =>
      (r.parent_tag_name || "").toLowerCase() === "animals" &&
      ["dog", "bird", "cat", "horse"].includes(r.tag_name.trim().toLowerCase())
  );
  for (const r of rules) {
    const lower = r.tag_name.trim().toLowerCase();
    if (!r.facet_slug && LEGACY_FLAT_NAMES.has(lower)) {
      return true;
    }
    if (lower === "combat" && !r.parent_tag_name) {
      return true;
    }
    if (lower === "animals" && !r.parent_tag_name && !hasSpeciesSubRules) {
      return true;
    }
    if (lower === "pokemon" && (r.facet_slug || "category") !== "source") {
      return true;
    }
  }
  return false;
}

function mergeUniqueKeywords(
  primary: readonly string[],
  extra: readonly string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...primary, ...extra]) {
    const clean = k.trim().toLowerCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/**
 * Non-destructively upgrades legacy flat auto-tag rules (`SFX: Combat, Animals, Pokemon...`)
 * to the 2-level Faceted & Nested Taxonomy rule set while preserving every custom user rule,
 * customized keyword, enabled state, duration bound, and folder include/exclude scope.
 */
export function upgradeLegacyAutoTagRuleset(
  existingRules: readonly AutoTagRule[],
  existingCategories: readonly AutoTagCategoryConfig[]
): {
  rules: AutoTagRule[];
  categories: AutoTagCategoryConfig[];
  upgradedCount: number;
} {
  const defaultByNameLower = new Map<string, AutoTagRule>();
  for (const def of DEFAULT_AUTO_TAG_RULES) {
    defaultByNameLower.set(def.tag_name.trim().toLowerCase(), def);
  }
  const catScopeByLower = new Map<string, AutoTagCategoryConfig>();
  for (const c of existingCategories) {
    catScopeByLower.set(c.name.trim().toLowerCase(), c);
  }

  const upgraded: AutoTagRule[] = [];
  const emittedLower = new Set<string>();
  let upgradedCount = 0;

  for (const rule of existingRules) {
    const lower = rule.tag_name.trim().toLowerCase();

    // Legacy broad flat `Animals` -> expand into 2-level Animals species rules preserving scopes
    if (lower === "animals" && !rule.parent_tag_name) {
      const animalSpeciesDefaults = DEFAULT_AUTO_TAG_RULES.filter(
        (d) => (d.parent_tag_name || "").toLowerCase() === "animals"
      );
      for (const sp of animalSpeciesDefaults) {
        const spLower = sp.tag_name.toLowerCase();
        if (emittedLower.has(spLower)) continue;
        emittedLower.add(spLower);
        upgraded.push({
          ...sp,
          enabled: rule.enabled,
          include_paths: rule.include_paths?.length
            ? [...rule.include_paths]
            : [],
          exclude_paths: rule.exclude_paths?.length
            ? [...rule.exclude_paths]
            : [],
          rel_include_paths: rule.rel_include_paths
            ? [...rule.rel_include_paths]
            : undefined,
          rel_exclude_paths: rule.rel_exclude_paths
            ? [...rule.rel_exclude_paths]
            : undefined,
          min_duration_ms: rule.min_duration_ms,
          max_duration_ms: rule.max_duration_ms,
        });
      }
      upgradedCount += 1;
      continue;
    }

    // Legacy `Combat` -> merge cleanly into `Action & Combat ▸ Impact`
    const canonicalMatch =
      lower === "combat"
        ? defaultByNameLower.get("impact")
        : defaultByNameLower.get(lower);

    if (canonicalMatch) {
      const targetLower = canonicalMatch.tag_name.toLowerCase();
      if (emittedLower.has(targetLower)) {
        // Merge keywords into already emitted canonical target
        const idx = upgraded.findIndex(
          (u) => u.tag_name.toLowerCase() === targetLower
        );
        if (idx >= 0) {
          upgraded[idx] = {
            ...upgraded[idx],
            keywords: mergeUniqueKeywords(
              upgraded[idx].keywords || [],
              rule.keywords || []
            ),
          };
        }
        upgradedCount += 1;
        continue;
      }
      emittedLower.add(targetLower);
      const changed =
        rule.tag_name !== canonicalMatch.tag_name ||
        rule.facet_slug !== canonicalMatch.facet_slug ||
        rule.parent_tag_name !== canonicalMatch.parent_tag_name ||
        rule.category !== canonicalMatch.category;
      if (changed) upgradedCount += 1;

      upgraded.push({
        ...rule,
        tag_name: canonicalMatch.tag_name,
        tag_color: canonicalMatch.tag_color,
        facet_slug: canonicalMatch.facet_slug,
        parent_tag_name: canonicalMatch.parent_tag_name,
        category: canonicalMatch.category,
        keywords: mergeUniqueKeywords(
          rule.keywords || [],
          canonicalMatch.keywords
        ),
      });
      continue;
    }

    // Custom user rule: keep intact, ensuring `facet_slug` defaults cleanly
    emittedLower.add(lower);
    upgraded.push({
      ...rule,
      facet_slug: rule.facet_slug || "category",
    });
  }

  // Append any newly introduced 2-level default rules not yet present
  for (const def of DEFAULT_AUTO_TAG_RULES) {
    const defLower = def.tag_name.toLowerCase();
    if (!emittedLower.has(defLower)) {
      emittedLower.add(defLower);
      upgraded.push({ ...def, keywords: [...def.keywords] });
      upgradedCount += 1;
    }
  }

  // Build clean category configs while preserving any custom folder scopes
  const nextCategories: AutoTagCategoryConfig[] = [];
  const seenCat = new Set<string>();
  const legacySfxScope = catScopeByLower.get("sfx");
  const legacyMusicScope = catScopeByLower.get("music");

  for (const rule of upgraded) {
    const catName = (rule.category || rule.parent_tag_name || "General").trim();
    const key = catName.toLowerCase();
    if (!catName || seenCat.has(key)) continue;
    seenCat.add(key);

    const existing = catScopeByLower.get(key);
    const inheritedScope =
      existing ||
      (key === "voice & music" ? legacyMusicScope : legacySfxScope);
    nextCategories.push({
      name: catName,
      include_paths: inheritedScope?.include_paths
        ? [...inheritedScope.include_paths]
        : [],
      exclude_paths: inheritedScope?.exclude_paths
        ? [...inheritedScope.exclude_paths]
        : [],
      rel_include_paths: inheritedScope?.rel_include_paths
        ? [...inheritedScope.rel_include_paths]
        : undefined,
      rel_exclude_paths: inheritedScope?.rel_exclude_paths
        ? [...inheritedScope.rel_exclude_paths]
        : undefined,
    });
  }

  return {
    rules: upgraded,
    categories: nextCategories,
    upgradedCount,
  };
}
