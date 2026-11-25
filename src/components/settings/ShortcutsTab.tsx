import React from "react";
import { DEFAULT_SHORTCUTS } from "../../constants/shortcuts";
import { useSampleStore } from "../../store/useSampleStore";
import { KeyboardShortcuts } from "../../types";
import { formatShortcutDisplay } from "../../utils/shortcuts";

interface ShortcutsTabProps {
  recordingAction: keyof KeyboardShortcuts | null;
  setRecordingAction: (action: keyof KeyboardShortcuts | null) => void;
}

const SHORTCUT_GROUPS: {
  title: string;
  items: {
    key: keyof KeyboardShortcuts;
    label: string;
    desc: string;
  }[];
}[] = [
  {
    title: "PLAYBACK",
    items: [
      {
        key: "playPause",
        label: "Play / Pause preview",
        desc: "Start or pause playback",
      },
      {
        key: "stopPlayback",
        label: "Stop playback",
        desc: "Stop audio and return playhead to 00:00",
      },
      {
        key: "prevTrack",
        label: "Previous sample",
        desc: "Jump to previous (or shuffle back)",
      },
      {
        key: "nextTrack",
        label: "Next sample",
        desc: "Jump to next (or random when Shuffle is ON)",
      },
      {
        key: "toggleShuffle",
        label: "Toggle shuffle mode",
        desc: "Turn persistent Shuffle mode On / Off",
      },
      {
        key: "toggleLoop",
        label: "Toggle loop mode",
        desc: "Enable or disable loop playback",
      },
      {
        key: "toggleAutoPreview",
        label: "Toggle auto-play",
        desc: "Enable or disable 0ms auto-preview on select",
      },
      {
        key: "toggleMute",
        label: "Mute / unmute audio",
        desc: "Instantly mute or restore output volume",
      },
    ],
  },
  {
    title: "LIBRARY",
    items: [
      {
        key: "toggleFavorite",
        label: "Toggle favorite",
        desc: "Star or unstar selected sample(s)",
      },
      {
        key: "openTagPicker",
        label: "Assign / manage tags",
        desc: "Open rapid tag picker for selected sample(s)",
      },
      {
        key: "openGenrePicker",
        label: "Assign / manage genres",
        desc: "Open rapid genre & mood picker for selected sample(s)",
      },
      {
        key: "addToBin",
        label: "Add to Session Bin",
        desc: "Send selected sample(s) to temporary Bin",
      },
      {
        key: "copyFilePath",
        label: "Copy file path(s)",
        desc: "Copy selected track file path(s) to clipboard",
      },
      {
        key: "showInFolder",
        label: "Show in Explorer",
        desc: "Reveal the selected sample in Windows Explorer",
      },
      {
        key: "findSimilar",
        label: "Find similar sounds (AI)",
        desc: "Search acoustically similar tracks from selected sample",
      },
      {
        key: "markSliceIn",
        label: "Mark slice In",
        desc: "Set waveform slice start at current playhead (I)",
      },
      {
        key: "markSliceOut",
        label: "Mark slice Out",
        desc: "Set waveform slice end at current playhead (O)",
      },
      {
        key: "saveSlice",
        label: "Save active slice",
        desc: "Save waveform slice to export folder & Slices tab",
      },
      {
        key: "clearSlice",
        label: "Clear waveform slice",
        desc: "Clear active In/Out slice selection",
      },
      {
        key: "removeFromCollection",
        label: "Remove from collection",
        desc: "Remove selected sample(s) from active collection",
      },
    ],
  },
  {
    title: "WINDOW",
    items: [
      {
        key: "toggleMiniDock",
        label: "Mini Dock overlay mode",
        desc: "Toggle compact Always-on-Top NLE companion dock",
      },
    ],
  },
];

export const ShortcutsTab: React.FC<ShortcutsTabProps> = ({
  recordingAction,
  setRecordingAction,
}) => {
  const shortcuts = useSampleStore((s) => s.shortcuts);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);

  return (
    <div className="space-y-3">
      {SHORTCUT_GROUPS.map((group) => (
        <div
          key={group.title}
          className="bg-surface-1 border border-line rounded-md overflow-hidden"
        >
          <div className="h-[32px] px-3 bg-surface-header border-b border-line flex items-center justify-between">
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg-2">
              {group.title}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-line-subtle">
            {group.items.map((item, idx) => {
              const isRecording = recordingAction === item.key;
              const rawKey =
                shortcuts[item.key] ?? DEFAULT_SHORTCUTS[item.key] ?? "";
              const displayKey = formatShortcutDisplay(rawKey);
              return (
                <div
                  key={item.key}
                  className={`h-[40px] px-3 flex items-center justify-between gap-2 border-b border-line-subtle ${
                    idx % 2 === 0 ? "sm:border-r sm:border-line-subtle" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-medium text-fg truncate">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-fg-3 truncate">
                      {item.desc}
                    </div>
                  </div>

                  <button
                    type="button"
                    data-shortcut-recorder="true"
                    onClick={() =>
                      setRecordingAction(isRecording ? null : item.key)
                    }
                    title="Click to record a new keybinding (Backspace to clear, Esc to cancel)"
                    className={`h-[23px] min-w-[76px] px-2 font-mono text-[10px] font-bold border border-b-2 rounded-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      isRecording
                        ? "bg-accent-soft border-accent text-accent-fg"
                        : displayKey
                        ? "bg-surface-2 hover:bg-surface-3 border-line text-fg hover:border-accent/60"
                        : "bg-surface-2 hover:bg-surface-3 border-line text-fg-3 hover:text-fg hover:border-accent/60"
                    }`}
                  >
                    {isRecording ? "PRESS KEY..." : displayKey || "UNBOUND"}
                  </button>
                </div>
              );
            })}

            {group.title === "WINDOW" && (
              <div className="h-[40px] px-3 flex items-center justify-between gap-2 border-b border-line-subtle">
                <div className="min-w-0">
                  <div className="text-[11.5px] font-medium text-fg truncate">
                    Open Settings window
                  </div>
                  <div className="text-[10px] text-fg-3 truncate">
                    Built-in shortcut to open or focus Settings
                  </div>
                </div>
                <span className="h-[23px] min-w-[76px] px-2 inline-flex items-center justify-center bg-surface-2 border border-b-2 border-line rounded-xs font-mono text-[10px] font-bold text-fg-2 whitespace-nowrap shrink-0">
                  CTRL + ,
                </span>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Built-in Navigation, Editing & Mouse Reference */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden">
        <div className="h-[32px] px-3 bg-surface-header border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg-2">
            NAVIGATION, EDITING &amp; MOUSE (BUILT-IN)
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-line-subtle font-mono text-[10.5px]">
          {[
            { label: "Focus sample search", key: "CTRL + F" },
            { label: "Rename selected / batch", key: "F2 / SHIFT+F2" },
            { label: "Create slice on waveform", key: "DRAG WAVEFORM" },
            { label: "Export slice to NLE", key: "DRAG WAVEFORM SLICE" },
            { label: "Toggle multi-select row", key: "CTRL + CLICK" },
            { label: "Select contiguous range", key: "SHIFT + CLICK" },
            { label: "Select all filtered", key: "CTRL + A" },
            { label: "Clear slice / selection", key: "ESC" },
            { label: "Exclude tag / mood filter", key: "ALT + CLICK" },
            ...(enableLicensesSystem
              ? [{ label: "Copy credits", key: "CTRL + SHIFT + C" }]
              : []),
          ].map((row, idx) => (
            <div
              key={row.label}
              className={`h-[34px] px-3 flex items-center justify-between border-b border-line-subtle ${
                idx % 2 === 0 ? "sm:border-r sm:border-line-subtle" : ""
              }`}
            >
              <span className="font-sans text-[11px] text-fg-2 truncate">
                {row.label}
              </span>
              <span className="h-[20px] px-2 inline-flex items-center bg-surface-2 border border-b-2 border-line rounded-xs text-[9.5px] font-semibold text-fg-2 shrink-0 ml-2">
                {row.key}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
