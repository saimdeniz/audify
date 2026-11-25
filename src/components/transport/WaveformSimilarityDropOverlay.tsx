import React, { useEffect, useState } from "react";
import { AudioLines, Loader2 } from "lucide-react";
import {
  AUDIO_EXTENSION_RE,
  SUPPORTED_AUDIO_EXTENSIONS,
} from "../../constants/audioFormats";
import { useSampleStore } from "../../store/useSampleStore";
import { isOsDragCurrentlyInFlight } from "../../utils/drag";

const MAX_EXTERNAL_SIMILARITY_UPLOAD_BYTES = 64 * 1024 * 1024;
let externalAudioDropSeq = 0;

function isPointInsideRect(
  el: HTMLElement | null,
  clientX: number,
  clientY: number
): boolean {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function isModalBlockingOverlay(): boolean {
  const st = useSampleStore.getState();
  if (st.isSettingsOpen) return true;
  return (
    document.querySelector(
      '[data-modal-portal="true"], [role="dialog"][aria-modal="true"]'
    ) !== null
  );
}

function isExternalFilesDragEvent(e: DragEvent): boolean {
  const st = useSampleStore.getState();
  if (st.inAppDragSample !== null || isOsDragCurrentlyInFlight()) {
    return false;
  }
  if (isModalBlockingOverlay()) {
    return false;
  }
  const types = e.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes("Files"));
}

async function commitExternalAudioDrop(
  fileList: FileList | undefined
): Promise<void> {
  const state = useSampleStore.getState();
  if (!fileList || fileList.length === 0) return;

  const files = Array.from(fileList);
  const audioFile = files.find((f) => AUDIO_EXTENSION_RE.test(f.name));
  if (!audioFile) {
    const extsLabel = SUPPORTED_AUDIO_EXTENSIONS.map((ext) =>
      ext.toUpperCase()
    ).join(", ");
    state.showStatusNotice(
      `Drop an audio file (${extsLabel}) onto the waveform to search by similarity.`,
      "info"
    );
    return;
  }

  const dropSeq = ++externalAudioDropSeq;
  const startProfileId = state.activeProfile?.id ?? null;

  const nativePath = (audioFile as unknown as { path?: string }).path;
  if (typeof nativePath === "string" && nativePath.trim().length > 0) {
    await state.findSimilarSamplesByExternalAudio({
      filePath: nativePath.trim(),
      fileName: audioFile.name,
    });
    return;
  }

  if (audioFile.size > MAX_EXTERNAL_SIMILARITY_UPLOAD_BYTES) {
    state.showStatusNotice(
      `Audio file "${audioFile.name}" exceeds the 64 MB in-memory similarity probe limit.`,
      "error"
    );
    return;
  }

  try {
    useSampleStore.setState({ externalSimilarityPendingFile: audioFile.name });
    const buf = await audioFile.arrayBuffer();
    const live = useSampleStore.getState();
    if (
      dropSeq !== externalAudioDropSeq ||
      (live.activeProfile?.id ?? null) !== startProfileId
    ) {
      return;
    }
    // Pass Uint8Array directly so Tauri v2 streams InvokeBody::Raw without JSON encoding
    await live.findSimilarSamplesByExternalAudio({
      fileName: audioFile.name,
      rawBytes: new Uint8Array(buf),
    });
  } catch (err) {
    if (dropSeq === externalAudioDropSeq) {
      useSampleStore.setState({ externalSimilarityPendingFile: null });
      useSampleStore
        .getState()
        .showStatusNotice(
          `Failed reading dropped audio file: ${String(err)}`,
          "error"
        );
    }
  }
}

interface WaveformSimilarityDropOverlayProps {
  panelRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Sononym-style similarity drop zone overlay rendered on the top waveform deck
 * when dragging either an in-app track (excluding deck-header self-drags) OR an
 * external OS audio file (works in both Safe Read-Only Mode and Write Mode
 * without importing/modifying anything), plus a non-blocking analyzing chip.
 */
export const WaveformSimilarityDropOverlay: React.FC<
  WaveformSimilarityDropOverlayProps
> = React.memo(({ panelRef }) => {
  const inAppDragSample = useSampleStore((s) => s.inAppDragSample);
  const inAppDragOrigin = useSampleStore((s) => s.inAppDragOrigin);
  const externalSimilarityPendingFile = useSampleStore(
    (s) => s.externalSimilarityPendingFile
  );
  const [isInAppHovered, setIsInAppHovered] = useState(false);
  const [isExternalDragActive, setIsExternalDragActive] = useState(false);
  const [isExternalHovered, setIsExternalHovered] = useState(false);

  const isInAppActive = Boolean(
    inAppDragSample &&
      !inAppDragSample.is_trashed &&
      inAppDragOrigin !== "deck-header"
  );

  // 1) In-app track drag onto waveform deck
  useEffect(() => {
    if (!isInAppActive) {
      setIsInAppHovered(false);
      return;
    }

    const commitSimilarityDrop = () => {
      const state = useSampleStore.getState();
      const dragged = state.inAppDragSample;
      if (
        !dragged ||
        dragged.is_trashed ||
        state.inAppDragOrigin === "deck-header"
      ) {
        return;
      }

      // Clear synchronously before async search so DOM drop + mouseup cannot fire twice
      state.setInAppDragSample(null);
      setIsInAppHovered(false);
      if (state.selectedSample?.id !== dragged.id) {
        state.selectSample(dragged, false);
      }
      void state.findSimilarSamples(dragged);
    };

    const clearInAppHover = () => setIsInAppHovered(false);

    const onDragOver = (e: DragEvent) => {
      if (isPointInsideRect(panelRef.current, e.clientX, e.clientY)) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
        setIsInAppHovered(true);
      } else {
        setIsInAppHovered(false);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      setIsInAppHovered(
        isPointInsideRect(panelRef.current, e.clientX, e.clientY)
      );
    };

    const onDrop = (e: DragEvent) => {
      if (isPointInsideRect(panelRef.current, e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        commitSimilarityDrop();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isPointInsideRect(panelRef.current, e.clientX, e.clientY)) {
        commitSimilarityDrop();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearInAppHover();
      }
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("pointerdown", clearInAppHover, true);
    window.addEventListener("blur", clearInAppHover);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("pointerdown", clearInAppHover, true);
      window.removeEventListener("blur", clearInAppHover);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isInAppActive, panelRef]);

  // 2) External OS file drag onto waveform deck (read-only acoustic similarity probe)
  useEffect(() => {
    const clearExternal = () => {
      setIsExternalDragActive(false);
      setIsExternalHovered(false);
    };

    const dismissFolderDropOverlay = () => {
      window.dispatchEvent(new CustomEvent("audify:clear-external-drag"));
    };

    const onExternalDragOver = (e: DragEvent) => {
      if (!isExternalFilesDragEvent(e)) {
        clearExternal();
        return;
      }
      setIsExternalDragActive(true);
      const inside = isPointInsideRect(panelRef.current, e.clientX, e.clientY);
      setIsExternalHovered(inside);
      if (inside) {
        // Tell folder-drop overlay to close immediately before stopping propagation
        dismissFolderDropOverlay();
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      }
    };

    const onExternalDragLeave = (e: DragEvent) => {
      if (
        e.relatedTarget === null ||
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        clearExternal();
      }
    };

    const onExternalDrop = (e: DragEvent) => {
      if (!isExternalFilesDragEvent(e)) {
        clearExternal();
        return;
      }
      const inside = isPointInsideRect(panelRef.current, e.clientX, e.clientY);
      clearExternal();
      if (!inside) return;

      dismissFolderDropOverlay();
      e.preventDefault();
      e.stopPropagation();
      void commitExternalAudioDrop(e.dataTransfer?.files);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearExternal();
      }
    };

    // Capture phase ensures waveform similarity probe runs before folder-import handlers
    window.addEventListener("dragover", onExternalDragOver, true);
    window.addEventListener("dragleave", onExternalDragLeave, true);
    window.addEventListener("drop", onExternalDrop, true);
    window.addEventListener("dragend", clearExternal, true);
    window.addEventListener("pointerdown", clearExternal, true);
    window.addEventListener("blur", clearExternal);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("dragover", onExternalDragOver, true);
      window.removeEventListener("dragleave", onExternalDragLeave, true);
      window.removeEventListener("drop", onExternalDrop, true);
      window.removeEventListener("dragend", clearExternal, true);
      window.removeEventListener("pointerdown", clearExternal, true);
      window.removeEventListener("blur", clearExternal);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [panelRef]);

  const isVisible = isInAppActive || isExternalDragActive;
  const isHovered = isInAppActive ? isInAppHovered : isExternalHovered;

  if (!isVisible) {
    if (!externalSimilarityPendingFile) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-1.5 z-20 flex items-center justify-center select-none"
      >
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-xs bg-surface-2 border border-accent text-[11px] font-mono text-accent-fg shadow-md max-w-[90%]">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">
            Analyzing &ldquo;{externalSimilarityPendingFile}&rdquo;...
          </span>
        </div>
      </div>
    );
  }

  const subtitle =
    isInAppActive && inAppDragSample
      ? inAppDragSample.file_name
      : "External audio file · Read-only acoustic search";

  if (!isHovered) {
    return (
      <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xs border border-dashed border-accent bg-surface-soft select-none">
        <div className="flex items-center gap-2 px-3 py-1 rounded-xs bg-surface-2 border border-line text-[11px] font-mono text-fg-2 shadow-xs">
          <AudioLines className="w-3.5 h-3.5 text-accent-fg shrink-0" />
          <span>Drop audio file on waveform to search by similarity</span>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      className="audify-drop-overlay-backdrop pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xs border-2 border-dashed border-accent select-none"
    >
      <div className="flex items-center gap-3 px-4 py-2 rounded-sm bg-surface-2 border border-line-strong shadow-lg max-w-[92%]">
        <div className="w-8 h-8 rounded-full bg-accent-soft border border-accent flex items-center justify-center text-accent-fg shrink-0">
          <AudioLines className="w-4 h-4 stroke-[2]" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold text-fg leading-tight">
            Release here to search by similarity
          </span>
          <span className="text-[10.5px] font-mono text-accent-fg truncate max-w-[340px]">
            {subtitle}
          </span>
        </div>
      </div>
    </div>
  );
});
