import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AUDIFY_STORAGE_KEYS } from "./constants/storageKeys";
import { safeGetItem } from "./store/storageHelpers";
import "./index.css";

try {
  const params = new URLSearchParams(window.location.search);
  const urlTheme = params.get("theme");
  const savedTheme = safeGetItem(AUDIFY_STORAGE_KEYS.themeMode);
  const initTheme =
    urlTheme === "light" || urlTheme === "contrast" || urlTheme === "dark"
      ? urlTheme
      : savedTheme === "light" ||
        savedTheme === "contrast" ||
        savedTheme === "dark"
      ? savedTheme
      : "dark";
  document.documentElement.setAttribute("data-theme", initTheme);
} catch {
  // Ignore storage access errors
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
