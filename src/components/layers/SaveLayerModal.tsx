import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FilePlus2, Save, Sparkles, X } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import type { LayerHistoryEntry } from "../../types";
import { useDialogFocusTrap } from "../../utils/modalFocus";

interface SaveLayerModalProps {
  open: boolean;
  initialName: string;
  editingLayerId: number | null;
  existingLayers: LayerHistoryEntry[];
  isSaving: boolean;
  onClose: () => void;
  onConfirmSave: (name: string, overwrite: boolean) => Promise<boolean>;
}

function normalizeLayerStem(raw: string): string {
  return raw.trim().replace(/\.wav$/i, "").toLowerCase();
}

function generateAutoLayerName(existingLayers: LayerHistoryEntry[]): string {
  const taken = new Set(
    existingLayers.map((l) => normalizeLayerStem(l.layer_name))
  );
  for (let i = 1; i <= 9999; i++) {
    const candidate = `Layer_${String(i).padStart(3, "0")}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `Layer_${Date.now()}`;
}

/**
 * Portal-backed Save Layer dialog with manual naming, optional `Auto` unique name
 * generator, live duplicate filename protection, dialog focus trapping, and
 * failure-preserving submit (keeps modal open on error so user never loses text).
 */
export const SaveLayerModal: React.FC<SaveLayerModalProps> = ({
  open,
  initialName,
  editingLayerId,
  existingLayers,
  isSaving,
  onClose,
  onConfirmSave,
}) => {
  const [name, setName] = useState(initialName);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useDialogFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    setName(initialName.replace(/\.wav$/i, ""));
    const raf = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!isSaving) onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, isSaving, onClose]);

  const cleanStem = name.trim().replace(/\.wav$/i, "");
  const normalized = normalizeLayerStem(cleanStem);

  const duplicateConflict = useMemo(() => {
    if (!normalized) return null;
    return (
      existingLayers.find(
        (entry) =>
          entry.id !== editingLayerId &&
          normalizeLayerStem(entry.layer_name) === normalized
      ) ?? null
    );
  }, [existingLayers, editingLayerId, normalized]);

  const exactConflictForNewCopy = useMemo(() => {
    if (!normalized) return null;
    return (
      existingLayers.find(
        (entry) => normalizeLayerStem(entry.layer_name) === normalized
      ) ?? null
    );
  }, [existingLayers, normalized]);

  if (!open) return null;

  const canSavePrimary =
    cleanStem.length > 0 && !duplicateConflict && !isSaving;
  const canSaveNewCopy =
    cleanStem.length > 0 && !exactConflictForNewCopy && !isSaving;

  const handleSubmit = async (overwrite: boolean) => {
    if (overwrite ? !canSavePrimary : !canSaveNewCopy) return;
    const ok = await onConfirmSave(cleanStem, overwrite);
    if (ok) {
      onClose();
    }
  };

  return createPortal(
    <div
      data-modal-portal="true"
      style={{ zIndex: Z_INDEX.modalConfirm }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
      className="fixed inset-0 audify-modal-backdrop flex items-center justify-center p-4 select-none"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Save Layer Mix"
        tabIndex={-1}
        data-mica-overlay="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[376px] max-w-full rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden text-[12px] text-fg outline-none"
      >
        <div className="h-[34px] px-3 bg-surface-1 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg">
            {editingLayerId !== null ? "SAVE / UPDATE LAYER" : "SAVE LAYER MIX"}
          </span>
          <button
            type="button"
            disabled={isSaving}
            aria-label="Close save dialog"
            onClick={() => {
              if (!isSaving) onClose();
            }}
            className="w-[22px] h-[22px] rounded-[3px] text-fg-3 hover:text-fg hover:bg-surface-3 disabled:opacity-40 flex items-center justify-center cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3 flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="save-layer-name-input"
              className="text-[11px] text-fg-2 font-medium"
            >
              Layer filename <span className="font-mono text-fg-3">(.wav)</span>
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="save-layer-name-input"
                ref={inputRef}
                type="text"
                disabled={isSaving}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSubmit(editingLayerId !== null);
                  }
                }}
                placeholder="Enter unique layer name..."
                className="flex-1 min-w-0 h-[26px] px-2 bg-surface-0 border border-line focus:border-accent rounded-[3px] text-[12px] text-fg focus:outline-none"
              />
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setName(generateAutoLayerName(existingLayers))}
                className="h-[26px] px-2 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg disabled:opacity-40 text-[11px] font-medium inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                title="Generate a clean unique automatic filename"
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto</span>
              </button>
            </div>
          </div>

          {duplicateConflict && (
            <div className="px-2.5 py-1.5 rounded-[3px] bg-warn/15 border border-warn/50 text-warn text-[11px] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                A layer named &quot;{duplicateConflict.layer_name}&quot; already
                exists. Pick a unique name or click Auto.
              </span>
            </div>
          )}

          <div className="pt-1 flex items-center justify-end gap-1.5">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                if (!isSaving) onClose();
              }}
              className="h-[24px] px-2.5 rounded-[3px] bg-surface-3 border border-line hover:border-line-strong text-fg-2 hover:text-fg disabled:opacity-40 text-[11px] cursor-pointer"
            >
              Cancel
            </button>

            {editingLayerId !== null && (
              <button
                type="button"
                disabled={!canSaveNewCopy}
                onClick={() => void handleSubmit(false)}
                className="h-[24px] px-2.5 rounded-[3px] bg-surface-3 hover:bg-accent-soft border border-line hover:border-accent text-fg-2 hover:text-accent-fg disabled:opacity-40 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                title={
                  exactConflictForNewCopy
                    ? "Enter a new unique name to save as a separate copy"
                    : "Save as a new separate WAV and recipe"
                }
              >
                <FilePlus2 className="w-3 h-3" />
                <span>Save Copy</span>
              </button>
            )}

            <button
              type="button"
              disabled={!canSavePrimary}
              onClick={() => void handleSubmit(editingLayerId !== null)}
              className="h-[24px] px-3 rounded-[3px] bg-accent hover:bg-accent-hover text-accent-on disabled:opacity-40 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Save className="w-3 h-3" />
              <span>{editingLayerId !== null ? "Update" : "Save"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
