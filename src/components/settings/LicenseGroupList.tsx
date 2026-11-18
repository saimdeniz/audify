import React from "react";
import { Folder, Search, X } from "lucide-react";
import { LicenseGroup } from "../../types";
import { QuickCreatePopover } from "../QuickCreatePopover";

interface LicenseGroupListProps {
  search: string;
  onSearchChange: (val: string) => void;
  filteredGroups: LicenseGroup[];
  totalGroupsCount: number;
  countsByGroup: Record<string, number>;
  activeGroupId: string | null;
  onSelectGroup: (id: string) => void;
  onCreateGroup: (name: string) => Promise<boolean>;
}

export const LicenseGroupList: React.FC<LicenseGroupListProps> = ({
  search,
  onSearchChange,
  filteredGroups,
  totalGroupsCount,
  countsByGroup,
  activeGroupId,
  onSelectGroup,
  onCreateGroup,
}) => {
  return (
    <div className="bg-surface-1 border border-line rounded-md flex flex-col min-h-0 overflow-hidden">
      <div className="h-[36px] px-2 bg-surface-header border-b border-line flex items-center justify-between gap-1.5 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search artists..."
            className="w-full h-[24px] rounded-xs bg-surface-2 border border-line focus:border-accent pl-8 pr-6 text-[10px] font-mono text-fg placeholder-fg-3 outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <QuickCreatePopover
          title="New Artist Group"
          placeholder="Artist / group name..."
          hasColor={false}
          buttonTitle="Add Artist Group"
          onCreated={(name) => onCreateGroup(name)}
        />
      </div>

      <div className="h-[26px] px-2.5 bg-surface-sub border-b border-line flex items-center justify-between text-[9.5px] font-mono text-fg-3 font-semibold shrink-0">
        <span>ARTIST GROUPS ({filteredGroups.length})</span>
        <span>TRACKS</span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
        {filteredGroups.length === 0 ? (
          <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
            {totalGroupsCount === 0
              ? "No artist groups created yet."
              : "No artist groups match search."}
          </div>
        ) : (
          filteredGroups.map((g) => {
            const isSelected = activeGroupId === g.id;
            const matchedCount = countsByGroup[g.id] ?? 0;
            const folderBadgeCount =
              g.folders.length || g.rel_folders?.length || 0;
            return (
              <div
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className={`h-[32px] px-2.5 rounded-xs flex items-center justify-between cursor-pointer text-[11px] transition-colors select-none ${
                  isSelected
                    ? "bg-surface-3 border border-accent text-fg font-semibold shadow-xs"
                    : "bg-surface-1 hover:bg-surface-2 border border-line text-fg-2 hover:text-fg"
                }`}
              >
                <div className="flex items-center space-x-2 truncate min-w-0">
                  <Folder className="w-3.5 h-3.5 text-accent-fg shrink-0" />
                  <span className="font-medium truncate text-fg">{g.name}</span>
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded-xs bg-surface-2 text-fg-3 border border-line shrink-0">
                    {folderBadgeCount}{" "}
                    {folderBadgeCount === 1 ? "folder" : "folders"}
                  </span>
                </div>
                <span className="font-mono text-[9.5px] text-fg-3 shrink-0 ml-2">
                  {matchedCount.toLocaleString()}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
