import React, { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { getAsciiMagicPreview } from "../../services/asciiMagicService";
import type {
  AsciiMagicInstalledPiece,
  AsciiMagicLook,
  ThemeMode,
} from "../../types";
import {
  releaseCanvasRenderCaches,
  renderPreviewThumbnail,
} from "../../utils/asciiMagic/frameRenderer";
import { InlineConfirmDeleteButton } from "../common/InlineConfirmDeleteButton";

export interface AsciiMagicCardProps {
  slug: string;
  name: string;
  category: string;
  note: string;
  cols: number;
  rows: number;
  fps: number;
  installedRecord: AsciiMagicInstalledPiece | null;
  isActive: boolean;
  isInstalling: boolean;
  isConfirmingDelete: boolean;
  look: AsciiMagicLook;
  themeMode: ThemeMode;
  onSelect: (slug: string) => void;
  onInstall: (slug: string) => void;
  onRequestDelete: (slug: string) => void;
  onConfirmDelete: (slug: string) => void;
  onCancelDelete: () => void;
}

const THUMB_W = 72;
const THUMB_H = 42;

export const AsciiMagicCard: React.FC<AsciiMagicCardProps> = React.memo(
  ({
    slug,
    name,
    category,
    note,
    cols,
    rows,
    fps,
    installedRecord,
    isActive,
    isInstalling,
    isConfirmingDelete,
    look,
    themeMode,
    onSelect,
    onInstall,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
  }) => {
    const cardRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [isVisible, setIsVisible] = useState<boolean>(
      () => typeof IntersectionObserver === "undefined"
    );
    const [hasPainted, setHasPainted] = useState<boolean>(false);
    const hasPreview = Boolean(installedRecord?.has_preview);

    useEffect(() => {
      if (!hasPreview) {
        setIsVisible(false);
        return;
      }
      const el = cardRef.current;
      if (!el || typeof IntersectionObserver === "undefined") {
        setIsVisible(true);
        return;
      }
      const obs = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry) {
            setIsVisible(entry.isIntersecting);
          }
        },
        { rootMargin: "120px" }
      );
      obs.observe(el);
      return () => obs.disconnect();
    }, [hasPreview]);

    // Paint directly to the small thumbnail canvas without retaining snapshot JSON in React state,
    // and release the canvas backing store whenever the card scrolls out of view or unmounts.
    useEffect(() => {
      const canvasEl = canvasRef.current;
      if (!hasPreview || !isVisible) {
        setHasPainted(false);
        releaseCanvasRenderCaches(canvasEl, true);
        return;
      }
      let cancelled = false;
      void getAsciiMagicPreview(slug).then((snap) => {
        if (cancelled) return;
        const cv = canvasRef.current;
        if (!snap || !cv) {
          setHasPainted(false);
          return;
        }
        renderPreviewThumbnail(cv, snap, look, themeMode, THUMB_W, THUMB_H);
        setHasPainted(true);
      });
      return () => {
        cancelled = true;
        releaseCanvasRenderCaches(canvasEl, true);
      };
    }, [slug, hasPreview, isVisible, installedRecord?.sha256, look, themeMode]);

    const installed = installedRecord !== null;
    const handlePrimaryClick = () => {
      if (isInstalling) return;
      if (installed) {
        onSelect(slug);
      } else {
        onInstall(slug);
      }
    };

    return (
      <div
        ref={cardRef}
        className={`group relative h-[58px] px-2 rounded-xs border transition-all flex items-center gap-2 overflow-hidden ${
          isActive
            ? "border-accent bg-accent-soft ring-1 ring-accent"
            : "border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3"
        }`}
      >
        <button
          type="button"
          onClick={handlePrimaryClick}
          disabled={isInstalling}
          title={
            installed
              ? `${name} (${category}) — Click to activate${note ? ` — ${note}` : ""}`
              : `${name} (${category}) — Click to download & activate${note ? ` — ${note}` : ""}`
          }
          className="min-w-0 flex-1 h-full flex items-center gap-2.5 text-left cursor-pointer disabled:cursor-wait"
        >
          <div className="relative w-[72px] h-[42px] rounded-xs border border-line bg-surface-1 shrink-0 overflow-hidden flex items-center justify-center">
            {hasPreview && isVisible && (
              <canvas
                ref={canvasRef}
                aria-hidden="true"
                className={`w-full h-full block ${hasPainted ? "" : "hidden"}`}
              />
            )}
            {(!hasPreview || !isVisible || !hasPainted) && (
              <div className="flex flex-col items-center justify-center px-1 text-center">
                <span className="text-[9px] font-mono font-semibold text-fg-2 leading-none">
                  {cols}×{rows}
                </span>
                <span className="text-[8px] font-mono text-fg-3 mt-0.5 leading-none">
                  {fps}fps
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`text-[11px] truncate ${
                  isActive ? "text-fg font-semibold" : "text-fg font-medium"
                }`}
              >
                {name}
              </span>
              {isActive && (
                <span className="px-1 py-[1px] rounded-xs bg-accent text-accent-on text-[8.5px] font-mono font-bold uppercase tracking-wider shrink-0">
                  Live
                </span>
              )}
              {!isActive && installed && (
                <span className="px-1 py-[1px] rounded-xs bg-surface-3 border border-line text-fg-2 text-[8.5px] font-mono uppercase shrink-0">
                  Saved
                </span>
              )}
            </div>
            <span className="text-[9.5px] text-fg-3 truncate leading-tight">
              {note || `${category} · ${slug}`}
            </span>
          </div>
        </button>

        <div className="shrink-0 flex items-center pl-1">
          {isInstalling ? (
            <span
              className="w-[22px] h-[22px] rounded-xs bg-surface-3 border border-line flex items-center justify-center text-accent-fg"
              title="Downloading & validating..."
            >
              <Loader2 className="w-3 h-3 animate-spin" />
            </span>
          ) : installed ? (
            <InlineConfirmDeleteButton
              size="xs"
              isConfirming={isConfirmingDelete}
              onRequest={() => onRequestDelete(slug)}
              onConfirm={() => onConfirmDelete(slug)}
              onCancel={onCancelDelete}
              deleteTitle={`Remove ${name} from cache`}
              confirmTitle={`Confirm remove ${name}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => onInstall(slug)}
              className="w-[22px] h-[22px] rounded-xs bg-surface-1 hover:bg-accent hover:text-accent-on border border-line text-fg-2 flex items-center justify-center transition-colors cursor-pointer"
              title={`Download ${name} (${slug})`}
            >
              <Download className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }
);
