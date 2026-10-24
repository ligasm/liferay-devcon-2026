import { defineConfig } from 'astro/config';

// Pure static output, no adapter: everything is HTML on disk at the end of `astro build`.
export default defineConfig({
  output: 'static',
  site: process.env.PUBLIC_URL || 'https://static.example.com',
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_astro' },
  outDir: '../dist',
  compressHTML: true,
});
