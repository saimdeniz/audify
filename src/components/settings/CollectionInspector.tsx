import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Folder, FolderTree, Sparkles, Zap } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { Collection } from "../../types";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { InlineConfirmDeleteButton } from "../common/InlineConfirmDeleteButton";
import { ThemedSelect, type ThemedSelectOption } from "../common/ThemedSelect";
import { InspectorShell } from "./InspectorShell";
import { useMainFilterAction } from "./useMainFilterAction";

interface CollectionInspectorProps {
  activeInspectedCollection: Collection | null;
  subCollections: Collection[];
  allCollections?: Collection[];
  confirmDeleteCollectionId: number | null;
  setConfirmDeleteCollectionId: (id: number | null) => void;
  onSelectCollectionId?: (id: number) => void;
}

export const CollectionInspector: React.FC<CollectionInspectorProps> = ({
  activeInspectedCollection,
  subCollections,
  allCollections = [],
  confirmDeleteCollectionId,
  setConfirmDeleteCollectionId,
  onSelectCollectionId,
}) => {
  const createCollection = useSampleStore((s) => s.createCollection);
  const renameCollection = useSampleStore((s) => s.renameCollection);
  const reparentCollection = useSampleStore((s) => s.reparentCollection);
  const deleteCollection = useSampleStore((s) => s.deleteCollection);
  const applyTemplatesToExistingCollection = useSampleStore(
    (s) => s.applyTemplatesToExistingCollection
  );
  const smartCollectionCounts = useSampleStore((s) => s.smartCollectionCounts);
  const hasSamplePool = useSampleStore((s) => s.allProfileSamples.length > 0);
  const sendFilterToMain = useMainFilterAction();

  const [inspectorCollectionName, setInspectorCollectionName] = useState("");
  const [inspectorSmartQuery, setInspectorSmartQuery] = useState("");
  const [confirmDeleteSubId, setConfirmDeleteSubId] = useState<number | null>(
    null
  );

  useEffect(() => {
    setConfirmDeleteSubId(null);
    if (activeInspectedCollection) {
      setInspectorCollectionName(activeInspectedCollection.name);
      setInspectorSmartQuery(activeInspectedCollection.smart_query || "");
    }
  }, [activeInspectedCollection]);

  const isSmartCollection = Boolean(
    activeInspectedCollection?.smart_query?.trim()
  );
  const isSubCollection = Boolean(activeInspectedCollection?.parent_id);
  const parentCollection = useMemo(
    () =>
      activeInspectedCollection?.parent_id
        ? allCollections.find(
            (c) => c.id === activeInspectedCollection.parent_id
          ) ?? null
        : null,
    [allCollections, activeInspectedCollection]
  );
  const parentOptions = useMemo<ThemedSelectOption[]>(() => {
    if (!activeInspectedCollection || isSmartCollection) return [];
    const candidates = allCollections.filter(
      (c) =>
        !c.parent_id &&
        !c.smart_query?.trim() &&
        c.id !== activeInspectedCollection.id
    );
    return [
      { value: "", label: "(Top-level Collection)" },
      ...candidates.map((c) => ({ value: String(c.id), label: c.name })),
    ];
  }, [allCollections, activeInspectedCollection, isSmartCollection]);

  const smartMatchCount = activeInspectedCollection
    ? smartCollectionCounts[activeInspectedCollection.id] ?? 0
    : 0;
  const totalLinkedTracks = activeInspectedCollection
    ? isSmartCollection
      ? smartMatchCount
      : activeInspectedCollection.sample_count +
        subCollections.reduce((acc, s) => acc + (s.sample_count || 0), 0)
    : 0;

  return (
    <InspectorShell
      icon={
        isSmartCollection ? (
          <Zap className="w-3.5 h-3.5 text-accent-fg shrink-0" />
        ) : (
          <Folder className="w-3.5 h-3.5 text-accent-fg shrink-0" />
        )
      }
      title={
        isSmartCollection
          ? "SMART COLLECTION INSPECTOR"
          : isSubCollection
          ? "SUB-COLLECTION INSPECTOR"
          : "COLLECTION INSPECTOR"
      }
      hasItem={Boolean(activeInspectedCollection)}
      itemName={
        activeInspectedCollection
          ? parentCollection
            ? `${parentCollection.name} ▸ ${activeInspectedCollection.name}`
            : activeInspectedCollection.name
          : undefined
      }
      onFilter={
        activeInspectedCollection
          ? () =>
              sendFilterToMain({
                kind: "collection",
                id: activeInspectedCollection.id,
                label: activeInspectedCollection.name,
              })
          : undefined
      }
      filterTitle={
        activeInspectedCollection
          ? `Filter sample table by "${activeInspectedCollection.name}"`
          : undefined
      }
      extraActions={
        activeInspectedCollection &&
        !isSmartCollection &&
        !isSubCollection && (
          <button
            type="button"
            onClick={() =>
              void applyTemplatesToExistingCollection(
                activeInspectedCollection.id
              )
            }
            className="w-[22px] h-[22px] rounded-xs bg-surface-2 hover:bg-surface-3 hover:text-accent-fg text-fg-2 border border-line flex items-center justify-center transition-colors cursor-pointer"
            title="Generate missing template sub-folders"
          >
            <Sparkles className="w-3 h-3" />
          </button>
        )
      }
      canDelete={Boolean(activeInspectedCollection)}
      isConfirmingDelete={
        Boolean(activeInspectedCollection) &&
        confirmDeleteCollectionId === activeInspectedCollection?.id
      }
      onRequestDelete={() =>
        activeInspectedCollection &&
        setConfirmDeleteCollectionId(activeInspectedCollection.id)
      }
      onConfirmDelete={() => {
        if (!activeInspectedCollection) return;
        void deleteCollection(activeInspectedCollection.id);
        setConfirmDeleteCollectionId(null);
      }}
      onCancelDelete={() => setConfirmDeleteCollectionId(null)}
      deleteTitle={
        activeInspectedCollection
          ? `Delete "${activeInspectedCollection.name}"`
          : undefined
      }
      bodyClassName="flex-1 overflow-y-auto space-y-3 p-3 min-h-0"
      emptyState={
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-fg-3">
          <FolderTree className="w-8 h-8 opacity-40 text-accent-fg" />
          <div className="text-[11px] font-mono">No collection selected.</div>
          <div className="text-[9.5px] font-mono text-fg-3 max-w-[200px]">
            Select a collection from the left list to view or edit details.
          </div>
        </div>
      }
    >
      {activeInspectedCollection && (
        <>
          <div className="h-[34px] px-3 bg-surface-soft border border-line rounded-xs flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                {isSmartCollection ? "MATCHES" : "LINKED TRACKS"}
              </span>
              <span className="font-mono text-[13px] font-bold text-accent-fg tabular-nums">
                {isSmartCollection && !hasSamplePool
                  ? "DYNAMIC"
                  : totalLinkedTracks.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                {isSmartCollection ? "TYPE" : "SUB-FOLDERS"}
              </span>
              <span className="font-mono text-[12px] font-bold text-fg tabular-nums">
                {isSmartCollection ? "SMART QUERY" : subCollections.length}
              </span>
            </div>
          </div>

          <div className="space-y-1 shrink-0">
            <label className="text-[10px] font-mono text-fg-3 font-semibold uppercase tracking-wider">
              NAME
            </label>
            <input
              type="text"
              value={inspectorCollectionName}
              onChange={(e) => setInspectorCollectionName(e.target.value)}
              onBlur={async () => {
                const clean = inspectorCollectionName.trim();
                if (clean && clean !== activeInspectedCollection.name) {
                  const updated = await renameCollection(
                    activeInspectedCollection.id,
                    clean,
                    activeInspectedCollection.color,
                    activeInspectedCollection.icon,
                    activeInspectedCollection.rule_path,
                    isSmartCollection
                      ? activeInspectedCollection.smart_query
                      : undefined
                  );
                  if (!updated) {
                    setInspectorCollectionName(activeInspectedCollection.name);
                  }
                } else {
                  setInspectorCollectionName(activeInspectedCollection.name);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setInspectorCollectionName(activeInspectedCollection.name);
                  e.currentTarget.blur();
                }
              }}
              className="w-full h-[26px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-medium text-fg outline-none rounded-xs font-mono"
            />
          </div>

          {!isSmartCollection &&
            subCollections.length === 0 &&
            parentOptions.length > 1 && (
              <div className="space-y-1 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] font-mono text-fg-3 font-semibold uppercase tracking-wider">
                    PARENT COLLECTION
                  </label>
                  {isSubCollection && (
                    <button
                      type="button"
                      onClick={() =>
                        void reparentCollection(activeInspectedCollection.id, null)
                      }
                      className="h-[18px] px-1.5 rounded-[2px] bg-surface-2 hover:bg-accent-soft border border-line hover:border-accent text-[9px] font-mono text-fg-2 hover:text-accent-fg inline-flex items-center gap-0.5 transition-colors cursor-pointer"
                      title="Promote back to top-level collection"
                    >
                      <ArrowUpRight className="w-2.5 h-2.5" />
                      <span>Promote to Root</span>
                    </button>
                  )}
                </div>
                <ThemedSelect
                  value={
                    activeInspectedCollection.parent_id
                      ? String(activeInspectedCollection.parent_id)
                      : ""
                  }
                  options={parentOptions}
                  ariaLabel="Parent Collection"
                  onChange={(val) => {
                    void reparentCollection(
                      activeInspectedCollection.id,
                      val ? Number(val) : null
                    );
                  }}
                />
              </div>
            )}

          {isSmartCollection ? (
            <div className="space-y-1.5 pt-2 border-t border-line">
              <div className="h-[24px] flex items-center justify-between">
                <label className="text-[10px] font-mono text-fg-3 font-semibold uppercase tracking-wider">
                  SMART SEARCH QUERY
                </label>
              </div>
              <input
                type="text"
                value={inspectorSmartQuery}
                onChange={(e) => setInspectorSmartQuery(e.target.value)}
                onBlur={async () => {
                  const clean = inspectorSmartQuery.trim();
                  const currentQuery = (
                    activeInspectedCollection.smart_query || ""
                  ).trim();
                  if (!clean) {
                    setInspectorSmartQuery(currentQuery);
                    return;
                  }
                  if (clean !== currentQuery) {
                    const updated = await renameCollection(
                      activeInspectedCollection.id,
                      activeInspectedCollection.name,
                      activeInspectedCollection.color,
                      activeInspectedCollection.icon,
                      null,
                      clean
                    );
                    if (!updated) {
                      setInspectorSmartQuery(currentQuery);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setInspectorSmartQuery(
                      activeInspectedCollection.smart_query || ""
                    );
                    e.currentTarget.blur();
                  }
                }}
                placeholder='e.g. kick -loop bpm:120-130 <3s'
                className="w-full h-[28px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-mono text-fg placeholder-fg-3 outline-none rounded-xs"
              />
              <div className="text-[9.5px] font-mono text-fg-3 leading-relaxed">
                Supports Smart Search syntax:{" "}
                <span className="text-fg-2">
                  "exact", -exclude, OR, bpm:120-130, key:~8A, &lt;3s, tag:kick, ext:wav
                </span>
              </div>
            </div>
          ) : isSubCollection ? (
            <div className="pt-2 border-t border-line text-[10px] font-mono text-fg-3">
              Sub-folder under{" "}
              {parentCollection ? (
                <button
                  type="button"
                  onClick={() => onSelectCollectionId?.(parentCollection.id)}
                  className="text-accent-fg hover:underline cursor-pointer"
                >
                  {parentCollection.name}
                </button>
              ) : (
                "parent collection"
              )}
              . Drag to the COLLECTIONS header or use Parent Collection above to
              promote to top level.
            </div>
          ) : (
            <div className="space-y-1.5 pt-2 border-t border-line">
            <div className="h-[24px] flex items-center justify-between">
              <label className="text-[10px] font-mono text-fg-3 font-semibold uppercase tracking-wider">
                SUB-FOLDERS ({subCollections.length})
              </label>
              <QuickCreatePopover
                title="New Sub-folder"
                placeholder="Sub-folder name..."
                hasColor={false}
                buttonTitle="Add Sub-folder"
                buttonClassName="w-[20px] h-[20px] bg-accent hover:bg-accent-hover text-accent-on rounded-xs flex items-center justify-center shrink-0 shadow-xs transition-colors cursor-pointer"
                onCreated={async (clean) => {
                  const created = await createCollection(
                    clean,
                    undefined,
                    undefined,
                    activeInspectedCollection.id
                  );
                  return Boolean(created);
                }}
              />
            </div>

            <div className="space-y-1 max-h-[160px] overflow-y-auto pr-0.5">
              {subCollections.length === 0 ? (
                <div className="p-3 text-center text-[10px] text-fg-3 font-mono border border-dashed border-line rounded-xs">
                  No sub-folders yet.
                </div>
              ) : (
                subCollections.map((sub) => (
                  <div
                    key={sub.id}
                    className="h-[26px] px-2 rounded-xs bg-surface-2 border border-line flex items-center justify-between gap-1.5 text-[10.5px]"
                  >
                    <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                      <Folder className="w-3 h-3 text-fg-3 shrink-0" />
                      <input
                        type="text"
                        defaultValue={sub.name}
                        key={`${sub.id}-${sub.name}`}
                        onBlur={async (e) => {
                          const inputEl = e.currentTarget;
                          const v = inputEl.value.trim();
                          if (v && v !== sub.name) {
                            const updated = await renameCollection(
                              sub.id,
                              v,
                              sub.color,
                              sub.icon,
                              sub.rule_path
                            );
                            if (!updated) {
                              inputEl.value = sub.name;
                            }
                          } else {
                            inputEl.value = sub.name;
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.value = sub.name;
                            e.currentTarget.blur();
                          }
                        }}
                        className="bg-transparent border-b border-transparent hover:border-line focus:border-accent text-[10.5px] font-medium text-fg outline-none flex-1 min-w-0 truncate"
                        title={sub.name}
                      />
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      <span className="font-mono text-[9px] text-fg-3">
                        {sub.sample_count}
                      </span>
                      <InlineConfirmDeleteButton
                        size="xs"
                        isConfirming={confirmDeleteSubId === sub.id}
                        onRequest={() => setConfirmDeleteSubId(sub.id)}
                        onConfirm={() => {
                          setConfirmDeleteSubId(null);
                          void deleteCollection(sub.id);
                        }}
                        onCancel={() => setConfirmDeleteSubId(null)}
                        deleteTitle="Delete sub-folder"
                        confirmTitle="Confirm delete sub-folder"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          )}
        </>
      )}
    </InspectorShell>
  );
};
