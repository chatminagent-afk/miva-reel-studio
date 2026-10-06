import { defineConfig } from 'vitest/config';

// E2E app Electron terbangun (out/): `npm run e2e` = build + xvfb-run vitest -c vitest.e2e.config.ts
export default defineConfig({
  test: { include: ['tests/e2e/**/*.e2e.ts'], testTimeout: 600_000, hookTimeout: 120_000, fileParallelism: false },
});
