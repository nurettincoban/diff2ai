import { defineConfig } from 'tsup';
import copy from 'esbuild-plugin-copy';
import type { Plugin } from 'esbuild';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  clean: true,
  esbuildPlugins: [
    copy({
      assets: [{ from: 'templates/**/*', to: 'templates' }],
      verbose: true,
    }) as unknown as Plugin,
  ],
});
