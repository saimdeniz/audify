import { useEffect, useSyncExternalStore } from "react";
import {
  AppUpdateSnapshot,
  getAppUpdateSnapshot,
  scheduleStartupUpdateCheck,
  subscribeAppUpdate,
} from "../services/updateCheckService";

export function useAppUpdate(): AppUpdateSnapshot {
  return useSyncExternalStore(
    subscribeAppUpdate,
    getAppUpdateSnapshot,
    getAppUpdateSnapshot
  );
}

export function useStartupUpdateCheck(): void {
  useEffect(() => scheduleStartupUpdateCheck(), []);
}
