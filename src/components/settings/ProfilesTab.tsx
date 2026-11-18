import React, { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Pencil,
  Trash2,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { deterministicColorForName } from "../../constants/palettes";
import { Profile } from "../../types";
import { ColorPickerPopover } from "../ColorPickerPopover";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { InlineConfirmRowBar } from "../common/InlineConfirmDeleteButton";
import { ProfileBackupsCard } from "./ProfileBackupsCard";

function buildUniqueProfileCopyName(baseName: string, profiles: Profile[]): string {
  const existing = new Set(profiles.map((p) => p.name.trim().toLowerCase()));
  const firstCandidate = `${baseName} Copy`;
  if (!existing.has(firstCandidate.toLowerCase())) {
    return firstCandidate;
  }
  let counter = 2;
  while (existing.has(`${baseName} Copy ${counter}`.toLowerCase())) {
    counter++;
  }
  return `${baseName} Copy ${counter}`;
}

export const ProfilesTab: React.FC = () => {
  const profiles = useSampleStore((s) => s.profiles);
  const activeProfile = useSampleStore((s) => s.activeProfile);
  const switchProfile = useSampleStore((s) => s.switchProfile);
  const createProfile = useSampleStore((s) => s.createProfile);
  const duplicateProfile = useSampleStore((s) => s.duplicateProfile);
  const updateProfileInfo = useSampleStore((s) => s.updateProfileInfo);
  const deleteProfile = useSampleStore((s) => s.deleteProfile);
  const fetchLocalBackups = useSampleStore((s) => s.fetchLocalBackups);
  const exportProfileJson = useSampleStore((s) => s.exportProfileJson);

  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [editingProfileName, setEditingProfileName] = useState("");
  const [editingProfileColor, setEditingProfileColor] = useState("#F59E0B");
  const [confirmDeleteProfileId, setConfirmDeleteProfileId] = useState<
    number | null
  >(null);

  useEffect(() => {
    void fetchLocalBackups();
  }, [fetchLocalBackups]);

  useEffect(() => {
    setEditingProfileId(null);
    setConfirmDeleteProfileId(null);
  }, [activeProfile?.id]);

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      {/* WORKSPACE PROFILES CARD */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden shrink-0">
        <div className="h-[34px] px-3 border-b border-line bg-surface-header flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-[10.5px] font-mono font-semibold text-fg-2 uppercase tracking-wider">
              WORKSPACE PROFILES
            </span>
            <span className="text-[9.5px] font-mono text-fg-3 bg-surface-2 px-1.5 py-0.2 rounded-xs border border-line">
              {profiles.length}
            </span>
          </div>
          <QuickCreatePopover
            title="New Profile"
            placeholder="Profile name..."
            hasColor={true}
            buttonTitle="Create a new workspace profile"
            buttonLabel="New Profile"
            buttonClassName="h-[23px] px-2.5 bg-accent hover:bg-accent-hover text-accent-on rounded-xs inline-flex items-center space-x-1 text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
            onCreated={async (name, color) => {
              const trimmed = name.trim();
              const duplicate = profiles.some(
                (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase()
              );
              await createProfile(
                trimmed,
                color || deterministicColorForName(trimmed)
              );
              if (duplicate) return false;
              return useSampleStore
                .getState()
                .profiles.some(
                  (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase()
                );
            }}
          />
        </div>

        {/* Profiles List */}
        <div className="divide-y divide-line-subtle overflow-hidden">
          {profiles.map((prof) => {
            const isCurrent = activeProfile?.id === prof.id;
            const isEditing = editingProfileId === prof.id;
            const isConfirmingDelete = confirmDeleteProfileId === prof.id;

            return (
              <div
                key={prof.id}
                className={`h-[36px] px-3 flex items-center justify-between space-x-2 transition-colors ${
                  isConfirmingDelete
                    ? "bg-danger/10"
                    : isCurrent
                    ? "bg-accent-soft"
                    : "bg-surface-1 hover:bg-surface-hover"
                }`}
              >
                {isEditing ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const clean = editingProfileName.trim();
                      if (!clean) return;
                      const duplicate = profiles.some(
                        (p) =>
                          p.id !== prof.id &&
                          p.name.trim().toLowerCase() === clean.toLowerCase()
                      );
                      await updateProfileInfo(prof.id, clean, editingProfileColor);
                      if (!duplicate) {
                        setEditingProfileId(null);
                      }
                    }}
                    className="flex items-center space-x-1.5 flex-1 min-w-0"
                  >
                    <input
                      type="text"
                      value={editingProfileName}
                      onChange={(e) => setEditingProfileName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingProfileId(null);
                        }
                      }}
                      autoFocus
                      className="flex-1 min-w-0 h-[24px] bg-surface-0 border border-accent px-2 text-[11.5px] text-fg outline-none rounded-xs"
                    />
                    <ColorPickerPopover
                      color={editingProfileColor}
                      onChange={setEditingProfileColor}
                      triggerSize="xs"
                      align="right"
                      title="Edit Profile Color (16M Colors)"
                    />
                    <button
                      type="submit"
                      disabled={!editingProfileName.trim()}
                      className="h-[22px] px-2 bg-accent text-accent-on disabled:opacity-40 shrink-0 inline-flex items-center space-x-1 text-[10.5px] font-semibold rounded-xs cursor-pointer"
                      title="Save changes"
                    >
                      <Check className="w-3 h-3" />
                      <span>Save</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingProfileId(null)}
                      className="h-[22px] px-2 bg-surface-3 border border-line text-fg-2 shrink-0 inline-flex items-center text-[10.5px] rounded-xs cursor-pointer"
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  </form>
                ) : isConfirmingDelete ? (
                  <InlineConfirmRowBar
                    prompt={<>Delete profile &ldquo;{prof.name}&rdquo;?</>}
                    onConfirm={async () => {
                      setConfirmDeleteProfileId(null);
                      await deleteProfile(prof.id);
                    }}
                    onCancel={() => setConfirmDeleteProfileId(null)}
                  />
                ) : (
                  <>
                    <div
                      onClick={() => {
                        if (!isCurrent) void switchProfile(prof.id);
                      }}
                      className="flex items-center space-x-2 min-w-0 flex-1 cursor-pointer"
                      title={
                        isCurrent
                          ? "Active workspace profile"
                          : `Click to switch to "${prof.name}"`
                      }
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-[3px] inline-block shrink-0"
                        style={{ backgroundColor: prof.color }}
                      />
                      <span className="text-[12px] font-semibold text-fg truncate">
                        {prof.name}
                      </span>
                      {isCurrent && (
                        <span className="px-1.5 py-0.2 bg-accent-soft border border-accent/60 font-mono text-[9px] font-semibold text-accent-fg shrink-0 whitespace-nowrap rounded-xs">
                          ACTIVE
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => void switchProfile(prof.id)}
                          className="h-[22px] px-2 flex items-center justify-center bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-accent-fg rounded-xs text-[10.5px] font-medium transition-colors cursor-pointer mr-0.5"
                          title="Switch to this profile"
                        >
                          Switch
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteProfileId(null);
                          setEditingProfileId(prof.id);
                          setEditingProfileName(prof.name);
                          setEditingProfileColor(prof.color);
                        }}
                        className="w-[22px] h-[22px] flex items-center justify-center bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs transition-colors cursor-pointer"
                        title="Rename or change color"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void duplicateProfile(
                            prof.id,
                            buildUniqueProfileCopyName(prof.name, profiles)
                          )
                        }
                        className="w-[22px] h-[22px] flex items-center justify-center bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs transition-colors cursor-pointer"
                        title="Duplicate profile"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportProfileJson(prof.id)}
                        className="w-[22px] h-[22px] flex items-center justify-center bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-accent-fg rounded-xs transition-colors cursor-pointer"
                        title="Export workspace profile (.audify-profile)"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProfileId(null);
                          setConfirmDeleteProfileId(prof.id);
                        }}
                        disabled={profiles.length <= 1 || isCurrent}
                        className="w-[22px] h-[22px] flex items-center justify-center bg-surface-2 hover:bg-danger/15 hover:border-danger hover:text-danger border border-line text-fg-2 rounded-xs disabled:opacity-30 transition-colors cursor-pointer"
                        title={
                          isCurrent
                            ? "Cannot delete active profile"
                            : "Delete profile"
                        }
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* BACKUPS & SNAPSHOTS FULL-HEIGHT CARD */}
      <ProfileBackupsCard />
    </div>
  );
};
