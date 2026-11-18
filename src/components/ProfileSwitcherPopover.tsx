import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Settings } from "lucide-react";
import { TAG_COLOR_PALETTE } from "../constants/palettes";
import { Z_INDEX } from "../constants/zIndex";
import { useSampleStore } from "../store/useSampleStore";
import { Profile } from "../types";

interface ProfileSwitcherPopoverProps {
  profileMenuPos: { top: number; left: number };
  profiles: Profile[];
  activeProfile: Profile | null;
  onClose: () => void;
  onSwitchProfile: (profileId: number) => Promise<void>;
  onCreateProfile: (name: string, color: string) => Promise<void>;
  onOpenManageProfiles: () => void;
}

export const ProfileSwitcherPopover: React.FC<ProfileSwitcherPopoverProps> = ({
  profileMenuPos,
  profiles,
  activeProfile,
  onClose,
  onSwitchProfile,
  onCreateProfile,
  onOpenManageProfiles,
}) => {
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileColor, setNewProfileColor] = useState(TAG_COLOR_PALETTE[0]);

  const handleQuickCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    const duplicate = profiles.some(
      (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      useSampleStore
        .getState()
        .setStatusMessage(`Profile "${trimmed}" already exists`);
      return;
    }
    await onCreateProfile(trimmed, newProfileColor);
    setNewProfileName("");
    setShowQuickCreate(false);
    onClose();
  };

  const menu = (
    <div
      data-popover-portal="true"
      data-context-menu-portal="true"
      data-mica-overlay="true"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: `${profileMenuPos.top}px`,
        left: `${profileMenuPos.left}px`,
        zIndex: Z_INDEX.floatingMenu,
      }}
      className="w-[232px] bg-surface-2 border border-line-strong rounded-md overflow-hidden py-1 shadow-2xl text-[12px] text-fg backdrop-blur-md"
    >
      <div className="px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider text-fg-head border-b border-line">
        WORKSPACE PROFILES
      </div>

      <div className="max-h-[180px] overflow-y-auto py-0.5">
        {profiles.map((p) => {
          const isCurrent = activeProfile?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onClose();
                if (!isCurrent) {
                  void onSwitchProfile(p.id);
                }
              }}
              className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between transition-colors ${
                isCurrent
                  ? "bg-accent-soft text-accent-fg font-medium"
                  : "hover:bg-surface-3 text-fg"
              }`}
            >
              <span className="flex items-center space-x-2 truncate">
                <span
                  className="w-2 h-2 rounded-[2px] inline-block shrink-0 shadow-xs"
                  style={{ backgroundColor: p.color }}
                />
                <span className="truncate">{p.name}</span>
              </span>
              {isCurrent && (
                <Check className="w-3.5 h-3.5 text-accent-fg shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      <div className="border-t border-line pt-1 mt-0.5">
        {showQuickCreate ? (
          <form
            onSubmit={handleQuickCreateProfile}
            className="px-2 py-1.5 space-y-1.5"
          >
            <div className="flex items-center space-x-1">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Profile name..."
                autoFocus
                className="flex-1 min-w-0 h-[22px] bg-surface-3 border border-line focus:border-accent px-1.5 text-[11px] text-fg outline-none rounded-xs"
              />
              <button
                type="submit"
                disabled={!newProfileName.trim()}
                className="h-[22px] px-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-on font-mono text-[10px] font-bold shrink-0 whitespace-nowrap rounded-xs"
              >
                OK
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {TAG_COLOR_PALETTE.slice(0, 8).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewProfileColor(c)}
                  className={`w-3.5 h-3.5 rounded-[3px] border shrink-0 transition-transform ${
                    newProfileColor === c
                      ? "border-fg scale-110 shadow-xs"
                      : "border-transparent opacity-80 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowQuickCreate(true)}
            className="w-full text-left px-2.5 py-1 text-[11px] font-mono text-accent-fg hover:bg-surface-3 whitespace-nowrap flex items-center space-x-1.5"
          >
            <Plus className="w-3 h-3 shrink-0" />
            <span>New Profile...</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenManageProfiles}
          className="w-full text-left px-2.5 py-1 text-[11px] font-mono text-fg-2 hover:text-fg hover:bg-surface-3 whitespace-nowrap flex items-center space-x-1.5"
        >
          <Settings className="w-3 h-3 shrink-0" />
          <span>Manage Profiles...</span>
        </button>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(menu, document.body)
    : menu;
};
