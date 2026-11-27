import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRightToLine,
  GripVertical,
  Layers,
  LocateFixed,
  Magnet,
  Maximize2,
  PanelTop,
  Play,
  Plus,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import type { LayerPreviewState } from "../../types";
import { beginDragOnMove, startNativeSampleDrag } from "../../utils/drag";
import { ThemedSelect, ThemedSelectOption } from "../common/ThemedSelect";
import type { TimelineFollowMode } from "./LayersTimelineCanvas";
import {
  MAX_LANE_HEIGHT,
  MIN_LANE_HEIGHT,
  pxPerSecToSliderValue,
  sliderValueToPxPerSec,
} from "./layersTimelineMath";

const SNAP_GRID_OPTIONS: readonly ThemedSelectOption[] = [
  { value: "0.05", label: "50ms" },
  { value: "0.1", label: "100ms" },
  { value: "0.25", label: "250ms" },
  { value: "0.5", label: "500ms" },
];

interface LayersStudioHeaderBarProps {
  savedCount: number;
  layerDraftName: string;
  layerDraftDirty: boolean;
  layerDraftEditingId: number | null;
  hasClips: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isRenderingLayerPreview: boolean;
  isSavingLayer: boolean;
  layersSplitLibraryOpen: boolean;
  layerDraftPreview: LayerPreviewState | null;
  pxPerSec: number;
  laneHeight: number;
  snapEnabled: boolean;
  snapGridSec: number;
  followMode: TimelineFollowMode;
  onOpenSavedView: () => void;
  onToggleSplitLibrary: () => void;
  onRenderAndPlay: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSnap: () => void;
  onChangeSnapGridSec: (sec: number) => void;
  onCycleFollowMode: () => void;
  onFitAll: () => void;
  onChangePxPerSec: (px: number) => void;
  onChangeLaneHeight: (h: number) => void;
  onPrepareNleDrag: () => Promise<{
    wavPath: string;
    savedRecord: { layer_name: string } | null;
  } | null>;
  onOpenSaveModal: () => void;
  onResetDraft: () => void;
}

/**
 * Single uniform `h-[32px]` responsive DaVinci-inspired timeline toolbar.
 * Automatically adapts button labels to compact / icon-only tiers via `ResizeObserver`
 * so zero controls ever clip off-screen when Audify is resized narrow.
 */
export const LayersStudioHeaderBar: React.FC<LayersStudioHeaderBarProps> = ({
  savedCount,
  layerDraftName,
  layerDraftDirty,
  layerDraftEditingId,
  hasClips,
  canUndo,
  canRedo,
  isRenderingLayerPreview,
  isSavingLayer,
  layersSplitLibraryOpen,
  layerDraftPreview,
  pxPerSec,
  laneHeight,
  snapEnabled,
  snapGridSec,
  followMode,
  onOpenSavedView,
  onToggleSplitLibrary,
  onRenderAndPlay,
  onUndo,
  onRedo,
  onToggleSnap,
  onChangeSnapGridSec,
  onCycleFollowMode,
  onFitAll,
  onChangePxPerSec,
  onChangeLaneHeight,
  onPrepareNleDrag,
  onOpenSaveModal,
  onResetDraft,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState(1120);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setBarWidth(w);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showDraftLabel = barWidth >= 1140;
  const showHeightSlider = barWidth >= 980;
  const iconOnly = barWidth < 860;
  const ultraCompact = barWidth < 710;

  const followTitle =
    followMode === "page"
      ? "Playhead Follow: Page Scroll (DaVinci default — click for Smooth / Off)"
      : followMode === "smooth"
      ? "Playhead Follow: Smooth Center Scroll (click to disable)"
      : "Playhead Follow: OFF (click to enable Page Scroll)";

  return (
    <div
      ref={barRef}
      className="h-[32px] px-2 bg-surface-1 border-b border-line flex items-center justify-between gap-1.5 shrink-0 overflow-hidden"
    >
      {/* Left: Transport, Undo/Redo, Snap + Fixed-width Grid, Follow, Fit, Zoom + Height */}
      <div className="flex items-center gap-1 shrink-0 min-w-0">
        <button
          type="button"
          onClick={onRenderAndPlay}
          disabled={!hasClips || isRenderingLayerPreview}
          className={`h-[22px] ${
            iconOnly ? "w-[22px] justify-center" : "px-2 gap-1"
          } rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg disabled:opacity-40 text-[11px] font-medium inline-flex items-center transition-colors cursor-pointer shrink-0`}
          title="Render & audition current layer mix (Space)"
        >
          <Play className="w-3 h-3 shrink-0" />
          {!iconOnly && <span>Mix</span>}
        </button>

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="w-[22px] h-[22px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="w-[22px] h-[22px] rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-3 h-3" />
        </button>

        <div className="w-[1px] h-[16px] bg-line mx-0.5 shrink-0" />

        <button
          type="button"
          onClick={onToggleSnap}
          className={`w-[22px] h-[22px] rounded-[3px] border inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            snapEnabled
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-3 hover:text-fg"
          }`}
          title="Toggle timeline grid snap (hold Ctrl while dragging to bypass)"
        >
          <Magnet className="w-3 h-3" />
        </button>

        <div className="w-[70px] shrink-0">
          <ThemedSelect
            value={String(snapGridSec)}
            options={SNAP_GRID_OPTIONS}
            onChange={(v) => onChangeSnapGridSec(Number(v))}
            searchable={false}
            ariaLabel="Snap grid interval"
            title="Snap grid interval"
            minMenuWidth={86}
            triggerClassName="!h-[22px] !w-[70px] !px-1.5 !rounded-[3px] !text-[10px] font-mono tabular-nums !bg-surface-2 !border-line"
          />
        </div>

        <button
          type="button"
          onClick={onCycleFollowMode}
          className={`w-[22px] h-[22px] rounded-[3px] border inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            followMode !== "off"
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-3 hover:text-fg"
          }`}
          title={followTitle}
        >
          {followMode === "smooth" ? (
            <LocateFixed className="w-3 h-3" />
          ) : (
            <ArrowRightToLine className="w-3 h-3" />
          )}
        </button>

        <div className="w-[1px] h-[16px] bg-line mx-0.5 shrink-0" />

        <button
          type="button"
          onClick={onFitAll}
          className={`h-[22px] ${
            iconOnly ? "w-[22px] justify-center" : "px-2 gap-1"
          } rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[10.5px] font-mono inline-flex items-center transition-colors cursor-pointer shrink-0`}
          title="Full Extent Zoom — fit entire mix on screen (Shift+Z)"
        >
          <Maximize2 className="w-3 h-3 shrink-0" />
          {!iconOnly && <span>Fit</span>}
        </button>

        {/* DaVinci Logarithmic Zoom Slider (Playhead-centered) */}
        <div
          className="flex items-center gap-1 px-0.5 shrink-0"
          title={`Horizontal Zoom: ${pxPerSec}px/s (Alt+Scroll centered on playhead)`}
        >
          {!ultraCompact && <span className="font-mono text-[10px] text-fg-3">-</span>}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pxPerSecToSliderValue(pxPerSec)}
            onChange={(e) =>
              onChangePxPerSec(sliderValueToPxPerSec(Number(e.target.value)))
            }
            className={ultraCompact ? "w-[48px]" : "w-[68px]"}
          />
          {!ultraCompact && <span className="font-mono text-[10px] text-fg-3">+</span>}
        </div>

        {showHeightSlider && (
          <div
            className="flex items-center gap-1 px-0.5 shrink-0"
            title={`Lane Height: ${laneHeight}px (Shift+Scroll; <=36px hides waveforms)`}
          >
            <span className="font-mono text-[10px] text-fg-3">H</span>
            <input
              type="range"
              min={MIN_LANE_HEIGHT}
              max={MAX_LANE_HEIGHT}
              step={2}
              value={laneHeight}
              onChange={(e) => onChangeLaneHeight(Number(e.target.value))}
              className="w-[50px]"
            />
          </div>
        )}
      </div>

      {/* Right: Draft label, Peak badge, Library toggle, Saved, Drag Mix, Save/Update, New */}
      <div className="flex items-center gap-1 shrink-0">
        {showDraftLabel && (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-2 max-w-[130px] truncate px-1"
            title={layerDraftName}
          >
            <span className="truncate">{layerDraftName}</span>
            {layerDraftDirty && (
              <span className="w-1.5 h-1.5 rounded-[2px] bg-accent shrink-0" />
            )}
          </span>
        )}

        {layerDraftPreview && !ultraCompact && (
          <span
            className={`h-[20px] px-1.5 rounded-[2px] border font-mono tabular-nums text-[9.5px] inline-flex items-center shrink-0 ${
              layerDraftPreview.clipped
                ? "bg-warn/15 border-warn/50 text-warn font-semibold"
                : "bg-surface-2 border-line text-fg-2"
            }`}
            title="Peak output level (soft limiter protects against digital clipping)"
          >
            {layerDraftPreview.clipped
              ? `CLIP ${layerDraftPreview.peakDb.toFixed(1)}dB`
              : `${layerDraftPreview.peakDb.toFixed(1)} dB`}
          </span>
        )}

        <button
          type="button"
          onClick={onToggleSplitLibrary}
          className={`h-[22px] ${
            iconOnly ? "w-[22px] justify-center" : "px-2 gap-1"
          } rounded-[3px] border text-[11px] font-medium inline-flex items-center transition-colors cursor-pointer shrink-0 ${
            layersSplitLibraryOpen
              ? "bg-accent-soft border-accent text-accent-fg"
              : "bg-surface-3 border-line text-fg-2 hover:text-fg hover:border-line-strong"
          }`}
          title={
            layersSplitLibraryOpen
              ? "Library panel visible (click to hide for full-height timeline)"
              : "Show Sample Library above timeline"
          }
        >
          <PanelTop className="w-3 h-3 shrink-0" />
          {!iconOnly && <span>Library</span>}
        </button>

        <button
          type="button"
          onClick={onOpenSavedView}
          className={`h-[22px] ${
            iconOnly ? "px-1.5 gap-1" : "px-2 gap-1"
          } rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] inline-flex items-center transition-colors cursor-pointer shrink-0`}
          title={`Switch to Saved Layers (${savedCount})`}
        >
          <Layers className="w-3 h-3 shrink-0" />
          {!iconOnly && <span>Saved</span>}
          <span className="font-mono tabular-nums text-[9.5px] text-fg-3">
            {savedCount}
          </span>
        </button>

        <div
          onMouseDown={(e) => {
            if (e.button !== 0 || !hasClips) return;
            e.preventDefault();
            beginDragOnMove(e.clientX, e.clientY, () => {
              void onPrepareNleDrag().then((res) => {
                if (res) {
                  const label =
                    res.savedRecord?.layer_name ??
                    `${layerDraftName || "Layer_Mix"}.wav`;
                  void startNativeSampleDrag([res.wavPath], label);
                }
              });
            });
          }}
          className={`h-[22px] ${
            iconOnly ? "w-[22px] justify-center" : "px-2 gap-1"
          } rounded-[3px] border text-[11px] inline-flex items-center transition-colors shrink-0 ${
            hasClips
              ? "bg-surface-3 hover:bg-accent-soft border-line hover:border-accent text-fg-2 hover:text-accent-fg cursor-grab active:cursor-grabbing"
              : "bg-surface-2 border-line text-fg-3 opacity-45 cursor-not-allowed"
          }`}
          title="Drag rendered WAV mix directly into Premiere Pro / DaVinci Resolve"
        >
          <GripVertical className="w-3 h-3 shrink-0" />
          {!iconOnly && <span>Drag Mix</span>}
        </div>

        <button
          type="button"
          disabled={!hasClips || isSavingLayer}
          onClick={onOpenSaveModal}
          className={`h-[22px] ${
            ultraCompact ? "px-2 gap-1" : "px-2.5 gap-1"
          } rounded-[3px] bg-accent hover:bg-accent-hover text-accent-on disabled:opacity-45 text-[11px] font-semibold inline-flex items-center transition-colors cursor-pointer shrink-0`}
          title="Save WAV & editable recipe (with custom name, Auto, and duplicate guard)"
        >
          <Save className="w-3 h-3 shrink-0" />
          <span>{layerDraftEditingId !== null ? "Update" : "Save"}</span>
        </button>

        <button
          type="button"
          onClick={onResetDraft}
          className={`h-[22px] ${
            iconOnly ? "w-[22px] justify-center" : "px-2 gap-1"
          } rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg text-[11px] inline-flex items-center transition-colors cursor-pointer shrink-0`}
          title="Start a fresh empty layer draft"
        >
          <Plus className="w-3 h-3 shrink-0" />
          {!iconOnly && <span>New</span>}
        </button>
      </div>
    </div>
  );
};
