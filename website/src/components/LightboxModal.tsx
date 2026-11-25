import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface LightboxModalProps {
  src: string | null;
  caption: string;
  onClose: () => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({ src, caption, onClose }) => {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0 p-4 sm:p-8"
      style={{ backgroundColor: "rgba(5, 5, 8, 0.88)", backdropFilter: "blur(10px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[92vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface-1 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line bg-surface-header px-4 py-2.5">
          <span className="font-mono text-[11px] text-fg-2">{caption}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close full resolution preview"
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-line bg-surface-2 text-fg-2 hover:border-line-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-auto bg-surface-0 p-2">
          <img src={src} alt={caption} className="mx-auto h-auto max-h-[82vh] w-auto rounded-xs" />
        </div>
      </div>
    </div>,
    document.body
  );
};
