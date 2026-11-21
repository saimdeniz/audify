import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Search, X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { TAG_COLOR_PALETTE } from "../../constants/palettes";
import { SampleItem } from "../../types";
import { useDialogFocusTrap } from "../../utils/modalFocus";
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
  const genres = useSampleStore((s) => s.genres);
  const selectedSampleIds = useSampleStore((s) => s.selectedSampleIds);

  const selectOrToggleTagFilter = useSampleStore(
    (s) => s.selectOrToggleTagFilter
  );
  const createTag = useSampleStore((s) => s.createTag);
  const assignTag = useSampleStore((s) => s.assignTag);
  const unassignTag = useSampleStore((s) => s.unassignTag);
  const createGenre = useSampleStore((s) => s.createGenre);
  const assignGenre = useSampleStore((s) => s.assignGenre);
  const assignGenreBatch = useSampleStore((s) => s.assignGenreBatch);

  const [popoverTagSearch, setPopoverTagSearch] = useState("");
  const [popoverNewTagColor, setPopoverNewTagColor] = useState<string>(
    TAG_COLOR_PALETTE[0]
  );
  const [popoverGenreSearch, setPopoverGenreSearch] = useState("");
  const [popoverNewGenreColor, setPopoverNewGenreColor] =
    useState<string>("#8B5CF6");

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

  const filteredPopoverTags = useMemo(() => {
    const q = popoverTagSearch.trim().toLowerCase();
    const assignedIds = new Set(livePopoverSample?.tags.map((t) => t.id) || []);
    return [...tags]
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aHas = assignedIds.has(a.id) ? 1 : 0;
        const bHas = assignedIds.has(b.id) ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        if (b.sample_count !== a.sample_count) {
          return b.sample_count - a.sample_count;
        }
        return a.name.localeCompare(b.name);
      });
  }, [tags, popoverTagSearch, livePopoverSample]);

  const exactPopoverTagMatch = useMemo(() => {
    const q = popoverTagSearch.trim().toLowerCase();
    if (!q) return true;
    return tags.some((t) => t.name.toLowerCase() === q);
  }, [tags, popoverTagSearch]);

  const filteredPopoverGenres = useMemo(() => {
    const q = popoverGenreSearch.trim().toLowerCase();
    const currentLower = (liveGenrePopoverSample?.genre || "").toLowerCase();
    return [...genres]
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aCur = a.name.toLowerCase() === currentLower ? 1 : 0;
        const bCur = b.name.toLowerCase() === currentLower ? 1 : 0;
        if (aCur !== bCur) return bCur - aCur;
        if (b.sample_count !== a.sample_count) {
          return b.sample_count - a.sample_count;
        }
        return a.name.localeCompare(b.name);
      });
  }, [genres, popoverGenreSearch, liveGenrePopoverSample]);

  const exactPopoverGenreMatch = useMemo(() => {
    const q = popoverGenreSearch.trim().toLowerCase();
    if (!q) return true;
    return genres.some((g) => g.name.toLowerCase() === q);
  }, [genres, popoverGenreSearch]);

  const popoverContent = (
    <>
      {hoverOverflowTags &&
        liveHoverOverflowSample &&
        !rowTagPopover &&
        liveHoverOverflowSample.tags.length > 2 && (
          <div
            data-popover-portal="true"
            data-mica-overlay="true"
            style={{
              top: hoverOverflowTags.y,
              left: hoverOverflowTags.x,
              zIndex: Z_INDEX.popoverFloating,
            }}
            className="fixed w-[216px] bg-surface-2 backdrop-blur-md border border-accent/70 rounded-md p-2 shadow-2xl pointer-events-none space-y-1.5"
          >
            <div className="flex items-center justify-between border-b border-line pb-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-accent-fg truncate">
                ALL TAGS ({liveHoverOverflowSample.tags.length})
              </span>
              <span className="font-mono text-[9px] text-fg-head shrink-0">
                Click +N to edit
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {liveHoverOverflowSample.tags.map((badge) => (
                <span
                  key={badge.id}
                  className="inline-flex items-center space-x-1 text-[10px] px-1.5 py-0.5 rounded-xs bg-surface-badge border border-line-strong text-fg"
                  style={{
                    borderLeftColor: badge.color,
                    borderLeftWidth: "2px",
                  }}
                >
                  <span className="truncate max-w-[140px]">{badge.name}</span>
                </span>
              ))}
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
          className="fixed w-[256px] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md p-2.5 shadow-2xl space-y-2.5 text-[12px] text-fg"
        >
          <div className="flex items-center justify-between border-b border-line pb-1.5">
            <div className="min-w-0 flex-1 pr-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-accent-fg">
                MANAGE TAGS
              </div>
              <div className="text-[11px] font-medium text-fg truncate">
                {livePopoverSample.file_name}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRowTagPopover(null)}
              className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-2 hover:text-fg hover:bg-line shrink-0"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            <div className="text-[9px] font-mono uppercase tracking-wider text-fg-head">
              ASSIGNED TO THIS FILE ({livePopoverSample.tags.length})
            </div>
            {livePopoverSample.tags.length === 0 ? (
              <div className="text-[11px] text-fg-3 font-mono py-0.5">
                No tags assigned yet.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1 max-h-[68px] overflow-y-auto">
                {livePopoverSample.tags.map((badge) => {
                  const isFiltered = selectedTagSet.has(badge.id);
                  return (
                    <div
                      key={badge.id}
                      className={`inline-flex items-center space-x-1 text-[11px] h-[22px] px-1.5 rounded-xs border ${
                        isFiltered
                          ? "bg-accent-soft border-accent text-accent-fg"
                          : "bg-surface-badge border-line-strong text-fg hover:border-line-hover"
                      }`}
                      style={{
                        borderLeftColor: badge.color,
                        borderLeftWidth: "2px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => selectOrToggleTagFilter(badge.id, false)}
                        className="truncate max-w-[130px] text-left cursor-pointer"
                        title={`Filter by "${badge.name}"`}
                      >
                        {badge.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void unassignTag(livePopoverSample.id, badge.id);
                        }}
                        className="text-fg-2 hover:text-accent-fg pl-0.5 flex items-center justify-center cursor-pointer"
                        title={`Remove "${badge.name}" from file`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5 pt-1 border-t border-line">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-fg-head absolute left-2 pointer-events-none" />
              <input
                type="text"
                value={popoverTagSearch}
                onChange={(e) => setPopoverTagSearch(e.target.value)}
                placeholder="Search or type new tag..."
                autoFocus
                className="w-full h-[24px] bg-surface-3 border border-line focus:border-accent pl-7 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none rounded-xs"
              />
              {popoverTagSearch && (
                <button
                  type="button"
                  onClick={() => setPopoverTagSearch("")}
                  className="absolute right-1.5 text-fg-2 hover:text-fg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {!exactPopoverTagMatch && popoverTagSearch.trim().length > 0 && (
              <div className="p-2 bg-surface-1 border border-accent/50 rounded-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase text-accent-fg">
                    NEW TAG COLOR
                  </span>
                  <div className="flex items-center gap-1">
                    {TAG_COLOR_PALETTE.slice(0, 7).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setPopoverNewTagColor(c)}
                        className={`w-3 h-3 rounded-[2px] border shrink-0 ${
                          popoverNewTagColor === c
                            ? "border-fg ring-1 ring-line-strong scale-110"
                            : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const name = popoverTagSearch.trim();
                    if (!name) return;
                    const created = await createTag(name, popoverNewTagColor);
                    if (created) {
                      await assignTag(livePopoverSample.id, created.id);
                      setPopoverTagSearch("");
                    }
                  }}
                  className="w-full h-[24px] px-2 bg-accent hover:bg-accent-hover text-accent-on font-mono text-[10px] font-bold rounded-xs flex items-center justify-center space-x-1 truncate"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    Create &amp; Assign &ldquo;{popoverTagSearch.trim()}&rdquo;
                  </span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1 max-h-[168px] overflow-y-auto pr-0.5">
              {filteredPopoverTags.map((t) => {
                const hasTag = livePopoverSample.tags.some(
                  (b) => b.id === t.id
                );
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (hasTag) {
                        void unassignTag(livePopoverSample.id, t.id);
                      } else {
                        void assignTag(livePopoverSample.id, t.id);
                      }
                    }}
                    className={`h-[24px] px-2 rounded-xs border flex items-center justify-between text-[11px] min-w-0 ${
                      hasTag
                        ? "bg-accent-soft border-accent text-accent-fg"
                        : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-hover"
                    }`}
                  >
                    <span className="flex items-center space-x-1.5 min-w-0 flex-1">
                      <span
                        className="w-2 h-2 rounded-[2px] shrink-0"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                    {hasTag && <Check className="w-3 h-3 shrink-0 ml-1" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {rowGenrePopover && liveGenrePopoverSample && (
        <div
          ref={genreDialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Assign genre for ${liveGenrePopoverSample.file_name}`}
          data-context-menu-portal="true"
          data-popover-portal="true"
          data-mica-overlay="true"
          style={{
            top: rowGenrePopover.y,
            left: rowGenrePopover.x,
            zIndex: Z_INDEX.popoverFloating,
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed w-[248px] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md p-2.5 shadow-2xl space-y-2 text-[12px] text-fg"
        >
          <div className="flex items-center justify-between border-b border-line pb-1.5">
            <div className="min-w-0 flex-1 pr-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-accent-fg">
                ASSIGN GENRE
              </div>
              <div className="text-[11px] font-medium text-fg truncate">
                {liveGenrePopoverSample.file_name}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRowGenrePopover(null)}
              className="w-[22px] h-[22px] rounded-xs flex items-center justify-center text-fg-2 hover:text-fg hover:bg-line shrink-0"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-fg-head absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={popoverGenreSearch}
              onChange={(e) => setPopoverGenreSearch(e.target.value)}
              placeholder="Search or type custom genre..."
              autoFocus
              className="w-full h-[24px] bg-surface-3 border border-line focus:border-accent pl-7 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none rounded-xs"
            />
            {popoverGenreSearch && (
              <button
                type="button"
                onClick={() => setPopoverGenreSearch("")}
                className="absolute right-1.5 text-fg-2 hover:text-fg"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {!exactPopoverGenreMatch && popoverGenreSearch.trim().length > 0 && (
            <div className="p-2 bg-surface-1 border border-accent/50 rounded-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] uppercase text-accent-fg">
                  NEW GENRE COLOR
                </span>
                <div className="flex items-center gap-1">
                  {TAG_COLOR_PALETTE.slice(0, 7).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPopoverNewGenreColor(c)}
                      className={`w-3 h-3 rounded-[2px] border shrink-0 ${
                        popoverNewGenreColor === c
                          ? "border-fg ring-1 ring-line-strong scale-110"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const name = popoverGenreSearch.trim();
                  if (!name) return;
                  const created = await createGenre(name, popoverNewGenreColor);
                  if (!created) return;
                  const genreLabel = created.name;
                  if (
                    selectedSampleIds.length > 1 &&
                    selectedIdSet.has(liveGenrePopoverSample.id)
                  ) {
                    await assignGenreBatch(selectedSampleIds, genreLabel);
                  } else {
                    await assignGenre(liveGenrePopoverSample.id, genreLabel);
                  }
                  setPopoverGenreSearch("");
                  setRowGenrePopover(null);
                }}
                className="w-full h-[24px] px-2 bg-accent hover:bg-accent-hover text-accent-on font-mono text-[10px] font-bold rounded-xs flex items-center justify-center space-x-1 truncate"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Create &amp; Assign &ldquo;{popoverGenreSearch.trim()}&rdquo;
                </span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 max-h-[168px] overflow-y-auto pr-0.5">
            {filteredPopoverGenres.map((g) => {
              const isAssigned =
                (liveGenrePopoverSample.genre || "").toLowerCase() ===
                g.name.toLowerCase();
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={async () => {
                    const nextVal = isAssigned ? "" : g.name;
                    if (
                      selectedSampleIds.length > 1 &&
                      selectedIdSet.has(liveGenrePopoverSample.id)
                    ) {
                      await assignGenreBatch(selectedSampleIds, nextVal);
                    } else {
                      await assignGenre(liveGenrePopoverSample.id, nextVal);
                    }
                    setRowGenrePopover(null);
                  }}
                  className={`h-[24px] px-2 rounded-xs border flex items-center justify-between text-[11px] min-w-0 ${
                    isAssigned
                      ? "bg-accent-soft border-accent text-accent-fg"
                      : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-hover"
                  }`}
                >
                  <span className="flex items-center space-x-1.5 min-w-0 flex-1">
                    <span
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="truncate">{g.name}</span>
                  </span>
                  {isAssigned && <Check className="w-3 h-3 shrink-0 ml-1" />}
                </button>
              );
            })}
          </div>

          {liveGenrePopoverSample.genre && (
            <button
              type="button"
              onClick={async () => {
                await assignGenre(liveGenrePopoverSample.id, "");
                setRowGenrePopover(null);
              }}
              className="w-full h-[22px] rounded-xs bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg font-mono text-[10px] flex items-center justify-center space-x-1 transition-colors"
            >
              <X className="w-3 h-3" />
              <span>Clear Genre ({liveGenrePopoverSample.genre})</span>
            </button>
          )}
        </div>
      )}
    </>
  );

  return typeof document !== "undefined"
    ? createPortal(popoverContent, document.body)
    : null;
};
