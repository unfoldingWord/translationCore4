// Ship the production resource selectors and JournalingStore in the witness.
const path = require('node:path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'smoke-upgrade-entry.ts')],
  outfile: path.resolve(process.argv[2]),
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  absWorkingDir: path.resolve(__dirname, '..'), logLevel: 'warning',
});
