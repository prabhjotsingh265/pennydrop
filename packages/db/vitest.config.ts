import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup.ts'],
    // One database for the whole suite: files run one at a time so they don't empty each other's tables.
    fileParallelism: false,
  },
});
