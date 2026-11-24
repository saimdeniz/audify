import React, { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Music, Plus, Search, Settings, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { QuickCreatePopover } from "../QuickCreatePopover";

let sessionGenreSearch = "";

interface GenresSidebarTabProps {
  dragHoverTarget: string | null;
  setDragHoverTarget: (target: string | null) => void;
  dropFlashTarget?: string | null;
}

export const GenresSidebarTab: React.FC<GenresSidebarTabProps> = ({
  dragHoverTarget,
  setDragHoverTarget,
  dropFlashTarget,
}) => {
  const genres = useSampleStore((s) => s.genres);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);
  const inAppDragCount = useSampleStore((s) =>
    s.inAppDragSamples.length > 0
      ? s.inAppDragSamples.length
      : s.inAppDragSample
      ? 1
      : 0
  );
  const setSelectedGenre = useSampleStore((s) => s.setSelectedGenre);
  const createGenre = useSampleStore((s) => s.createGenre);
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);

  const [genreSearch, setGenreSearch] = useState<string>(
    () => sessionGenreSearch
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    () => sessionGenreSearch.trim().length > 0
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [hideEmptyGenres, setHideEmptyGenres] = useState(false);

  const updateGenreSearch = (val: string) => {
    sessionGenreSearch = val;
    setGenreSearch(val);
  };

  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isSearchOpen]);

  const filteredGenres = useMemo(() => {
    const q = genreSearch.trim().toLowerCase();
    const selLower = selectedGenre ? selectedGenre.toLowerCase() : null;
    return [...genres]
      .filter((g) => {
        const isSelected =
          selLower !== null && g.name.toLowerCase() === selLower;
        if (hideEmptyGenres && g.sample_count === 0 && !isSelected) {
          return false;
        }
        if (q && !g.name.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aSel =
          selLower !== null && a.name.toLowerCase() === selLower ? 1 : 0;
        const bSel =
          selLower !== null && b.name.toLowerCase() === selLower ? 1 : 0;
        if (aSel !== bSel) return bSel - aSel;
        if (b.sample_count !== a.sample_count) {
          return b.sample_count - a.sample_count;
        }
        return a.name.localeCompare(b.name);
      });
  }, [genres, genreSearch, hideEmptyGenres, selectedGenre]);

  const emptyGenresCount = useMemo(
    () => genres.filter((g) => g.sample_count === 0).length,
    [genres]
  );

  const isSearching = genreSearch.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-[32px] px-2.5 border-b border-line bg-surface-header flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
            GENRES ({filteredGenres.length.toLocaleString()}/
            {genres.length.toLocaleString()})
          </span>
          {selectedGenre && (
            <button
              type="button"
              onClick={() => setSelectedGenre(null)}
              className="w-[18px] h-[18px] text-accent-fg hover:bg-accent/20 rounded-xs border border-accent/40 flex items-center justify-center shrink-0 transition-colors"
              title="Clear genre filter (Show all)"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {emptyGenresCount > 0 && (
            <button
              type="button"
              onClick={() => setHideEmptyGenres((v) => !v)}
              className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
                hideEmptyGenres
                  ? "bg-accent-soft border-accent text-accent-fg"
                  : "bg-surface-3 hover:border-line-strong border-line text-fg-3 hover:text-fg"
              }`}
              title={
                hideEmptyGenres
                  ? "Showing non-empty genres (Click to show all)"
                  : `Hide empty genres (${emptyGenresCount} genres with 0 samples)`
              }
            >
              {hideEmptyGenres ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
            </button>
          )}

          <QuickCreatePopover
            title="New Genre"
            placeholder="Genre name..."
            hasColor={true}
            align="right"
            buttonTitle="Create new genre"
            buttonClassName="w-[20px] h-[20px] rounded-xs font-mono text-[9px] bg-accent/15 border border-accent/50 text-accent-fg hover:bg-accent hover:text-accent-on flex items-center justify-center shrink-0 transition-colors"
            buttonIcon={<Plus className="w-3.5 h-3.5" />}
            onCreated={async (name, color) => {
              const created = await createGenre(name, color || "#8B5CF6");
              return Boolean(created);
            }}
          />

          <button
            type="button"
            onClick={() => {
              if (isSearchOpen && !genreSearch.trim()) {
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
            title="Search genres"
          >
            <Search className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true, "genres")}
            className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0 transition-colors"
            title="Manage Genres in Settings"
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
              value={genreSearch}
              onChange={(e) => updateGenreSearch(e.target.value)}
              onBlur={() => {
                if (!genreSearch.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (genreSearch.trim()) {
                    updateGenreSearch("");
                  } else {
                    setIsSearchOpen(false);
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder="Filter genres..."
              className="w-full h-[24px] rounded-xs bg-surface-3 border border-line focus:border-accent pl-6 pr-6 text-[11px] text-fg placeholder-fg-3 outline-none"
            />
            {genreSearch && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  updateGenreSearch("");
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
        {filteredGenres.length === 0 ? (
          genres.length === 0 ? (
            <div className="py-8 px-3 text-center space-y-2 select-none">
              <div className="w-8 h-8 mx-auto rounded-full bg-surface-2 flex items-center justify-center text-fg-3 border border-line">
                <Music className="w-4 h-4" />
              </div>
              <div className="text-[11px] font-medium text-fg">
                No genres yet
              </div>
              <div className="text-[10px] text-fg-3 leading-relaxed">
                Add a music library to detect embedded genres, or click + above
                to create a genre.
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-[11px] text-fg-3 font-mono">
              No genres match filter.
            </div>
          )
        ) : (
          <div className="flex flex-col text-[12px]">
            {filteredGenres.map((genre) => {
              const isSelected =
                selectedGenre !== null &&
                selectedGenre.toLowerCase() === genre.name.toLowerCase();
              const targetKey = `genre-${genre.name}`;
              const isDropHover =
                isDraggingInApp && dragHoverTarget === targetKey;
              const isDropFlash = dropFlashTarget === targetKey;

              return (
                <div
                  key={genre.id}
                  data-sidebar-drop={targetKey}
                  onClick={() => setSelectedGenre(genre.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSettingsOpen(true, "genres");
                  }}
                  onMouseEnter={() => {
                    if (isDraggingInApp) setDragHoverTarget(targetKey);
                  }}
                  title={`${genre.name} (${genre.sample_count.toLocaleString()})`}
                  className={`group/row h-[26px] px-2.5 flex items-center justify-between cursor-pointer border-l-2 min-w-0 transition-all ${
                    isDropFlash
                      ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-inset ring-accent"
                      : isDropHover
                      ? "bg-accent-soft border-accent text-accent-fg ring-1 ring-inset ring-accent"
                      : isSelected
                      ? "bg-surface-3 border-accent text-accent-fg font-medium"
                      : genre.sample_count === 0
                      ? "border-transparent text-fg-3 hover:bg-surface-hover hover:text-fg"
                      : "border-transparent text-fg hover:bg-surface-hover"
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <span
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ backgroundColor: genre.color }}
                    />
                    <span className="truncate">{genre.name}</span>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0 pl-1.5">
                    {isDropHover ? (
                      <span className="text-[10.5px] font-semibold text-accent-fg shrink-0">
                        {inAppDragCount > 1
                          ? `＋ Genre (${inAppDragCount})`
                          : "＋ Genre"}
                      </span>
                    ) : (
                      <span
                        className={`font-mono tabular-nums text-[11px] font-medium shrink-0 ${
                          isSelected
                            ? "text-accent-fg"
                            : genre.sample_count === 0
                            ? "text-fg-3"
                            : "text-fg-2 group-hover/row:text-fg"
                        }`}
                      >
                        {genre.sample_count.toLocaleString()}
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
