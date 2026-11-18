import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import type { ActiveSynonymHint } from "../../utils/sfxThesaurus";

const SMART_SEARCH_CHIPS = [
  { token: "<2s", desc: "Short (<2s)" },
  { token: ">10s", desc: "Long (>10s)" },
  { token: "dur:1-5s", desc: "1s to 5s" },
  { token: "-loop", desc: "Exclude Loops" },
  { token: "-music", desc: "No Music" },
  { token: "is:fav", desc: "Favorites" },
  { token: "is:oneshot", desc: "One-Shots" },
  { token: "is:loop", desc: "Loops Only" },
  { token: "bpm:120", desc: "~120 BPM" },
  { token: "bpm:90-130", desc: "90 to 130 BPM" },
  { token: "key:Am", desc: "Exact Key (Am / 8A)" },
  { token: "key:~8A", desc: "Harmonic Mix Keys (8A, 7A, 9A, 8B)" },
  { token: "tag:", desc: "By Tag" },
  { token: "genre:", desc: "By Genre / Mood" },
  { token: "folder:", desc: "By Folder" },
  { token: "ext:wav", desc: "WAV Only" },
  { token: "channels:stereo", desc: "Stereo Only (or mono)" },
  { token: "sr:48k", desc: "48 kHz (or >=48k)" },
  { token: "bit:24", desc: "24-bit Audio (or >=24)" },
  { token: "size:>5mb", desc: "Larger than 5 MB" },
] as const;

interface SmartSearchHelperPopoverProps {
  searchQuery: string;
  smartSearchSynonyms: boolean;
  synonymHints: ActiveSynonymHint[];
  searchInputRef: React.RefObject<HTMLInputElement>;
  anchorRef?: React.RefObject<HTMLElement | null>;
  setSearchQuery: (q: string) => void;
  setSmartSearchSynonyms: (v: boolean) => void;
  setShowSearchHelper: React.Dispatch<React.SetStateAction<boolean>>;
}

export const SmartSearchHelperPopover: React.FC<
  SmartSearchHelperPopoverProps
> = ({
  searchQuery,
  smartSearchSynonyms,
  synonymHints,
  searchInputRef,
  anchorRef,
  setSearchQuery,
  setSmartSearchSynonyms,
  setShowSearchHelper,
}) => {
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: 68,
    left: 12,
  });

  useLayoutEffect(() => {
    const updatePos = () => {
      const el = anchorRef?.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const w = Math.min(368, window.innerWidth - 24);
      const top = Math.min(window.innerHeight - 180, rect.bottom + 4);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
      setCoords({ top, left });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [anchorRef]);

  const panel = (
    <div
      data-context-menu-portal="true"
      data-popover-portal="true"
      data-mica-overlay="true"
      style={{
        position: "fixed",
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: Z_INDEX.floatingMenu,
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-[368px] max-w-[calc(100vw-24px)] bg-surface-2 backdrop-blur-md border border-line-strong rounded-md shadow-2xl p-2 space-y-2 font-mono text-[10px]"
    >
    <div className="flex items-center justify-between border-b border-line pb-1">
      <span className="text-fg font-semibold tracking-wider uppercase text-[9.5px]">
        SMART SEARCH OPERATORS
      </span>
      <button
        type="button"
        onClick={() => setSmartSearchSynonyms(!smartSearchSynonyms)}
        className={`h-[18px] px-1.5 rounded-xs border flex items-center space-x-1 transition-colors ${
          smartSearchSynonyms
            ? "bg-accent-soft border-accent text-accent-fg font-semibold"
            : "bg-surface-3 border-line text-fg-3"
        }`}
        title="Toggle Smart Audio Synonym Expansion"
      >
        <Sparkles className="w-2.5 h-2.5" />
        <span>SYNONYMS {smartSearchSynonyms ? "ON" : "OFF"}</span>
      </button>
    </div>

    <div className="grid grid-cols-4 gap-1">
      {SMART_SEARCH_CHIPS.map((chip) => {
        const isPresent = searchQuery
          .toLowerCase()
          .split(/\s+/)
          .includes(chip.token.toLowerCase());
        return (
          <button
            key={chip.token}
            type="button"
            onClick={() => {
              const trimmed = searchQuery.trim();
              if (isPresent) {
                const next = trimmed
                  .split(/\s+/)
                  .filter((w) => w.toLowerCase() !== chip.token.toLowerCase())
                  .join(" ");
                setSearchQuery(next);
              } else {
                const next = trimmed ? `${trimmed} ${chip.token}` : chip.token;
                setSearchQuery(next);
              }
              searchInputRef.current?.focus();
            }}
            className={`h-[22px] px-1.5 rounded-xs border flex items-center justify-between transition-colors ${
              isPresent
                ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                : "bg-surface-3 hover:bg-surface-1 border-line text-fg-2 hover:text-fg"
            }`}
            title={chip.desc}
          >
            <span className="truncate">{chip.token}</span>
          </button>
        );
      })}
    </div>

    {synonymHints.length > 0 && (
      <div className="pt-1 border-t border-line space-y-1">
        <div className="text-[9px] text-fg-3 uppercase tracking-wider">
          ACTIVE BILINGUAL UCS SYNONYMS (CLICK FOR EXACT MATCH)
        </div>
        {synonymHints.map((hint) => (
          <div key={hint.clusterId} className="flex flex-wrap items-center gap-1">
            <span className="text-accent-fg font-semibold">
              {hint.matchedTerm} ≈
            </span>
            {hint.suggestions.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => {
                  setSearchQuery(`"${sug}"`);
                  setShowSearchHelper(false);
                }}
                className="h-[18px] px-1.5 rounded-xs bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg transition-colors"
                title={`Search strictly for "${sug}" (quotes disable synonym expansion)`}
              >
                {sug}
              </button>
            ))}
          </div>
        ))}
      </div>
    )}

    <div className="pt-1 border-t border-line text-[9.5px] text-fg-3 flex items-center justify-between">
      <span>Tip: Wrap in &quot;quotes&quot; for strict exact match</span>
      <span className="text-accent-fg">key:~8A = Harmonic</span>
    </div>
  </div>
  );

  return typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
};
