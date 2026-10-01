import { defineConfig } from 'tsup';
import { copy } from 'esbuild-plugin-copy';
import type { Plugin } from 'esbuild';

// The package only ships a CLI binary, so a single ESM bundle is enough:
// no CJS build and no type declarations.
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  dts: false,
  outDir: 'dist',
  clean: true,
  esbuildPlugins: [
    copy({
      assets: [{ from: 'templates/**/*', to: 'templates' }],
      verbose: false,
    }) as unknown as Plugin,
  ],
});
