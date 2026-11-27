import {
  APP_VERSION,
  AUDIFY_RELEASES_LATEST_URL,
} from "../constants/appInfo";
import { AUDIFY_STORAGE_KEYS } from "../constants/storageKeys";
import { safeGetItem, safeSetItem } from "../utils/localStorageSafe";
import { invokeCommand } from "../utils/tauriCommands";
import { isStandaloneSettingsWindow } from "../utils/windowContext";

export interface AppUpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_url: string;
  release_name: string;
  published_at: string;
}

export type AppUpdateStatus = "idle" | "checking" | "ready" | "error";

export interface AppUpdateSnapshot {
  info: AppUpdateInfo | null;
  status: AppUpdateStatus;
  lastCheckedAt: number | null;
  autoCheckEnabled: boolean;
  dismissedVersion: string | null;
  isBannerVisible: boolean;
  errorMessage: string | null;
}

interface StoredUpdateCache {
  checkedAt: number;
  info: AppUpdateInfo;
}

export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 3000;

function readAutoCheckEnabled(): boolean {
  const raw = safeGetItem(AUDIFY_STORAGE_KEYS.autoCheckUpdates);
  return raw !== "false";
}

function readDismissedVersion(): string | null {
  const raw = safeGetItem(AUDIFY_STORAGE_KEYS.dismissedUpdateVersion);
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

function readCachedUpdate(): StoredUpdateCache | null {
  try {
    const raw = safeGetItem(AUDIFY_STORAGE_KEYS.updateCheckCacheV1);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUpdateCache>;
    if (
      typeof parsed?.checkedAt !== "number" ||
      !Number.isFinite(parsed.checkedAt) ||
      !parsed.info ||
      typeof parsed.info.latest_version !== "string" ||
      typeof parsed.info.current_version !== "string"
    ) {
      return null;
    }
    // Invalidate stale cache immediately once the user updates Audify to a newer version
    if (parsed.info.current_version !== APP_VERSION) {
      return null;
    }
    return { checkedAt: parsed.checkedAt, info: parsed.info };
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let inFlightCheck: Promise<AppUpdateInfo | null> | null = null;
let activeCheckIsForced = false;
let storageBridgeAttached = false;
let snapshot: AppUpdateSnapshot = buildSnapshotFromStorage("idle", null);

function computeBannerVisible(
  info: AppUpdateInfo | null,
  dismissedVersion: string | null
): boolean {
  return Boolean(
    info &&
      info.has_update &&
      info.latest_version.length > 0 &&
      dismissedVersion !== info.latest_version
  );
}

function buildSnapshotFromStorage(
  status: AppUpdateStatus,
  errorMessage: string | null
): AppUpdateSnapshot {
  const cached = readCachedUpdate();
  const autoCheckEnabled = readAutoCheckEnabled();
  const dismissedVersion = readDismissedVersion();
  const info = cached?.info ?? null;
  return {
    info,
    status: info && status === "idle" ? "ready" : status,
    lastCheckedAt: cached?.checkedAt ?? null,
    autoCheckEnabled,
    dismissedVersion,
    isBannerVisible: computeBannerVisible(info, dismissedVersion),
    errorMessage,
  };
}

function setSnapshot(next: AppUpdateSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function ensureStorageSyncBridge(): void {
  if (storageBridgeAttached || typeof window === "undefined") return;
  storageBridgeAttached = true;
  window.addEventListener("storage", (e) => {
    if (
      e.key === AUDIFY_STORAGE_KEYS.autoCheckUpdates ||
      e.key === AUDIFY_STORAGE_KEYS.updateCheckCacheV1 ||
      e.key === AUDIFY_STORAGE_KEYS.dismissedUpdateVersion
    ) {
      if (e.key === AUDIFY_STORAGE_KEYS.updateCheckCacheV1) {
        const fresh = readCachedUpdate();
        setSnapshot(
          buildSnapshotFromStorage(fresh ? "ready" : snapshot.status, fresh ? null : snapshot.errorMessage)
        );
        return;
      }
      setSnapshot(buildSnapshotFromStorage(snapshot.status, snapshot.errorMessage));
    }
  });
}

export function getAppUpdateSnapshot(): AppUpdateSnapshot {
  ensureStorageSyncBridge();
  return snapshot;
}

export function subscribeAppUpdate(listener: () => void): () => void {
  ensureStorageSyncBridge();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAutoCheckUpdates(enabled: boolean): void {
  safeSetItem(AUDIFY_STORAGE_KEYS.autoCheckUpdates, String(enabled), {
    broadcast: false,
  });
  setSnapshot({
    ...snapshot,
    autoCheckEnabled: enabled,
  });
}

export function dismissUpdateBanner(version: string): void {
  const clean = version.trim();
  if (!clean) return;
  safeSetItem(AUDIFY_STORAGE_KEYS.dismissedUpdateVersion, clean, {
    broadcast: false,
  });
  setSnapshot({
    ...snapshot,
    dismissedVersion: clean,
    isBannerVisible: computeBannerVisible(snapshot.info, clean),
  });
}

export async function checkForAppUpdates(opts?: {
  force?: boolean;
}): Promise<AppUpdateInfo | null> {
  const force = Boolean(opts?.force);
  if (!force) {
    const cached = readCachedUpdate();
    if (cached && Date.now() - cached.checkedAt < UPDATE_CACHE_TTL_MS) {
      setSnapshot(buildSnapshotFromStorage("ready", null));
      return cached.info;
    }
  }

  if (inFlightCheck) {
    if (force) activeCheckIsForced = true;
    return inFlightCheck;
  }

  activeCheckIsForced = force;
  setSnapshot({
    ...snapshot,
    status: "checking",
    errorMessage: null,
  });

  inFlightCheck = (async () => {
    try {
      const info = await invokeCommand("check_app_update", {});
      const checkedAt = Date.now();
      const cachePayload: StoredUpdateCache = { checkedAt, info };
      safeSetItem(
        AUDIFY_STORAGE_KEYS.updateCheckCacheV1,
        JSON.stringify(cachePayload),
        { broadcast: false }
      );
      const dismissedVersion = readDismissedVersion();
      setSnapshot({
        info,
        status: "ready",
        lastCheckedAt: checkedAt,
        autoCheckEnabled: readAutoCheckEnabled(),
        dismissedVersion,
        isBannerVisible: computeBannerVisible(info, dismissedVersion),
        errorMessage: null,
      });
      return info;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reportError = activeCheckIsForced;
      setSnapshot({
        ...snapshot,
        status: reportError ? "error" : snapshot.info ? "ready" : "idle",
        errorMessage: reportError ? msg : null,
      });
      return null;
    } finally {
      inFlightCheck = null;
      activeCheckIsForced = false;
    }
  })();

  return inFlightCheck;
}

export function scheduleStartupUpdateCheck(): () => void {
  ensureStorageSyncBridge();
  if (isStandaloneSettingsWindow() || !readAutoCheckEnabled()) {
    return () => {};
  }
  const timer = window.setTimeout(() => {
    if (readAutoCheckEnabled()) {
      void checkForAppUpdates({ force: false });
    }
  }, STARTUP_CHECK_DELAY_MS);
  return () => window.clearTimeout(timer);
}

export function sanitizeAudifyReleaseUrl(raw?: string): string {
  if (!raw) return AUDIFY_RELEASES_LATEST_URL;
  try {
    const parsed = new URL(raw.trim());
    const path = parsed.pathname;
    const validPath =
      path === "/saimdeniz/audify" ||
      path === "/saimdeniz/audify/" ||
      path.startsWith("/saimdeniz/audify/releases");
    if (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "github.com" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      validPath
    ) {
      return parsed.toString();
    }
  } catch {
    // Fall back to canonical latest releases URL
  }
  return AUDIFY_RELEASES_LATEST_URL;
}

export async function openAudifyReleasesPage(url?: string): Promise<void> {
  const target = sanitizeAudifyReleaseUrl(url);
  try {
    await invokeCommand("open_github_url", { url: target });
  } catch {
    if (typeof window !== "undefined") {
      window.open(target, "_blank", "noopener,noreferrer");
    }
  }
}

/** Test-only helper to reset singleton module state cleanly between cases. */
export function resetAppUpdateStateForTest(): void {
  inFlightCheck = null;
  activeCheckIsForced = false;
  snapshot = buildSnapshotFromStorage("idle", null);
  for (const listener of listeners) {
    listener();
  }
}
