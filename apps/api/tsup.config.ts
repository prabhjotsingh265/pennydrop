import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Our own packages are TypeScript source: bundle them in. Every npm package stays external,
  // those our packages use included; many are CommonJS, which an ES module bundle can't hold.
  noExternal: [/^@pennydrop\//],
  skipNodeModulesBundle: true,
});
