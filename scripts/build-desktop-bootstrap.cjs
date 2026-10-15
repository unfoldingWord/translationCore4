const path = require('node:path');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const directory = process.argv[2];
fs.mkdirSync(directory, { recursive: true });
// Bundle fflate into the artifact; a packaged app has no development
// node_modules directory. The worker and launcher resolve only local files.
for (const [source, target] of [
  ['desktop-bootstrap.cjs', 'tc4-bootstrap.cjs'],
  ['desktop-prepare.cjs', 'tc4-prepare.cjs'],
]) buildSync({ entryPoints: [path.join(__dirname, source)], outfile: path.join(directory, target), bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
fs.copyFileSync(path.join(__dirname, 'desktop-resource-worker.cjs'), path.join(directory, 'tc4-resource-worker.cjs'));
fs.copyFileSync(path.join(__dirname, 'desktop-preparing.html'), path.join(directory, 'tc4-preparing.html'));
