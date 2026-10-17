import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron",
      rollupOptions: { input: "electron/main.ts" },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      emptyOutDir: false,
      outDir: "dist-electron",
      rollupOptions: {
        input: "electron/preload.ts",
        output: { format: "cjs", entryFileNames: "preload.cjs" },
      },
    },
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: { outDir: "dist", rollupOptions: { input: resolve("index.html") } },
  },
});
