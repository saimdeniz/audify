import React, { useMemo, useState } from "react";
import {
  ExternalLink,
  Eye,
  FileCheck2,
  Inbox,
  Plus,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { generateBatchAttributionCredits } from "../../utils/format";
import { beginDragOnMove, startNativeSampleDrag } from "../../utils/drag";
import { EMPTY_SAMPLES, resolveSamplesByIds } from "../../utils/sampleLookup";

interface SessionBinTabProps {
  dragHoverTarget: string | null;
  setDragHoverTarget: (target: string | null) => void;
}

export const SessionBinTab: React.FC<SessionBinTabProps> = ({
  dragHoverTarget,
  setDragHoverTarget,
}) => {
  const binSampleIds = useSampleStore((s) => s.binSampleIds);
  const binSamplesPool = useSampleStore((s) =>
    s.binSampleIds.length === 0
      ? EMPTY_SAMPLES
      : s.allProfileSamples.length > 0
      ? s.allProfileSamples
      : s.rawSamples
  );
  const binSamples = useMemo(
    () => resolveSamplesByIds(binSampleIds, binSamplesPool),
    [binSampleIds, binSamplesPool]
  );
  const binFilterActive = useSampleStore((s) => s.binFilterActive);
  const autoBinOnNleDrag = useSampleStore((s) => s.autoBinOnNleDrag);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const licenseGroups = useSampleStore((s) => s.licenseGroups);
  const selectedSampleId = useSampleStore((s) => s.selectedSample?.id ?? null);
  const isDraggingInApp = useSampleStore((s) => s.inAppDragSample !== null);

  const setBinFilterActive = useSampleStore((s) => s.setBinFilterActive);
  const setAutoBinOnNleDrag = useSampleStore((s) => s.setAutoBinOnNleDrag);
  const removeSampleFromBin = useSampleStore((s) => s.removeSampleFromBin);
  const clearBin = useSampleStore((s) => s.clearBin);
  const createCollection = useSampleStore((s) => s.createCollection);
  const addSamplesToCollectionBatch = useSampleStore(
    (s) => s.addSamplesToCollectionBatch
  );
  const toggleFavoritesBatch = useSampleStore((s) => s.toggleFavoritesBatch);
  const copyAttributionForSamples = useSampleStore(
    (s) => s.copyAttributionForSamples
  );
  const selectSample = useSampleStore((s) => s.selectSample);

  const [binCollectionName, setBinCollectionName] = useState("");

  const binCredits = useMemo(
    () =>
      enableLicensesSystem && binSamples.length > 0
        ? generateBatchAttributionCredits(binSamples, licenseGroups)
        : null,
    [enableLicensesSystem, binSamples, licenseGroups]
  );

  return (
    <div
      data-drop-bin="true"
      data-sidebar-drop="bin"
      className={`flex-1 min-h-0 flex flex-col ${
        isDraggingInApp && dragHoverTarget === "bin" ? "bg-accent-soft" : ""
      }`}
      onMouseEnter={() => {
        if (isDraggingInApp) setDragHoverTarget("bin");
      }}
      onMouseLeave={() => {
        if (dragHoverTarget === "bin") setDragHoverTarget(null);
      }}
    >
      <div className="h-[32px] px-2.5 border-b border-line bg-surface-header flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-head truncate">
            SESSION BIN ({binSamples.length})
          </span>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={() => setBinFilterActive(!binFilterActive)}
            disabled={binSamples.length === 0 && !binFilterActive}
            className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors disabled:opacity-35 ${
              binFilterActive
                ? "bg-accent-soft border-accent text-accent-fg"
                : "bg-surface-3 border-line text-fg-3 hover:text-fg hover:border-line-strong"
            }`}
            title={
              binFilterActive
                ? "Showing only Bin tracks in table (Click to show all)"
                : "Show only Bin tracks in table"
            }
          >
            <Eye className="w-3 h-3" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => {
              if (e.button !== 0 || binSamples.length === 0) return;
              const paths = binSamples.map((s) => s.file_path);
              beginDragOnMove(e.clientX, e.clientY, () =>
                startNativeSampleDrag(paths)
              );
            }}
            disabled={binSamples.length === 0}
            className="w-[20px] h-[20px] rounded-xs bg-surface-3 hover:border-accent border border-line text-fg-3 hover:text-accent-fg flex items-center justify-center cursor-grab shrink-0 transition-colors disabled:opacity-35"
            title="Drag all Bin tracks to NLE / DAW"
          >
            <ExternalLink className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() =>
              void toggleFavoritesBatch(
                binSamples.map((s) => s.id),
                true
              )
            }
            disabled={binSamples.length === 0}
            className="w-[20px] h-[20px] rounded-xs bg-surface-3 hover:border-accent border border-line text-fg-3 hover:text-accent-fg flex items-center justify-center shrink-0 transition-colors disabled:opacity-35"
            title="Favorite all Bin tracks"
          >
            <Star className="w-3 h-3" />
          </button>

          {enableLicensesSystem && (
            <button
              type="button"
              onClick={() => copyAttributionForSamples(binSamples)}
              disabled={binSamples.length === 0}
              className="w-[20px] h-[20px] rounded-xs bg-surface-3 hover:border-accent border border-line text-accent-fg hover:bg-accent hover:text-accent-on flex items-center justify-center shrink-0 transition-colors disabled:opacity-35"
              title={
                binCredits
                  ? `Copy all credits (${binCredits.matchedSampleCount} matched • ${binCredits.artistCount} artist${
                      binCredits.artistCount === 1 ? "" : "s"
                    })`
                  : "Copy all credits"
              }
            >
              <FileCheck2 className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setAutoBinOnNleDrag(!autoBinOnNleDrag)}
            className={`w-[20px] h-[20px] rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
              autoBinOnNleDrag
                ? "bg-accent-soft border-accent text-accent-fg"
                : "bg-surface-3 border-line text-fg-3 hover:text-fg"
            }`}
            title={`Auto-add tracks dragged to NLE: ${
              autoBinOnNleDrag ? "ON" : "OFF"
            }`}
          >
            <Zap className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => clearBin()}
            disabled={binSamples.length === 0}
            className="w-[20px] h-[20px] rounded-xs bg-surface-3 hover:bg-danger hover:text-danger-on hover:border-danger border border-line text-fg-3 flex items-center justify-center shrink-0 transition-colors disabled:opacity-35"
            title="Clear Session Bin"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const name = binCollectionName.trim();
          if (!name || binSamples.length === 0) return;
          const created = await createCollection(name);
          if (created) {
            await addSamplesToCollectionBatch(
              created.id,
              binSamples.map((s) => s.id)
            );
            setBinCollectionName("");
          }
        }}
        className="px-2 py-1.5 border-b border-line flex items-center space-x-1 shrink-0"
      >
        <input
          type="text"
          value={binCollectionName}
          onChange={(e) => setBinCollectionName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && binCollectionName) {
              e.stopPropagation();
              setBinCollectionName("");
            }
          }}
          placeholder="Save Bin as collection..."
          className="flex-1 min-w-0 h-[24px] rounded-xs bg-surface-3 border border-line focus:border-accent px-2 text-[11px] text-fg placeholder-fg-3 outline-none"
        />
        <button
          type="submit"
          disabled={!binCollectionName.trim() || binSamples.length === 0}
          className="w-[24px] h-[24px] rounded-xs bg-surface-3 hover:bg-accent hover:text-accent-on border border-line text-accent-fg disabled:opacity-35 flex items-center justify-center shrink-0 transition-colors"
          title="Save Bin as Collection"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>

      <div className="flex-1 overflow-y-auto py-1.5">
        {binSamples.length === 0 ? (
          <div className="px-4 py-6 text-center space-y-1.5">
            <Inbox className="w-5 h-5 mx-auto text-fg-3" />
            <div className="text-[11px] text-fg-2 font-medium">Bin is empty</div>
            <div className="text-[10px] text-fg-3 leading-relaxed">
              Drag tracks here or press B to collect tracks for your edit.
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {binSamples.map((s) => (
              <div
                key={s.id}
                onClick={() => selectSample(s, true)}
                className={`group h-[26px] px-2 flex items-center justify-between cursor-pointer border-l-2 ${
                  selectedSampleId === s.id
                    ? "bg-surface-3 text-accent-fg border-accent"
                    : "text-fg-2 hover:bg-surface-hover hover:text-fg border-transparent"
                }`}
                title={s.file_path}
              >
                <span className="truncate text-[11px] flex-1 min-w-0">
                  {s.file_name}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSampleFromBin(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 w-[18px] h-[18px] rounded-xs flex items-center justify-center text-fg-2 hover:text-danger hover:bg-line shrink-0 ml-1"
                  title="Remove from Bin"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
