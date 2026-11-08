// Runs uw-content-validation's checkUSFMText on one aligned USFM file, serving the UGNT from
// this repository's Titus fixture instead of the network, and prints every notice.
//
//   npm install uw-content-validation@3.2.2 @babel/runtime@7.26.10   (in a scratch directory)
//   node run.mjs <that directory's node_modules> <usfm file> [label]
//
// The header says whether the validator's span walk is patched (see the evidence document).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [modules, file, label = path.basename(file ?? '')] = process.argv.slice(2);
const require = createRequire(path.resolve(modules, 'x.js'));

// The validator caches through localforage, a browser store. Under node, give it a memory map.
const memoryStore = () => {
  const m = new Map();
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => (m.set(k, v), v),
    clear: async () => m.clear(),
    length: async () => m.size,
  };
};
const lf = require.resolve('localforage');
require(lf);
require.cache[lf].exports = { INDEXEDDB: 'memory', createInstance: memoryStore };

const ucv = require('uw-content-validation');
const version = require('uw-content-validation/package.json').version;
const dist = require.resolve('uw-content-validation/dist/core/usfm-text-check.js');
const patched = !readFileSync(dist, 'utf8').includes('thisV = bookLine.slice(3);');

const here = path.dirname(fileURLToPath(import.meta.url));
const UGNT = path.resolve(here, '../../../fixtures/align/el-x-koine_ugnt-TIT.usfm');
const fetched = [];
async function getFile({ username, repository, path: p, branch }) {
  fetched.push(`${username}/${repository}/${branch}/${p}`);
  if (repository === 'el-x-koine_ugnt' && p === '57-TIT.usfm') return readFileSync(UGNT, 'utf8');
  throw new Error(`no network: refused ${username}/${repository}/${p}`);
}

const text = readFileSync(file, 'utf8');
const result = await ucv.checkUSFMText('unfoldingWord', 'en', 'ULT', 'TIT', '57-TIT.usfm', text, '', {
  getFile,
  suppressNoticeDisablingFlag: true,
});
const notices = result.noticeList ?? [];
console.log(
  `uw-content-validation ${version} (${patched ? 'span walk patched' : 'as published'}) on ${label}: ${notices.length} notices; fetched ${JSON.stringify(fetched)}`,
);
for (const n of notices) {
  const where = `${n.C ?? ''}:${n.V ?? ''}${n.lineNumber ? ` line ${n.lineNumber}` : ''}`;
  console.log(`  [${n.priority}] ${n.message}${n.details ? ` — ${n.details}` : ''} (${where})`);
}
const alignment = notices.filter((n) => /x-ref|original|occurrence|zaln/i.test(`${n.message} ${n.details ?? ''}`));
console.log(`alignment/x-ref notices: ${alignment.length}`);
