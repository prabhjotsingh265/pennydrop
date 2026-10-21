import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Our own packages are TypeScript source: bundle them in; npm packages stay external.
  noExternal: [/^@pennydrop\//],
});
