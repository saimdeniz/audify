import React, { useEffect, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { CAMELOT_KEYS } from "../../constants/camelotKeys";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { ContextMenuState } from "./tableLayout";

interface SubmenuBaseProps {
  submenuPositionClass: string;
  targetIds: number[];
  isMultiContext: boolean;
  activeContextSample: SampleItem;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

export const ContextMenuTagSubmenu: React.FC<SubmenuBaseProps> = ({
  submenuPositionClass,
  targetIds,
  isMultiContext,
  activeContextSample,
  setContextMenu,
}) => {
  const tags = useSampleStore((s) => s.tags);
  const assignTag = useSampleStore((s) => s.assignTag);
  const unassignTag = useSampleStore((s) => s.unassignTag);
  const assignTagBatch = useSampleStore((s) => s.assignTagBatch);
  const clearSampleTags = useSampleStore((s) => s.clearSampleTags);
  const [tagMenuSearch, setTagMenuSearch] = useState("");

  return (
    <div
      className={`absolute ${submenuPositionClass} w-[236px] bg-surface-2 border border-line-strong rounded-md p-2 text-fg shadow-2xl z-40 space-y-1.5`}
    >
      <div className="flex items-center space-x-1">
        <div className="relative flex-1 flex items-center">
          <Search className="w-3 h-3 text-fg-3 absolute left-2 pointer-events-none" />
          <input
            type="text"
            value={tagMenuSearch}
            onChange={(e) => setTagMenuSearch(e.target.value)}
            placeholder="Filter tags..."
            autoFocus
            className="w-full h-[22px] bg-surface-3 border border-line focus:border-accent pl-6 pr-5 text-[11px] text-fg placeholder:text-fg-3 outline-none rounded-xs"
          />
          {tagMenuSearch && (
            <button
              type="button"
              onClick={() => setTagMenuSearch("")}
              className="absolute right-1.5 text-fg-3 hover:text-fg"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {(isMultiContext || activeContextSample.tags.length > 0) && (
          <button
            type="button"
            onClick={async () => {
              await clearSampleTags(
                isMultiContext ? targetIds : [activeContextSample.id]
              );
              setContextMenu(null);
            }}
            className="w-[22px] h-[22px] rounded-xs bg-surface-3 hover:bg-danger/15 border border-line hover:border-danger text-fg-3 hover:text-danger flex items-center justify-center shrink-0 transition-colors"
            title={
              isMultiContext
                ? "Clear all tags on selected samples"
                : "Clear assigned tags"
            }
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1 max-h-[210px] overflow-y-auto pr-0.5">
        {tags
          .filter((t) =>
            t.name.toLowerCase().includes(tagMenuSearch.trim().toLowerCase())
          )
          .map((t) => {
            const assigned =
              !isMultiContext &&
              activeContextSample.tags.some((b) => b.id === t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={async () => {
                  if (isMultiContext) {
                    await assignTagBatch(targetIds, t.id);
                    setContextMenu(null);
                  } else if (assigned) {
                    await unassignTag(activeContextSample.id, t.id);
                  } else {
                    await assignTag(activeContextSample.id, t.id);
                  }
                }}
                className={`h-[24px] px-2 rounded-xs border flex items-center justify-between text-[11px] min-w-0 transition-colors ${
                  assigned
                    ? "bg-accent-soft border-accent text-accent-fg font-medium"
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
                {assigned && (
                  <Check className="w-3 h-3 text-accent-fg shrink-0 ml-1" />
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
};

export const ContextMenuGenreSubmenu: React.FC<SubmenuBaseProps> = ({
  submenuPositionClass,
  targetIds,
  isMultiContext,
  activeContextSample,
  setContextMenu,
}) => {
  const genres = useSampleStore((s) => s.genres);
  const assignGenre = useSampleStore((s) => s.assignGenre);
  const assignGenreBatch = useSampleStore((s) => s.assignGenreBatch);
  const [genreMenuSearch, setGenreMenuSearch] = useState("");

  return (
    <div
      className={`absolute ${submenuPositionClass} w-[236px] bg-surface-2 border border-line-strong rounded-md p-2 text-fg shadow-2xl z-40 space-y-1.5`}
    >
      <div className="flex items-center space-x-1">
        <div className="relative flex-1 flex items-center">
          <Search className="w-3 h-3 text-fg-3 absolute left-2 pointer-events-none" />
          <input
            type="text"
            value={genreMenuSearch}
            onChange={(e) => setGenreMenuSearch(e.target.value)}
            placeholder="Filter genres..."
            autoFocus
            className="w-full h-[22px] bg-surface-3 border border-line focus:border-accent pl-6 pr-5 text-[11px] text-fg placeholder:text-fg-3 outline-none rounded-xs"
          />
          {genreMenuSearch && (
            <button
              type="button"
              onClick={() => setGenreMenuSearch("")}
              className="absolute right-1.5 text-fg-3 hover:text-fg"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {(isMultiContext || activeContextSample.genre) && (
          <button
            type="button"
            onClick={async () => {
              if (isMultiContext) {
                await assignGenreBatch(targetIds, "");
              } else {
                await assignGenre(activeContextSample.id, "");
              }
              setContextMenu(null);
            }}
            className="w-[22px] h-[22px] rounded-xs bg-surface-3 hover:bg-danger/15 border border-line hover:border-danger text-fg-3 hover:text-danger flex items-center justify-center shrink-0 transition-colors"
            title={
              isMultiContext
                ? "Clear genre on selected samples"
                : "Clear assigned genre"
            }
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1 max-h-[210px] overflow-y-auto pr-0.5">
        {genres
          .filter((g) =>
            g.name.toLowerCase().includes(genreMenuSearch.trim().toLowerCase())
          )
          .map((g) => {
            const assigned =
              !isMultiContext &&
              (activeContextSample.genre || "").toLowerCase() ===
                g.name.toLowerCase();
            return (
              <button
                key={g.id}
                type="button"
                onClick={async () => {
                  if (isMultiContext) {
                    await assignGenreBatch(targetIds, g.name);
                  } else {
                    await assignGenre(
                      activeContextSample.id,
                      assigned ? "" : g.name
                    );
                  }
                  setContextMenu(null);
                }}
                className={`h-[24px] px-2 rounded-xs border flex items-center justify-between text-[11px] min-w-0 transition-colors ${
                  assigned
                    ? "bg-accent-soft border-accent text-accent-fg font-medium"
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
                {assigned && (
                  <Check className="w-3 h-3 text-accent-fg shrink-0 ml-1" />
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
};

export const ContextMenuBpmKeySubmenu: React.FC<SubmenuBaseProps> = ({
  submenuPositionClass,
  targetIds,
  isMultiContext,
  activeContextSample,
  setContextMenu,
}) => {
  const setSampleBpmKey = useSampleStore((s) => s.setSampleBpmKey);
  const [bpmInput, setBpmInput] = useState("");
  const [keyInput, setKeyInput] = useState("");

  useEffect(() => {
    setBpmInput(
      !isMultiContext &&
        activeContextSample.bpm !== null &&
        activeContextSample.bpm !== undefined &&
        activeContextSample.bpm > 0
        ? String(Math.round(activeContextSample.bpm * 10) / 10)
        : ""
    );
    setKeyInput(
      !isMultiContext
        ? activeContextSample.musical_key ||
            activeContextSample.camelot_key ||
            ""
        : ""
    );
  }, [
    isMultiContext,
    activeContextSample.id,
    activeContextSample.bpm,
    activeContextSample.musical_key,
    activeContextSample.camelot_key,
  ]);

  return (
    <div
      className={`absolute ${submenuPositionClass} w-[248px] bg-surface-2 border border-line-strong rounded-md p-2 text-fg shadow-2xl z-40 space-y-2 cursor-default`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* BPM Manual Override */}
      <div className="space-y-1">
        <div className="flex items-center justify-between font-mono text-[9.5px] text-fg-3 uppercase">
          <span>Tempo (BPM)</span>
          {!isMultiContext && activeContextSample.bpm ? (
            <span className="text-accent-fg">
              {Math.round(activeContextSample.bpm * 10) / 10} BPM
            </span>
          ) : null}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const val = Number(bpmInput.trim());
            if (!Number.isFinite(val) || val < 20 || val > 300) return;
            await setSampleBpmKey(targetIds, { bpm: val });
            setContextMenu(null);
          }}
          className="flex items-center space-x-1"
        >
          <input
            type="number"
            min={20}
            max={300}
            step="0.1"
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            placeholder="20–300 BPM"
            className="flex-1 min-w-0 h-[22px] bg-surface-3 border border-line focus:border-accent px-2 font-mono text-[11px] text-fg placeholder:text-fg-3 outline-none rounded-xs"
          />
          <button
            type="submit"
            className="h-[22px] px-2 bg-accent hover:bg-accent-hover text-accent-on font-mono text-[10px] font-bold rounded-xs shrink-0"
          >
            SET
          </button>
          {(isMultiContext || Boolean(activeContextSample.bpm)) && (
            <button
              type="button"
              onClick={async () => {
                await setSampleBpmKey(targetIds, { clearBpm: true });
                setBpmInput("");
                setContextMenu(null);
              }}
              className="w-[22px] h-[22px] rounded-xs bg-surface-3 hover:bg-danger/15 border border-line hover:border-danger text-fg-3 hover:text-danger flex items-center justify-center shrink-0 transition-colors"
              title="Clear BPM"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </form>
      </div>

      <div className="border-t border-line" />

      {/* Musical / Camelot Key Manual Override */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[9.5px] text-fg-3 uppercase">
          <span>Key / Camelot</span>
          {!isMultiContext &&
          (activeContextSample.camelot_key ||
            activeContextSample.musical_key) ? (
            <span className="text-accent-fg">
              {[activeContextSample.camelot_key, activeContextSample.musical_key]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const trimmed = keyInput.trim();
            if (!trimmed) return;
            await setSampleBpmKey(targetIds, { musicalKey: trimmed });
            setContextMenu(null);
          }}
          className="flex items-center space-x-1"
        >
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Am, C#m, 8A, 11B..."
            className="flex-1 min-w-0 h-[22px] bg-surface-3 border border-line focus:border-accent px-2 font-mono text-[11px] text-fg placeholder:text-fg-3 outline-none rounded-xs"
          />
          <button
            type="submit"
            className="h-[22px] px-2 bg-accent hover:bg-accent-hover text-accent-on font-mono text-[10px] font-bold rounded-xs shrink-0"
          >
            SET
          </button>
          {(isMultiContext ||
            Boolean(
              activeContextSample.musical_key ||
                activeContextSample.camelot_key
            )) && (
            <button
              type="button"
              onClick={async () => {
                await setSampleBpmKey(targetIds, { clearKey: true });
                setKeyInput("");
                setContextMenu(null);
              }}
              className="w-[22px] h-[22px] rounded-xs bg-surface-3 hover:bg-danger/15 border border-line hover:border-danger text-fg-3 hover:text-danger flex items-center justify-center shrink-0 transition-colors"
              title="Clear Musical Key"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </form>

        <div className="grid grid-cols-4 gap-1 max-h-[148px] overflow-y-auto pr-0.5">
          {CAMELOT_KEYS.map((item) => {
            const isAssigned =
              !isMultiContext &&
              (activeContextSample.camelot_key || "").toUpperCase() ===
                item.camelot;
            return (
              <button
                key={item.camelot}
                type="button"
                onClick={async () => {
                  await setSampleBpmKey(targetIds, { musicalKey: item.key });
                  setContextMenu(null);
                }}
                title={`${item.camelot} (${item.key})`}
                className={`h-[21px] px-1 rounded-xs border font-mono text-[9.5px] flex items-center justify-between transition-colors ${
                  isAssigned
                    ? "bg-accent-soft border-accent text-accent-fg font-semibold"
                    : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-hover"
                }`}
              >
                <span>{item.camelot}</span>
                <span className="text-fg-3 text-[9px] truncate ml-0.5">
                  {item.key}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
