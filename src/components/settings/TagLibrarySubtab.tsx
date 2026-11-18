import React, { useEffect, useMemo, useState } from "react";
import { Filter, Search, Sparkles, Tag as TagIcon, X } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  deterministicColorForName,
  TAG_COLOR_PALETTE,
} from "../../constants/palettes";
import { ColorPickerPopover } from "../ColorPickerPopover";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { InspectorShell } from "./InspectorShell";
import { useMainFilterAction } from "./useMainFilterAction";

export const TagLibrarySubtab: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const tags = useSampleStore((s) => s.tags);
  const autoTagRules = useSampleStore((s) => s.autoTagRules);
  const createTag = useSampleStore((s) => s.createTag);
  const renameTag = useSampleStore((s) => s.renameTag);
  const updateTagColor = useSampleStore((s) => s.updateTagColor);
  const deleteTag = useSampleStore((s) => s.deleteTag);
  const sendFilterToMain = useMainFilterAction();

  const [tagManagerSearch, setTagManagerSearch] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [inspectorTagName, setInspectorTagName] = useState("");
  const [inspectorTagColor, setInspectorTagColor] = useState(
    TAG_COLOR_PALETTE[0]
  );
  const [confirmDeleteTagId, setConfirmDeleteTagId] = useState<number | null>(
    null
  );

  useEffect(() => {
    setSelectedTagId(null);
    setConfirmDeleteTagId(null);
  }, [activeProfileId]);

  const filteredSettingsTags = useMemo(() => {
    const q = tagManagerSearch.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, tagManagerSearch]);

  const activeInspectedTag = useMemo(() => {
    if (selectedTagId !== null) {
      const match = tags.find((t) => t.id === selectedTagId);
      if (match) return match;
    }
    return filteredSettingsTags[0] || tags[0] || null;
  }, [tags, selectedTagId, filteredSettingsTags]);

  useEffect(() => {
    if (activeInspectedTag) {
      setInspectorTagName(activeInspectedTag.name);
      setInspectorTagColor(activeInspectedTag.color);
    }
  }, [activeInspectedTag]);

  const linkedAutoRule = useMemo(() => {
    if (!activeInspectedTag) return null;
    const lower = activeInspectedTag.name.trim().toLowerCase();
    return (
      autoTagRules.find((r) => r.tag_name.trim().toLowerCase() === lower) ||
      null
    );
  }, [autoTagRules, activeInspectedTag]);

  const quickAssignNumber = useMemo(() => {
    if (!activeInspectedTag) return null;
    const idx = tags.findIndex((t) => t.id === activeInspectedTag.id);
    return idx >= 0 && idx < 9 ? idx + 1 : null;
  }, [tags, activeInspectedTag]);

  const unusedTagsCount = useMemo(
    () => tags.filter((t) => (t.sample_count || 0) === 0).length,
    [tags]
  );

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
        {/* LEFT: MASTER LIST */}
        <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
          <div className="h-[36px] px-2 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={tagManagerSearch}
                onChange={(e) => setTagManagerSearch(e.target.value)}
                placeholder="Search tags..."
                className="w-full h-[24px] rounded-xs bg-surface-2 border border-line focus:border-accent pl-8 pr-6 text-[10px] font-mono text-fg placeholder-fg-3 outline-none"
              />
              {tagManagerSearch && (
                <button
                  type="button"
                  onClick={() => setTagManagerSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <QuickCreatePopover
              title="New Tag"
              placeholder="Tag name..."
              hasColor={true}
              buttonTitle="Add Tag"
              onCreated={async (name, color) => {
                const created = await createTag(
                  name,
                  color || deterministicColorForName(name)
                );
                if (!created) return false;
                setSelectedTagId(created.id);
                setConfirmDeleteTagId(null);
                return true;
              }}
            />
          </div>

          <div className="h-[26px] px-2.5 bg-surface-sub border-b border-line flex items-center justify-between text-[9.5px] font-mono text-fg-3 font-semibold shrink-0">
            <span>TAGS ({filteredSettingsTags.length})</span>
            <span>TRACKS</span>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
            {filteredSettingsTags.length === 0 ? (
              <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
                {tags.length === 0
                  ? "No tags created yet."
                  : "No tags match filter."}
              </div>
            ) : (
              filteredSettingsTags.map((t) => {
                const isSelected = activeInspectedTag?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      setSelectedTagId(t.id);
                      setConfirmDeleteTagId(null);
                    }}
                    className={`h-[32px] px-2.5 rounded-xs flex items-center justify-between cursor-pointer text-[11px] transition-colors select-none ${
                      isSelected
                        ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
                        : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-[3px] shrink-0 shadow-xs"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="font-medium truncate text-fg">
                        {t.name}
                      </span>
                    </div>
                    <span className="font-mono text-[9.5px] text-fg-3 shrink-0 ml-2">
                      {t.sample_count.toLocaleString()}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: TAG INSPECTOR */}
        <InspectorShell
          icon={<TagIcon className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
          title="TAG INSPECTOR"
          hasItem={Boolean(activeInspectedTag)}
          itemName={activeInspectedTag?.name}
          itemDotColor={activeInspectedTag?.color}
          onFilter={
            activeInspectedTag
              ? () =>
                  sendFilterToMain({
                    kind: "tag",
                    id: activeInspectedTag.id,
                    label: activeInspectedTag.name,
                  })
              : undefined
          }
          filterTitle={
            activeInspectedTag
              ? `Filter sample table by "${activeInspectedTag.name}"`
              : undefined
          }
          canDelete={Boolean(activeInspectedTag)}
          isConfirmingDelete={
            Boolean(activeInspectedTag) &&
            confirmDeleteTagId === activeInspectedTag?.id
          }
          onRequestDelete={() =>
            activeInspectedTag && setConfirmDeleteTagId(activeInspectedTag.id)
          }
          onConfirmDelete={async () => {
            if (!activeInspectedTag) return;
            setConfirmDeleteTagId(null);
            await deleteTag(activeInspectedTag.id);
          }}
          onCancelDelete={() => setConfirmDeleteTagId(null)}
          deleteTitle="Delete tag"
          bodyClassName="flex-1 overflow-y-auto space-y-3 p-3 min-h-0 flex flex-col"
          emptyState={
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-fg-3">
              <TagIcon className="w-8 h-8 opacity-40 text-accent-fg" />
              <div className="text-[11px] font-mono">No tag selected.</div>
              <div className="text-[9.5px] font-mono text-fg-3 max-w-[200px]">
                Select a tag from the left list to view or edit details.
              </div>
            </div>
          }
        >
          {activeInspectedTag && (
            <>
              {/* Top Stat Bar */}
              <div className="h-[34px] px-3 bg-surface-soft border border-line rounded-xs flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                  LINKED TRACKS
                </span>
                <span className="font-mono text-[13px] font-bold text-accent-fg tabular-nums">
                  {activeInspectedTag.sample_count.toLocaleString()}
                </span>
              </div>

              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
                    NAME
                  </label>
                  <input
                    type="text"
                    value={inspectorTagName}
                    onChange={(e) => setInspectorTagName(e.target.value)}
                    onBlur={async () => {
                      const clean = inspectorTagName.trim();
                      if (clean && clean !== activeInspectedTag.name) {
                        await renameTag(activeInspectedTag.id, clean);
                      } else {
                        setInspectorTagName(activeInspectedTag.name);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setInspectorTagName(activeInspectedTag.name);
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-full h-[28px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-mono text-fg outline-none rounded-xs transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-fg-3 uppercase tracking-wider block font-semibold">
                    COLOR
                  </label>
                  <div className="h-[28px] px-2 flex items-center space-x-2 bg-surface-2 border border-line rounded-xs">
                    <ColorPickerPopover
                      color={inspectorTagColor}
                      onChange={async (newColor) => {
                        setInspectorTagColor(newColor);
                        await updateTagColor(activeInspectedTag.id, newColor);
                      }}
                      triggerSize="xs"
                      align="right"
                      title="Change Color (16M Colors)"
                    />
                    <span className="font-mono text-[10.5px] font-semibold text-fg uppercase">
                      {inspectorTagColor}
                    </span>
                  </div>
                </div>
              </div>

              {/* Linked Auto-Tag Rule Summary */}
              <div className="bg-surface-soft border border-line rounded-xs p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-1.5">
                    <Sparkles className="w-3 h-3 text-accent-fg shrink-0" />
                    <span className="text-[9.5px] font-mono font-semibold uppercase tracking-wider text-fg-3">
                      LINKED AUTO-TAG RULE
                    </span>
                  </div>
                  {linkedAutoRule ? (
                    <div className="flex items-center space-x-1">
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-xs bg-surface-2 border border-line text-fg-2">
                        {linkedAutoRule.category || "SFX"}
                      </span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.2 rounded-xs border font-semibold ${
                          linkedAutoRule.enabled
                            ? "bg-accent-soft border-accent/50 text-accent-fg"
                            : "bg-surface-2 border-line text-fg-3"
                        }`}
                      >
                        {linkedAutoRule.enabled ? "ON" : "OFF"}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[9px] font-mono text-fg-3">
                      Manual / AI
                    </span>
                  )}
                </div>

                {linkedAutoRule ? (
                  <p className="text-[10px] font-mono text-fg-2 leading-relaxed line-clamp-3">
                    {(linkedAutoRule.keywords || []).join(", ") ||
                      "No keywords configured."}
                  </p>
                ) : (
                  <p className="text-[10.5px] text-fg-3 leading-relaxed">
                    No keyword auto-rule targets &ldquo;{activeInspectedTag.name}
                    &rdquo;. Switch to <strong className="text-fg-2">Rules</strong>{" "}
                    above to automate it.
                  </p>
                )}
              </div>

              {/* Quick Info & Action CTA */}
              <div className="mt-auto pt-2 border-t border-line-subtle space-y-2 shrink-0">
                <div className="flex items-center justify-between text-[10px] font-mono text-fg-3">
                  <span>
                    {quickAssignNumber !== null
                      ? `Quick key: #${quickAssignNumber}`
                      : `Tag rank: #${
                          tags.findIndex(
                            (t) => t.id === activeInspectedTag.id
                          ) + 1
                        } / ${tags.length}`}
                  </span>
                  {unusedTagsCount > 0 && (
                    <span>{unusedTagsCount} unused (0 tracks)</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    sendFilterToMain({
                      kind: "tag",
                      id: activeInspectedTag.id,
                      label: activeInspectedTag.name,
                    })
                  }
                  className="w-full h-[28px] px-3 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg rounded-xs inline-flex items-center justify-center space-x-1.5 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <Filter className="w-3 h-3 text-accent-fg shrink-0" />
                  <span>Filter tracks by &ldquo;{activeInspectedTag.name}&rdquo;</span>
                </button>
              </div>
            </>
          )}
        </InspectorShell>
      </div>
    </div>
  );
};
