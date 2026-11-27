import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@tauri-apps")) return "tauri-vendor";
          if (id.includes("lucide-react")) return "lucide-icons";
          if (id.includes("@tanstack/react-virtual")) return "virtual-table";
          if (
            id.includes("\\react\\") ||
            id.includes("/react/") ||
            id.includes("react-dom") ||
            id.includes("\\scheduler\\") ||
            id.includes("/scheduler/") ||
            id.includes("zustand")
          ) {
            return "react-vendor";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
