import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Capacitor reads from `dist/` per capacitor.config.ts webDir.
    outDir: "dist",
  },
});
