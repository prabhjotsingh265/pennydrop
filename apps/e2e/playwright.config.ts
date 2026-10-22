import { defineConfig, devices } from '@playwright/test';

/**
 * End to end, against a running Pennydrop: the whole stack, practice shops
 * included. Locally `make e2e` runs these on the web container's own network,
 * so the page's origin is the one the API trusts; CI starts the stack itself.
 */
export default defineConfig({
  testDir: './tests',
  // One shared demo, broken and fixed in turn: one test at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /demo\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/demo.json' },
      dependencies: ['setup'],
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], storageState: '.auth/demo.json' },
      dependencies: ['setup'],
    },
  ],
});
