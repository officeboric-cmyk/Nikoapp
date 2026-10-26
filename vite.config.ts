import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build also works from a sub-path (e.g. GitHub Pages).
  base: './',
  // Three.js alone is ~550 kB minified; that's expected for this game.
  build: { chunkSizeWarningLimit: 800 },
});
