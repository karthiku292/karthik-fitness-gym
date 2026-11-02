import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Use 127.0.0.1 (not localhost) so Windows IPv6 (::1) resolution
        // can't break the proxy to the IPv4-bound backend.
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
