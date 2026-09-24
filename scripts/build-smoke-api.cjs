// Bundle the installed API smoke helper and its ZIP reader. The installed
// machine has no checkout or npm dependencies, so fflate must ship in the file.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const [out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/build-smoke-api.cjs <output.cjs>');
  process.exit(2);
}

const output = path.resolve(out);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'smoke-api.cjs')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  absWorkingDir: path.resolve(__dirname, '..'),
  logLevel: 'warning',
});
fs.chmodSync(output, 0o755);
