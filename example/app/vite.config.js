import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        404: resolve(__dirname, 'public/404.html'),
      },
    },
  },
  // The example links to a sibling `mero-react` via `file:../..`. Without
  // these excludes, Vite pre-bundles the package once on first start and
  // reuses that snapshot until `node_modules/.vite/` is cleared — so any new
  // export added to `mero-react/dist/` (e.g. `CalimeroLogo`) goes missing
  // until you `--force` or rm the cache. Excluding tells Vite to re-resolve
  // these on every request, which is what we want for local iteration.
  optimizeDeps: {
    exclude: ['@calimero-network/mero-react', '@calimero-network/mero-js'],
  },
  plugins: [nodePolyfills(), react()],
});
