import React from "react";
import { Hash, Music, Plus } from "lucide-react";
import type { Tag, TagFacet, TaxonomyFacetSlug } from "../../types";
import type { FlattenedTaxonomyRow } from "../../utils/taxonomyTree";
import { QuickCreatePopover } from "../QuickCreatePopover";
import {
  TaxonomyFacetSectionHeader,
  TaxonomySidebarRow,
} from "./TaxonomySidebarRow";

export interface TaxonomySidebarFacetSection {
  facet: TagFacet;
  hierarchical: boolean;
  totalCount: number;
  rows: FlattenedTaxonomyRow[];
}

interface TaxonomySidebarSectionsProps {
  isGenres: boolean;
  tabTagsCount: number;
  visibleCount: number;
  isSearching: boolean;
  facetSections: TaxonomySidebarFacetSection[];
  sectionsOpen: Record<string, boolean>;
  defaultFacetSlug: TaxonomyFacetSlug;
  dropScope: string;
  selectedTagSet: ReadonlySet<number>;
  excludedTagSet: ReadonlySet<number>;
  selectedGenre: string | null;
  isDraggingInApp: boolean;
  inAppDragCount: number;
  draggingTagId: number | null;
  activeDropKey: string | null;
  dragHoverTarget: string | null;
  dropFlashTarget?: string | null;
  onSetSectionOpen: (slug: string, open: boolean) => void;
  onCreateInFacet: (
    rawName: string,
    color: string | undefined,
    facetSlug: TaxonomyFacetSlug
  ) => Promise<boolean>;
  onToggleExpand: (tagId: number) => void;
  onRowClick: (e: React.MouseEvent, tag: Tag) => void;
  onRowContextMenu: (e: React.MouseEvent) => void;
  onRowMouseEnter: (targetKey: string) => void;
  onRowPointerDragStart: (
    e: React.MouseEvent,
    tag: Tag,
    effectiveColor: string,
    isSource: boolean
  ) => void;
}

export const TaxonomySidebarSections: React.FC<TaxonomySidebarSectionsProps> = ({
  isGenres,
  tabTagsCount,
  visibleCount,
  isSearching,
  facetSections,
  sectionsOpen,
  defaultFacetSlug,
  dropScope,
  selectedTagSet,
  excludedTagSet,
  selectedGenre,
  isDraggingInApp,
  inAppDragCount,
  draggingTagId,
  activeDropKey,
  dragHoverTarget,
  dropFlashTarget,
  onSetSectionOpen,
  onCreateInFacet,
  onToggleExpand,
  onRowClick,
  onRowContextMenu,
  onRowMouseEnter,
  onRowPointerDragStart,
}) => {
  if (tabTagsCount === 0) {
    return (
      <div className="py-8 px-3 text-center space-y-2">
        <div className="w-8 h-8 mx-auto rounded-[3px] bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
          {isGenres ? (
            <Music className="w-4 h-4" />
          ) : (
            <Hash className="w-4 h-4" />
          )}
        </div>
        <div className="text-[11px] font-medium text-fg">
          {isGenres ? "No genres or moods yet" : "No tags yet"}
        </div>
        <div className="text-[10px] text-fg-3 leading-relaxed">
          {isGenres
            ? "Scan a music library or click + above to create genres and moods."
            : "Scan your audio library to auto-tag matching sounds, or click + above to create categories."}
        </div>
      </div>
    );
  }

  if (visibleCount === 0) {
    return (
      <div className="py-4 text-center text-[11px] text-fg-3 font-mono">
        {isGenres
          ? "No genres or moods match filter."
          : "No tags match filter."}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {facetSections.map(({ facet, hierarchical, totalCount, rows }, idx) => {
        const showSection =
          idx === 0 ||
          rows.length > 0 ||
          draggingTagId !== null ||
          !facet.is_system;
        if (!showSection) return null;
        const isOpen = isSearching ? true : sectionsOpen[facet.slug] !== false;
        const dropKey = `sec:${facet.slug}`;
        const isSource = facet.slug === "source";
        return (
          <div key={facet.slug}>
            <TaxonomyFacetSectionHeader
              label={facet.name.toUpperCase()}
              count={isSearching ? rows.length : totalCount}
              isOpen={isOpen}
              isDropActive={activeDropKey === dropKey}
              dropScope={dropScope}
              dropKey={dropKey}
              dropHint={`↳ ${facet.name} root`}
              title={`Click to collapse · Drop an item here to move to ${facet.name}`}
              rightExtra={
                facet.slug !== defaultFacetSlug ? (
                  <QuickCreatePopover
                    title={`New ${facet.name}`}
                    placeholder={
                      hierarchical
                        ? "e.g. Parent/Child"
                        : `New ${facet.name}...`
                    }
                    hasColor={!isSource}
                    align="right"
                    buttonTitle={`Create in ${facet.name}`}
                    buttonClassName="w-[16px] h-[16px] rounded-[2px] text-fg-3 hover:text-accent-fg hover:bg-surface-3 flex items-center justify-center transition-colors"
                    buttonIcon={<Plus className="w-3 h-3" />}
                    onCreated={(name, color) =>
                      onCreateInFacet(name, color, facet.slug)
                    }
                  />
                ) : undefined
              }
              onToggle={() => onSetSectionOpen(facet.slug, !isOpen)}
            />

            {isOpen && rows.length > 0 && (
              <div className="flex flex-col text-[12px]">
                {rows.map((row) => {
                  const isSelected =
                    selectedTagSet.has(row.tag.id) ||
                    (isGenres &&
                      selectedGenre !== null &&
                      selectedGenre.toLowerCase() ===
                        row.tag.name.toLowerCase());
                  const targetKey = `tag-${row.tag.id}`;
                  const nodeDropKey = `node:${facet.slug}:${row.tag.id}`;
                  return (
                    <TaxonomySidebarRow
                      key={row.tag.id}
                      tag={row.tag}
                      depth={hierarchical ? row.depth : 0}
                      hasChildren={hierarchical && row.hasChildren}
                      isExpanded={hierarchical && row.isExpanded}
                      isSource={isSource}
                      flat={!hierarchical}
                      effectiveColor={row.effectiveColor}
                      breadcrumb={
                        isGenres
                          ? `${facet.name}: ${row.breadcrumb}`
                          : isSource
                          ? `Source: ${row.breadcrumb}`
                          : row.breadcrumb
                      }
                      dropLabelPrefix={isGenres ? facet.name : undefined}
                      isSelected={isSelected}
                      isExcluded={excludedTagSet.has(row.tag.id)}
                      isDraggingInApp={isDraggingInApp}
                      isDraggingSelf={draggingTagId === row.tag.id}
                      inAppDragCount={inAppDragCount}
                      isDropHover={
                        isDraggingInApp && dragHoverTarget === targetKey
                      }
                      isDropFlash={dropFlashTarget === targetKey}
                      isReparentHover={
                        hierarchical && activeDropKey === nodeDropKey
                      }
                      dropScope={hierarchical ? dropScope : undefined}
                      dropKey={hierarchical ? nodeDropKey : undefined}
                      dropHint={
                        hierarchical
                          ? `↳ Nest under ${row.tag.name}`
                          : undefined
                      }
                      onToggleExpand={hierarchical ? onToggleExpand : undefined}
                      onClick={onRowClick}
                      onContextMenu={onRowContextMenu}
                      onMouseEnterTag={onRowMouseEnter}
                      onPointerDragStart={onRowPointerDragStart}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
