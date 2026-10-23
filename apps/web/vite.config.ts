import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// In Docker the API is reachable as http://api:3001; outside it, on localhost.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:3001';

/**
 * Every text file of the build also written compressed (.br and .gz), once, at the highest
 * settings: the API sends whichever the browser takes, without compressing on each request.
 */
function precompress(): Plugin {
  let outDir = '';
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  return {
    name: 'pennydrop:precompress',
    apply: 'build',
    configResolved(config) {
      // The prerender's own build, for Node, is never served.
      outDir = config.build.ssr ? '' : resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!outDir) return;
      for (const path of files(outDir)) {
        // Fonts and images are compressed already; tiny files gain nothing.
        if (!/\.(js|css|html|svg|txt|json|xml)$/.test(path) || statSync(path).size < 1024) continue;
        const body = readFileSync(path);
        writeFileSync(`${path}.gz`, gzipSync(body, { level: 9 }));
        writeFileSync(
          `${path}.br`,
          brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': apiOrigin,
    },
  },
});
