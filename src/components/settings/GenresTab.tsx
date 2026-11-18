import React, { useEffect, useMemo, useState } from "react";
import { Filter, Music, Search, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  deterministicColorForName,
  TAG_COLOR_PALETTE,
} from "../../constants/palettes";
import { ColorPickerPopover } from "../ColorPickerPopover";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { InspectorShell } from "./InspectorShell";
import { useMainFilterAction } from "./useMainFilterAction";

export const GenresTab: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const genres = useSampleStore((s) => s.genres);
  const createGenre = useSampleStore((s) => s.createGenre);
  const renameGenre = useSampleStore((s) => s.renameGenre);
  const updateGenreColor = useSampleStore((s) => s.updateGenreColor);
  const deleteGenre = useSampleStore((s) => s.deleteGenre);
  const sendFilterToMain = useMainFilterAction();

  const [genreManagerSearch, setGenreManagerSearch] = useState("");
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null);
  const [inspectorGenreName, setInspectorGenreName] = useState("");
  const [inspectorGenreColor, setInspectorGenreColor] = useState(
    TAG_COLOR_PALETTE[5]
  );
  const [confirmDeleteGenreId, setConfirmDeleteGenreId] = useState<
    number | null
  >(null);

  useEffect(() => {
    setSelectedGenreId(null);
    setConfirmDeleteGenreId(null);
  }, [activeProfileId]);

  const filteredSettingsGenres = useMemo(() => {
    const q = genreManagerSearch.trim().toLowerCase();
    if (!q) return genres;
    return genres.filter((g) => g.name.toLowerCase().includes(q));
  }, [genres, genreManagerSearch]);

  const activeInspectedGenre = useMemo(() => {
    if (selectedGenreId !== null) {
      const match = genres.find((g) => g.id === selectedGenreId);
      if (match) return match;
    }
    return filteredSettingsGenres[0] || genres[0] || null;
  }, [genres, selectedGenreId, filteredSettingsGenres]);

  useEffect(() => {
    if (activeInspectedGenre) {
      setInspectorGenreName(activeInspectedGenre.name);
      setInspectorGenreColor(activeInspectedGenre.color);
    }
  }, [activeInspectedGenre]);

  const genreStats = useMemo(() => {
    let totalTagged = 0;
    let unusedCount = 0;
    for (const g of genres) {
      const c = g.sample_count || 0;
      totalTagged += c;
      if (c === 0) unusedCount++;
    }
    const currentCount = activeInspectedGenre?.sample_count || 0;
    const rank = activeInspectedGenre
      ? genres.filter((g) => (g.sample_count || 0) > currentCount).length + 1
      : 0;
    const sharePct =
      totalTagged > 0 && currentCount > 0
        ? ((currentCount / totalTagged) * 100).toFixed(1)
        : "0.0";
    return { totalTagged, unusedCount, rank, sharePct };
  }, [genres, activeInspectedGenre]);

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
        {/* LEFT: MASTER LIST */}
        <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
          <div className="h-[36px] px-2 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={genreManagerSearch}
                onChange={(e) => setGenreManagerSearch(e.target.value)}
                placeholder="Search genres..."
                className="w-full h-[24px] rounded-xs bg-surface-2 border border-line focus:border-accent pl-8 pr-6 text-[10px] font-mono text-fg placeholder-fg-3 outline-none"
              />
              {genreManagerSearch && (
                <button
                  type="button"
                  onClick={() => setGenreManagerSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <QuickCreatePopover
              title="New Genre"
              placeholder="Genre name..."
              hasColor={true}
              buttonTitle="Add Genre"
              onCreated={async (name, color) => {
                const created = await createGenre(
                  name,
                  color || deterministicColorForName(name)
                );
                if (!created) return false;
                setSelectedGenreId(created.id);
                setConfirmDeleteGenreId(null);
                return true;
              }}
            />
          </div>

          <div className="h-[26px] px-2.5 bg-surface-sub border-b border-line flex items-center justify-between text-[9.5px] font-mono text-fg-3 font-semibold shrink-0">
            <span>GENRES ({filteredSettingsGenres.length})</span>
            <span>TRACKS</span>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
            {filteredSettingsGenres.length === 0 ? (
              <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
                {genres.length === 0
                  ? "No genres created yet."
                  : "No genres match filter."}
              </div>
            ) : (
              filteredSettingsGenres.map((g) => {
                const isSelected = activeInspectedGenre?.id === g.id;
                return (
                  <div
                    key={g.id}
                    onClick={() => {
                      setSelectedGenreId(g.id);
                      setConfirmDeleteGenreId(null);
                    }}
                    className={`h-[32px] px-2.5 rounded-xs flex items-center justify-between cursor-pointer text-[11px] transition-colors select-none ${
                      isSelected
                        ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
                        : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-[3px] shrink-0 shadow-xs"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="font-medium truncate text-fg">
                        {g.name}
                      </span>
                    </div>
                    <span className="font-mono text-[9.5px] text-fg-3 shrink-0 ml-2">
                      {g.sample_count.toLocaleString()}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: GENRE INSPECTOR */}
        <InspectorShell
          icon={<Music className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
          title="GENRE INSPECTOR"
          hasItem={Boolean(activeInspectedGenre)}
          itemName={activeInspectedGenre?.name}
          itemDotColor={activeInspectedGenre?.color}
          onFilter={
            activeInspectedGenre
              ? () =>
                  sendFilterToMain({
                    kind: "genre",
                    name: activeInspectedGenre.name,
                  })
              : undefined
          }
          filterTitle={
            activeInspectedGenre
              ? `Filter sample table by "${activeInspectedGenre.name}"`
              : undefined
          }
          canDelete={Boolean(activeInspectedGenre)}
          isConfirmingDelete={
            Boolean(activeInspectedGenre) &&
            confirmDeleteGenreId === activeInspectedGenre?.id
          }
          onRequestDelete={() =>
            activeInspectedGenre &&
            setConfirmDeleteGenreId(activeInspectedGenre.id)
          }
          onConfirmDelete={async () => {
            if (!activeInspectedGenre) return;
            setConfirmDeleteGenreId(null);
            await deleteGenre(activeInspectedGenre.id);
          }}
          onCancelDelete={() => setConfirmDeleteGenreId(null)}
          deleteTitle={
            activeInspectedGenre
              ? `Delete "${activeInspectedGenre.name}"`
              : undefined
          }
          bodyClassName="flex-1 overflow-y-auto space-y-3 p-3 min-h-0 flex flex-col"
          emptyState={
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-fg-3">
              <Music className="w-8 h-8 opacity-40 text-accent-fg" />
              <div className="text-[11px] font-mono">No genre selected.</div>
              <div className="text-[9.5px] font-mono text-fg-3 max-w-[200px]">
                Select a genre from the left list to view or edit details.
              </div>
            </div>
          }
        >
          {activeInspectedGenre && (
            <>
              {/* Top Stat Bar */}
              <div className="h-[34px] px-3 bg-surface-soft border border-line rounded-xs flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                  LINKED TRACKS
                </span>
                <span className="font-mono text-[13px] font-bold text-accent-fg tabular-nums">
                  {activeInspectedGenre.sample_count.toLocaleString()}
                </span>
              </div>

              <div className="space-y-2.5">
                <div className="space-y-1 shrink-0">
                  <label className="text-[10px] font-mono text-fg-3 font-semibold uppercase tracking-wider">
                    NAME
                  </label>
                  <input
                    type="text"
                    value={inspectorGenreName}
                    onChange={(e) => setInspectorGenreName(e.target.value)}
                    onBlur={async () => {
                      const clean = inspectorGenreName.trim();
                      if (clean && clean !== activeInspectedGenre.name) {
                        await renameGenre(activeInspectedGenre.id, clean);
                      } else {
                        setInspectorGenreName(activeInspectedGenre.name);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setInspectorGenreName(activeInspectedGenre.name);
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-full h-[28px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-medium text-fg outline-none rounded-xs font-mono"
                  />
                </div>

                <div className="space-y-1 shrink-0">
                  <label className="text-[10px] font-mono text-fg-3 font-semibold uppercase tracking-wider">
                    COLOR
                  </label>
                  <div className="h-[28px] px-2 bg-surface-2 border border-line rounded-xs flex items-center space-x-2">
                    <ColorPickerPopover
                      color={inspectorGenreColor}
                      onChange={async (newColor) => {
                        setInspectorGenreColor(newColor);
                        await updateGenreColor(
                          activeInspectedGenre.id,
                          newColor
                        );
                      }}
                      triggerSize="xs"
                      align="right"
                      title="Genre Color (16M Colors)"
                    />
                    <span className="font-mono text-[10.5px] text-fg font-semibold">
                      {inspectorGenreColor.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Catalog Breakdown & Quick Action */}
              <div className="bg-surface-soft border border-line rounded-xs p-2.5 space-y-2">
                <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-fg-3 font-semibold">
                  <span>CATALOG BREAKDOWN</span>
                  <span className="text-fg-2 tabular-nums">
                    Rank #{genreStats.rank} / {genres.length}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <div className="bg-surface-1 border border-line rounded-xs px-2 py-1.5 flex items-center justify-between">
                    <span className="text-fg-3">Genre share</span>
                    <span className="text-accent-fg font-semibold tabular-nums">
                      {genreStats.sharePct}%
                    </span>
                  </div>
                  <div className="bg-surface-1 border border-line rounded-xs px-2 py-1.5 flex items-center justify-between">
                    <span className="text-fg-3">Unused genres</span>
                    <span className="text-fg font-semibold tabular-nums">
                      {genreStats.unusedCount}
                    </span>
                  </div>
                </div>

                {activeInspectedGenre.sample_count === 0 ? (
                  <p className="text-[10.5px] text-fg-3 leading-relaxed">
                    No tracks currently use &ldquo;{activeInspectedGenre.name}
                    &rdquo;. Use the trash icon above to remove unused test or
                    duplicate genres.
                  </p>
                ) : (
                  <p className="text-[10.5px] text-fg-3 leading-relaxed">
                    Run <strong className="text-fg-2">Auto-assign</strong> in the
                    header to detect genres from folder names and metadata across
                    unclassified tracks.
                  </p>
                )}
              </div>

              <div className="mt-auto pt-2 border-t border-line-subtle shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    sendFilterToMain({
                      kind: "genre",
                      name: activeInspectedGenre.name,
                    })
                  }
                  className="w-full h-[28px] px-3 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg rounded-xs inline-flex items-center justify-center space-x-1.5 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <Filter className="w-3 h-3 text-accent-fg shrink-0" />
                  <span>
                    Filter tracks by &ldquo;{activeInspectedGenre.name}&rdquo;
                  </span>
                </button>
              </div>
            </>
          )}
        </InspectorShell>
      </div>
    </div>
  );
};
