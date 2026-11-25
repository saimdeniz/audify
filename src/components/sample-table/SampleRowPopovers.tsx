import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { useDialogFocusTrap } from "../../utils/modalFocus";
import { getSharedTaxonomyIndex } from "../../utils/taxonomyTree";
import { TaxonomyPicker } from "../taxonomy/TaxonomyPicker";
import { RowPopoverPosition } from "./tableLayout";

interface SampleRowPopoversProps {
  hoverOverflowTags: RowPopoverPosition | null;
  rowTagPopover: RowPopoverPosition | null;
  setRowTagPopover: React.Dispatch<
    React.SetStateAction<RowPopoverPosition | null>
  >;
  rowGenrePopover: RowPopoverPosition | null;
  setRowGenrePopover: React.Dispatch<
    React.SetStateAction<RowPopoverPosition | null>
  >;
  sampleByIdMap: ReadonlyMap<number, SampleItem>;
  selectedIdSet: ReadonlySet<number>;
  selectedTagSet: ReadonlySet<number>;
}

export const SampleRowPopovers: React.FC<SampleRowPopoversProps> = ({
  hoverOverflowTags,
  rowTagPopover,
  setRowTagPopover,
  rowGenrePopover,
  setRowGenrePopover,
  sampleByIdMap,
  selectedIdSet,
  selectedTagSet,
}) => {
  const tags = useSampleStore((s) => s.tags);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);
  const toggleTagFilter = useSampleStore((s) => s.toggleTagFilter);

  const taxonomy = useMemo(
    () => getSharedTaxonomyIndex(tags, tagFacets),
    [tags, tagFacets]
  );

  const liveHoverOverflowSample = hoverOverflowTags
    ? sampleByIdMap.get(hoverOverflowTags.sampleId) || null
    : null;
  const livePopoverSample = rowTagPopover
    ? sampleByIdMap.get(rowTagPopover.sampleId) || null
    : null;
  const liveGenrePopoverSample = rowGenrePopover
    ? sampleByIdMap.get(rowGenrePopover.sampleId) || null
    : null;

  const tagDialogRef = useRef<HTMLDivElement>(null);
  const genreDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(Boolean(rowTagPopover && livePopoverSample), tagDialogRef);
  useDialogFocusTrap(
    Boolean(rowGenrePopover && liveGenrePopoverSample),
    genreDialogRef
  );

  useEffect(() => {
    if (!rowTagPopover && !rowGenrePopover) return;
    window.dispatchEvent(new CustomEvent("audify:hide-tooltip"));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (rowTagPopover) setRowTagPopover(null);
        if (rowGenrePopover) setRowGenrePopover(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [rowTagPopover, rowGenrePopover, setRowTagPopover, setRowGenrePopover]);

  const resolveBatchTargets = (anchor: SampleItem | null) => {
    if (!anchor) return { ids: [] as number[], items: [] as SampleItem[] };
    const isMulti = selectedIdSet.has(anchor.id) && selectedSampleIds.length > 1;
    if (!isMulti) return { ids: [anchor.id], items: [anchor] };
    const items = selectedSampleIds
      .map((id) => sampleByIdMap.get(id))
      .filter((s): s is SampleItem => Boolean(s));
    return {
      ids: selectedSampleIds,
      items: items.length > 0 ? items : [anchor],
    };
  };

  const tagTargets = useMemo(
    () => resolveBatchTargets(livePopoverSample),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [livePopoverSample, selectedIdSet, selectedSampleIds, sampleByIdMap]
  );

  const genreTargets = useMemo(
    () => resolveBatchTargets(liveGenrePopoverSample),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveGenrePopoverSample, selectedIdSet, selectedSampleIds, sampleByIdMap]
  );

  const hoverCategorySourceTags = useMemo(() => {
    if (!liveHoverOverflowSample) return [];
    return liveHoverOverflowSample.tags.filter(
      (b) => taxonomy.domainByTagId.get(b.id) !== "genres"
    );
  }, [liveHoverOverflowSample, taxonomy]);

  const popoverContent = (
    <>
      {hoverOverflowTags &&
        liveHoverOverflowSample &&
        !rowTagPopover &&
        hoverCategorySourceTags.length > 1 && (
          <div
            data-popover-portal="true"
            data-mica-overlay="true"
            style={{
              top: hoverOverflowTags.y,
              left: hoverOverflowTags.x,
              zIndex: Z_INDEX.popoverFloating,
            }}
            className="fixed w-[224px] bg-surface-2 audify-overlay-surface border border-accent/70 rounded-md p-2 shadow-2xl pointer-events-none space-y-1.5"
          >
            <div className="flex items-center justify-between border-b border-line pb-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-accent-fg truncate">
                ALL TAGS ({hoverCategorySourceTags.length})
              </span>
              <span className="font-mono text-[9px] text-fg-head shrink-0">
                Click +N to edit
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {hoverCategorySourceTags.map((badge) => {
                const crumb =
                  taxonomy.breadcrumbByTagId.get(badge.id) ?? badge.name;
                const isSource =
                  taxonomy.facetByTagId.get(badge.id) === "source";
                const color =
                  taxonomy.effectiveColorByTagId.get(badge.id) ?? badge.color;
                return (
                  <span
                    key={badge.id}
                    className="inline-flex items-center space-x-1 text-[10px] px-1.5 py-0.5 rounded-xs bg-surface-badge border border-line-strong text-fg"
                    style={
                      isSource
                        ? undefined
                        : { borderLeftColor: color, borderLeftWidth: "2px" }
                    }
                  >
                    <span className="truncate max-w-[175px]">
                      {isSource ? `#${badge.name}` : crumb}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

      {rowTagPopover && livePopoverSample && (
        <div
          ref={tagDialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Manage tags for ${livePopoverSample.file_name}`}
          data-context-menu-portal="true"
          data-popover-portal="true"
          data-mica-overlay="true"
          style={{
            top: rowTagPopover.y,
            left: rowTagPopover.x,
            zIndex: Z_INDEX.popoverFloating,
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed w-[272px] bg-surface-2 audify-overlay-surface border border-line-strong rounded-md p-2.5 shadow-2xl"
        >
          <TaxonomyPicker
            mode="tags"
            sampleIds={tagTargets.ids}
            samples={tagTargets.items}
            title={
              tagTargets.ids.length > 1
                ? `MANAGE TAGS (${tagTargets.ids.length} FILES)`
                : "MANAGE TAGS"
            }
            subtitle={
              tagTargets.ids.length > 1
                ? `${livePopoverSample.file_name} + ${tagTargets.ids.length - 1} more`
                : livePopoverSample.file_name
            }
            selectedFilterTagIds={selectedTagSet}
            onFilterTagClick={toggleTagFilter}
            onClose={() => setRowTagPopover(null)}
          />
        </div>
      )}

      {rowGenrePopover && liveGenrePopoverSample && (
        <div
          ref={genreDialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Manage genres and moods for ${liveGenrePopoverSample.file_name}`}
          data-context-menu-portal="true"
          data-popover-portal="true"
          data-mica-overlay="true"
          style={{
            top: rowGenrePopover.y,
            left: rowGenrePopover.x,
            zIndex: Z_INDEX.popoverFloating,
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed w-[272px] bg-surface-2 audify-overlay-surface border border-line-strong rounded-md p-2.5 shadow-2xl"
        >
          <TaxonomyPicker
            mode="genres"
            sampleIds={genreTargets.ids}
            samples={genreTargets.items}
            title={
              genreTargets.ids.length > 1
                ? `GENRES & MOODS (${genreTargets.ids.length} FILES)`
                : "GENRES & MOODS"
            }
            subtitle={
              genreTargets.ids.length > 1
                ? `${liveGenrePopoverSample.file_name} + ${genreTargets.ids.length - 1} more`
                : liveGenrePopoverSample.file_name
            }
            selectedFilterTagIds={selectedTagSet}
            onFilterTagClick={toggleTagFilter}
            onClose={() => setRowGenrePopover(null)}
          />
        </div>
      )}
    </>
  );

  return typeof document !== "undefined"
    ? createPortal(popoverContent, document.body)
    : popoverContent;
};
