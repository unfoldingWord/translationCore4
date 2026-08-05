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
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:19998', changeOrigin: true },
    },
  },
  test: {
    // Tests default to node; the word-aligner mount test opts into jsdom via
    // a per-file `@vitest-environment jsdom` pragma (TEST-PLAN §2.3 S-0a).
    environment: 'node',
    include: ['test/**/*.test.{js,jsx,ts,tsx}'],
  },
}));
