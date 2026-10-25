import { defineConfig } from 'astro/config';
import path from 'node:path';

// Pure static output, no adapter: everything is HTML on disk at the end of `astro build`.
export default defineConfig({
  output: 'static',
  site: process.env.PUBLIC_URL || 'https://static.example.com',
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_astro' },
  outDir: process.env.DIST_DIR || path.resolve('..', 'dist'), // DIST_DIR is absolute when set by build.mjs
  compressHTML: true,
});
