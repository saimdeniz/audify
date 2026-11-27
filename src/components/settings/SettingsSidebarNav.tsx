import React from "react";
import {
  ArrowUpRight,
  ExternalLink,
  FileCheck2,
  Folder,
  FolderTree,
  Keyboard,
  Layers,
  Music,
  Palette,
  ShieldAlert,
  Sliders,
  Sparkles,
  Tag as TagIcon,
} from "lucide-react";
import {
  APP_VERSION,
  AUDIFY_RELEASES_LATEST_URL,
} from "../../constants/appInfo";
import { useAppUpdate } from "../../hooks/useAppUpdate";
import { openAudifyReleasesPage } from "../../services/updateCheckService";
import { SettingsTab } from "../../store/useSampleStore";

type SettingsNavItem = {
  id: SettingsTab;
  label: string;
  Icon: React.FC<{ className?: string }>;
};

type SettingsNavGroup = {
  title: string;
  items: readonly SettingsNavItem[];
};

const NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    title: "GENERAL",
    items: [
      { id: "profiles", label: "Profiles", Icon: Layers },
      { id: "appearance", label: "Appearance", Icon: Palette },
      { id: "audio", label: "Audio", Icon: Sliders },
    ],
  },
  {
    title: "LIBRARY & TAGS",
    items: [
      { id: "libraries", label: "Libraries", Icon: Folder },
      { id: "collections", label: "Collections", Icon: FolderTree },
      { id: "tags", label: "Tags & Rules", Icon: TagIcon },
      { id: "genres", label: "Genres", Icon: Music },
      { id: "licenses", label: "Licenses", Icon: FileCheck2 },
    ],
  },
  {
    title: "LOCAL AI",
    items: [{ id: "ai", label: "AI", Icon: Sparkles }],
  },
  {
    title: "SYSTEM",
    items: [
      { id: "shortcuts", label: "Shortcuts", Icon: Keyboard },
      { id: "advanced", label: "Advanced", Icon: ShieldAlert },
    ],
  },
];

interface SettingsSidebarNavProps {
  settingsTab: SettingsTab;
  enableLicensesSystem: boolean;
  enableAdvancedFileOps: boolean;
  onSelectTab: (tab: SettingsTab) => void;
}

export const SettingsSidebarNav: React.FC<SettingsSidebarNavProps> = ({
  settingsTab,
  enableLicensesSystem,
  enableAdvancedFileOps,
  onSelectTab,
}) => {
  const { info } = useAppUpdate();
  const hasUpdate = Boolean(info?.has_update && info.latest_version);

  return (
  <div className="w-[184px] bg-surface-1 border-r border-line flex flex-col shrink-0 min-h-0">
    <div className="flex-1 p-2 overflow-y-auto space-y-2.5 min-h-0">
      {NAV_GROUPS.map((group, groupIndex) => (
        <div
          key={group.title}
          className={
            groupIndex > 0 ? "pt-2 border-t border-line-subtle space-y-0.5" : "space-y-0.5"
          }
        >
          <div className="px-2.5 pb-1">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-fg-3">
              {group.title}
            </span>
          </div>

          {group.items.map((tab) => {
            const active = settingsTab === tab.id;
            const Icon = tab.Icon;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelectTab(tab.id)}
                className={`w-full h-[30px] px-2.5 rounded-sm text-left text-[12px] flex items-center justify-between border-l-2 whitespace-nowrap transition-colors ${
                  active
                    ? "bg-accent-soft text-accent-fg border-accent font-medium"
                    : "text-fg-2 hover:bg-surface-hover hover:text-fg border-transparent"
                }`}
              >
                <span className="flex items-center space-x-2 truncate">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </span>
                {tab.id === "licenses" && enableLicensesSystem && (
                  <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
                )}
                {tab.id === "advanced" && enableAdvancedFileOps && (
                  <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>

    {hasUpdate && info && (
      <div className="px-2 pt-2 shrink-0">
        <button
          type="button"
          onClick={() => void openAudifyReleasesPage(info.release_url)}
          title={`Download Audify v${info.latest_version} on GitHub Releases`}
          className="w-full h-[24px] px-2 rounded-[3px] bg-accent-soft hover:bg-accent border border-accent text-accent-fg hover:text-accent-on font-mono text-[10px] font-semibold flex items-center justify-between transition-colors cursor-pointer"
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <ArrowUpRight className="w-3 h-3 shrink-0" />
            <span className="truncate">Update · v{info.latest_version}</span>
          </span>
        </button>
      </div>
    )}

    <div className="px-3.5 py-2 border-t border-line-subtle flex items-center justify-between font-mono text-[10px] text-fg-3 shrink-0">
      <span>Audify</span>
      <button
        type="button"
        onClick={() => void openAudifyReleasesPage(AUDIFY_RELEASES_LATEST_URL)}
        title="Open latest Audify release on GitHub (github.com/saimdeniz/audify)"
        className="group inline-flex items-center gap-1 tabular-nums text-fg-3 hover:text-accent-fg transition-colors cursor-pointer"
      >
        <span>v{APP_VERSION}</span>
        <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 shrink-0" />
      </button>
    </div>
  </div>
  );
};
