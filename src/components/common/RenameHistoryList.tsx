import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RotateCcw } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { parseSqliteUtcMs, splitFileNameAndExt } from "../../utils/format";

export interface SampleRenameHistoryItem {
  name: string;
  created_at: string;
}

/** Fetches up to 10 historical filenames for a sample from SQLite `file_ops_journal`. */
export async function fetchSampleRenameHistory(
  sampleId: number,
  limit = 10
): Promise<SampleRenameHistoryItem[]> {
  if (!Number.isSafeInteger(sampleId) || sampleId <= 0) return [];
  try {
    const rows = await invoke<SampleRenameHistoryItem[]>(
      "get_sample_rename_history",
      { sampleId, limit }
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function formatCompactTimestamp(raw: string): string {
  const ms = parseSqliteUtcMs(raw);
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface RenameHistoryListProps {
  sampleId: number;
  fallbackPrevName?: string | null;
  preloadedItems?: SampleRenameHistoryItem[] | null;
  onRestored: () => void;
}

/**
 * Shared flyout list showing up to 10 historical filenames for a sample.
 * Used inside both Main View's `SampleContextMenu` and Mini Dock's floating submenu.
 */
export const RenameHistoryList: React.FC<RenameHistoryListProps> = ({
  sampleId,
  fallbackPrevName,
  preloadedItems,
  onRestored,
}) => {
  const [items, setItems] = useState<SampleRenameHistoryItem[]>(() => {
    if (preloadedItems && preloadedItems.length > 0) return preloadedItems;
    return fallbackPrevName
      ? [{ name: fallbackPrevName, created_at: "" }]
      : [];
  });
  const [loading, setLoading] = useState(!preloadedItems);

  useEffect(() => {
    if (preloadedItems) {
      setItems(preloadedItems);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void fetchSampleRenameHistory(sampleId, 10).then((rows) => {
      if (!alive) return;
      if (rows.length > 0) {
        setItems(rows);
      } else if (fallbackPrevName) {
        setItems([{ name: fallbackPrevName, created_at: "" }]);
      } else {
        setItems([]);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [sampleId, fallbackPrevName, preloadedItems]);

  const handleRestore = async (targetName: string) => {
    const stem = splitFileNameAndExt(targetName).stem;
    onRestored();
    if (!stem) return;
    await useSampleStore.getState().renameSampleFile(sampleId, stem);
  };

  return (
    <div className="flex flex-col">
      <div className="px-2.5 py-1 border-b border-line text-[10px] font-mono uppercase tracking-wider text-fg-3">
        Rename History (Last 10)
      </div>
      {loading && items.length === 0 ? (
        <div className="px-2.5 py-2 text-[10.5px] text-fg-3">Loading...</div>
      ) : items.length === 0 ? (
        <div className="px-2.5 py-2 text-[10.5px] text-fg-3">
          No previous names recorded
        </div>
      ) : (
        <div className="max-h-[240px] overflow-y-auto py-0.5">
          {items.map((item, idx) => {
            const stamp = formatCompactTimestamp(item.created_at);
            return (
              <button
                key={`${item.name}-${idx}`}
                type="button"
                onClick={() => void handleRestore(item.name)}
                title={`Restore filename "${item.name}"`}
                className="w-full h-[26px] px-2.5 flex items-center justify-between gap-2 text-left text-[11px] text-fg hover:bg-accent-soft hover:text-accent-fg transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  <RotateCcw className="w-3 h-3 text-accent-fg shrink-0" />
                  <span className="truncate">{item.name}</span>
                </span>
                {stamp && (
                  <span className="font-mono text-[9.5px] text-fg-3 shrink-0">
                    {stamp}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
