#!/usr/bin/env node
// fetch-help.mjs — put the help pages into the client (#519).
//
// The help pages are `tc-help/` in unfoldingWord/tc-website. This script is the ONE pin of
// that repository: it fetches the pinned commit and copies `tc-help/` to `public/help/`
// (gitignored). Vite serves `public/` in development and copies it to `dist/help/` in a
// build, so the rig and the packaged app serve the pages at `/clients/uw-tc4/help/`.
// `npm run build` and `npm run dev` run it first (`prebuild`, `predev`).
//
//   node scripts/fetch-help.mjs
//
// The fetch is sparse and shallow: only the blobs of `tc-help/` at the pin (about 21 MB).
// `public/help/.tc-website-rev` holds the pin of the copy on disk. When it names this pin,
// the script uses no network. It is written last, so an interrupted copy is fetched again.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/unfoldingWord/tc-website.git';
// The pages that describe 4.0.0-rc.1 [decided 2026-10-09 — owner, #519]. Change the pin here only.
export const TC_WEBSITE_REV = 'cdfdf9b7d534e7574beb3fcf44678973cdc5f9d7'; // 2026-10-09

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'help');
const STAMP = path.join(OUT, '.tc-website-rev');

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function main() {
  if (read(STAMP) === TC_WEBSITE_REV) {
    console.log(`help pages: public/help/ is tc-website ${TC_WEBSITE_REV.slice(0, 7)}`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-help-'));
  const git = (...args) => execFileSync('git', ['-C', tmp, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    git('remote', 'add', 'origin', REPO);
    git('sparse-checkout', 'set', '--no-cone', '/tc-help/');
    git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', TC_WEBSITE_REV);
    git('checkout', '-q', 'FETCH_HEAD');
    const head = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (head !== TC_WEBSITE_REV) throw new Error(`fetched ${head}, not the pin`);
    const pages = path.join(tmp, 'tc-help');
    if (!fs.existsSync(path.join(pages, 'index.html'))) throw new Error('the pinned commit has no tc-help/index.html');
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.cpSync(pages, OUT, { recursive: true });
    fs.writeFileSync(STAMP, `${TC_WEBSITE_REV}\n`);
    console.log(`help pages: copied tc-website ${TC_WEBSITE_REV.slice(0, 7)} tc-help/ to public/help/`);
  } catch (err) {
    console.error(`help pages: could not fetch ${REPO} at ${TC_WEBSITE_REV} into public/help/: ${err.message}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
