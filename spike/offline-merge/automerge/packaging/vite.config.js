import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import path from 'node:path';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [wasm()],
  base: './',
  build: {
    target: 'esnext',
    outDir: '/tmp/tc4-automerge-proof-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        automerge: path.resolve(new URL('.', import.meta.url).pathname, 'index.html'),
        baseline: path.resolve(new URL('.', import.meta.url).pathname, 'baseline.html'),
      },
    },
  },
});
