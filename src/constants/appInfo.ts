import { version } from "../../package.json";

/** Single source of truth for the running Audify version (synced with package.json & Tauri). */
export const APP_VERSION: string = version;
