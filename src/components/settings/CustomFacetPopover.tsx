import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderTree, List, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deterministicColorForName,
  FAMILY_COLOR_PALETTE,
} from "../../constants/palettes";
import type { TagFacet, TaxonomyDomain } from "../../types";
import { ColorPickerPopover } from "../ColorPickerPopover";

interface CustomFacetPopoverProps {
  domain: TaxonomyDomain;
  existingFacet?: TagFacet;
  onCreate?: (
    name: string,
    domain: TaxonomyDomain,
    color: string,
    allowNesting: boolean
  ) => Promise<TagFacet | null>;
  onUpdate?: (
    facetId: number,
    patch: { name?: string; color?: string; allowNesting?: boolean }
  ) => Promise<TagFacet | null>;
  onDelete?: (facetId: number) => Promise<number | null>;
  onSaved?: (facet: TagFacet) => void;
  onDeleted?: () => void;
}

export const CustomFacetPopover: React.FC<CustomFacetPopoverProps> = ({
  domain,
  existingFacet,
  onCreate,
  onUpdate,
  onDelete,
  onSaved,
  onDeleted,
}) => {
  const isEdit = Boolean(existingFacet);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(FAMILY_COLOR_PALETTE[4]);
  const [allowNesting, setAllowNesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    if (existingFacet) {
      setName(existingFacet.name);
      setColor(existingFacet.color || FAMILY_COLOR_PALETTE[4]);
      setAllowNesting(Boolean(existingFacet.allow_nesting));
    } else {
      setName("");
      setColor(domain === "genres" ? "#8B5CF6" : "#0EA5E9");
      setAllowNesting(false);
    }
    setConfirmDelete(false);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = 264;
    const approxHeight = isEdit ? 248 : 216;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8)
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= approxHeight + 8
        ? rect.bottom + 4
        : Math.max(8, rect.top - approxHeight - 4);
    setCoords({ top, left });
  }, [open, isEdit]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (dialogRef.current?.contains(target)) return;
      if (target.closest("[data-color-picker-portal='true']")) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || submitting) return;
    setSubmitting(true);
    try {
      const resolvedColor = color || deterministicColorForName(clean);
      if (isEdit && existingFacet && onUpdate) {
        const updated = await onUpdate(existingFacet.id, {
          name: clean,
          color: resolvedColor,
          allowNesting,
        });
        if (updated) {
          onSaved?.(updated);
          setOpen(false);
        }
      } else if (onCreate) {
        const created = await onCreate(
          clean,
          domain,
          resolvedColor,
          allowNesting
        );
        if (created) {
          onSaved?.(created);
          setOpen(false);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingFacet || !onDelete || submitting) return;
    setSubmitting(true);
    try {
      const migrated = await onDelete(existingFacet.id);
      if (migrated !== null) {
        setOpen(false);
        onDeleted?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fallbackLabel = domain === "genres" ? "Genre" : "Category";

  return (
    <>
      {isEdit ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={openPopover}
          className="w-[15px] h-[15px] rounded-[2px] flex items-center justify-center text-fg-3 hover:text-accent-fg hover:bg-surface-3 transition-colors cursor-pointer"
          title={`Edit or delete custom facet "${existingFacet?.name}"`}
          aria-label={`Edit facet ${existingFacet?.name}`}
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={openPopover}
          className="h-[20px] px-1.5 rounded-[2px] font-mono text-[9.5px] uppercase border border-dashed border-line-strong hover:border-accent bg-surface-2 hover:bg-accent-soft text-fg-3 hover:text-accent-fg inline-flex items-center gap-0.5 transition-colors cursor-pointer"
          title={`Create custom ${domain === "genres" ? "genre" : "tag"} facet`}
        >
          <Plus className="w-2.5 h-2.5 shrink-0" />
          <span>Facet</span>
        </button>
      )}

      {open &&
        coords &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit Custom Facet" : "New Custom Facet"}
            style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[120] w-[264px] bg-surface-1 border border-line-strong rounded-md shadow-xl p-2.5 space-y-2.5 text-fg"
          >
            <div className="flex items-center justify-between border-b border-line pb-1.5">
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-accent-fg">
                {isEdit ? "EDIT CUSTOM FACET" : "NEW CUSTOM FACET"}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-4 h-4 rounded-[2px] flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-3 cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2.5">
              <div className="space-y-1">
                <label className="text-[9.5px] font-mono uppercase text-fg-3 font-semibold block">
                  NAME
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    domain === "genres"
                      ? "e.g. Energy, Era, Tempo..."
                      : "e.g. Mic Type, Project, Pack..."
                  }
                  className="w-full h-[26px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-mono text-fg placeholder-fg-3 outline-none rounded-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-mono uppercase text-fg-3 font-semibold block">
                  STRUCTURE
                </label>
                <div className="grid grid-cols-2 gap-1 bg-surface-2 p-0.5 rounded-xs border border-line">
                  <button
                    type="button"
                    onClick={() => setAllowNesting(false)}
                    className={`h-[22px] rounded-[2px] font-mono text-[9.5px] inline-flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                      !allowNesting
                        ? "bg-accent-soft text-accent-fg border border-accent font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent"
                    }`}
                  >
                    <List className="w-3 h-3 shrink-0" />
                    <span>Flat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllowNesting(true)}
                    className={`h-[22px] rounded-[2px] font-mono text-[9.5px] inline-flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                      allowNesting
                        ? "bg-accent-soft text-accent-fg border border-accent font-semibold"
                        : "text-fg-2 hover:text-fg border border-transparent"
                    }`}
                  >
                    <FolderTree className="w-3 h-3 shrink-0" />
                    <span>Nested Tree</span>
                  </button>
                </div>
                {isEdit && existingFacet?.allow_nesting && !allowNesting && (
                  <p className="text-[9px] text-fg-3 leading-snug">
                    Switching to Flat promotes existing sub-items to top level.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-mono uppercase text-fg-3 font-semibold block">
                  COLOR
                </label>
                <div className="h-[26px] px-2 bg-surface-2 border border-line rounded-xs inline-flex items-center gap-2">
                  <ColorPickerPopover
                    color={color}
                    onChange={setColor}
                    triggerSize="xs"
                    align="left"
                    title="Pick 16M Facet Color"
                  />
                  <span className="font-mono text-[10px] text-fg uppercase">
                    {color}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-line-subtle">
                {isEdit && onDelete ? (
                  confirmDelete ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleDelete()}
                        className="h-[24px] px-2 rounded-xs bg-danger text-accent-on font-mono text-[9.5px] font-semibold cursor-pointer disabled:opacity-50"
                        title={`Delete facet — items move safely to ${fallbackLabel}`}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="h-[24px] px-1.5 rounded-xs bg-surface-2 border border-line text-[9.5px] font-mono text-fg-2 hover:text-fg cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="h-[24px] px-1.5 rounded-xs bg-surface-2 hover:bg-danger/10 border border-line hover:border-danger/40 text-fg-3 hover:text-danger inline-flex items-center gap-1 text-[9.5px] font-mono cursor-pointer transition-colors"
                      title={`Delete custom facet (items move safely to ${fallbackLabel})`}
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete</span>
                    </button>
                  )
                ) : (
                  <span className="text-[9px] font-mono text-fg-3">
                    {allowNesting ? "Up to 3 levels" : "Single level"}
                  </span>
                )}

                <button
                  type="submit"
                  disabled={!name.trim() || submitting}
                  className="h-[24px] px-2.5 rounded-xs bg-accent hover:bg-accent-hover text-accent-on font-mono text-[10px] font-semibold disabled:opacity-40 cursor-pointer transition-colors"
                >
                  {isEdit ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}
    </>
  );
};
