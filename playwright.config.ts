import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests and documentation screenshots of the built app (EVE-77), driven through Playwright's Electron
 * support. Both need `electron-vite build` first: `npm run e2e`, `npm run screenshots`. They open real windows,
 * so do not run them while EVE is being played on the same desktop.
 */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  projects: [
    { name: 'e2e', testIgnore: /screenshots\.spec\.ts/ },
    { name: 'screenshots', testMatch: /screenshots\.spec\.ts/ },
  ],
});
