import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, User, X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { ArtistStat, LicenseGroup } from "../../types";
import { foldSearchText } from "../../utils/format";

interface LicenseLinkedArtistsSectionProps {
  activeLicenseGroup: LicenseGroup;
  artistStats: readonly ArtistStat[];
  updateLicenseGroup: (
    id: string,
    patch: Partial<Omit<LicenseGroup, "id">>
  ) => Promise<void>;
}

export const LicenseLinkedArtistsSection: React.FC<
  LicenseLinkedArtistsSectionProps
> = ({ activeLicenseGroup, artistStats, updateLicenseGroup }) => {
  const linkedArtists = useMemo(
    () => activeLicenseGroup.artists ?? [],
    [activeLicenseGroup.artists]
  );

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 260 });

  useEffect(() => {
    setQuery("");
    setIsOpen(false);
    setActiveIndex(0);
  }, [activeLicenseGroup.id]);

  const linkedLowerSet = useMemo(() => {
    const set = new Set<string>();
    for (const name of linkedArtists) {
      const clean = name.trim().toLowerCase();
      if (clean) set.add(clean);
    }
    return set;
  }, [linkedArtists]);

  const countByArtistLower = useMemo(() => {
    const map = new Map<string, number>();
    for (const stat of artistStats) {
      map.set(stat.artist.trim().toLowerCase(), stat.count);
    }
    return map;
  }, [artistStats]);

  const suggestions = useMemo(() => {
    const needle = foldSearchText(query.trim());
    const prefix: ArtistStat[] = [];
    const contains: ArtistStat[] = [];
    for (let i = 0; i < artistStats.length; i++) {
      const stat = artistStats[i];
      if (linkedLowerSet.has(stat.artist.trim().toLowerCase())) continue;
      if (!needle) {
        prefix.push(stat);
        if (prefix.length >= 40) break;
        continue;
      }
      const folded = foldSearchText(stat.artist);
      if (folded.startsWith(needle)) {
        prefix.push(stat);
      } else if (folded.includes(needle)) {
        contains.push(stat);
      }
    }
    return [...prefix, ...contains].slice(0, 40);
  }, [artistStats, linkedLowerSet, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, suggestions.length]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(200, Math.round(rect.width));
      const maxTop = window.innerHeight - 190;
      const top =
        rect.bottom + 4 <= maxTop
          ? Math.round(rect.bottom + 4)
          : Math.max(8, Math.round(rect.top - 188));
      const left = Math.max(
        8,
        Math.min(window.innerWidth - width - 8, Math.round(rect.left))
      );
      setMenuPos({ top, left, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, suggestions.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        (inputRef.current?.contains(target) ||
          dropdownRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isOpen]);

  const appendUniqueArtist = async (rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (linkedLowerSet.has(lower)) {
      setQuery("");
      setIsOpen(false);
      return;
    }
    await updateLicenseGroup(activeLicenseGroup.id, {
      artists: [...linkedArtists, trimmed],
    });
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div className="space-y-1.5 pt-1 border-t border-line">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-mono text-fg-3 font-semibold">
          LINKED ARTISTS ({linkedArtists.length})
        </label>
        <span className="text-[9px] font-mono text-fg-3">
          Scanned Artist metadata
        </span>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (isOpen && suggestions.length > 0) {
            const chosen = suggestions[activeIndex] ?? suggestions[0];
            if (chosen && query.trim().length > 0) {
              const exactTyped = suggestions.find(
                (s) => s.artist.toLowerCase() === query.trim().toLowerCase()
              );
              await appendUniqueArtist((exactTyped ?? chosen).artist);
              return;
            }
            if (chosen && query.trim().length === 0) {
              await appendUniqueArtist(chosen.artist);
              return;
            }
          }
          if (query.trim()) {
            await appendUniqueArtist(query);
          }
        }}
        className="flex items-center space-x-1"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (!isOpen || suggestions.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((prev) => (prev + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex(
                (prev) => (prev - 1 + suggestions.length) % suggestions.length
              );
            }
          }}
          placeholder={
            artistStats.length > 0
              ? "Pick scanned artist metadata..."
              : "Add artist metadata name..."
          }
          className="flex-1 min-w-0 h-[24px] bg-surface-2 border border-line focus:border-accent px-2 font-mono text-[10px] text-fg outline-none rounded-xs placeholder-fg-3"
        />
        <button
          type="submit"
          className="w-[24px] h-[24px] bg-surface-2 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs flex items-center justify-center shrink-0 cursor-pointer"
          title="Link artist metadata"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label="Scanned library artists"
            data-settings-dropdown-open="true"
            data-mica-overlay="true"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              zIndex: Z_INDEX.floatingMenu,
            }}
            className="fixed bg-surface-2 border border-line-strong rounded-md shadow-2xl overflow-hidden audify-overlay-surface"
          >
            <div className="px-2.5 py-1 bg-surface-header border-b border-line flex items-center justify-between font-mono text-[9px] text-fg-3">
              <span>SCANNED ARTISTS ({suggestions.length})</span>
              <span>TRACKS</span>
            </div>
            <div className="py-1 max-h-[164px] overflow-y-auto">
              {suggestions.length === 0 ? (
                <div className="px-2.5 py-2 text-[10px] font-mono text-fg-3 text-center">
                  {artistStats.length === 0
                    ? "No Artist metadata found in library."
                    : "No matching scanned artists."}
                </div>
              ) : (
                suggestions.map((stat, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={stat.artist}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        void appendUniqueArtist(stat.artist);
                      }}
                      className={`w-full h-[24px] px-2.5 flex items-center justify-between gap-2 text-left text-[10.5px] font-mono transition-colors cursor-pointer ${
                        isActive
                          ? "bg-accent-soft text-accent-fg font-semibold"
                          : "text-fg hover:bg-surface-3"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        <User className="w-3 h-3 shrink-0 opacity-75" />
                        <span className="truncate">{stat.artist}</span>
                      </span>
                      <span className="text-[9.5px] text-fg-3 tabular-nums shrink-0">
                        {stat.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}

      <div className="space-y-1 max-h-[96px] overflow-y-auto pr-0.5">
        {linkedArtists.length === 0 ? (
          <div className="p-2 text-center text-[10px] text-fg-3 font-mono border border-dashed border-line rounded-xs">
            No metadata artists linked (optional).
          </div>
        ) : (
          linkedArtists.map((artistName) => {
            const countForArtist =
              countByArtistLower.get(artistName.trim().toLowerCase()) ?? 0;
            return (
              <div
                key={artistName}
                className="h-[26px] px-2 rounded-xs bg-surface-2 border border-line flex items-center justify-between space-x-2 text-[10px] font-mono"
              >
                <div className="flex items-center space-x-1.5 truncate min-w-0">
                  <User className="w-3 h-3 text-accent-fg shrink-0" />
                  <span className="truncate text-fg" title={artistName}>
                    {artistName}
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 shrink-0">
                  <span className="text-[9.5px] text-ok tabular-nums">
                    {countForArtist.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void updateLicenseGroup(activeLicenseGroup.id, {
                        artists: linkedArtists.filter((a) => a !== artistName),
                      })
                    }
                    className="w-[16px] h-[16px] flex items-center justify-center text-fg-3 hover:text-accent-fg rounded-xs transition-colors cursor-pointer"
                    title="Unlink artist metadata"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
