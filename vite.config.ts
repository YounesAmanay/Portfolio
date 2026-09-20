import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative asset paths, so the same build works from a filesystem, a preview
  // server, and a GitHub Pages project subpath (/<repo>/) without rebuilding.
  base: './',
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@kinetic': fileURLToPath(new URL('./src/kinetic', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
    },
  },
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
});
