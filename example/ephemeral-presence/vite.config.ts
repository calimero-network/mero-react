import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Both SDK halves are consumed from the LOCAL working copies, not from npm:
// this example exists to exercise the un-released ephemeral-presence surface.
//
//  * `@calimero-network/mero-react` -> ../../src (TypeScript source; Vite
//    transpiles it, so there is no build step between an edit and the browser).
//  * `@calimero-network/mero-js`    -> ../../../mero-js/dist/index.mjs, the
//    sibling checkout's build output. `npm run build` there before running
//    this app. The non-minified `index.mjs` (esbuild platform=neutral) is used
//    rather than `index.browser.mjs` so stack traces stay readable; both are
//    built from the same source.
//
// Aliasing is deliberately used INSTEAD of bumping mero-react's
// `@calimero-network/mero-js` dependency, which stays at `^7.3.0`.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@calimero-network/mero-js',
        replacement: here('../../../mero-js/dist/index.mjs'),
      },
      { find: '@calimero-network/mero-react', replacement: here('../../src') },
    ],
    // One React instance only: mero-react is aliased to source outside this
    // package's node_modules, so without this its `react` import can resolve to
    // a second copy and every hook throws "invalid hook call".
    dedupe: ['react', 'react-dom'],
  },
  // 5273, not Vite's default 5173: a stray dev server on 5173 is common in this
  // workspace, and silently landing on a different port breaks the Playwright
  // baseURL. strictPort makes a collision fail loudly instead.
  server: { port: 5273, strictPort: true },
});
