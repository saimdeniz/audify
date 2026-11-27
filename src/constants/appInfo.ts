import { version } from "../../package.json";

/** Single source of truth for the running Audify version (synced with package.json & Tauri). */
export const APP_VERSION: string = version;

export const AUDIFY_GITHUB_REPO_URL = "https://github.com/saimdeniz/audify";
export const AUDIFY_RELEASES_LATEST_URL =
  "https://github.com/saimdeniz/audify/releases/latest";
