import React, { useEffect, useMemo, useState } from "react";
import {
  FileCheck2,
  Folder,
  FolderTree,
  Keyboard,
  Layers,
  Music,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Tag as TagIcon,
  Undo2,
  Zap,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  resolveFacetDomain,
  resolveTagFacetSlug,
} from "../../utils/taxonomyTree";
import { ModernToggleSwitch } from "./ModernToggleSwitch";
import { SettingsProfileMenus } from "./SettingsProfileMenus";

interface SubTabOption<T extends string> {
  id: T;
  label: string;
  count: number;
  Icon: React.FC<{ className?: string }>;
}

function HeaderSubTabSwitcher<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly [SubTabOption<T>, SubTabOption<T>];
}) {
  return (
    <div className="w-[184px] h-[24px] flex items-center bg-surface-2 p-0.5 rounded-xs border border-line shrink-0 justify-self-center">
      {options.map(({ id, label, count, Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex-1 h-[20px] justify-center font-mono text-[10px] rounded-xs flex items-center space-x-1 transition-all ${
              active
                ? "bg-accent-soft text-accent-fg border border-accent font-semibold"
                : "text-fg-2 hover:text-fg border border-transparent"
            }`}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span>{label}</span>
            <span className="text-[9px] opacity-80">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

interface SettingsSectionHeaderProps {
  collectionsSubTab: "list" | "templates";
  setCollectionsSubTab: (tab: "list" | "templates") => void;
  tagsSubTab: "rules" | "library";
  setTagsSubTab: (tab: "rules" | "library") => void;
  onClearShortcutRecording: () => void;
}

export const SettingsSectionHeader: React.FC<SettingsSectionHeaderProps> = ({
  collectionsSubTab,
  setCollectionsSubTab,
  tagsSubTab,
  setTagsSubTab,
  onClearShortcutRecording,
}) => {
  const settingsTab = useSampleStore((s) => s.settingsTab);
  const profilesCount = useSampleStore((s) => s.profiles.length);
  const activeProfile = useSampleStore((s) => s.activeProfile);
  const libraries = useSampleStore((s) => s.libraries);
  const librariesCount = libraries.length;
  const totalSamplesCount = useSampleStore((s) => s.samples.length);
  const isScanning = useSampleStore((s) => s.isScanning);
  const collections = useSampleStore((s) => s.collections);
  const collectionTemplatesCount = useSampleStore(
    (s) => s.collectionTemplates.length
  );
  const autoTagRulesCount = useSampleStore((s) => s.autoTagRules.length);
  const autoTagRules = useSampleStore((s) => s.autoTagRules);
  const autoTagCategories = useSampleStore((s) => s.autoTagCategories);
  const autoTagRulesDirty = useSampleStore((s) => s.autoTagRulesDirty);
  const autoTagImpactPreview = useSampleStore((s) => s.autoTagImpactPreview);
  const canUndoAutoTagApply = useSampleStore((s) => s.canUndoAutoTagApply);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const tags = useSampleStore((s) => s.tags);
  const genres = useSampleStore((s) => s.genres);
  const isDetectingGenres = useSampleStore((s) => s.isDetectingGenres);
  const licenseGroupsCount = useSampleStore((s) => s.licenseGroups.length);
  const enableLicensesSystem = useSampleStore((s) => s.enableLicensesSystem);
  const trashedCount = useSampleStore((s) => s.trashedCount);
  const aiReady = useSampleStore((s) => Boolean(s.aiModelStatus?.ready));

  const rebuildAllLibraries = useSampleStore((s) => s.rebuildAllLibraries);
  const addAndScanFolder = useSampleStore((s) => s.addAndScanFolder);
  const resetCollectionTemplates = useSampleStore(
    (s) => s.resetCollectionTemplates
  );
  const reapplyAutoTagRules = useSampleStore((s) => s.reapplyAutoTagRules);
  const refreshAutoTagImpactPreview = useSampleStore(
    (s) => s.refreshAutoTagImpactPreview
  );
  const undoLastAutoTagApply = useSampleStore((s) => s.undoLastAutoTagApply);
  const resetAutoTagRules = useSampleStore((s) => s.resetAutoTagRules);
  const autoDetectGenres = useSampleStore((s) => s.autoDetectGenres);
  const setEnableLicensesSystem = useSampleStore(
    (s) => s.setEnableLicensesSystem
  );
  const resetShortcuts = useSampleStore((s) => s.resetShortcuts);

  const [isApplyingRules, setIsApplyingRules] = useState(false);
  const [isUndoingRules, setIsUndoingRules] = useState(false);

  useEffect(() => {
    if (settingsTab !== "tags" || tagsSubTab !== "rules") return;
    if (!autoTagRulesDirty) return;
    const timer = window.setTimeout(() => {
      void refreshAutoTagImpactPreview();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [
    settingsTab,
    tagsSubTab,
    autoTagRulesDirty,
    autoTagRules,
    autoTagCategories,
    refreshAutoTagImpactPreview,
  ]);

  const { tagsCount, genresCount } = useMemo(() => {
    let tCount = 0;
    let gCount = 0;
    for (const t of tags) {
      const domain = resolveFacetDomain(
        resolveTagFacetSlug(t, tagFacets),
        tagFacets
      );
      if (domain === "genres") gCount += 1;
      else tCount += 1;
    }
    return {
      tagsCount: tCount,
      genresCount: gCount > 0 ? gCount : genres.length,
    };
  }, [tags, tagFacets, genres.length]);

  const rootCollectionsCount = useMemo(
    () => collections.reduce((acc, c) => (c.parent_id ? acc : acc + 1), 0),
    [collections]
  );
  const totalIndexedInLibraries = useMemo(
    () =>
      libraries.reduce((sum, l) => sum + (l.sample_count || 0), 0) ||
      totalSamplesCount,
    [libraries, totalSamplesCount]
  );

  const tabHeaderMeta = {
    profiles: { Icon: Layers, title: "Profiles", badge: profilesCount },
    appearance: {
      Icon: Palette,
      title: "Appearance",
      badge: activeProfile?.name || "Default",
    },
    audio: { Icon: Sliders, title: "Audio", badge: null },
    ai: {
      Icon: Sparkles,
      title: "AI",
      badge: aiReady ? "READY" : "OFFLINE SETUP",
    },
    libraries: { Icon: Folder, title: "Libraries", badge: librariesCount },
    collections: {
      Icon: FolderTree,
      title: "Collections",
      badge: rootCollectionsCount,
    },
    tags: { Icon: TagIcon, title: "Tags & Rules", badge: tagsCount },
    genres: { Icon: Music, title: "Genres", badge: genresCount },
    licenses: {
      Icon: FileCheck2,
      title: "Licenses",
      badge: licenseGroupsCount,
    },
    shortcuts: { Icon: Keyboard, title: "Shortcuts", badge: null },
    advanced: {
      Icon: ShieldAlert,
      title: "Advanced & File Safety",
      badge: null,
    },
  }[settingsTab];
  const HeaderIcon = tabHeaderMeta.Icon;
  const hasSubTabs = settingsTab === "collections" || settingsTab === "tags";

  return (
    <div
      className={
        hasSubTabs
          ? "h-[42px] px-4 border-b border-line bg-surface-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center gap-3 shrink-0"
          : "h-[42px] px-4 border-b border-line bg-surface-1 flex items-center justify-between gap-3 shrink-0"
      }
    >
      {/* Left: Active Tab Icon + Title + Contextual Badge */}
      <div
        className={`flex items-center space-x-2 min-w-0 ${
          hasSubTabs ? "justify-self-start max-w-full" : ""
        }`}
      >
        <HeaderIcon className="w-4 h-4 text-accent-fg shrink-0" />
        <h3 className="text-[13px] font-semibold text-fg truncate">
          {tabHeaderMeta.title}
        </h3>
        {tabHeaderMeta.badge !== null && (
          <span className="text-[10px] font-mono text-fg-2 bg-surface-2 px-1.5 py-0.5 rounded-xs border border-line shrink-0">
            {tabHeaderMeta.badge}
          </span>
        )}
        {settingsTab === "libraries" && totalIndexedInLibraries > 0 && (
          <span className="text-[10.5px] font-mono text-fg-2 shrink-0 ml-1">
            {totalIndexedInLibraries.toLocaleString()} samples
          </span>
        )}
        {settingsTab === "advanced" && trashedCount > 0 && (
          <span className="text-[10px] font-mono text-accent-fg bg-accent-soft px-1.5 py-0.5 rounded-xs border border-accent/40 shrink-0">
            {trashedCount} in Trash
          </span>
        )}
      </div>

      {/* Center (Fixed-position grid track on Collections & Tags & Rules — never overlaps right controls) */}
      {settingsTab === "collections" && (
        <HeaderSubTabSwitcher
          value={collectionsSubTab}
          onChange={setCollectionsSubTab}
          options={[
            { id: "list", label: "List", count: rootCollectionsCount, Icon: Folder },
            {
              id: "templates",
              label: "Templates",
              count: collectionTemplatesCount,
              Icon: Zap,
            },
          ]}
        />
      )}

      {settingsTab === "tags" && (
        <HeaderSubTabSwitcher
          value={tagsSubTab}
          onChange={setTagsSubTab}
          options={[
            { id: "library", label: "Library", count: tagsCount, Icon: TagIcon },
            {
              id: "rules",
              label: "Rules",
              count: autoTagRulesCount,
              Icon: Sparkles,
            },
          ]}
        />
      )}

      {/* Right: Tab-Specific Compact Header Controls */}
      <div
        className={`flex items-center space-x-1.5 shrink-0 ${
          hasSubTabs ? "justify-self-end" : ""
        }`}
      >
        {settingsTab === "profiles" && (
          <SettingsProfileMenus activeProfileId={activeProfile?.id} />
        )}

        {settingsTab === "libraries" && (
          <>
            <button
              type="button"
              onClick={() => void rebuildAllLibraries()}
              disabled={isScanning || librariesCount === 0}
              className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs inline-flex items-center space-x-1.5 text-[11px] font-medium disabled:opacity-40 transition-colors cursor-pointer"
              title="Rebuild all 600-bin waveforms & re-apply auto-tags"
            >
              <RotateCcw
                className={`w-3 h-3 shrink-0 ${isScanning ? "animate-spin" : ""}`}
              />
              <span>Sync all</span>
            </button>
            <button
              type="button"
              onClick={() => void addAndScanFolder()}
              disabled={isScanning}
              className="h-[24px] px-2.5 bg-accent hover:bg-accent-hover text-accent-on rounded-xs inline-flex items-center space-x-1 text-[11px] font-semibold disabled:opacity-50 shrink-0 shadow-xs cursor-pointer"
              title="Add & index audio library folder"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Add Library</span>
            </button>
          </>
        )}

        {settingsTab === "collections" && collectionsSubTab === "templates" && (
          <button
            type="button"
            onClick={() => void resetCollectionTemplates()}
            className="h-[24px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent text-fg-2 hover:text-fg inline-flex items-center space-x-1 text-[11px] font-medium transition-colors shrink-0 cursor-pointer"
            title="Reset collection sub-folder templates to defaults"
          >
            <RotateCcw className="w-3 h-3 shrink-0" />
            <span>Reset</span>
          </button>
        )}

        {settingsTab === "tags" && tagsSubTab === "rules" && (
          <div className="flex items-center space-x-1.5 shrink-0">
            {autoTagRulesDirty && autoTagImpactPreview && (
              <span
                data-testid="auto-tag-impact-badge"
                className="h-[24px] px-2 rounded-xs bg-surface-2 border border-line font-mono tabular-nums text-[10px] text-fg-2 inline-flex items-center gap-1.5 shrink-0"
                title={`Pending rule impact: ${autoTagImpactPreview.affected_samples.toLocaleString()} sample(s) affected (+${autoTagImpactPreview.added_links.toLocaleString()} added, -${autoTagImpactPreview.removed_links.toLocaleString()} removed)`}
              >
                <span>
                  ~{autoTagImpactPreview.affected_samples.toLocaleString()}
                </span>
                <span className="text-accent-fg font-semibold">
                  +{autoTagImpactPreview.added_links.toLocaleString()}
                </span>
                {autoTagImpactPreview.removed_links > 0 && (
                  <span className="text-fg-3">
                    -{autoTagImpactPreview.removed_links.toLocaleString()}
                  </span>
                )}
              </span>
            )}
            {canUndoAutoTagApply && (
              <button
                type="button"
                disabled={isUndoingRules || isApplyingRules}
                onClick={async () => {
                  try {
                    setIsUndoingRules(true);
                    await undoLastAutoTagApply();
                  } finally {
                    setIsUndoingRules(false);
                  }
                }}
                className="h-[24px] px-2 inline-flex items-center space-x-1 bg-surface-2 hover:bg-accent-soft hover:border-accent border border-line text-fg-2 hover:text-accent-fg rounded-xs text-[11px] font-medium transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                title="Revert the most recent Apply Rules auto-tag changes"
              >
                <Undo2 className="w-3 h-3 shrink-0" />
                <span>Undo</span>
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  setIsApplyingRules(true);
                  await reapplyAutoTagRules();
                } finally {
                  setIsApplyingRules(false);
                }
              }}
              disabled={isApplyingRules || isUndoingRules}
              className={`h-[24px] px-2.5 inline-flex items-center space-x-1.5 bg-accent hover:bg-accent-hover text-accent-on rounded-xs text-[11px] font-semibold transition-colors disabled:opacity-50 shrink-0 shadow-xs cursor-pointer ${
                autoTagRulesDirty ? "ring-1 ring-warn" : ""
              }`}
              title={
                autoTagRulesDirty
                  ? autoTagImpactPreview
                    ? `Pending changes affect ${autoTagImpactPreview.affected_samples.toLocaleString()} sample(s) (+${autoTagImpactPreview.added_links.toLocaleString()} / -${autoTagImpactPreview.removed_links.toLocaleString()}) — click to apply`
                    : "Rule or category scope changes pending — click to re-evaluate library samples"
                  : "Re-evaluate all library files against auto-tag rules"
              }
            >
              <RefreshCw
                className={`w-3 h-3 shrink-0 ${
                  isApplyingRules ? "animate-spin" : ""
                }`}
              />
              <span>Apply rules</span>
              {autoTagRulesDirty && !isApplyingRules && (
                <span className="w-1.5 h-1.5 rounded-[2px] bg-warn shrink-0" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void resetAutoTagRules()}
              className="h-[24px] px-2 inline-flex items-center space-x-1 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs text-[11px] font-medium transition-colors shrink-0 cursor-pointer"
              title="Reset to default auto-tag rules"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span>Reset</span>
            </button>
          </div>
        )}

        {settingsTab === "genres" && (
          <button
            type="button"
            onClick={() => void autoDetectGenres()}
            disabled={isDetectingGenres}
            className={`h-[24px] px-2.5 rounded-xs border inline-flex items-center space-x-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              isDetectingGenres
                ? "bg-accent-soft border-accent text-accent-fg animate-pulse"
                : "bg-accent hover:bg-accent-hover border-accent text-accent-on shadow-xs"
            }`}
            title="Auto-Detect Genres from Metadata & Folder Names"
          >
            <Sparkles className="w-3 h-3 shrink-0" />
            <span>Auto-assign</span>
          </button>
        )}

        {settingsTab === "licenses" && (
          <div className="flex items-center space-x-2">
            <span className="text-[11px] text-fg-2">
              Credits in Session Bin
            </span>
            <ModernToggleSwitch
              checked={enableLicensesSystem}
              onChange={setEnableLicensesSystem}
              title="Enable or disable Licensing & Attribution System (Sidebar tab, right-click Copy Credits, Ctrl+Shift+C)"
            />
          </div>
        )}

        {settingsTab === "shortcuts" && (
          <button
            type="button"
            onClick={() => {
              onClearShortcutRecording();
              resetShortcuts();
            }}
            className="h-[24px] px-2.5 inline-flex items-center space-x-1.5 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs text-[11px] font-medium transition-colors cursor-pointer"
            title="Reset all shortcuts to defaults"
          >
            <RotateCcw className="w-3 h-3 shrink-0" />
            <span>Reset to defaults</span>
          </button>
        )}

        {settingsTab === "ai" && (
          <span
            className="h-[22px] px-2 inline-flex items-center space-x-1 bg-surface-2 border border-line rounded-xs font-mono text-[10px] text-fg-2"
            title="100% local ONNX Runtime execution. Audio waveforms never leave your machine."
          >
            <ShieldCheck className="w-3 h-3 text-ok shrink-0" />
            <span>LOCAL ONLY · NO CLOUD</span>
          </span>
        )}
      </div>
    </div>
  );
};
