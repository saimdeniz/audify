import React from "react";
import { Lock } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

interface ReadOnlyWriteModeButtonProps {
  compact?: boolean;
}

export const ReadOnlyWriteModeButton: React.FC<ReadOnlyWriteModeButtonProps> = ({
  compact = false,
}) => {
  const setSettingsOpen = useSampleStore((s) => s.setSettingsOpen);

  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true, "advanced")}
      className={`${
        compact
          ? "h-[20px] px-1.5 text-[9.5px]"
          : "h-[22px] px-2 text-[10px]"
      } rounded-[3px] bg-accent-soft border border-accent/50 hover:bg-accent hover:text-accent-on text-accent-fg font-mono font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0`}
      title="Safe Read-Only Mode — click to enable Disk File Operations (Write Mode) in Settings → Advanced"
    >
      <Lock className="w-2.5 h-2.5 shrink-0" />
      <span>{compact ? "Read-Only" : "Read-Only · Write Mode"}</span>
    </button>
  );
};
