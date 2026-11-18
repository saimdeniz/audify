import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  ASCII_MAGIC_FIT_OPTIONS,
  ASCII_MAGIC_LOOK_OPTIONS,
} from "../../constants/asciiMagic";
import {
  deleteAsciiMagicPiece,
  getAsciiMagicState,
  installAndCapturePreview,
  subscribeAsciiMagicUpdated,
  syncAsciiMagicCatalog,
} from "../../services/asciiMagicService";
import { useSampleStore } from "../../store/useSampleStore";
import type { AsciiMagicInstalledPiece, AsciiMagicState } from "../../types";
import { AsciiMagicCard } from "./AsciiMagicCard";
import {
  AsciiMagicCategoryDropdown,
  type AsciiMagicCategoryOption,
} from "./AsciiMagicCategoryDropdown";

const PAGE_STEP = 48;

interface DisplayCatalogItem {
  slug: string;
  name: string;
  category: string;
  note: string;
  tags: string[];
  cols: number;
  rows: number;
  fps: number;
  installedRecord: AsciiMagicInstalledPiece | null;
}

export const AsciiMagicCatalogPanel: React.FC = React.memo(() => {
  const wallpaperKind = useSampleStore((s) => s.wallpaperKind);
  const asciiMagicSlug = useSampleStore((s) => s.asciiMagicSlug);
  const asciiMagicLook = useSampleStore((s) => s.asciiMagicLook);
  const asciiMagicFit = useSampleStore((s) => s.asciiMagicFit);
  const themeMode = useSampleStore((s) => s.themeMode);
  const setAsciiMagicSlug = useSampleStore((s) => s.setAsciiMagicSlug);
  const setAsciiMagicLook = useSampleStore((s) => s.setAsciiMagicLook);
  const setAsciiMagicFit = useSampleStore((s) => s.setAsciiMagicFit);

  const [magicState, setMagicState] = useState<AsciiMagicState | null>(null);
  const [slugInput, setSlugInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [pageLimit, setPageLimit] = useState(PAGE_STEP);
  const [syncing, setSyncing] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [confirmDeleteSlug, setConfirmDeleteSlug] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const next = await getAsciiMagicState();
      setMagicState(next);
    } catch (err) {
      setErrorMsg(String(err));
    }
  }, []);

  useEffect(() => {
    void refreshState();
    return subscribeAsciiMagicUpdated(() => {
      void refreshState();
    });
  }, [refreshState]);

  const handleSyncCatalog = async () => {
    if (syncing) return;
    setSyncing(true);
    setErrorMsg(null);
    try {
      const next = await syncAsciiMagicCatalog();
      setMagicState(next);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleInstall = useCallback(
    async (slugOrUrl: string, fromDirectInput = false) => {
      const trimmed = slugOrUrl.trim();
      if (!trimmed || installingSlug) return;
      setInstallingSlug(trimmed);
      setErrorMsg(null);
      try {
        const record = await installAndCapturePreview(trimmed);
        if (fromDirectInput) setSlugInput("");
        await refreshState();
        setAsciiMagicSlug(record.slug, true);
      } catch (err) {
        setErrorMsg(String(err));
      } finally {
        setInstallingSlug(null);
      }
    },
    [installingSlug, refreshState, setAsciiMagicSlug]
  );

  const handleSelect = useCallback(
    (slug: string) => {
      setErrorMsg(null);
      setAsciiMagicSlug(slug, true);
    },
    [setAsciiMagicSlug]
  );

  const handleConfirmDelete = useCallback(
    async (slug: string) => {
      setConfirmDeleteSlug(null);
      setErrorMsg(null);
      try {
        await deleteAsciiMagicPiece(slug);
        if (asciiMagicSlug === slug) {
          setAsciiMagicSlug("", true);
        }
        await refreshState();
      } catch (err) {
        setErrorMsg(String(err));
      }
    },
    [asciiMagicSlug, refreshState, setAsciiMagicSlug]
  );

  const handleCardInstall = useCallback(
    (slug: string) => {
      void handleInstall(slug, false);
    },
    [handleInstall]
  );

  const handleRequestDelete = useCallback((slug: string) => {
    setConfirmDeleteSlug(slug);
  }, []);

  const handleConfirmDeleteProp = useCallback(
    (slug: string) => {
      void handleConfirmDelete(slug);
    },
    [handleConfirmDelete]
  );

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteSlug(null);
  }, []);

  const installedBySlug = useMemo(() => {
    const map = new Map<string, AsciiMagicInstalledPiece>();
    for (const item of magicState?.installed ?? []) {
      map.set(item.slug, item);
    }
    return map;
  }, [magicState?.installed]);

  const combinedItems = useMemo<DisplayCatalogItem[]>(() => {
    const items: DisplayCatalogItem[] = [];
    const seen = new Set<string>();

    for (const p of magicState?.catalog ?? []) {
      seen.add(p.slug);
      items.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        note: p.note,
        tags: p.tags,
        cols: p.cols,
        rows: p.rows,
        fps: p.fps,
        installedRecord: installedBySlug.get(p.slug) ?? null,
      });
    }

    for (const inst of magicState?.installed ?? []) {
      if (seen.has(inst.slug)) continue;
      items.push({
        slug: inst.slug,
        name: inst.name,
        category: inst.category,
        note: inst.note,
        tags: [],
        cols: inst.cols,
        rows: inst.rows,
        fps: inst.fps,
        installedRecord: inst,
      });
    }

    return items;
  }, [magicState?.catalog, magicState?.installed, installedBySlug]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return combinedItems.filter((item) => {
      if (installedOnly && !item.installedRecord) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.slug.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.note.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [combinedItems, installedOnly, categoryFilter, searchQuery]);

  useEffect(() => {
    setPageLimit(PAGE_STEP);
  }, [searchQuery, categoryFilter, installedOnly]);

  const categoryOptions = useMemo<AsciiMagicCategoryOption[]>(() => {
    const counts = new Map<string, number>();
    for (const item of combinedItems) {
      if (installedOnly && !item.installedRecord) continue;
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return (magicState?.categories ?? []).map((cat) => ({
      id: cat.id,
      name: cat.name,
      count: counts.get(cat.id) ?? 0,
    }));
  }, [magicState?.categories, combinedItems, installedOnly]);

  const categoryTotalCount = useMemo(
    () =>
      installedOnly
        ? combinedItems.filter((item) => item.installedRecord !== null).length
        : combinedItems.length,
    [combinedItems, installedOnly]
  );

  const visibleItems = useMemo(
    () => filteredItems.slice(0, pageLimit),
    [filteredItems, pageLimit]
  );

  const catalogCount = magicState?.catalog.length ?? 0;
  const installedCount = magicState?.installed.length ?? 0;

  return (
    <div className="space-y-2.5 min-w-0">
      {/* Row 1: Direct Slug / URL Installer + Catalog Sync */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleInstall(slugInput, true);
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <input
          type="text"
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder="Paste ascii-magic.com/ascii/<slug> or enter slug (e.g. chai-stall-dawn)"
          className="h-[26px] flex-1 min-w-[200px] px-2 rounded-xs bg-surface-1 border border-line text-[11px] text-fg placeholder:text-fg-3 focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!slugInput.trim() || installingSlug !== null}
          className="h-[26px] px-2.5 rounded-xs bg-accent text-accent-on text-[10.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {installingSlug ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          <span>Install &amp; Apply</span>
        </button>

        <button
          type="button"
          onClick={() => void handleSyncCatalog()}
          disabled={syncing}
          className="h-[26px] px-2.5 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[10.5px] font-medium text-fg-2 hover:text-fg inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
          title="Download searchable index.json from ascii-magic.com"
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
          <span>{catalogCount > 0 ? `Refresh (${catalogCount})` : "Sync Catalog"}</span>
        </button>
      </form>

      {errorMsg && (
        <div className="px-2.5 py-1.5 rounded-xs border border-danger bg-surface-2 text-danger text-[10.5px] flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{errorMsg}</span>
        </div>
      )}

      {/* Row 2: Look & Framing Selector Pills */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-xs bg-surface-2 border border-line">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-accent-fg shrink-0" />
          <span className="text-[11px] font-medium text-fg-2">Render Look</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap items-center p-0.5 bg-surface-1 rounded-xs border border-line gap-0.5">
            {ASCII_MAGIC_LOOK_OPTIONS.map((opt) => {
              const active = asciiMagicLook === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAsciiMagicLook(opt.id)}
                  className={`h-[20px] px-2 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-accent text-accent-on font-semibold shadow-xs"
                      : "text-fg-3 hover:text-fg"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div
            className="flex items-center p-0.5 bg-surface-1 rounded-xs border border-line gap-0.5"
            title="Tile framing mode (Fit preserves every column and row)"
          >
            {ASCII_MAGIC_FIT_OPTIONS.map((opt) => {
              const active = asciiMagicFit === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAsciiMagicFit(opt.id)}
                  className={`h-[20px] px-2 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-accent text-accent-on font-semibold shadow-xs"
                      : "text-fg-3 hover:text-fg"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 3: Search, Installed Toggle & Category Dropdown */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative flex-1 min-w-[170px]">
          <Search className="w-3 h-3 text-fg-3 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              catalogCount > 0
                ? `Search ${catalogCount} scenes by name, tag, or slug...`
                : "Filter saved scenes..."
            }
            className="w-full h-[24px] pl-6 pr-2 rounded-xs bg-surface-1 border border-line text-[10.5px] text-fg placeholder:text-fg-3 focus:outline-none focus:border-accent"
          />
        </div>

        <button
          type="button"
          onClick={() => setInstalledOnly((v) => !v)}
          className={`h-[24px] px-2 rounded-xs border text-[10px] font-medium cursor-pointer shrink-0 ${
            installedOnly
              ? "border-accent bg-accent-soft text-fg font-semibold"
              : "border-line bg-surface-2 text-fg-2 hover:text-fg"
          }`}
        >
          Saved ({installedCount})
        </button>

        {categoryOptions.length > 0 && (
          <AsciiMagicCategoryDropdown
            value={categoryFilter}
            options={categoryOptions}
            totalCount={categoryTotalCount}
            onChange={setCategoryFilter}
          />
        )}
      </div>

      {/* Scrollable Grid or Empty Prompt */}
      {combinedItems.length === 0 ? (
        <div className="p-4 rounded-xs border border-line bg-surface-2 text-center space-y-2">
          <p className="text-[11px] text-fg-2">
            Paste any <span className="font-mono text-fg">ascii-magic.com/ascii/&lt;slug&gt;</span>{" "}
            URL above to download immediately, or sync the full searchable catalog.
          </p>
          <button
            type="button"
            onClick={() => void handleSyncCatalog()}
            disabled={syncing}
            className="h-[26px] px-3 rounded-xs bg-accent text-accent-on text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            <span>{syncing ? "Syncing..." : "Sync Full Catalog"}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-2 max-h-[248px] overflow-y-auto pr-1">
            {visibleItems.map((item) => (
              <AsciiMagicCard
                key={item.slug}
                slug={item.slug}
                name={item.name}
                category={item.category}
                note={item.note}
                cols={item.cols}
                rows={item.rows}
                fps={item.fps}
                installedRecord={item.installedRecord}
                isActive={
                  wallpaperKind === "ascii_magic" && asciiMagicSlug === item.slug
                }
                isInstalling={installingSlug === item.slug}
                isConfirmingDelete={confirmDeleteSlug === item.slug}
                look={asciiMagicLook}
                themeMode={themeMode}
                onSelect={handleSelect}
                onInstall={handleCardInstall}
                onRequestDelete={handleRequestDelete}
                onConfirmDelete={handleConfirmDeleteProp}
                onCancelDelete={handleCancelDelete}
              />
            ))}
          </div>

          {filteredItems.length > visibleItems.length && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setPageLimit((n) => n + PAGE_STEP)}
                className="h-[22px] px-3 rounded-xs border border-line bg-surface-2 hover:bg-surface-3 text-[10px] font-medium text-fg-2 hover:text-fg cursor-pointer"
              >
                Show more ({visibleItems.length}/{filteredItems.length})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Attribution & Security Note */}
      <p className="text-[9.5px] text-fg-3 leading-snug">
        Community scenes by Kailash (<span className="font-mono">ascii-magic.com</span>, MIT
        License). Downloaded pieces are validated statically and run inside an isolated sandbox
        Worker (<span className="font-mono">connect-src 'none'</span>).
      </p>
    </div>
  );
});

export default AsciiMagicCatalogPanel;
