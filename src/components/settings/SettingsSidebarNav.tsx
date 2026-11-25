import React from "react";
import {
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
import { APP_VERSION } from "../../constants/appInfo";
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
}) => (
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

    <div className="px-3.5 py-2 border-t border-line-subtle flex items-center justify-between font-mono text-[10px] text-fg-3 shrink-0 select-text">
      <span>Audify</span>
      <span className="tabular-nums">v{APP_VERSION}</span>
    </div>
  </div>
);
