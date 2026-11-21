import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  Database,
  Download,
  FolderOpen,
  ShieldCheck,
  Sliders,
  Sparkles,
  Upload,
} from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import { useSampleStore } from "../../store/useSampleStore";
import { FullSnapshotRestoreModal } from "./FullSnapshotRestoreModal";

interface SettingsProfileMenusProps {
  activeProfileId?: number;
}

/**
 * Two-tier profile / full-DB snapshot import & export dropdowns and portable
 * data-folder shortcut rendered in the Settings header for the Profiles tab.
 */
export const SettingsProfileMenus: React.FC<SettingsProfileMenusProps> = ({
  activeProfileId,
}) => {
  const exportSettingsJson = useSampleStore((s) => s.exportSettingsJson);
  const importSettingsJson = useSampleStore((s) => s.importSettingsJson);
  const exportProfileJson = useSampleStore((s) => s.exportProfileJson);
  const importProfileJson = useSampleStore((s) => s.importProfileJson);
  const exportFullSnapshot = useSampleStore((s) => s.exportFullSnapshot);
  const openFullSnapshotRestorePrompt = useSampleStore(
    (s) => s.openFullSnapshotRestorePrompt
  );

  const [profileMenuOpen, setProfileMenuOpen] = useState<
    "import" | "export" | null
  >(null);
  const importBtnRef = useRef<HTMLButtonElement | null>(null);
  const exportBtnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!profileMenuOpen) return;
    const update = () => {
      const btn =
        profileMenuOpen === "import"
          ? importBtnRef.current
          : exportBtnRef.current;
      const rect = btn?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    setProfileMenuOpen(null);
  }, [activeProfileId]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setProfileMenuOpen(null);
      }
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [profileMenuOpen]);

  return (
    <>
      <div className="relative">
        <button
          ref={importBtnRef}
          type="button"
          onClick={() =>
            setProfileMenuOpen(profileMenuOpen === "import" ? null : "import")
          }
          className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-[11px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1.5 transition-colors cursor-pointer"
          title="Import workspace profile, settings JSON, or restore a full DB snapshot"
        >
          <Upload className="w-3 h-3 text-fg-3 shrink-0" />
          <span>Import</span>
          <ChevronDown className="w-3 h-3 text-fg-3 shrink-0" />
        </button>

        {profileMenuOpen === "import" &&
          createPortal(
            <>
              <div
                style={{ zIndex: Z_INDEX.contextMenu }}
                className="fixed inset-0"
                onClick={() => setProfileMenuOpen(null)}
              />
              <div
                data-settings-dropdown-open="true"
                data-mica-overlay="true"
                style={{
                  top: menuPos.top,
                  right: menuPos.right,
                  zIndex: Z_INDEX.floatingMenu,
                }}
                className="fixed w-60 bg-surface-2 backdrop-blur-md border border-line rounded-md shadow-2xl p-1 text-left"
              >
                <div className="px-2 pt-1 pb-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-fg-3">
                  Workspace Profile
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void importProfileJson();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-accent-fg shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Import profile
                    </div>
                    <div className="text-[9.5px] font-mono text-fg-3">
                      .audify-profile / .json
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void importSettingsJson();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5 text-fg-2 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Import settings only
                    </div>
                    <div className="text-[9.5px] font-mono text-fg-3">
                      .audify-settings.json
                    </div>
                  </div>
                </button>

                <div className="my-1 border-t border-line" />
                <div className="px-2 pt-0.5 pb-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-fg-3">
                  Full Backup (.db)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void openFullSnapshotRestorePrompt();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5 text-accent-fg shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Restore full snapshot
                    </div>
                    <div className="text-[9.5px] text-fg-3">
                      .audify-backup.zip (All profiles &amp; DB)
                    </div>
                  </div>
                </button>
              </div>
            </>,
            document.body
          )}
      </div>

      <div className="relative">
        <button
          ref={exportBtnRef}
          type="button"
          onClick={() =>
            setProfileMenuOpen(profileMenuOpen === "export" ? null : "export")
          }
          className="h-[24px] px-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-[11px] font-medium text-fg-2 hover:text-fg inline-flex items-center space-x-1.5 transition-colors cursor-pointer"
          title="Export workspace profile or full library DB snapshot"
        >
          <Download className="w-3 h-3 text-fg-3 shrink-0" />
          <span>Export</span>
          <ChevronDown className="w-3 h-3 text-fg-3 shrink-0" />
        </button>

        {profileMenuOpen === "export" &&
          createPortal(
            <>
              <div
                style={{ zIndex: Z_INDEX.contextMenu }}
                className="fixed inset-0"
                onClick={() => setProfileMenuOpen(null)}
              />
              <div
                data-settings-dropdown-open="true"
                data-mica-overlay="true"
                style={{
                  top: menuPos.top,
                  right: menuPos.right,
                  zIndex: Z_INDEX.floatingMenu,
                }}
                className="fixed w-64 bg-surface-2 backdrop-blur-md border border-line rounded-md shadow-2xl p-1 text-left"
              >
                <div className="px-2 pt-1 pb-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-fg-3">
                  Workspace Profile (Portable)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void exportProfileJson();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-accent-fg shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Workspace profile
                    </div>
                    <div className="text-[9.5px] text-fg-3">
                      .audify-profile · Manual tags &amp; rules
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void exportProfileJson(undefined, { includeAiTags: true });
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-accent-fg shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Workspace + AI tags
                    </div>
                    <div className="text-[9.5px] text-fg-3">
                      .audify-profile · Includes approved AI tags
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void exportProfileJson(undefined, { shareSafe: true });
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-accent-fg shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Share-safe profile
                    </div>
                    <div className="text-[9.5px] text-fg-3">
                      Without personal file paths
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void exportSettingsJson();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5 text-fg-2 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Settings only
                    </div>
                    <div className="text-[9.5px] font-mono text-fg-3">
                      .audify-settings.json
                    </div>
                  </div>
                </button>

                <div className="my-1 border-t border-line" />
                <div className="px-2 pt-0.5 pb-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-fg-3">
                  Full Backup (.db Snapshot)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(null);
                    void exportFullSnapshot();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xs hover:bg-surface-3 flex items-start space-x-2 text-left transition-colors cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5 text-accent-fg shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg">
                      Full library snapshot
                    </div>
                    <div className="text-[9.5px] text-fg-3">
                      .audify-backup.zip · DB, vectors &amp; images
                    </div>
                  </div>
                </button>
              </div>
            </>,
            document.body
          )}
      </div>

      <button
        type="button"
        onClick={() => void invoke("open_data_folder")}
        className="w-[24px] h-[24px] bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent rounded-xs text-fg-2 hover:text-accent-fg flex items-center justify-center transition-colors cursor-pointer"
        title="Open portable user/ data folder in Explorer"
      >
        <FolderOpen className="w-3.5 h-3.5" />
      </button>

      <FullSnapshotRestoreModal />
    </>
  );
};
