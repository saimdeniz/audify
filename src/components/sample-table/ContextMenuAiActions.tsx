import React, { useMemo } from "react";
import { AudioLines, Ban, Check, Sparkles, Tags } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { SampleItem } from "../../types";
import { formatShortcutDisplay } from "../../utils/shortcuts";
import { MenuItem } from "../common/MenuItem";
import { ContextMenuState } from "./tableLayout";

interface ContextMenuAiActionsProps {
  targetIds: number[];
  isMultiContext: boolean;
  activeContextSample: SampleItem;
  clearSubmenuHover: () => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

/**
 * Local AI Audio Intelligence context-menu entries (acoustic similarity lookup,
 * manual AI tagging/re-indexing, and 1-click pending suggestion approval).
 */
export const ContextMenuAiActions: React.FC<ContextMenuAiActionsProps> = ({
  targetIds,
  isMultiContext,
  activeContextSample,
  clearSubmenuHover,
  setContextMenu,
}) => {
  const aiModelReady = useSampleStore((s) => s.aiModelStatus?.ready ?? false);
  const aiTaggingMode = useSampleStore((s) => s.aiTaggingMode);
  const findSimilarShortcut = useSampleStore(
    (s) => s.shortcuts.findSimilar || "Shift+Enter"
  );
  const aiSuggestionsBySampleId = useSampleStore(
    (s) => s.aiSuggestionsBySampleId
  );
  const findSimilarSamples = useSampleStore((s) => s.findSimilarSamples);
  const analyzeSamplesAi = useSampleStore((s) => s.analyzeSamplesAi);
  const runKnnTagLearning = useSampleStore((s) => s.runKnnTagLearning);
  const approveAllAiTagSuggestions = useSampleStore(
    (s) => s.approveAllAiTagSuggestions
  );
  const dismissAllAiTagSuggestions = useSampleStore(
    (s) => s.dismissAllAiTagSuggestions
  );

  const pendingForTargets = useMemo(() => {
    let total = 0;
    for (const id of targetIds) {
      total += aiSuggestionsBySampleId[id]?.length ?? 0;
    }
    return total;
  }, [aiSuggestionsBySampleId, targetIds]);

  return (
    <>
      <div className="my-1 border-t border-line" />

      {!isMultiContext && (
        <MenuItem
          compactHeight
          tone="accent"
          onMouseEnter={clearSubmenuHover}
          onClick={() => {
            setContextMenu(null);
            void findSimilarSamples(activeContextSample);
          }}
          icon={<AudioLines className="w-3.5 h-3.5 text-accent-fg" />}
          label="Find Similar Sounds"
          rightSlot={
            !aiModelReady ? (
              <span className="font-mono text-[9px] text-fg-3">Setup</span>
            ) : (
              <span className="font-mono text-[9.5px] text-fg-3 ml-1">
                {formatShortcutDisplay(findSimilarShortcut, { compact: true })}
              </span>
            )
          }
          title={
            aiModelReady
              ? "Find acoustically similar sounds in this library/folder"
              : "Requires local YAMNet AI model setup in Settings → AI"
          }
        />
      )}

      <MenuItem
        compactHeight
        tone="accent"
        onMouseEnter={clearSubmenuHover}
        onClick={() => {
          const ids = [...targetIds];
          setContextMenu(null);
          void analyzeSamplesAi({ sampleIds: ids, reanalyzeExisting: true });
        }}
        icon={<Sparkles className="w-3.5 h-3.5 text-accent-fg" />}
        label={
          aiTaggingMode === "vectors_only"
            ? isMultiContext
              ? `AI Index Acoustic Vectors (${targetIds.length})`
              : "AI Index Acoustic Vector"
            : isMultiContext
            ? `AI Analyze & Suggest Tags (${targetIds.length})`
            : "AI Analyze & Suggest Tags"
        }
        title={
          aiTaggingMode === "vectors_only"
            ? "Extract 128-dim acoustic similarity embeddings (Similarity Only mode)"
            : "Run local ONNX YAMNet inference to generate embeddings & AI tag suggestions"
        }
      />

      {aiTaggingMode !== "vectors_only" && (
        <MenuItem
          compactHeight
          tone="accent"
          onMouseEnter={clearSubmenuHover}
          onClick={() => {
            const ids = [...targetIds];
            setContextMenu(null);
            void runKnnTagLearning(ids);
          }}
          icon={<Tags className="w-3.5 h-3.5 text-accent-fg" />}
          label={
            isMultiContext
              ? `Learn Tags from Manual Labels (${targetIds.length})`
              : "Learn Tags from Manual Labels (k-NN)"
          }
          title="Vote tags from acoustically similar samples you already tagged manually (reuses YAMNet vectors, zero extra model)"
        />
      )}

      {pendingForTargets > 0 && (
        <>
          <MenuItem
            compactHeight
            tone="accent"
            onMouseEnter={clearSubmenuHover}
            onClick={() => {
              const ids = [...targetIds];
              setContextMenu(null);
              void approveAllAiTagSuggestions(ids);
            }}
            icon={<Check className="w-3.5 h-3.5 text-accent-fg" />}
            label={`Approve AI Tags (${pendingForTargets})`}
            title="Promote pending AI tag suggestions for selected sample(s) to manual tags"
          />
          <MenuItem
            compactHeight
            tone="accent"
            onMouseEnter={clearSubmenuHover}
            onClick={() => {
              const ids = [...targetIds];
              setContextMenu(null);
              void dismissAllAiTagSuggestions(ids);
            }}
            icon={<Ban className="w-3.5 h-3.5 text-accent-fg" />}
            label={`Dismiss AI Tags (${pendingForTargets})`}
            title="Dismiss pending AI tag suggestions for selected sample(s)"
          />
        </>
      )}
    </>
  );
};
