import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["mail.localhost", "localhost"],
    hmr: { clientPort: 8443, protocol: "wss", host: "mail.localhost" },
    proxy: { "/api": "http://localhost:3000" },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "editor", test: /node_modules[\\/](@tiptap|prosemirror)/ },
            { name: "vendor", test: /node_modules/ },
          ],
        },
      },
    },
  },
});
