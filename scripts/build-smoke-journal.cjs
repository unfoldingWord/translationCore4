// Bundle the real JournalingStore lifecycle into a self-contained artifact
// helper. The installed smoke machine has no checkout or TypeScript runtime;
// esbuild embeds the production client code at package time.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const [out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/build-smoke-journal.cjs <output.cjs>');
  process.exit(2);
}
const root = path.resolve(__dirname, '..');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'smoke-journal-entry.ts')],
  outfile: path.resolve(out),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  absWorkingDir: root,
  logLevel: 'warning',
});
fs.chmodSync(path.resolve(out), 0o755);
