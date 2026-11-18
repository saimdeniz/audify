import React, { useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import {
  BatchRenameCaseMode,
  BatchRenameConfig,
  BatchRenameMode,
} from "../../utils/batchRename";

const PATTERN_TOKENS = [
  { token: "{name}", title: "Original filename (without extension)" },
  { token: "{n}", title: "Sequential counter using Start / Step / Pad" },
  { token: "{n:03}", title: "3-digit zero-padded counter" },
  { token: "{folder}", title: "Immediate parent folder name" },
  { token: "{genre}", title: "Sample genre (if set)" },
  { token: "{bpm}", title: "Rounded BPM (if detected)" },
  { token: "{key}", title: "Musical key (if detected)" },
] as const;

const CASE_OPTIONS: Array<{ id: BatchRenameCaseMode; label: string }> = [
  { id: "keep", label: "Keep" },
  { id: "lower", label: "lower" },
  { id: "upper", label: "UPPER" },
  { id: "title", label: "Title" },
  { id: "snake", label: "snake_case" },
];

type RenameModeTabDef = {
  id: BatchRenameMode;
  label: string;
  compactLabel: string;
};

const BATCH_MODE_TABS: readonly RenameModeTabDef[] = [
  { id: "add", label: "Add First / Last", compactLabel: "Pre / Suf" },
  { id: "replace", label: "Find & Replace", compactLabel: "Replace" },
  { id: "pattern", label: "Pattern & Counter", compactLabel: "Pattern" },
];

const SINGLE_MODE_TABS: readonly RenameModeTabDef[] = [
  { id: "direct", label: "New Name", compactLabel: "Name" },
  ...BATCH_MODE_TABS,
];

interface BatchRenameControlsProps {
  config: BatchRenameConfig;
  setConfig: React.Dispatch<React.SetStateAction<BatchRenameConfig>>;
  isSingle: boolean;
  isCompact?: boolean;
  singleExt: string;
  onReset: () => void;
}

/**
 * Mode switcher, fixed-height transformation fields, case controls, and
 * collision safeguard options for both single-file and batch rename.
 */
export const BatchRenameControls: React.FC<BatchRenameControlsProps> = ({
  config,
  setConfig,
  isSingle,
  isCompact = false,
  singleExt,
  onReset,
}) => {
  const directInputRef = useRef<HTMLInputElement>(null);
  const modeTabs = isSingle ? SINGLE_MODE_TABS : BATCH_MODE_TABS;

  useEffect(() => {
    if (config.mode !== "direct") return;
    const id = requestAnimationFrame(() => {
      directInputRef.current?.focus();
      directInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [config.mode, isSingle]);

  return (
    <div
      className={
        isCompact
          ? "p-2.5 border-b border-line space-y-2 bg-surface-0 shrink-0"
          : "p-2.5 sm:p-3.5 border-b border-line space-y-2 sm:space-y-2.5 bg-surface-0 shrink-0"
      }
    >
      <div className="flex items-center justify-between gap-1.5 flex-nowrap">
        <div className="flex items-center bg-surface-2 p-0.5 rounded-xs border border-line min-w-0 shrink overflow-x-auto">
          {modeTabs.map((tab) => {
            const active = config.mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-label={tab.label}
                title={tab.label}
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    mode: tab.id,
                  }))
                }
                className={`h-[24px] px-2 sm:px-2.5 font-mono text-[10px] sm:text-[10.5px] rounded-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? "bg-accent-soft text-accent-fg border border-accent font-semibold"
                    : "text-fg-2 hover:text-fg border border-transparent"
                }`}
              >
                {isCompact ? (
                  <span>{tab.compactLabel}</span>
                ) : (
                  <>
                    <span className="sm:hidden">{tab.compactLabel}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onReset}
          aria-label="Reset"
          className="h-[24px] px-2 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[10px] font-mono text-fg-2 hover:text-fg inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          title="Reset rename options"
        >
          <RotateCcw className="w-3 h-3 shrink-0" />
          {!isCompact && <span className="hidden sm:inline">Reset</span>}
        </button>
      </div>

      {/* Fixed-height mode body prevents header & layout jump across tabs in both Full & Mini Dock */}
      <div className="h-[78px] flex flex-col justify-between">
        {config.mode === "direct" && (
          <>
            <div className="space-y-1">
              <label
                htmlFor="batch-rename-direct"
                className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
              >
                New Filename
              </label>
              <div className="flex items-center">
                <input
                  ref={directInputRef}
                  id="batch-rename-direct"
                  type="text"
                  autoFocus
                  value={config.directStem}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      directStem: e.target.value,
                    }))
                  }
                  placeholder="Enter filename..."
                  className={`flex-1 min-w-0 h-[28px] px-2 bg-surface-2 border border-line focus:border-accent font-mono text-[11px] text-fg outline-none ${
                    singleExt ? "rounded-l-xs" : "rounded-xs"
                  }`}
                />
                {singleExt && (
                  <span className="h-[28px] px-2.5 inline-flex items-center bg-surface-1 border border-l-0 border-line rounded-r-xs font-mono text-[11px] text-fg-3 shrink-0">
                    {singleExt}
                  </span>
                )}
              </div>
            </div>
            <div className="h-[20px] flex items-center text-[10px] sm:text-[10.5px] font-mono text-fg-3 truncate">
              Press Enter to apply · Extension is always preserved
            </div>
          </>
        )}

        {config.mode === "add" && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              <div className="space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-prefix"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Add to First (Prefix)
                </label>
                <input
                  id="batch-rename-prefix"
                  type="text"
                  autoFocus={!isSingle}
                  value={config.prefix}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, prefix: e.target.value }))
                  }
                  placeholder="e.g. SFX_"
                  className="w-full h-[28px] px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none"
                />
              </div>

              <div className="space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-suffix"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Add to Last (Suffix)
                </label>
                <input
                  id="batch-rename-suffix"
                  type="text"
                  value={config.suffix}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, suffix: e.target.value }))
                  }
                  placeholder="e.g. _v1"
                  className="w-full h-[28px] px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none"
                />
              </div>
            </div>
            <div className="h-[20px] flex items-center text-[10px] sm:text-[10.5px] font-mono text-fg-3 truncate">
              Prefix adds before filename · Suffix adds before extension
            </div>
          </>
        )}

        {config.mode === "replace" && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              <div className="space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-find"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Find Text
                </label>
                <input
                  id="batch-rename-find"
                  type="text"
                  autoFocus
                  value={config.find}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, find: e.target.value }))
                  }
                  placeholder="Text to replace..."
                  className="w-full h-[28px] px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none"
                />
              </div>
              <div className="space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-replace"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Replace With
                </label>
                <input
                  id="batch-rename-replace"
                  type="text"
                  value={config.replaceWith}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      replaceWith: e.target.value,
                    }))
                  }
                  placeholder="Empty to remove..."
                  className="w-full h-[28px] px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none"
                />
              </div>
            </div>
            <div className="h-[20px] flex items-center gap-4 text-[10.5px] sm:text-[11px] text-fg-2">
              <label className="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={config.caseSensitive}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      caseSensitive: e.target.checked,
                    }))
                  }
                  className="rounded-xs border-line bg-surface-2"
                />
                <span>Case sensitive</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={config.replaceAll}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      replaceAll: e.target.checked,
                    }))
                  }
                  className="rounded-xs border-line bg-surface-2"
                />
                <span>Replace all matches</span>
              </label>
            </div>
          </>
        )}

        {config.mode === "pattern" && (
          <>
            <div className="grid grid-cols-12 gap-1.5 sm:gap-2">
              <div className="col-span-6 space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-pattern"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Naming Pattern
                </label>
                <input
                  id="batch-rename-pattern"
                  type="text"
                  autoFocus
                  value={config.pattern}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      pattern: e.target.value,
                    }))
                  }
                  placeholder="{name}_{n}"
                  className="w-full h-[28px] px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none"
                />
              </div>
              <div className="col-span-2 space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-start"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Start
                </label>
                <input
                  id="batch-rename-start"
                  type="number"
                  value={config.startNumber}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      startNumber: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  className="w-full h-[28px] px-1.5 sm:px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none tabular-nums"
                />
              </div>
              <div className="col-span-2 space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-step"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Step
                </label>
                <input
                  id="batch-rename-step"
                  type="number"
                  min={1}
                  value={config.step}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      step: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                    }))
                  }
                  className="w-full h-[28px] px-1.5 sm:px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none tabular-nums"
                />
              </div>
              <div className="col-span-2 space-y-1 min-w-0">
                <label
                  htmlFor="batch-rename-pad"
                  title="Zero-pad width"
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-3 block whitespace-nowrap truncate"
                >
                  Pad
                </label>
                <input
                  id="batch-rename-pad"
                  type="number"
                  min={1}
                  max={6}
                  value={config.zeroPad}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      zeroPad: Math.max(
                        1,
                        Math.min(6, Number.parseInt(e.target.value, 10) || 2)
                      ),
                    }))
                  }
                  className="w-full h-[28px] px-1.5 sm:px-2 bg-surface-2 border border-line focus:border-accent rounded-xs font-mono text-[11px] text-fg outline-none tabular-nums"
                />
              </div>
            </div>

            <div className="h-[20px] flex items-center gap-1 flex-nowrap overflow-x-auto">
              <span className="font-mono text-[9.5px] text-fg-3 mr-0.5 shrink-0">
                Tokens:
              </span>
              {PATTERN_TOKENS.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  title={item.title}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      pattern: `${prev.pattern}${item.token}`,
                    }))
                  }
                  className="h-[20px] px-1.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent font-mono text-[10px] text-accent-fg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  {item.token}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="pt-1.5 border-t border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-mono text-[10px] text-fg-3 mr-1">Case:</span>
          {CASE_OPTIONS.map((c) => {
            const active = config.caseMode === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  setConfig((prev) => ({ ...prev, caseMode: c.id }))
                }
                className={`h-[21px] px-1.5 rounded-xs font-mono text-[10px] border whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? "bg-accent-soft text-accent-fg border-accent font-semibold"
                    : "bg-surface-2 text-fg-2 border-line hover:text-fg"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-[10.5px] sm:text-[11px] text-fg-2">
          <label
            className="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            title="Collapse repeated spaces cleanly"
          >
            <input
              type="checkbox"
              checked={config.trimSpaces}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  trimSpaces: e.target.checked,
                }))
              }
              className="rounded-xs border-line bg-surface-2"
            />
            <span>Trim spaces</span>
          </label>

          <label
            className="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            title="Automatically append _01, _02 if destination conflicts with an existing or duplicate filename"
          >
            <input
              type="checkbox"
              checked={config.autoDisambiguate}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  autoDisambiguate: e.target.checked,
                }))
              }
              className="rounded-xs border-line bg-surface-2"
            />
            <span className="font-medium text-fg">
              Auto-number duplicates (_01, _02)
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};
