import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  // Bundled, not imported at runtime: mero-platform 0.1.0 ships extensionless
  // directory imports (`export … from "./bridge"`) that bundlers resolve but
  // Node's ESM loader rejects. Left external, every consumer whose tests load
  // this package under Node (vitest without an inline rule) would fail to
  // import it. esbuild resolves them here instead; the code is small.
  noExternal: ['@calimero-network/mero-platform'],
  treeshake: true,
  minify: false,
  // Bundle styles.css into the JS output and inject it as a <style> tag at
  // runtime (on first import). Means consumers don't need a separate CSS
  // import — `import { ConnectButton } from '@calimero-network/mero-react'`
  // is enough for the styles to apply.
  injectStyle: true,
});
