import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { deterministicColorForName } from "../constants/palettes";
import { Z_INDEX } from "../constants/zIndex";

const ColorPickerPopover = lazy(() =>
  import("./ColorPickerPopover").then((m) => ({
    default: m.ColorPickerPopover,
  }))
);

interface QuickCreatePopoverProps {
  title: string;
  placeholder?: string;
  hasColor?: boolean;
  defaultColor?: string;
  defaultValue?: string;
  align?: "left" | "right";
  buttonTitle?: string;
  buttonClassName?: string;
  buttonIcon?: React.ReactNode;
  buttonLabel?: string;
  /** Return `false` to keep the popover open (e.g. validation / duplicate error). */
  onCreated: (
    name: string,
    color?: string
  ) => Promise<boolean | void> | boolean | void;
}

export const QuickCreatePopover: React.FC<QuickCreatePopoverProps> = ({
  title,
  placeholder = "Name...",
  hasColor = false,
  defaultColor,
  defaultValue = "",
  align = "right",
  buttonTitle,
  buttonClassName,
  buttonIcon,
  buttonLabel,
  onCreated,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor || "#3B82F6");
  const [hasUserCustomizedColor, setHasUserCustomizedColor] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return null;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = Math.min(260, Math.max(216, window.innerWidth - 16));
    const popoverHeight = hasColor ? 120 : 92;

    let top = rect.bottom + 4;
    if (top + popoverHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popoverHeight - 4);
    }

    let left = align === "right" ? rect.right - popoverWidth : rect.left;
    left = Math.max(8, Math.min(window.innerWidth - popoverWidth - 8, left));

    return { top, left, width: popoverWidth };
  }, [align, hasColor]);

  const handleToggleOpen = () => {
    if (!isOpen) {
      setName(defaultValue);
      const initialColor = defaultColor || deterministicColorForName(title);
      setColor(initialColor);
      setHasUserCustomizedColor(false);

      const pos = calculatePosition();
      if (pos) {
        setPopoverPos(pos);
      }
      setIsOpen(true);
    } else {
      setIsOpen(false);
      setPopoverPos(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const pos = calculatePosition();
    if (pos) setPopoverPos(pos);

    const timer = setTimeout(() => {
      inputRef.current?.focus();
      if (inputRef.current && inputRef.current.value.length > 0) {
        inputRef.current.select();
      }
    }, 35);

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-color-picker-portal]")) return;
      if (
        triggerRef.current &&
        target &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Yield if nested ColorPickerPopover is currently open
        if (document.querySelector("[data-color-picker-portal]")) return;
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const onScrollOrResize = () => {
      const updated = calculatePosition();
      if (updated) setPopoverPos(updated);
    };

    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [isOpen, calculatePosition]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSubmitting) return;

    try {
      setIsSubmitting(true);
      const outcome = await onCreated(trimmed, hasColor ? color : undefined);
      if (outcome === false) {
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      setIsOpen(false);
      setName("");
      setHasUserCustomizedColor(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggleOpen}
        className={
          buttonClassName ||
          "w-[24px] h-[24px] bg-accent hover:bg-accent-hover text-accent-on rounded-xs flex items-center justify-center shrink-0 shadow-xs transition-colors cursor-pointer"
        }
        title={buttonTitle || title}
      >
        {buttonIcon || <Plus className="w-3.5 h-3.5 stroke-[2.5]" />}
        {buttonLabel && (
          <span className="ml-1 font-mono text-[10px]">{buttonLabel}</span>
        )}
      </button>

      {isOpen &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            data-quick-create-portal="true"
            data-popover-portal="true"
            data-mica-overlay="true"
            style={{
              position: "fixed",
              top: `${popoverPos.top}px`,
              left: `${popoverPos.left}px`,
              width: `${popoverPos.width}px`,
              zIndex: Z_INDEX.popoverFloating,
            }}
            className="bg-surface-2 border border-line-strong rounded-lg p-2.5 shadow-2xl select-none text-fg backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSubmit} className="space-y-2">
              <div className="flex items-center justify-between border-b border-line pb-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider font-semibold text-fg">
                  {title}
                </span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-fg-3 hover:text-fg rounded-xs p-0.5 cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              <div className="flex items-center space-x-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={name}
                  onChange={(e) => {
                    const val = e.target.value;
                    setName(val);
                    if (hasColor && !hasUserCustomizedColor && val.trim()) {
                      setColor(deterministicColorForName(val));
                    }
                  }}
                  placeholder={placeholder}
                  className="flex-1 min-w-0 h-[26px] bg-surface-3 border border-line focus:border-accent px-2 text-[11px] font-mono text-fg outline-none rounded-xs placeholder-fg-3"
                />
                {hasColor && (
                  <Suspense fallback={null}>
                    <ColorPickerPopover
                      color={color}
                      onChange={(newColor) => {
                        setColor(newColor);
                        setHasUserCustomizedColor(true);
                      }}
                      align="right"
                      triggerSize="sm"
                      title="Pick Color"
                    />
                  </Suspense>
                )}
              </div>

              <div className="flex items-center justify-end space-x-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="h-[22px] px-2 text-[10px] font-mono text-fg-3 hover:text-fg bg-surface-3 hover:bg-surface-hover rounded-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || isSubmitting}
                  className="h-[22px] px-2.5 text-[10px] font-mono font-semibold text-accent-on bg-accent hover:bg-accent-hover disabled:opacity-40 rounded-xs transition-colors shadow-xs cursor-pointer"
                >
                  Create
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}
    </>
  );
};
