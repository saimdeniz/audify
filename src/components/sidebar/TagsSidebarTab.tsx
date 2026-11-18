import React, { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Hash, Plus, Search, Settings, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { QuickCreatePopover } from "../QuickCreatePopover";

let sessionTagSearch = "";

interface TagsSidebarTabProps {
  dragHoverTarget: string | null;
  setDragHoverTarget: (target: string | null) => void;
  dropFlashTarget?: string | null;
}

export const TagsSidebarTab: React.FC<TagsSidebarTabProps> = ({
  dragHoverTarget,
  setDragHoverTarget,
  dropFlashTarget,
}) => {
  const tags = useSampleStore((s) => s.tags);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const inAppDragCount = useSampleStore((s) =>
    s.inAppDragSamples.length > 0
      ? s.inAppDragSamples.length
      : s.inAppDragSample
      ? 1
      : 0
  );
  const toggleTagFilter = useSampleStore((s) => s.toggleTagFilter);
  const clearTagFilters = useSampleStore((s) => s.clearTagFilters);
  const createTag = useSampleStore((s) => s.createTag);
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);

  const [tagSearch, setTagSearch] = useState<string>(() => sessionTagSearch);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    () => sessionTagSearch.trim().length > 0
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [hideEmptyTags, setHideEmptyTags] = useState(false);

  const updateTagSearch = (val: string) => {
    sessionTagSearch = val;
    setTagSearch(val);
  };

  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isSearchOpen]);

  const selectedTagSet = useMemo(
    () => new Set(selectedTagIds),
    [selectedTagIds]
  );

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return [...tags]
      .filter((t) => {
        const isSelected = selectedTagSet.has(t.id);
        if (hideEmptyTags && t.sample_count === 0 && !isSelected) {
          return false;
        }
        if (q && !t.name.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aSel = selectedTagSet.has(a.id) ? 1 : 0;
        const bSel = selectedTagSet.has(b.id) ? 1 : 0;
        if (aSel !== bSel) return bSel - aSel;
        if (b.sample_count !== a.sample_count) {
          return b.sample_count - a.sample_count;
        }
        return a.name.localeCompare(b.name);
      });
  }, [tags, tagSearch, hideEmptyTags, selectedTagSet]);

  const emptyTagsCount = useMemo(
    () => tags.filter((t) => t.sample_count === 0).length,
    [tags]
  );

  const isSearching = tagSearch.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-[32px] px-2.5 border-b border-line bg-surface-header flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
            TAGS ({filteredTags.length.toLocaleString()}/
            {tags.length.toLocaleString()})
          </span>
          {selectedTagIds.length > 0 && (
            <button
              type="button"
              onClick={clearTagFilters}
              className="w-[18px] h-[18px] text-accent-fg hover:bg-accent/20 rounded-xs border border-accent/40 flex items-center justify-center shrink-0 transition-colors"
              title="Clear tag filters (Show all)"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {emptyTagsCount > 0 && (
            <button
              type="button"
              onClick={() => setHideEmptyTags((v) => !v)}
              className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
                hideEmptyTags
                  ? "bg-accent-soft border-accent text-accent-fg"
                  : "bg-surface-3 hover:border-line-strong border-line text-fg-3 hover:text-fg"
              }`}
              title={
                hideEmptyTags
                  ? "Showing non-empty tags (Click to show all)"
                  : `Hide empty tags (${emptyTagsCount} tags with 0 samples)`
              }
            >
              {hideEmptyTags ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
            </button>
          )}

          <QuickCreatePopover
            title="New Tag"
            placeholder="Tag name..."
            hasColor={true}
            align="right"
            buttonTitle="Create new tag"
            buttonClassName="w-[20px] h-[20px] rounded-xs font-mono text-[9px] bg-accent/15 border border-accent/50 text-accent-fg hover:bg-accent hover:text-accent-on flex items-center justify-center shrink-0 transition-colors"
            buttonIcon={<Plus className="w-3.5 h-3.5" />}
            onCreated={async (name, color) => {
              const created = await createTag(name, color || "#3B82F6");
              return Boolean(created);
            }}
          />

          <button
            type="button"
            onClick={() => {
              if (isSearchOpen && !tagSearch.trim()) {
                setIsSearchOpen(false);
              } else {
                setIsSearchOpen(true);
                requestAnimationFrame(() => searchInputRef.current?.focus());
              }
            }}
            className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
              isSearchOpen || isSearching
                ? "bg-accent-soft border-accent text-accent-fg"
                : "border-transparent text-fg-3 hover:text-fg hover:bg-line"
            }`}
            title="Search tags"
          >
            <Search className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true, "tags")}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Manage Tags & Rules in Settings"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>

      {(isSearchOpen || isSearching) && (
        <div className="px-2 py-1.5 border-b border-line shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-fg-head absolute left-2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={tagSearch}
              onChange={(e) => updateTagSearch(e.target.value)}
              onBlur={() => {
                if (!tagSearch.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (tagSearch.trim()) {
                    updateTagSearch("");
                  } else {
                    setIsSearchOpen(false);
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder="Filter tags..."
              className="w-full h-[24px] rounded-xs bg-surface-3 border border-line focus:border-accent pl-6 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none"
            />
            {tagSearch && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  updateTagSearch("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1.5 text-fg-2 hover:text-fg"
                title="Clear filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {filteredTags.length === 0 ? (
          tags.length === 0 ? (
            <div className="py-8 px-3 text-center space-y-2 select-none">
              <div className="w-8 h-8 mx-auto rounded-full bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
                <Hash className="w-4 h-4" />
              </div>
              <div className="text-[11px] font-medium text-fg">No tags yet</div>
              <div className="text-[10px] text-fg-3 leading-relaxed">
                Scan your audio library to auto-tag matching sounds, or click +
                above to add tags.
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-[11px] text-fg-3 font-mono">
              No tags match filter.
            </div>
          )
        ) : (
          <div className="flex flex-col space-y-0.5 text-[12px]">
            {filteredTags.map((tag) => {
              const isSelected = selectedTagSet.has(tag.id);
              const targetKey = `tag-${tag.id}`;
              const isDropHover =
                isDraggingInApp && dragHoverTarget === targetKey;
              const isDropFlash = dropFlashTarget === targetKey;

              return (
                <div
                  key={tag.id}
                  data-sidebar-drop={targetKey}
                  onClick={() => toggleTagFilter(tag.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSettingsOpen(true, "tags");
                  }}
                  onMouseEnter={() => {
                    if (isDraggingInApp) setDragHoverTarget(targetKey);
                  }}
                  onMouseLeave={() => {
                    if (dragHoverTarget === targetKey) setDragHoverTarget(null);
                  }}
                  title={`${tag.name} (${tag.sample_count.toLocaleString()})`}
                  className={`group/row h-[26px] px-2.5 flex items-center justify-between cursor-pointer border-l-2 min-w-0 transition-all ${
                    isDropFlash
                      ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-inset ring-accent"
                      : isDropHover
                      ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-inset ring-accent"
                      : isSelected
                      ? "bg-surface-3 border-accent text-accent-fg font-medium"
                      : tag.sample_count === 0
                      ? "border-transparent text-fg-3 hover:bg-surface-hover hover:text-fg"
                      : "border-transparent text-fg hover:bg-surface-hover"
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <span
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0 pl-1.5">
                    {isDropHover ? (
                      <span className="text-[10.5px] font-semibold text-accent-fg shrink-0">
                        {inAppDragCount > 1
                          ? `＋ Tag (${inAppDragCount})`
                          : "＋ Tag"}
                      </span>
                    ) : (
                      <span
                        className={`font-mono tabular-nums text-[11px] font-medium shrink-0 ${
                          isSelected
                            ? "text-accent-fg"
                            : tag.sample_count === 0
                            ? "text-fg-3"
                            : "text-fg-2 group-hover/row:text-fg"
                        }`}
                      >
                        {tag.sample_count.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
