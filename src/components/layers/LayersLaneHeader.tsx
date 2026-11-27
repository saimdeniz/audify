import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { LayerLaneSpec } from "../../types";

interface LayersLaneHeaderProps {
  lanes: LayerLaneSpec[];
  widthPx: number;
  laneHeight: number;
  ghostNewLaneVisible: boolean;
  onStartResize: (e: React.MouseEvent) => void;
  onToggleMute: (laneId: string) => void;
  onToggleSolo: (laneId: string) => void;
  onChangeVolume: (laneId: string, db: number) => void;
  onRenameLane: (laneId: string, name: string) => void;
  onRemoveLane: (laneId: string) => void;
}

/**
 * Resizable DaVinci-style vertical lane mixer strip (`120px–320px`), synchronized
 * pixel-for-pixel with `LayersTimelineCanvas`'s dynamic `laneHeight` (`28px–130px`).
 * Hides secondary volume fader when `laneHeight < 44px` so 15+ lanes stay crisp.
 */
export const LayersLaneHeader: React.FC<LayersLaneHeaderProps> = ({
  lanes,
  widthPx,
  laneHeight,
  ghostNewLaneVisible,
  onStartResize,
  onToggleMute,
  onToggleSolo,
  onChangeVolume,
  onRenameLane,
  onRemoveLane,
}) => {
  const [editingLaneId, setEditingLaneId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const isCompact = laneHeight < 44;

  const commitName = (laneId: string) => {
    const clean = nameDraft.trim();
    setEditingLaneId(null);
    if (clean) onRenameLane(laneId, clean);
  };

  return (
    <div
      style={{ width: widthPx }}
      className="shrink-0 bg-surface-1 border-r border-line flex flex-col select-none relative"
    >
      <div className="flex-1">
        {lanes.map((lane, idx) => (
          <div
            key={lane.id}
            style={{ height: laneHeight }}
            className="relative pl-2.5 pr-1.5 border-b border-line flex flex-col justify-center gap-1 bg-surface-1 hover:bg-surface-hover transition-colors overflow-hidden"
          >
            {/* Left 3px lane color bar (DaVinci style) */}
            <span
              className="absolute left-0 top-0 bottom-0 w-[3px]"
              style={{ backgroundColor: lane.colorHex }}
            />

            {/* Row 1: Lane index + Name + S / M / Delete */}
            <div className="flex items-center gap-1 min-w-0">
              {editingLaneId === lane.id ? (
                <input
                  autoFocus
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => commitName(lane.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName(lane.id);
                    if (e.key === "Escape") setEditingLaneId(null);
                  }}
                  className="flex-1 min-w-0 h-[18px] px-1 bg-surface-0 border border-accent rounded-[2px] text-[11px] text-fg focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => {
                    setEditingLaneId(lane.id);
                    setNameDraft(lane.name);
                  }}
                  className="flex-1 min-w-0 text-left text-[11px] font-medium text-fg truncate cursor-text"
                  title={`${lane.name} (Double-click to rename)`}
                >
                  <span className="font-mono text-[9.5px] font-semibold text-fg-3 mr-1">
                    L{idx + 1}
                  </span>
                  {lane.name}
                </button>
              )}

              <button
                type="button"
                onClick={() => onToggleSolo(lane.id)}
                className={`w-[18px] h-[18px] rounded-[2px] border font-mono text-[9.5px] font-bold flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  lane.solo
                    ? "bg-accent border-accent text-accent-on"
                    : "bg-surface-3 border-line text-fg-3 hover:text-fg"
                }`}
                title="Solo lane"
              >
                S
              </button>
              <button
                type="button"
                onClick={() => onToggleMute(lane.id)}
                className={`w-[18px] h-[18px] rounded-[2px] border font-mono text-[9.5px] font-bold flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  lane.muted
                    ? "bg-accent-soft border-accent text-accent-fg"
                    : "bg-surface-3 border-line text-fg-3 hover:text-fg"
                }`}
                title="Mute lane"
              >
                M
              </button>
              {lanes.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveLane(lane.id)}
                  className="w-[18px] h-[18px] rounded-[2px] text-fg-3 hover:text-fg hover:bg-surface-3 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                  title="Remove lane"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              )}
            </div>

            {/* Row 2: Studio rectangular fader + dB readout (shown when height >= 44px) */}
            {!isCompact && (
              <div className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={-36}
                  max={12}
                  step={0.5}
                  value={lane.volumeDb}
                  onChange={(e) => onChangeVolume(lane.id, Number(e.target.value))}
                  onDoubleClick={() => onChangeVolume(lane.id, 0)}
                  className="flex-1 min-w-0"
                  title="Lane volume (double-click to reset to 0 dB)"
                />
                <span className="w-[40px] text-right font-mono tabular-nums text-[9.5px] text-fg-2 shrink-0">
                  {lane.volumeDb <= -35.5
                    ? "-∞"
                    : `${lane.volumeDb > 0 ? "+" : ""}${lane.volumeDb.toFixed(1)}dB`}
                </span>
              </div>
            )}
          </div>
        ))}

        {/* Ghost Lane Header preview shown when dragging sample below the last lane */}
        {ghostNewLaneVisible && (
          <div
            style={{ height: laneHeight }}
            className="px-2.5 border-b border-dashed border-accent bg-accent-soft flex items-center gap-1.5 text-[10.5px] text-accent-fg font-medium"
          >
            <Plus className="w-3 h-3 shrink-0" />
            <span className="truncate">New Lane (Drop)</span>
          </div>
        )}
      </div>

      {/* Right-edge column width resizer */}
      <div
        onMouseDown={onStartResize}
        title="Drag to resize Lanes panel width"
        className="absolute top-0 bottom-0 right-[-3px] w-[6px] cursor-col-resize hover:bg-accent/60 z-20 transition-colors"
      />
    </div>
  );
};
