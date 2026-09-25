import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ command }) => ({
  plugins: [react(), nodePolyfills()],
  // pankosmia-web 0.18.5 has no CORS handling at all (source-verified), so the dev
  // server proxies /api to the rig — same-origin to the browser. The built client is
  // served BY the rig from /clients/uw-tc4; the server's homepage redirect points at
  // the slash-less path, where relative ('./') asset URLs resolve wrongly and the
  // page renders blank — so the build uses the ABSOLUTE client base (cf. PLATFORM-NOTES #18).
  base: command === 'build' ? '/clients/uw-tc4/' : '/',
  // #1: the suggestion engine loads only inside its Web Worker, on the first
  // Suggest. Pre-bundle it, or the dev server discovers the three CJS packages
  // at that moment and reloads the page ("new dependencies optimized") — mid-
  // session, and under the e2e journeys.
  optimizeDeps: { include: ['uw-wordmapbooster', 'wordmap', 'wordmap-lexer'] },
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:19998', changeOrigin: true },
    },
  },
  test: {
    // Tests default to node; a test that needs the DOM opts into jsdom via
    // a per-file `@vitest-environment jsdom` pragma.
    environment: 'node',
    include: ['test/**/*.test.{js,jsx,ts,tsx}'],
    // Vitest empties CSS imports by default, `?raw` too. The PDF export's print
    // document carries this stylesheet as text (#20), so tests read the real file.
    css: { include: [/print\.css/] },
  },
}));
