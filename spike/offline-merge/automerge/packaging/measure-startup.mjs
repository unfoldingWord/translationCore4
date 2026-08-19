import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const DIST = '/tmp/tc4-automerge-proof-dist';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer((request, response) => {
  const requested = request.url === '/' ? '/index.html' : request.url;
  const file = path.resolve(DIST, `.${requested}`);
  if (!file.startsWith(`${DIST}${path.sep}`) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  response.setHeader('cache-control', 'no-store');
  response.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const measure = async (pageName) => {
  const runs = [];
  for (let i = 0; i < 20; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const wallStart = performance.now();
    await page.goto(`http://127.0.0.1:${port}/${pageName}`, { waitUntil: 'networkidle' });
    const inner = JSON.parse(await page.locator('#result').textContent());
    runs.push({ wall: performance.now() - wallStart, inner: inner.milliseconds });
    await context.close();
  }
  return runs;
};
const baseline = await measure('baseline.html');
const automerge = await measure('index.html');
await browser.close();
server.close();
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const result = {
  runs: 20,
  baseline: { wallMedianMs: median(baseline.map((x) => x.wall)), codeMedianMs: median(baseline.map((x) => x.inner)) },
  automerge: { wallMedianMs: median(automerge.map((x) => x.wall)), codeMedianMs: median(automerge.map((x) => x.inner)) },
};
result.delta = {
  wallMedianMs: result.automerge.wallMedianMs - result.baseline.wallMedianMs,
  codeMedianMs: result.automerge.codeMedianMs - result.baseline.codeMedianMs,
};
console.log(JSON.stringify(result));
