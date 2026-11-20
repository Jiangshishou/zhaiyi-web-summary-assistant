import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/index.ts")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        manualChunks: undefined
      }
    }
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"]
  }
});
