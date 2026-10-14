#!/usr/bin/env node
// seed-ar-gt.mjs — #650 slice 3: the Arabic package of ar_gt, installed in the rig.
//
// ar_gt publishes tN, tW and tA but no `_twl`, so its set pins the bundled `en_twl` with
// its own `ar_tw` (D97 ruling 7). Door43's catalogue does not mark ar_gt's repositories
// `tc-ready` [VERIFIED — git.door43.org/api/v1/catalog/search?owner=ar_gt, 2026-10-14], so
// the Source texts screen offers nothing to download for it: the rig installs it instead.
//
// Writes each cached release (dev-env/resources-cache) as a fresh install writes it: the
// unwrapped export under repos/_local_/_sideloaded_/<owner>--<repo>, and an install record
// in client_settings/uw-tc4.json with the repo path, the release tag, and the commit and
// flavor of its metadata. The other records stay as they are.
//
// Usage:  node scripts/seed-ar-gt.mjs <work dir> <resources-cache dir>
// Called by the J4 case of AC3, just before it chooses ar_gt, and not by the seed: an
// installed ar_gt is a third package in every Project settings, which other journeys count.

import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const [work, cache] = process.argv.slice(2);
if (!work || !cache) {
  console.error('usage: seed-ar-gt.mjs <work dir> <resources-cache dir>');
  process.exit(2);
}

const OWNER = 'ar_gt';
const RELEASES = [['ar_tn', 'v3.2'], ['ar_tw', 'v3'], ['ar_ta', 'v3.3']];

const csPath = path.join(work, 'client_settings', 'uw-tc4.json');
const settings = fs.existsSync(csPath) ? JSON.parse(fs.readFileSync(csPath, 'utf8')) : {};
settings.installedResources ??= {};
const done = [];
for (const [repo, tag] of RELEASES) {
  const zip = path.join(cache, `${repo}-${tag}-unwrapped.zip`);
  if (!fs.existsSync(zip)) {
    console.log(`ar_gt: ${repo} ${tag} is not cached; ar_gt is not installed`);
    process.exit(0);
  }
  const key = `_local_/_sideloaded_/${OWNER.toLowerCase()}--${repo}`;
  const dest = path.join(work, 'repos', ...key.split('/'));
  fs.rmSync(dest, { recursive: true, force: true });
  for (const [name, bytes] of Object.entries(unzipSync(new Uint8Array(fs.readFileSync(zip))))) {
    if (name.endsWith('/')) continue;
    const p = path.join(dest, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
  const meta = JSON.parse(strFromU8(fs.readFileSync(path.join(dest, 'metadata.json'))));
  const sha = Object.values(meta.identification?.primary?.dcs ?? {})[0]?.revision;
  const ft = meta.type?.flavorType ?? {};
  if (!sha) throw new Error(`${repo} ${tag}: no revision in its metadata`);
  settings.installedResources[key] = { repoPath: `git.door43.org/${OWNER}/${repo}`, version: tag, flavor: `${ft.name}/${ft.flavor?.name}`, sha };
  done.push(`${repo} ${tag}`);
}
fs.mkdirSync(path.dirname(csPath), { recursive: true });
fs.writeFileSync(csPath, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`ar_gt installed: ${done.join(', ')}`);
