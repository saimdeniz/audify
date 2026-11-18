import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AsciiMagicInstalledPiece,
  AsciiMagicPreviewSnapshot,
  AsciiMagicState,
} from "../types";
import { asciiMagicSandbox } from "../utils/asciiMagic/sandboxBridge";
import {
  clearAsciiMagicPreviewSnapshots,
  getAsciiMagicPreviewCacheEntry,
  hasAsciiMagicPreviewCacheEntry,
  setBoundedPreviewCache,
} from "../utils/asciiMagic/previewCache";
import { evictAsciiMagicAutoAccentCache } from "../utils/autoAccentCache";

export async function getAsciiMagicState(): Promise<AsciiMagicState> {
  return invoke<AsciiMagicState>("get_ascii_magic_state");
}

export async function syncAsciiMagicCatalog(): Promise<AsciiMagicState> {
  return invoke<AsciiMagicState>("sync_ascii_magic_catalog");
}

export async function installAsciiMagicPiece(
  slugOrUrl: string
): Promise<AsciiMagicInstalledPiece> {
  const record = await invoke<AsciiMagicInstalledPiece>(
    "install_ascii_magic_piece",
    { slugOrUrl }
  );
  clearAsciiMagicPreviewSnapshots(record.slug);
  evictAsciiMagicAutoAccentCache(record.slug);
  return record;
}

export async function deleteAsciiMagicPiece(slug: string): Promise<void> {
  clearAsciiMagicPreviewSnapshots(slug);
  evictAsciiMagicAutoAccentCache(slug);
  await invoke("delete_ascii_magic_piece", { slug });
}

export async function saveAsciiMagicPreview(
  slug: string,
  snapshot: AsciiMagicPreviewSnapshot
): Promise<void> {
  setBoundedPreviewCache(slug, snapshot);
  void import("../utils/autoAccent")
    .then((m) => m.cacheAsciiMagicAutoAccent(slug, snapshot))
    .catch(() => {});
  const previewJson = JSON.stringify(snapshot);
  await invoke("save_ascii_magic_preview", { slug, previewJson });
}

export async function getAsciiMagicPreview(
  slug: string
): Promise<AsciiMagicPreviewSnapshot | null> {
  if (hasAsciiMagicPreviewCacheEntry(slug)) {
    const val = getAsciiMagicPreviewCacheEntry(slug) ?? null;
    setBoundedPreviewCache(slug, val);
    return val;
  }
  const raw = await invoke<string | null>("get_ascii_magic_preview", { slug });
  if (!raw) {
    setBoundedPreviewCache(slug, null);
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AsciiMagicPreviewSnapshot>;
    if (parsed && parsed.meta && parsed.frame && typeof parsed.frame.text === "string") {
      const snap = parsed as AsciiMagicPreviewSnapshot;
      setBoundedPreviewCache(slug, snap);
      void import("../utils/autoAccent")
        .then((m) => m.cacheAsciiMagicAutoAccent(slug, snap))
        .catch(() => {});
      return snap;
    }
  } catch {
    // Ignore corrupt preview JSON
  }
  setBoundedPreviewCache(slug, null);
  return null;
}

export function evictAsciiMagicPreviewCache(slug?: string): void {
  evictAsciiMagicAutoAccentCache(slug);
  clearAsciiMagicPreviewSnapshots(slug);
}

export async function installAndCapturePreview(
  slugOrUrl: string
): Promise<AsciiMagicInstalledPiece> {
  const record = await installAsciiMagicPiece(slugOrUrl);
  try {
    const snap = await asciiMagicSandbox.capturePiecePreview(
      record.slug,
      record.sha256
    );
    await saveAsciiMagicPreview(record.slug, snap);
    return { ...record, has_preview: true };
  } catch {
    // Piece is already installed and validated on disk; preview generation is best-effort.
    return record;
  }
}

export function subscribeAsciiMagicUpdated(
  onUpdate: (slug: string) => void
): () => void {
  let active = true;
  let unlisten: (() => void) | null = null;

  void listen<string>("ascii-magic-updated", (event) => {
    if (!active) return;
    if (typeof event.payload === "string") {
      clearAsciiMagicPreviewSnapshots(event.payload);
      evictAsciiMagicAutoAccentCache(event.payload);
      onUpdate(event.payload);
    }
  }).then((fn) => {
    if (!active) {
      fn();
    } else {
      unlisten = fn;
    }
  });

  return () => {
    active = false;
    unlisten?.();
  };
}
