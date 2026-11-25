import React, { useEffect, useMemo, useState } from "react";
import { GitMerge, Palette, Plus, X } from "lucide-react";
import type { Tag, TagFacet, TaxonomyDomain, TaxonomyFacetSlug } from "../../types";
import {
  getFacetLabel,
  getFacetsForDomain,
  getSharedTaxonomyIndex,
  getValidParentCandidates,
  isFacetHierarchical,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";
import { ColorPickerPopover } from "../ColorPickerPopover";
import { ThemedSelect, type ThemedSelectOption } from "../common/ThemedSelect";

interface TagLibraryInspectorFieldsProps {
  domain?: TaxonomyDomain;
  tag: Tag;
  allTags: readonly Tag[];
  facets?: readonly TagFacet[];
  onRename: (tagId: number, newName: string) => Promise<void>;
  onUpdateColor: (tagId: number, newColor: string) => Promise<void>;
  onUpdateTaxonomy: (
    tagId: number,
    patch: {
      facetSlug?: TaxonomyFacetSlug;
      parentId?: number | null;
      clearParent?: boolean;
      colorInherited?: boolean;
      aliases?: string[];
    }
  ) => Promise<Tag | null>;
  onMerge: (
    sourceTagId: number,
    targetTagId: number,
    addSourceAsAlias?: boolean
  ) => Promise<Tag | null>;
  onHarmonizeParent?: (parentTagId: number) => Promise<number>;
  onSelectTagId?: (id: number) => void;
}

export const TagLibraryInspectorFields: React.FC<
  TagLibraryInspectorFieldsProps
> = ({
  domain = "tags",
  tag,
  allTags,
  facets = [],
  onRename,
  onUpdateColor,
  onUpdateTaxonomy,
  onMerge,
  onHarmonizeParent,
  onSelectTagId,
}) => {
  const [nameDraft, setNameDraft] = useState(tag.name);
  const [aliasDraft, setAliasDraft] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [harmonizing, setHarmonizing] = useState(false);

  useEffect(() => {
    setNameDraft(tag.name);
    setAliasDraft("");
    setMergeTargetId("");
  }, [tag.id, tag.name]);

  const isGenres = domain === "genres";
  const itemNoun = isGenres ? "genre" : "tag";
  const subNoun = isGenres ? "sub-genre" : "sub-tag";

  const domainFacets = useMemo(
    () => getFacetsForDomain(facets, domain),
    [facets, domain]
  );
  const domainFacetSet = useMemo(
    () => new Set<TaxonomyFacetSlug>(domainFacets.map((f) => f.slug)),
    [domainFacets]
  );

  const taxonomy = useMemo(
    () => getSharedTaxonomyIndex(allTags, facets),
    [allTags, facets]
  );
  const facet = resolveTagFacetSlug(tag, facets);
  const facetLabel = getFacetLabel(facet, facets);
  const hierarchical = isFacetHierarchical(facet, facets);
  const effectiveColor = taxonomy.effectiveColorByTagId.get(tag.id) ?? tag.color;
  const aliases = tag.aliases ?? [];

  const parentCandidates = useMemo(
    () =>
      hierarchical ? getValidParentCandidates(allTags, tag.id, facet, facets) : [],
    [allTags, tag.id, facet, facets, hierarchical]
  );

  const nonInheritedSubTags = useMemo(() => {
    const descIds = taxonomy.descendantsByTagId.get(tag.id) ?? [];
    return descIds
      .filter((id) => id !== tag.id)
      .map((id) => taxonomy.byId.get(id))
      .filter((t): t is Tag => Boolean(t && !t.color_inherited));
  }, [taxonomy, tag.id]);

  const mergeCandidates = useMemo(() => {
    const descSet = new Set(taxonomy.descendantsByTagId.get(tag.id) ?? [tag.id]);
    return allTags
      .filter(
        (t) =>
          !descSet.has(t.id) &&
          domainFacetSet.has(resolveTagFacetSlug(t, facets))
      )
      .sort((a, b) =>
        (taxonomy.breadcrumbByTagId.get(a.id) ?? a.name).localeCompare(
          taxonomy.breadcrumbByTagId.get(b.id) ?? b.name
        )
      );
  }, [allTags, tag.id, taxonomy, domainFacetSet, facets]);

  const facetOptions = useMemo<ThemedSelectOption[]>(
    () =>
      domainFacets.map((f) => ({
        value: f.slug,
        label: f.name,
      })),
    [domainFacets]
  );

  const parentOptions = useMemo<ThemedSelectOption[]>(
    () => [
      { value: "", label: `(Root ${facetLabel})` },
      ...parentCandidates.map((p) => ({
        value: String(p.id),
        label: taxonomy.breadcrumbByTagId.get(p.id) ?? p.name,
        color: taxonomy.effectiveColorByTagId.get(p.id) ?? p.color,
      })),
    ],
    [parentCandidates, taxonomy, facetLabel]
  );

  const mergeOptions = useMemo<ThemedSelectOption[]>(
    () =>
      mergeCandidates.map((c) => {
        const cFacet = resolveTagFacetSlug(c, facets);
        return {
          value: String(c.id),
          label: taxonomy.breadcrumbByTagId.get(c.id) ?? c.name,
          color:
            cFacet === "source"
              ? undefined
              : taxonomy.effectiveColorByTagId.get(c.id) ?? c.color,
          badge: getFacetLabel(cFacet, facets),
        };
      }),
    [mergeCandidates, taxonomy, facets]
  );

  const handleHarmonizeSubTags = async () => {
    if (nonInheritedSubTags.length === 0 || harmonizing) return;
    setHarmonizing(true);
    try {
      if (onHarmonizeParent) {
        await onHarmonizeParent(tag.id);
      } else {
        for (const child of nonInheritedSubTags) {
          await onUpdateTaxonomy(child.id, { colorInherited: true });
        }
      }
    } finally {
      setHarmonizing(false);
    }
  };

  const handleAddAlias = async () => {
    const clean = aliasDraft.trim();
    if (!clean) return;
    if (
      clean.toLowerCase() === tag.name.toLowerCase() ||
      aliases.some((a) => a.toLowerCase() === clean.toLowerCase())
    ) {
      setAliasDraft("");
      return;
    }
    const next = [...aliases, clean];
    setAliasDraft("");
    await onUpdateTaxonomy(tag.id, { aliases: next });
  };

  return (
    <div className="space-y-2.5">
      {/* Name + Compact Color Row */}
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
            NAME
          </label>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={async () => {
              const clean = nameDraft.trim();
              if (clean && clean !== tag.name) {
                await onRename(tag.id, clean);
              } else {
                setNameDraft(tag.name);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setNameDraft(tag.name);
                e.currentTarget.blur();
              }
            }}
            className="w-full h-[28px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-mono text-fg outline-none rounded-xs transition-colors"
          />
        </div>

        <div className="shrink-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
              COLOR
            </label>
            {tag.parent_id != null && tag.color_inherited && (
              <span className="text-[8.5px] font-mono text-fg-3">
                auto shade
              </span>
            )}
            {tag.parent_id == null &&
              facet === "source" &&
              tag.color_inherited && (
                <span className="text-[8.5px] font-mono text-fg-3">neutral</span>
              )}
          </div>
          <div className="h-[28px] px-2 flex items-center space-x-2 bg-surface-2 border border-line rounded-xs">
            <ColorPickerPopover
              color={effectiveColor}
              onChange={(c) => void onUpdateColor(tag.id, c)}
              triggerSize="xs"
              align="right"
              title="Open 16M Color Picker (HSV / Hex / Random)"
            />
            <span className="font-mono text-[10.5px] font-semibold text-fg uppercase">
              {effectiveColor}
            </span>
          </div>
        </div>
      </div>

      {/* Contextual Color Harmony Action (only shown when sub-tags or custom override need 1-click sync) */}
      {(nonInheritedSubTags.length > 0 ||
        ((tag.parent_id != null || facet === "source") &&
          !tag.color_inherited)) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {nonInheritedSubTags.length > 0 && (
            <button
              type="button"
              disabled={harmonizing}
              onClick={() => void handleHarmonizeSubTags()}
              className="h-[20px] px-2 rounded-[2px] bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent/50 text-accent-fg font-mono text-[9.5px] inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
              title={`Automatically derive harmonious tonal shades of "${tag.name}"'s color for ${nonInheritedSubTags.length} ${subNoun}(s)`}
            >
              <Palette className="w-2.5 h-2.5 shrink-0" />
              <span>
                {harmonizing
                  ? "Harmonizing..."
                  : `Harmonize ${nonInheritedSubTags.length} ${subNoun}${
                      nonInheritedSubTags.length > 1 ? "s" : ""
                    }`}
              </span>
            </button>
          )}
          {(tag.parent_id != null || facet === "source") &&
            !tag.color_inherited && (
              <button
                type="button"
                onClick={() =>
                  void onUpdateTaxonomy(tag.id, { colorInherited: true })
                }
                className="h-[20px] px-2 rounded-[2px] bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent/50 text-accent-fg font-mono text-[9.5px] inline-flex items-center gap-1 transition-colors cursor-pointer"
                title={
                  tag.parent_id != null
                    ? "Reset to automatic harmonious shade of parent's color"
                    : "Reset to neutral Source / Pack tone"
                }
              >
                <Palette className="w-2.5 h-2.5 shrink-0" />
                <span>
                  {tag.parent_id != null
                    ? "Use parent shade"
                    : "Use neutral tone"}
                </span>
              </button>
            )}
        </div>
      )}

      {/* Facet & Parent Row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
            FACET
          </label>
          <ThemedSelect
            value={facet}
            options={facetOptions}
            ariaLabel={isGenres ? "Genre Group" : "Tag Facet"}
            onChange={(val) => {
              const nextFacet = val as TaxonomyFacetSlug;
              void onUpdateTaxonomy(tag.id, {
                facetSlug: nextFacet,
                clearParent: true,
              });
            }}
          />
        </div>

        {hierarchical ? (
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
              PARENT {facetLabel.toUpperCase()}
            </label>
            <ThemedSelect
              value={tag.parent_id ? String(tag.parent_id) : ""}
              options={parentOptions}
              ariaLabel={`Parent ${facetLabel}`}
              onChange={(val) => {
                if (!val) {
                  void onUpdateTaxonomy(tag.id, { clearParent: true });
                } else {
                  void onUpdateTaxonomy(tag.id, { parentId: Number(val) });
                }
              }}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
              STRUCTURE
            </label>
            <div className="h-[28px] px-2 flex items-center bg-surface-soft border border-line rounded-xs text-[10px] font-mono text-fg-3">
              Flat ({facetLabel})
            </div>
          </div>
        )}
      </div>

      {/* Aliases */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
          SEARCH ALIASES ({aliases.length})
        </label>
        <div className="flex flex-wrap gap-1">
          {aliases.map((alias) => (
            <span
              key={alias}
              className="inline-flex items-center gap-1 h-[20px] px-1.5 rounded-[2px] bg-surface-2 border border-line text-[10.5px] font-mono text-fg-2"
            >
              <span>{alias}</span>
              <button
                type="button"
                onClick={() =>
                  void onUpdateTaxonomy(tag.id, {
                    aliases: aliases.filter((a) => a !== alias),
                  })
                }
                className="text-fg-3 hover:text-accent-fg"
                title={`Remove alias "${alias}"`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAddAlias();
              }
            }}
            placeholder={
              isGenres
                ? "Add search alias (e.g. OST, Synthpop)..."
                : "Add search alias (e.g. Voice, Hit)..."
            }
            className="flex-1 h-[26px] bg-surface-2 border border-line focus:border-accent px-2 text-[10.5px] font-mono text-fg placeholder-fg-3 outline-none rounded-xs"
          />
          <button
            type="button"
            onClick={() => void handleAddAlias()}
            disabled={!aliasDraft.trim()}
            className="h-[26px] px-2 rounded-xs bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg disabled:opacity-40 inline-flex items-center justify-center transition-colors"
            title="Add alias"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Merge into another item */}
      {mergeCandidates.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-line-subtle">
          <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
            {isGenres ? "MERGE INTO ANOTHER GENRE" : "MERGE INTO ANOTHER TAG"}
          </label>
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <ThemedSelect
                value={mergeTargetId}
                options={mergeOptions}
                placeholder={`Select target ${itemNoun}...`}
                searchable={true}
                ariaLabel={`Merge into target ${itemNoun}`}
                triggerClassName="h-[26px] text-[10.5px]"
                onChange={(val) => setMergeTargetId(val)}
              />
            </div>
            <button
              type="button"
              disabled={!mergeTargetId}
              onClick={async () => {
                const targetId = Number(mergeTargetId);
                if (!targetId) return;
                const merged = await onMerge(tag.id, targetId, true);
                if (merged) {
                  setMergeTargetId("");
                  onSelectTagId?.(merged.id);
                }
              }}
              className="h-[26px] px-2 rounded-xs bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-[10px] font-mono text-fg-2 hover:text-accent-fg disabled:opacity-40 inline-flex items-center gap-1 shrink-0 transition-colors"
              title={`Merge "${tag.name}" into selected target and preserve name as search alias`}
            >
              <GitMerge className="w-3 h-3" />
              <span>Merge</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
