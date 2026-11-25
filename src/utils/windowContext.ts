import { invoke } from "@tauri-apps/api/core";
import {
  CROSS_WINDOW_SYNC_KEY,
  SETTINGS_TAB_STORAGE_KEY as CENTRAL_SETTINGS_TAB_KEY,
} from "../constants/storageKeys";

export type SettingsTab =
  | "libraries"
  | "appearance"
  | "audio"
  | "ai"
  | "shortcuts"
  | "licenses"
  | "collections"
  | "tags"
  | "genres"
  | "profiles"
  | "advanced";

export type MainFilterRequest =
  | { kind: "collection"; id: number; label?: string }
  | { kind: "tag"; id: number; label?: string }
  | { kind: "genre"; name: string }
  | { kind: "license"; id: string; label?: string }
  | { kind: "search"; query: string; label?: string }
  | { kind: "trash" }
  | { kind: "duplicates" };

export type CrossWindowSyncKind =
  | "settings"
  | "catalog"
  | "profile"
  | "backgrounds"
  | "live-visual";

export interface CrossWindowSyncMessage {
  kind: CrossWindowSyncKind;
  patch?: Record<string, unknown>;
  msgId?: string;
}

let syncChannel: BroadcastChannel | null = null;
let syncMsgSeq = 0;

function nextCrossWindowSyncMsgId(): string {
  syncMsgSeq += 1;
  return `${Date.now().toString(36)}-${syncMsgSeq}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function getSyncChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!syncChannel) {
    try {
      syncChannel = new BroadcastChannel(CROSS_WINDOW_SYNC_KEY);
    } catch {
      syncChannel = null;
    }
  }
  return syncChannel;
}

export function postCrossWindowSync(
  kind: CrossWindowSyncKind,
  patch?: Record<string, unknown>
): void {
  const msgId = nextCrossWindowSyncMsgId();
  try {
    const ch = getSyncChannel();
    if (ch) {
      ch.postMessage({ kind, patch, msgId } satisfies CrossWindowSyncMessage);
    }
  } catch {
    // ignore BroadcastChannel errors
  }

  if (kind === "catalog" || kind === "profile" || kind === "backgrounds") {
    void Promise.resolve(invoke("broadcast_state_sync", { kind, msgId })).catch(
      () => {}
    );
  }
}

export function subscribeCrossWindowSync(
  handler: (msg: CrossWindowSyncMessage) => void
): () => void {
  const ch = getSyncChannel();
  if (!ch) return () => {};
  const onMessage = (e: MessageEvent<CrossWindowSyncMessage>) => {
    if (e.data && typeof e.data.kind === "string") {
      handler(e.data);
    }
  };
  ch.addEventListener("message", onMessage);
  return () => ch.removeEventListener("message", onMessage);
}

export function isStandaloneSettingsWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("window") === "settings";
  } catch {
    return false;
  }
}

export const APPLY_MAIN_FILTER_EVENT = "audify:apply-main-filter";
export const SETTINGS_TAB_STORAGE_KEY = CENTRAL_SETTINGS_TAB_KEY;

const VALID_SETTINGS_TABS = new Set<SettingsTab>([
  "profiles",
  "appearance",
  "audio",
  "ai",
  "libraries",
  "collections",
  "tags",
  "genres",
  "licenses",
  "shortcuts",
  "advanced",
]);

export function normalizeSettingsTab(raw: unknown): SettingsTab {
  if (typeof raw === "string" && VALID_SETTINGS_TABS.has(raw as SettingsTab)) {
    return raw as SettingsTab;
  }
  return "profiles";
}
