import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { lane } from './e2e/lane.mjs';
import { collectNpmNotices, renderNpmNotices } from './scripts/third-party-npm.mjs';

// #524: TC4_VITE_PORT and TC4_RIG_PORT name this checkout's port lane (e2e/lane.mjs).
const LANE = lane();
// #520: "About translationCore" shows the version and the short commit hash of the running
// build (src/data/about.ts). The build reads git here; the app never does. A build outside a
// git checkout fails here: it has no hash to show.
const { version } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }).trim();
// #554: the build writes third-party-npm.md: the npm packages in the app, with each license
// text. The packager adds it to THIRD-PARTY-NOTICES.md. A package counts when it has code in
// an output chunk. The worker builds run inside the main build, so the main build's
// generateBundle sees the worker modules too.
const bundledModules = new Set();
const recordBundledModules = {
  name: 'tc4-bundled-modules',
  apply: 'build',
  generateBundle(_, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk') continue;
      for (const [id, info] of Object.entries(chunk.modules)) if (info.renderedLength > 0) bundledModules.add(id);
    }
  },
};
const thirdPartyNpm = {
  name: 'tc4-third-party-npm',
  apply: 'build',
  generateBundle() {
    const overrides = fileURLToPath(new URL('./scripts/license-overrides/', import.meta.url));
    this.emitFile({ type: 'asset', fileName: 'third-party-npm.md', source: renderNpmNotices(collectNpmNotices(bundledModules, overrides)) });
  },
};

export default defineConfig(({ command }) => ({
  plugins: [react(), nodePolyfills(), recordBundledModules, thirdPartyNpm],
  worker: { plugins: () => [recordBundledModules] },
  define: { __APP_VERSION__: JSON.stringify(version), __APP_COMMIT__: JSON.stringify(commit) },
  // pankosmia-web 0.18.15 (a83725b) has no CORS handling at all (source-verified 2026-10-03), so the dev
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
    port: LANE.vitePort,
    strictPort: true,
    proxy: {
      // keepAlive: without it the proxy opens a NEW upstream TCP connection per
      // request, and on Windows that put ~14 ms on every /api round trip
      // (issue #423, docs/evidence/open-time-windows-2026-09-28.md) — enough
      // that a many-read screen starved a project open behind it.
      '/api': { target: LANE.rigOrigin, changeOrigin: true, agent: new http.Agent({ keepAlive: true }) },
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
