import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { API_PREFIXES } from './shared/apiPrefixes.js';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, 'http://localhost:3000'])),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
