import React, { useEffect, useMemo, useState } from "react";
import { CopyCheck, History, Inbox, Scissors, Star, X } from "lucide-react";
import { DuplicateGeneralControls } from "./DuplicateGeneralControls";
import { SliceGeneralControls } from "./SliceGeneralControls";
import { TrashGeneralControls } from "./TrashGeneralControls";
import {
  CAMELOT_MAJOR_KEYS,
  CAMELOT_MINOR_KEYS,
} from "../../constants/camelotKeys";
import { useSampleStore } from "../../store/useSampleStore";
import {
  removeSearchPrefixTokens,
  upsertSearchPrefixToken,
} from "../../utils/searchPrefixHelpers";

export type FilterDrawerTabId =
  | "general"
  | "type"
  | "sample_rate"
  | "genre"
  | "tags"
  | "bpm"
  | "key";

const BPM_PRESETS = [
  { label: "< 90", token: "<=90" },
  { label: "90–110", token: "90-110" },
  { label: "110–130", token: "110-130" },
  { label: "130–150", token: "130-150" },
  { label: "150+", token: ">=150" },
] as const;

interface FilterDrawerPanelProps {
  activeTab: FilterDrawerTabId;
  compact?: boolean;
  bpmTokens: string[];
  keyTokens: string[];
}

export const FilterDrawerPanel: React.FC<FilterDrawerPanelProps> = ({
  activeTab,
  compact = false,
  bpmTokens,
  keyTokens,
}) => {
  const favoriteOnly = useSampleStore((s) => s.favoriteOnly);
  const recentOnly = useSampleStore((s) => s.recentOnly);
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const duplicatesFilterActive = useSampleStore(
    (s) => s.duplicatesFilterActive
  );
  const slicesFilterActive = useSampleStore((s) => s.slicesFilterActive);
  const trashFilterActive = useSampleStore((s) => s.trashFilterActive);
  const typeFilter = useSampleStore((s) => s.typeFilter);
  const srFilter = useSampleStore((s) => s.srFilter);
  const selectedGenre = useSampleStore((s) => s.selectedGenre);
  const genres = useSampleStore((s) => s.genres);
  const selectedTagIds = useSampleStore((s) => s.selectedTagIds);
  const tags = useSampleStore((s) => s.tags);
  const searchQuery = useSampleStore((s) => s.searchQuery);

  const setFavoriteOnly = useSampleStore((s) => s.setFavoriteOnly);
  const setRecentOnly = useSampleStore((s) => s.setRecentOnly);
  const setBinFilterActive = useSampleStore((s) => s.setBinFilterActive);
  const setDuplicatesFilterActive = useSampleStore(
    (s) => s.setDuplicatesFilterActive
  );
  const setSlicesFilterActive = useSampleStore(
    (s) => s.setSlicesFilterActive
  );
  const setTypeFilter = useSampleStore((s) => s.setTypeFilter);
  const setSrFilter = useSampleStore((s) => s.setSrFilter);
  const setSelectedGenre = useSampleStore((s) => s.setSelectedGenre);
  const toggleTagFilter = useSampleStore((s) => s.toggleTagFilter);
  const setSearchQuery = useSampleStore((s) => s.setSearchQuery);

  const currentBpmToken = bpmTokens[0] || "";
  const [bpmMinInput, setBpmMinInput] = useState("");
  const [bpmMaxInput, setBpmMaxInput] = useState("");

  useEffect(() => {
    if (!currentBpmToken) {
      setBpmMinInput("");
      setBpmMaxInput("");
      return;
    }
    const rangeMatch = currentBpmToken.match(
      /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/
    );
    if (rangeMatch) {
      setBpmMinInput(rangeMatch[1]);
      setBpmMaxInput(rangeMatch[2]);
      return;
    }
    const minMatch = currentBpmToken.match(/^>=?(\d+(?:\.\d+)?)$/);
    if (minMatch) {
      setBpmMinInput(minMatch[1]);
      setBpmMaxInput("");
      return;
    }
    const maxMatch = currentBpmToken.match(/^<=?(\d+(?:\.\d+)?)$/);
    if (maxMatch) {
      setBpmMinInput("");
      setBpmMaxInput(maxMatch[1]);
      return;
    }
    const single = Number(currentBpmToken);
    if (Number.isFinite(single) && single > 0) {
      setBpmMinInput(String(single));
      setBpmMaxInput(String(single));
    }
  }, [currentBpmToken]);

  const applyBpmRangeInputs = (minRaw: string, maxRaw: string) => {
    const minVal = minRaw.trim() ? Number(minRaw.trim()) : null;
    const maxVal = maxRaw.trim() ? Number(maxRaw.trim()) : null;
    const hasMin = minVal !== null && Number.isFinite(minVal) && minVal > 0;
    const hasMax = maxVal !== null && Number.isFinite(maxVal) && maxVal > 0;

    let token: string | null = null;
    if (hasMin && hasMax) {
      token = `${Math.min(minVal!, maxVal!)}-${Math.max(minVal!, maxVal!)}`;
    } else if (hasMin) {
      token = `>=${minVal}`;
    } else if (hasMax) {
      token = `<=${maxVal}`;
    }
    setSearchQuery(upsertSearchPrefixToken(searchQuery, "bpm:", token));
  };

  const currentKeyToken = keyTokens[0] || "";
  const isHarmonicActive =
    currentKeyToken.startsWith("~") || currentKeyToken.startsWith("≈");
  const activeCamelotCode = (
    isHarmonicActive ? currentKeyToken.slice(1) : currentKeyToken
  ).toUpperCase();

  const handleToggleCamelotKey = (camelot: string) => {
    if (activeCamelotCode === camelot.toUpperCase()) {
      setSearchQuery(removeSearchPrefixTokens(searchQuery, "key:"));
    } else {
      const nextToken = isHarmonicActive ? `~${camelot}` : camelot;
      setSearchQuery(upsertSearchPrefixToken(searchQuery, "key:", nextToken));
    }
  };

  const handleToggleHarmonic = () => {
    if (!activeCamelotCode) return;
    const nextToken = isHarmonicActive
      ? activeCamelotCode
      : `~${activeCamelotCode}`;
    setSearchQuery(upsertSearchPrefixToken(searchQuery, "key:", nextToken));
  };

  const selectedTagSet = useMemo(
    () => new Set(selectedTagIds),
    [selectedTagIds]
  );

  const sortedGenres = useMemo(
    () =>
      [...genres].sort(
        (a, b) => b.sample_count - a.sample_count || a.name.localeCompare(b.name)
      ),
    [genres]
  );

  const sortedTags = useMemo(
    () =>
      [...tags].sort(
        (a, b) => b.sample_count - a.sample_count || a.name.localeCompare(b.name)
      ),
    [tags]
  );

  switch (activeTab) {
    case "general":
      return (
        <div className={`flex flex-col w-full ${compact ? "gap-1" : "gap-1.5"}`}>
          <div
            className={`flex items-center flex-wrap ${
              compact ? "gap-1" : "gap-1.5"
            }`}
          >
            <button
              type="button"
              onClick={() => setFavoriteOnly(!favoriteOnly)}
              className={`${
                compact ? "h-[22px] px-1.5 gap-1 text-[10.5px]" : "h-[24px] px-2.5 gap-1.5 text-[11px]"
              } rounded-[3px] border inline-flex items-center whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                favoriteOnly
                  ? "bg-accent-soft border-accent text-accent-fg font-medium"
                  : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
              }`}
            >
              <Star className={`w-3 h-3 ${favoriteOnly ? "fill-current" : ""}`} />
              <span>Favorites</span>
            </button>

            <button
              type="button"
              onClick={() => setBinFilterActive(!binFilterActive)}
              className={`${
                compact ? "h-[22px] px-1.5 gap-1 text-[10.5px]" : "h-[24px] px-2.5 gap-1.5 text-[11px]"
              } rounded-[3px] border inline-flex items-center whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                binFilterActive
                  ? "bg-accent-soft border-accent text-accent-fg font-medium"
                  : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
              }`}
            >
              <Inbox className="w-3 h-3" />
              <span>Session Bin</span>
            </button>

            <button
              type="button"
              onClick={() => setRecentOnly(!recentOnly)}
              className={`${
                compact ? "h-[22px] px-1.5 gap-1 text-[10.5px]" : "h-[24px] px-2.5 gap-1.5 text-[11px]"
              } rounded-[3px] border inline-flex items-center whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                recentOnly
                  ? "bg-accent-soft border-accent text-accent-fg font-medium"
                  : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
              }`}
            >
              <History className="w-3 h-3" />
              <span>Recent</span>
            </button>

            <button
              type="button"
              onClick={() => setSlicesFilterActive(!slicesFilterActive)}
              className={`${
                compact ? "h-[22px] px-1.5 gap-1 text-[10.5px]" : "h-[24px] px-2.5 gap-1.5 text-[11px]"
              } rounded-[3px] border inline-flex items-center whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                slicesFilterActive
                  ? "bg-accent-soft border-accent text-accent-fg font-medium"
                  : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
              }`}
              title="Browse exported & saved waveform slices with source track origin"
            >
              <Scissors className="w-3 h-3" />
              <span>Slices</span>
            </button>

            <button
              type="button"
              onClick={() => setDuplicatesFilterActive(!duplicatesFilterActive)}
              className={`${
                compact ? "h-[22px] px-1.5 gap-1 text-[10.5px]" : "h-[24px] px-2.5 gap-1.5 text-[11px]"
              } rounded-[3px] border inline-flex items-center whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                duplicatesFilterActive
                  ? "bg-accent-soft border-accent text-accent-fg font-medium"
                  : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
              }`}
              title="Find exact and similar duplicate audio files"
            >
              <CopyCheck className="w-3 h-3" />
              <span>Duplicates</span>
            </button>
          </div>

          {slicesFilterActive && <SliceGeneralControls compact={compact} />}
          {duplicatesFilterActive && (
            <DuplicateGeneralControls compact={compact} />
          )}
          {trashFilterActive && <TrashGeneralControls compact={compact} />}
        </div>
      );

    case "type":
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { id: "all", label: "ALL" },
              { id: "oneshot", label: "ONE-SHOT" },
              { id: "loop", label: "LOOP" },
            ] as const
          ).map((opt) => {
            const active = typeFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTypeFilter(opt.id)}
                className={`h-[24px] px-2.5 rounded-[3px] border font-mono text-[11px] transition-colors ${
                  active
                    ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );

    case "sample_rate":
      return (
        <div className="flex items-center gap-1.5 flex-wrap font-mono">
          <button
            type="button"
            onClick={() => setSrFilter(null)}
            className={`h-[24px] px-2.5 rounded-[3px] border text-[11px] transition-colors ${
              srFilter === null
                ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
            }`}
          >
            ALL
          </button>
          {(
            [
              { val: 44100, label: "44.1 kHz" },
              { val: 48000, label: "48 kHz" },
              { val: 96000, label: "96 kHz" },
            ] as const
          ).map((sr) => {
            const active = srFilter === sr.val;
            return (
              <button
                key={sr.val}
                type="button"
                onClick={() => setSrFilter(active ? null : sr.val)}
                className={`h-[24px] px-2.5 rounded-[3px] border text-[11px] transition-colors ${
                  active
                    ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                }`}
              >
                {sr.label}
              </button>
            );
          })}
        </div>
      );

    case "genre":
      return sortedGenres.length === 0 ? (
        <span className="text-[11px] text-fg-3">No genres available.</span>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap content-start">
          {sortedGenres.map((g) => {
            const active =
              selectedGenre !== null &&
              selectedGenre.toLowerCase() === g.name.toLowerCase();
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedGenre(g.name)}
                className={`h-[23px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 transition-colors ${
                  active
                    ? "bg-accent-soft border-accent text-accent-fg font-medium"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                }`}
                title={`${g.name} (${g.sample_count.toLocaleString()})`}
              >
                <span
                  className="w-2 h-2 rounded-[2px] shrink-0"
                  style={{ backgroundColor: g.color }}
                />
                <span>{g.name}</span>
                <span className="text-[10px] font-mono text-fg-3">
                  {g.sample_count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      );

    case "tags":
      return sortedTags.length === 0 ? (
        <span className="text-[11px] text-fg-3">No tags available.</span>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap content-start">
          {sortedTags.map((t) => {
            const active = selectedTagSet.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTagFilter(t.id)}
                className={`h-[23px] px-2 rounded-[3px] border text-[11px] inline-flex items-center gap-1.5 transition-colors ${
                  active
                    ? "bg-accent-soft border-accent text-accent-fg font-medium"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                }`}
                title={`${t.name} (${t.sample_count.toLocaleString()})`}
              >
                <span
                  className="w-2 h-2 rounded-[2px] shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span>{t.name}</span>
                <span className="text-[10px] font-mono text-fg-3">
                  {t.sample_count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      );

    case "bpm":
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-[11px] text-fg-2">
            <span className="text-[10px] uppercase tracking-wider text-fg-3">
              Range:
            </span>
            <input
              type="number"
              min={30}
              max={300}
              value={bpmMinInput}
              onChange={(e) => {
                setBpmMinInput(e.target.value);
                applyBpmRangeInputs(e.target.value, bpmMaxInput);
              }}
              placeholder="Min"
              className="w-[52px] h-[24px] px-1.5 rounded-[3px] bg-surface-0 border border-line focus:border-accent font-mono text-[11px] text-fg text-center outline-none"
            />
            <span className="text-fg-3">–</span>
            <input
              type="number"
              min={30}
              max={300}
              value={bpmMaxInput}
              onChange={(e) => {
                setBpmMaxInput(e.target.value);
                applyBpmRangeInputs(bpmMinInput, e.target.value);
              }}
              placeholder="Max"
              className="w-[52px] h-[24px] px-1.5 rounded-[3px] bg-surface-0 border border-line focus:border-accent font-mono text-[11px] text-fg text-center outline-none"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap font-mono">
            {BPM_PRESETS.map((preset) => {
              const active = currentBpmToken === preset.token;
              return (
                <button
                  key={preset.token}
                  type="button"
                  onClick={() => {
                    const next = active ? null : preset.token;
                    setSearchQuery(
                      upsertSearchPrefixToken(searchQuery, "bpm:", next)
                    );
                  }}
                  className={`h-[24px] px-2 rounded-[3px] border text-[11px] transition-colors ${
                    active
                      ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                      : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            {currentBpmToken && (
              <button
                type="button"
                onClick={() =>
                  setSearchQuery(removeSearchPrefixTokens(searchQuery, "bpm:"))
                }
                className="h-[24px] px-2 rounded-[3px] border border-line bg-surface-3 hover:border-accent text-fg-3 hover:text-fg text-[10.5px] inline-flex items-center gap-1"
                title="Clear BPM filter"
              >
                <X className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>
      );

    case "key":
      return (
        <div className="flex flex-col gap-1.5 w-full">
          {(
            [
              { label: "Minor", modeLabel: "Minor", keys: CAMELOT_MINOR_KEYS },
              { label: "Major", modeLabel: "Major", keys: CAMELOT_MAJOR_KEYS },
            ] as const
          ).map((row) => (
            <div key={row.label} className="flex items-center gap-1 flex-wrap">
              <span className="w-[38px] text-[10px] font-mono uppercase text-fg-3 shrink-0">
                {row.label}
              </span>
              {row.keys.map((k) => {
                const active = activeCamelotCode === k.camelot;
                return (
                  <button
                    key={k.camelot}
                    type="button"
                    onClick={() => handleToggleCamelotKey(k.camelot)}
                    className={`h-[22px] px-1.5 rounded-[3px] border font-mono text-[10.5px] transition-colors ${
                      active
                        ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                        : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
                    }`}
                    title={`${k.camelot} (${k.key} ${row.modeLabel})`}
                  >
                    <span>{k.camelot}</span>
                    <span className="text-[9.5px] text-fg-3 ml-1">
                      {k.key}
                    </span>
                  </button>
                );
              })}

              {row.label === "Major" && (
                <button
                  type="button"
                  disabled={!activeCamelotCode}
                  onClick={handleToggleHarmonic}
                  className={`ml-auto h-[22px] px-2 rounded-[3px] border font-mono text-[10.5px] transition-colors disabled:opacity-40 ${
                    isHarmonicActive
                      ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                      : "bg-surface-3 border-line text-fg-2 hover:text-fg"
                  }`}
                  title="Include harmonically compatible Camelot neighbor keys (±1 fifth & relative Major/Minor)"
                >
                  ~ Harmonic
                </button>
              )}
            </div>
          ))}
        </div>
      );
  }
};
