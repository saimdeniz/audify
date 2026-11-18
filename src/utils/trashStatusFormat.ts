import type { TrashOpStatus } from "../types";

export function formatTrashOpLabel(
  status: TrashOpStatus,
  compact = false
): string {
  const n = status.count.toLocaleString();
  const unit = status.count === 1 ? "file" : "files";
  if (status.kind === "emptying") {
    return compact
      ? `Recycling ${n}...`
      : `Moving ${n} ${unit} to Recycle Bin...`;
  }
  if (status.kind === "restoring") {
    return compact ? `Restoring ${n}...` : `Restoring ${n} ${unit}...`;
  }
  return compact ? `Trashing ${n}...` : `Moving ${n} ${unit} to Trash...`;
}
