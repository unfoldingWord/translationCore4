// Application start-up probe — issue #80.
// Measures the cold-load time of the PRODUCTION client as the rig serves it
// (http://127.0.0.1:19998/clients/uw-tc4/ — the same path a packaged app uses).
//
// Method: one fresh browser context per run (empty cache = a cold load). The clock
// starts before navigation and stops when the Home screen's "New Bible" button is
// visible — the first point a user can act. One unmeasured warm-up run heats the
// server; 5 measured runs follow; the median is the recorded number.
//
// Run:  rig up (dev-env/scripts/run.zsh), fresh build installed
//       (scripts/rig-install.zsh), then:  node docs/evidence/tools/bench-startup.mjs
import { chromium } from '@playwright/test';

const URL = process.env.TC4_CLIENT_URL || 'http://127.0.0.1:19998/clients/uw-tc4/';
const RUNS = 5;

const browser = await chromium.launch();
const load = async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const t0 = process.hrtime.bigint();
  await page.goto(URL);
  await page.getByRole('button', { name: 'New Bible' }).waitFor({ timeout: 30_000 });
  const readyMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const nav = await page.evaluate(() => {
    const [n] = performance.getEntriesByType('navigation');
    return { domContentLoaded: n.domContentLoadedEventEnd, loadEvent: n.loadEventEnd, transfer: n.transferSize };
  });
  await context.close();
  return { readyMs, ...nav };
};

await load(); // warm-up (server caches, JIT) — not recorded
const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await load());
await browser.close();

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`start-up probe — ${URL}`);
for (const r of runs)
  console.log(`  ready ${r.readyMs.toFixed(0)} ms  (domContentLoaded ${r.domContentLoaded.toFixed(0)} ms, load ${r.loadEvent.toFixed(0)} ms)`);
console.log(`median time-to-interactive (Home "New Bible" visible): ${med(runs.map((r) => r.readyMs)).toFixed(0)} ms over ${RUNS} cold loads`);
