import React, { useState } from "react";
import {
  Folder,
  FolderOpen,
  Lock,
  RefreshCw,
  Trash2,
  Unlock,
} from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { InlineConfirmRowBar } from "../common/InlineConfirmDeleteButton";
import { ToggleRow } from "./ToggleRow";

export const LibrariesTab: React.FC = () => {
  const libraries = useSampleStore((s) => s.libraries);
  const isScanning = useSampleStore((s) => s.isScanning);
  const scanProgress = useSampleStore((s) => s.scanProgress);
  const enableLiveFolderWatch = useSampleStore((s) => s.enableLiveFolderWatch);
  const setEnableLiveFolderWatch = useSampleStore(
    (s) => s.setEnableLiveFolderWatch
  );
  const setLibraryProfileScope = useSampleStore(
    (s) => s.setLibraryProfileScope
  );
  const setLibraryReadOnly = useSampleStore((s) => s.setLibraryReadOnly);
  const syncFolderIncremental = useSampleStore((s) => s.syncFolderIncremental);
  const relinkLibraryFolder = useSampleStore((s) => s.relinkLibraryFolder);
  const removeLibrary = useSampleStore((s) => s.removeLibrary);

  const [confirmRemoveLibId, setConfirmRemoveLibId] = useState<number | null>(
    null
  );

  const pct = scanProgress ? Math.round(scanProgress.percentage) : 0;
  const visibleInProfileCount = libraries.filter(
    (l) => l.is_global !== false || l.assigned_to_profile !== false
  ).length;
  const totalSampleCount = libraries.reduce(
    (sum, l) => sum + (l.sample_count || 0),
    0
  );
  const protectedVaultCount = libraries.filter((l) => l.is_read_only).length;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Live Scan Progress Bar if Active */}
      {isScanning && scanProgress && (
        <div className="bg-surface-1 border border-accent p-2.5 space-y-1.5 rounded-md shrink-0">
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-accent-fg font-semibold">
              Scanning [{scanProgress.processed}/{scanProgress.total}]
            </span>
            <span className="text-fg">{pct}%</span>
          </div>
          <div className="w-full h-[4px] bg-surface-0 border border-line rounded-full overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <div className="font-mono text-[9.5px] text-fg-2 truncate">
            {scanProgress.current_file}
          </div>
        </div>
      )}

      {/* Active Libraries Table Card (sizes naturally to its entries) */}
      <div className="bg-surface-1 border border-line rounded-md max-h-[420px] flex flex-col min-h-0 overflow-hidden shrink-0">
        <div className="h-[26px] px-3 bg-surface-header border-b border-line grid grid-cols-[1fr_80px_172px_150px] items-center gap-3 text-[9.5px] font-mono font-semibold text-fg-3 uppercase tracking-wider shrink-0">
          <span>LIBRARY</span>
          <span className="text-right">SAMPLES</span>
          <span>VISIBILITY</span>
          <span className="text-right">ACTIONS</span>
        </div>

        <div className="flex-1 divide-y divide-line-subtle overflow-y-auto min-h-0">
          {libraries.length === 0 ? (
            <div className="p-8 text-center font-mono text-[11px] text-fg-3">
              No library folders indexed yet. Click &ldquo;+ Add Library&rdquo;
              in the header to add a folder.
            </div>
          ) : (
            libraries.map((lib) => {
              const isGlobal = lib.is_global !== false;
              const isAssigned = lib.assigned_to_profile !== false;
              const isConfirmingRemove = confirmRemoveLibId === lib.id;

              return (
                <div
                  key={lib.id}
                  className={`py-2.5 px-3 transition-colors ${
                    isConfirmingRemove
                      ? "bg-danger/10"
                      : "bg-surface-1 hover:bg-surface-hover"
                  }`}
                >
                  {isConfirmingRemove ? (
                    <InlineConfirmRowBar
                      prompt={
                        <>
                          Remove &ldquo;{lib.name}&rdquo; from database?{" "}
                          <span className="text-fg-3 font-normal">
                            Files on disk are not touched.
                          </span>
                        </>
                      }
                      confirmLabel="Remove"
                      confirmTitle={`Confirm removing "${lib.name}" from database`}
                      disabled={isScanning}
                      onConfirm={async () => {
                        setConfirmRemoveLibId(null);
                        await removeLibrary(lib.id);
                      }}
                      onCancel={() => setConfirmRemoveLibId(null)}
                    />
                  ) : (
                    <div className="grid grid-cols-[1fr_80px_172px_150px] items-center gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2 min-w-0">
                          <Folder className="w-3.5 h-3.5 text-accent-fg shrink-0" />
                          <span className="font-semibold text-[12px] text-fg truncate">
                            {lib.name}
                          </span>
                          {lib.is_read_only && (
                            <span
                              className="text-[9px] font-mono px-1.5 py-0.2 rounded-xs bg-accent-soft border border-accent/45 text-accent-fg font-semibold shrink-0"
                              title="Protected Read-Only Vault: F2 Rename and Trash are blocked for this library"
                            >
                              PROTECTED
                            </span>
                          )}
                        </div>
                        <div
                          className="font-mono text-[10px] text-fg-3 truncate mt-0.5 pl-5"
                          title={lib.path}
                        >
                          {lib.path}
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums text-[11px] font-semibold text-fg-2">
                        {lib.sample_count.toLocaleString()}
                      </div>

                      <div className="flex items-center p-0.5 bg-surface-2 rounded-xs border border-line w-fit">
                        <button
                          type="button"
                          onClick={() =>
                            void setLibraryProfileScope(lib.id, true, true)
                          }
                          className={`h-[20px] px-2 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                            isGlobal
                              ? "bg-accent-soft border border-accent/50 text-accent-fg font-semibold"
                              : "text-fg-3 hover:text-fg border border-transparent"
                          }`}
                          title="Visible across all workspace profiles"
                        >
                          Global
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void setLibraryProfileScope(lib.id, false, true)
                          }
                          className={`h-[20px] px-2 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                            !isGlobal && isAssigned
                              ? "bg-accent-soft border border-accent/50 text-accent-fg font-semibold"
                              : "text-fg-3 hover:text-fg border border-transparent"
                          }`}
                          title="Visible only in the active profile"
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void setLibraryProfileScope(lib.id, false, false)
                          }
                          className={`h-[20px] px-2 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                            !isGlobal && !isAssigned
                              ? "bg-surface-3 border border-line text-fg font-semibold"
                              : "text-fg-3 hover:text-fg border border-transparent"
                          }`}
                          title="Hidden in the active profile"
                        >
                          Hidden
                        </button>
                      </div>

                      <div className="flex items-center justify-end space-x-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            void setLibraryReadOnly(lib.id, !lib.is_read_only)
                          }
                          className={`w-[22px] h-[22px] border rounded-xs shrink-0 flex items-center justify-center transition-colors cursor-pointer ${
                            lib.is_read_only
                              ? "bg-accent-soft border-accent/50 text-accent-fg hover:bg-accent/20"
                              : "bg-surface-2 hover:bg-surface-3 border-line text-fg-3 hover:text-fg"
                          }`}
                          title={
                            lib.is_read_only
                              ? "Protected Read-Only Vault (F2 Rename & Trash blocked) — Click to unlock"
                              : "Lock as Protected Read-Only Vault (blocks F2 Rename & Trash)"
                          }
                        >
                          {lib.is_read_only ? (
                            <Lock className="w-3 h-3" />
                          ) : (
                            <Unlock className="w-3 h-3" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => void relinkLibraryFolder(lib.id)}
                          disabled={isScanning}
                          className="h-[22px] px-2 bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-accent-fg rounded-xs disabled:opacity-50 shrink-0 inline-flex items-center space-x-1 text-[10.5px] font-medium transition-colors cursor-pointer"
                          title="Relink moved or renamed library folder while preserving Favorites, Collections, Tags, Genres & Session Bin"
                        >
                          <FolderOpen className="w-3 h-3 shrink-0" />
                          <span>Relink</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void syncFolderIncremental(lib.path)}
                          disabled={isScanning}
                          className="w-[22px] h-[22px] bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs disabled:opacity-50 shrink-0 flex items-center justify-center transition-colors cursor-pointer"
                          title="Sync folder changes"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfirmRemoveLibId(lib.id)}
                          disabled={isScanning}
                          className="w-[22px] h-[22px] bg-surface-2 hover:bg-danger/15 hover:text-danger hover:border-danger border border-line text-fg-3 rounded-xs disabled:opacity-50 shrink-0 flex items-center justify-center transition-colors cursor-pointer"
                          title="Remove library from database"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Live Folder Watch Option */}
      <div className="bg-surface-1 border border-line rounded-md overflow-hidden shrink-0">
        <div className="h-[30px] px-3 bg-surface-2 border-b border-line flex items-center justify-between">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-fg">
            LIVE FOLDER WATCHER
          </span>
          <span
            className={`font-mono text-[9.5px] font-semibold ${
              enableLiveFolderWatch ? "text-accent-fg" : "text-fg-3"
            }`}
          >
            {enableLiveFolderWatch ? "Active" : "Paused"}
          </span>
        </div>
        <ToggleRow
          label="Live Watch Folders"
          description="Automatically detect and sync external file additions, edits, or removals in active library folders."
          checked={enableLiveFolderWatch}
          onChange={setEnableLiveFolderWatch}
          title="Watch active library folders in the background with debounce and write-stability checks"
        />
      </div>

      {/* Library Summary & Visibility Guide */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 shrink-0">
        <div className="bg-surface-1 border border-line rounded-md px-3 py-2.5 space-y-1">
          <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-fg-3 font-semibold">
            <span>ACTIVE SCOPE</span>
            <span className="text-accent-fg tabular-nums">
              {visibleInProfileCount}/{libraries.length} visible
            </span>
          </div>
          <p className="text-[11px] text-fg-2">
            <strong className="text-fg">Global</strong> shared ·{" "}
            <strong className="text-fg">Profile</strong> active-only ·{" "}
            <strong className="text-fg">Hidden</strong> excluded.
          </p>
        </div>

        <div className="bg-surface-1 border border-line rounded-md px-3 py-2.5 space-y-1">
          <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-fg-3 font-semibold">
            <span>VAULT LOCK</span>
            <span className="text-fg tabular-nums">
              {protectedVaultCount} locked
            </span>
          </div>
          <p className="text-[11px] text-fg-2">
            Blocks <span className="font-mono text-fg">F2</span> rename and
            Trash moves on disk.
          </p>
        </div>

        <div className="bg-surface-1 border border-line rounded-md px-3 py-2.5 space-y-1">
          <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-fg-3 font-semibold">
            <span>REPAIR &amp; SYNC</span>
            <span className="text-ok tabular-nums">
              {totalSampleCount.toLocaleString()} samples
            </span>
          </div>
          <p className="text-[11px] text-fg-2">
            <strong className="text-fg">Relink</strong> reconnects moved
            folders without losing tags.
          </p>
        </div>
      </div>
    </div>
  );
};
