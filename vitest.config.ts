import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests spawn git in throwaway repos; isolate them from the
    // developer's global/system git config so results match CI everywhere.
    env: {
      GIT_CONFIG_GLOBAL: path.resolve('tests/fixtures/gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    },
    testTimeout: 30_000,
  },
});
