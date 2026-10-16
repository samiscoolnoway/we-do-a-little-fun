import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Everything is bundled into one JS file and one CSS file so that
// scripts/make-standalone.mjs can inline them into single-file HTML builds.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
