import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Keyboard, Sparkles, X } from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { useDialogFocusTrap } from "../../utils/modalFocus";
import { formatShortcutDisplay } from "../../utils/shortcuts";

interface ShortcutsCheatsheetModalProps {
  onClose: () => void;
}

export const ShortcutsCheatsheetModal: React.FC<ShortcutsCheatsheetModalProps> = ({
  onClose,
}) => {
  const shortcuts = useSampleStore((s) => s.shortcuts);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(true, dialogRef);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F1" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const fmt = (key: keyof typeof DEFAULT_SHORTCUTS) =>
    formatShortcutDisplay(shortcuts[key] ?? DEFAULT_SHORTCUTS[key]) || "Unbound";

  const sections: { title: string; rows: [string, string][] }[] = [
    {
      title: "Playback & Navigation",
      rows: [
        ["Play / Pause", fmt("playPause")],
        ["Stop", fmt("stopPlayback")],
        ["Previous / Next Track", `${fmt("prevTrack")} / ${fmt("nextTrack")}`],
        ["Toggle Loop", fmt("toggleLoop")],
        ["Toggle Shuffle", fmt("toggleShuffle")],
        ["Toggle Auto-Preview", fmt("toggleAutoPreview")],
        ["Toggle Mute", fmt("toggleMute")],
        ["Focus Search", "Ctrl + F"],
      ],
    },
    {
      title: "Workflow, Slices & File Ops",
      rows: [
        ["Mini Dock Mode", fmt("toggleMiniDock")],
        ["Toggle Favorite", fmt("toggleFavorite")],
        ["Add to Session Bin", fmt("addToBin")],
        ["Mark Slice In / Out", `${fmt("markSliceIn")} / ${fmt("markSliceOut")}`],
        ["Save Active Slice", fmt("saveSlice")],
        ["Clear Slice", `${fmt("clearSlice")} / Esc`],
        ["Find Similar Audio (AI)", fmt("findSimilar")],
        ["Rename / Batch Rename", "F2"],
        ["Undo / Redo File Op", "Ctrl + Z / Ctrl + Y"],
        ["Quick Tag 1–9", "1 – 9"],
        ["Copy Path / Reveal", `${fmt("copyFilePath")} / ${fmt("showInFolder")}`],
        ["Settings", "Ctrl + ,"],
      ],
    },
  ];

  const tips: [string, string][] = [
    ["Left-Drag Waveform", "Precision live scrubbing across the waveform at any point"],
    ["Right-Drag / Shift-Drag Waveform", "Draw a precision WAV slice region directly on the deck"],
    ["Drag Slice Body → NLE", "Exports & drops the sliced WAV directly into Premiere / Resolve"],
    ["Drop Audio File on Waveform", "Instant AI acoustic similarity search against your entire library"],
    ["Ctrl + Click Key Cell", "Harmonic Camelot neighbor filter (~1A..12B compatible keys)"],
    ["Titlebar Compact Sidebar Toggle", "Switch to 40px icon rail (optional hover-peek in Settings → Appearance)"],
    ["Smart Search Operators", 'Try `bpm:120-130`, `key:~8A`, `sr:48k`, `ch:2`, `<2s`, `"exact"`'],
  ];

  const modal = (
    <div
      data-modal-portal="true"
      style={{ zIndex: Z_INDEX.modalConfirm }}
      onClick={onClose}
      className="fixed inset-0 audify-modal-backdrop flex items-center justify-center p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts and Studio Tips"
        tabIndex={-1}
        data-mica-overlay="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[660px] max-w-[94vw] max-h-[86vh] bg-surface-1 border border-line-strong rounded-md shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="h-[38px] px-3.5 bg-surface-2 border-b border-line flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <Keyboard className="w-4 h-4 text-accent-fg shrink-0" />
            <span className="font-mono text-[11px] uppercase tracking-wider font-semibold text-fg">
              KEYBOARD SHORTCUTS &amp; STUDIO WORKFLOWS
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts guide"
            className="w-[24px] h-[24px] rounded-xs flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3.5 overflow-y-auto space-y-3.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sections.map((sec) => (
              <div
                key={sec.title}
                className="bg-surface-2 border border-line rounded-sm overflow-hidden"
              >
                <div className="px-2.5 py-1.5 border-b border-line font-mono text-[10px] uppercase tracking-wider text-accent-fg font-semibold">
                  {sec.title}
                </div>
                <div className="divide-y divide-line-subtle">
                  {sec.rows.map(([label, keys]) => (
                    <div
                      key={label}
                      className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-fg-2 truncate">{label}</span>
                      <kbd className="px-1.5 py-0.5 rounded-xs bg-surface-3 border border-line-strong font-mono text-[10px] text-fg shrink-0">
                        {keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-surface-2 border border-line rounded-sm overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-line flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-accent-fg font-semibold">
              <Sparkles className="w-3 h-3 shrink-0" />
              <span>PRO WORKFLOW TIPS</span>
            </div>
            <div className="divide-y divide-line-subtle">
              {tips.map(([trigger, desc]) => (
                <div
                  key={trigger}
                  className="px-2.5 py-1.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px]"
                >
                  <span className="font-mono text-[10.5px] font-semibold text-accent-fg shrink-0">
                    {trigger}
                  </span>
                  <span className="text-fg-2 text-[11px]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="h-[30px] px-3.5 bg-surface-2 border-t border-line flex items-center justify-between font-mono text-[10px] text-fg-3 shrink-0">
          <span>Press ? or F1 anytime to toggle this guide</span>
          <span>Customize bindings in Settings → Shortcuts</span>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
};
