#!/usr/bin/env node
// write-install-records.mjs <work dir> — issue #396, decision D57.
//
// A sideloaded resource's metadata holds only its commit sha; the release tag exists
// only in the machine's install record. D57: "The dev rig's seed writes the install
// records for the tags it sideloads." seed.zsh calls this script after its sideload step.
//
// A Node port of the owner's workspace seed.zsh block (quoted in #396), which is the
// journey baseline. It writes <work dir>/client_settings/uw-tc4.json `installedResources`:
//   - one record per listed resource that is present under repos/_local_/_sideloaded_/;
//   - key: the on-disk directory, the bare name (`_local_/_sideloaded_/en_tn`) —
//     discoverOnDisk (src/data/installed.ts) merges records by that path;
//   - `sha`: the first `identification.primary.dcs` revision of the resource's
//     metadata.json; a record with no revision has no `sha` field;
//   - `flavor`: `<flavorType>/<flavor>` from the metadata, built as the workspace block
//     builds it.
// The OBS resources and the picture pack get no record, as in the workspace block.
// The other keys of uw-tc4.json stay as they are.
import fs from 'node:fs';
import path from 'node:path';

const work = process.argv[2];
if (!work) {
  console.error('usage: node write-install-records.mjs <work dir>');
  process.exit(2);
}

const ORG = { 'es-419_tn': 'es-419_gl', 'es-419_tw': 'es-419_gl', 'es-419_ta': 'es-419_gl' };
const VERSIONS = {
  en_ult: 'v89',
  en_ust: 'v89',
  en_tn: 'v89',
  en_tw: 'v89',
  en_ta: 'v89',
  en_tq: 'v89',
  'el-x-koine_ugnt': 'v0.34',
  'es-419_tn': 'v66',
  'es-419_tw': 'v37',
  'es-419_ta': 'v4',
};

const installed = {};
for (const [name, version] of Object.entries(VERSIONS)) {
  const metaPath = path.join(work, 'repos', '_local_', '_sideloaded_', name, 'metadata.json');
  if (!fs.existsSync(metaPath)) continue;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const dcs = meta?.identification?.primary?.dcs || {};
  const sha = Object.values(dcs)[0]?.revision;
  const ft = meta?.type?.flavorType ?? {};
  const flavor = `${ft.name ?? ''}/${(ft.flavor || {}).name ?? ''}`;
  const org = ORG[name] ?? 'unfoldingWord';
  const pin = { repoPath: `git.door43.org/${org}/${name}`, version, flavor };
  if (sha) pin.sha = sha;
  installed[`_local_/_sideloaded_/${name}`] = pin;
}

const csDir = path.join(work, 'client_settings');
fs.mkdirSync(csDir, { recursive: true });
const csPath = path.join(csDir, 'uw-tc4.json');
const current = fs.existsSync(csPath) ? JSON.parse(fs.readFileSync(csPath, 'utf8')) : {};
current.installedResources = installed;
fs.writeFileSync(csPath, `${JSON.stringify(current, null, 2)}\n`);
const names = Object.keys(installed).map((key) => key.split('/').pop());
console.log(`install records: ${names.length} (${names.join(', ') || 'none'})`);
