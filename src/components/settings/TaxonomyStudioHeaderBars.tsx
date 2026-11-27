import React from "react";
import { ChevronsDown, ChevronsUp, GripVertical, Search, X } from "lucide-react";
import { deterministicColorForName } from "../../utils/taxonomyColor";
import type { StudioDragVisual } from "../../hooks/useStudioPointerDrag";
import type {
  Tag,
  TagFacet,
  TaxonomyDomain,
  TaxonomyFacetSlug,
} from "../../types";
import { getFacetDefaultColor } from "../../utils/taxonomyTree";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { CustomFacetPopover } from "./CustomFacetPopover";

export type FacetFilterOption = "all" | TaxonomyFacetSlug;

export type StudioDragPayload =
  | { kind: "tag"; id: number }
  | { kind: "facet"; id: number };

interface TaxonomyStudioHeaderBarsProps {
  domain: TaxonomyDomain;
  dropScope: string;
  domainFacets: readonly TagFacet[];
  allFacets: readonly TagFacet[];
  domainTagsCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  facetFilter: FacetFilterOption;
  onFacetFilterChange: (f: FacetFilterOption) => void;
  defaultFacetSlug: TaxonomyFacetSlug;
  draggingTagId: number | null;
  draggingFacetId: number | null;
  activeDropKey: string | null;
  onExpandAllClick: () => void;
  onCollapseAllClick: () => void;
  onBeginFacetDrag: (
    e: React.MouseEvent,
    payload: StudioDragPayload,
    visual: StudioDragVisual
  ) => void;
  onCreateTag: (
    name: string,
    color: string,
    opts?: {
      facetSlug?: TaxonomyFacetSlug;
      parentId?: number | null;
      colorInherited?: boolean;
    }
  ) => Promise<Tag | null>;
  onSelectTag: (id: number) => void;
  onCreateFacet: (
    name: string,
    domain: TaxonomyDomain,
    color: string,
    allowNesting: boolean
  ) => Promise<TagFacet | null>;
  onUpdateFacet: (
    facetId: number,
    patch: { name?: string; color?: string; allowNesting?: boolean }
  ) => Promise<TagFacet | null>;
  onDeleteFacet: (facetId: number) => Promise<number | null>;
}

export const TaxonomyStudioHeaderBars: React.FC<
  TaxonomyStudioHeaderBarsProps
> = ({
  domain,
  dropScope,
  domainFacets,
  allFacets,
  domainTagsCount,
  searchQuery,
  onSearchChange,
  facetFilter,
  onFacetFilterChange,
  defaultFacetSlug,
  draggingTagId,
  draggingFacetId,
  activeDropKey,
  onExpandAllClick,
  onCollapseAllClick,
  onBeginFacetDrag,
  onCreateTag,
  onSelectTag,
  onCreateFacet,
  onUpdateFacet,
  onDeleteFacet,
}) => {
  const isGenres = domain === "genres";
  const canDragFacets = domainFacets.length > 1;

  return (
    <>
      {/* Top Toolbar: Search + Expand/Collapse + Quick Create */}
      <div className="h-[36px] px-2 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              isGenres
                ? "Search genres, moods & aliases..."
                : "Search tags & aliases..."
            }
            className="w-full h-[24px] rounded-xs bg-surface-2 border border-line focus:border-accent pl-8 pr-6 text-[10px] font-mono text-fg placeholder-fg-3 outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onExpandAllClick}
          className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-3 hover:text-fg flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          title="Expand All Sections & Nested Items"
        >
          <ChevronsDown className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onCollapseAllClick}
          className="w-[24px] h-[24px] rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-fg-3 hover:text-fg flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          title="Collapse Nested Items & Sections"
        >
          <ChevronsUp className="w-3.5 h-3.5" />
        </button>

        <QuickCreatePopover
          title={isGenres ? "New Genre / Mood" : "New Tag"}
          placeholder={isGenres ? "Genre or mood name..." : "Tag name..."}
          hasColor={defaultFacetSlug !== "source"}
          buttonTitle={isGenres ? "Add Genre / Mood" : "Add Root Tag"}
          onCreated={async (name, color) => {
            const created = await onCreateTag(
              name,
              color ||
                getFacetDefaultColor(defaultFacetSlug, allFacets) ||
                deterministicColorForName(name),
              {
                facetSlug: defaultFacetSlug,
                colorInherited: defaultFacetSlug === "source",
              }
            );
            if (!created) return false;
            onSelectTag(created.id);
            return true;
          }}
        />
      </div>

      {/* Facet Filter Pill Bar + Drag-to-Reorder + Custom Facet Creation/Edit */}
      <div className="px-2 py-1.5 bg-surface-sub border-b border-line flex items-center gap-1 flex-wrap shrink-0 select-none">
        <button
          type="button"
          onClick={() => onFacetFilterChange("all")}
          className={`h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase border transition-colors cursor-pointer ${
            facetFilter === "all"
              ? "bg-accent-soft border-accent text-accent-fg font-semibold"
              : "bg-surface-2 border-line text-fg-3 hover:text-fg"
          }`}
        >
          ALL ({domainTagsCount})
        </button>

        {domainFacets.map((facet) => {
          const pillDropKey = `pill:${facet.slug}`;
          const fBeforeKey = `fbefore:${facet.id}`;
          const fAfterKey = `fafter:${facet.id}`;
          const isDropHover = activeDropKey === pillDropKey;
          const isBeforeHover = activeDropKey === fBeforeKey;
          const isAfterHover = activeDropKey === fAfterKey;
          const isDraggingSelf = draggingFacetId === facet.id;
          const isActive = facetFilter === facet.slug;
          return (
            <div
              key={facet.slug}
              data-studio-drop-scope={dropScope}
              data-studio-drop-axis="x"
              data-studio-drop-key={pillDropKey}
              data-studio-drop-hint={`↳ Move to ${facet.name}`}
              data-studio-drop-before-key={fBeforeKey}
              data-studio-drop-before-hint={`← Move before ${facet.name}`}
              data-studio-drop-after-key={fAfterKey}
              data-studio-drop-after-hint={`→ Move after ${facet.name}`}
              className={`relative h-[20px] rounded-[2px] border inline-flex items-center transition-colors ${
                isDraggingSelf
                  ? "opacity-45 bg-surface-2 border-dashed border-accent"
                  : isDropHover
                  ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-accent"
                  : isActive
                  ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                  : "bg-surface-2 border-line text-fg-3 hover:text-fg"
              }`}
            >
              {isBeforeHover && (
                <span className="absolute -left-[2px] top-0 bottom-0 w-[2px] bg-accent rounded-xs pointer-events-none" />
              )}
              {isAfterHover && (
                <span className="absolute -right-[2px] top-0 bottom-0 w-[2px] bg-accent rounded-xs pointer-events-none" />
              )}
              {canDragFacets && (
                <span
                  onMouseDown={(e) =>
                    onBeginFacetDrag(
                      e,
                      { kind: "facet", id: facet.id },
                      { label: facet.name, swatchColor: facet.color }
                    )
                  }
                  className="h-full pl-1 flex items-center text-fg-faint hover:text-fg-2 cursor-grab active:cursor-grabbing"
                  title={`Drag to reorder ${facet.name} facet`}
                >
                  <GripVertical className="w-2.5 h-2.5" />
                </span>
              )}
              <button
                type="button"
                onClick={() => onFacetFilterChange(facet.slug)}
                className={`h-full ${
                  canDragFacets ? "pl-0.5 pr-1.5" : "px-1.5"
                } font-mono text-[9.5px] uppercase cursor-pointer`}
                title={
                  draggingTagId !== null
                    ? `Drop here to move to ${facet.name}`
                    : `Filter by ${facet.name}`
                }
              >
                {facet.name}
              </button>
              {!facet.is_system && (
                <span className="pr-0.5 flex items-center">
                  <CustomFacetPopover
                    domain={domain}
                    existingFacet={facet}
                    onUpdate={onUpdateFacet}
                    onDelete={onDeleteFacet}
                    onDeleted={() => {
                      if (facetFilter === facet.slug) {
                        onFacetFilterChange("all");
                      }
                    }}
                  />
                </span>
              )}
            </div>
          );
        })}

        <CustomFacetPopover
          domain={domain}
          onCreate={onCreateFacet}
          onSaved={(created) => onFacetFilterChange(created.slug)}
        />
      </div>
    </>
  );
};
