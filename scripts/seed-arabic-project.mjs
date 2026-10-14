#!/usr/bin/env node
// seed-arabic-project.mjs — #650: the Arabic right-to-left project of the rig.
//
// Builds a Titus project in Arabic from two real sources: the structure of
// conformance/sample-burrito (its Titus, its versification, its resource pins) and the
// text of Titus 1:1-5 from BSOJ's Arabic Bible (`ar_avd`, the cached release in
// dev-env/resources-cache). The verses the sample leaves undrafted stay undrafted. The
// metadata says `ar` and `scriptDirection: "rtl"`. The pins are the English package,
// as a new project has them: the J4 Arabic run downloads BSOJ and changes to it.
//
// Usage:  node scripts/seed-arabic-project.mjs <dest-dir> <ar_avd unwrapped zip>
//   <dest-dir>  the project directory to create (removed first if present), e.g.
//               <rig>/state/work/repos/_local_/_local_/arabic_burrito
//
// Called from dev-env/scripts/seed.zsh when TC4_ARABIC_FIXTURE=1.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import usfm from 'usfm-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(HERE, '..', 'conformance', 'sample-burrito');
const [dest, avdZip] = process.argv.slice(2);
if (!dest || !avdZip) {
  console.error('usage: seed-arabic-project.mjs <dest-dir> <ar_avd unwrapped zip>');
  process.exit(2);
}

// The Arabic Titus: its header lines and the text of each verse.
const files = unzipSync(new Uint8Array(fs.readFileSync(avdZip)), { filter: (f) => /(^|\/)[0-9]*-?TIT\.usfm$/i.test(f.name) });
const avdName = Object.keys(files)[0];
if (!avdName) throw new Error(`no Titus in ${avdZip}`);
const avd = strFromU8(files[avdName]);
const headerOf = (marker) => (new RegExp(`^\\\\${marker} (.+)$`, 'm').exec(avd) ?? [])[1]?.trim();
// The Bible has no \mt line: the main title is its running title.
const header = (marker) => headerOf(marker) ?? (marker === 'mt' ? headerOf('h') : undefined);
const flatten = (objects) => (objects ?? []).map((o) => {
  if (o.type === 'footnote' || o.tag === 'f') return '';
  if (o.children) return flatten(o.children);
  return o.text ?? '';
}).join('');
const chapters = usfm.toJSON(avd).chapters;
const arabicVerse = (c, v) => flatten(chapters[String(c)]?.[String(v)]?.verseObjects).replace(/\s+/g, ' ').trim();

// The sample's Titus, with Arabic in each verse the sample drafted.
let chapter = 0;
const tit = fs.readFileSync(path.join(SAMPLE, 'ingredients', 'TIT.usfm'), 'utf8').split('\n').map((line) => {
  const c = /^\\c (\d+)/.exec(line);
  if (c) chapter = Number(c[1]);
  const v = /^\\v (\d+) (.*)$/.exec(line);
  if (v && v[2].trim() !== '___') {
    const text = arabicVerse(chapter, v[1]);
    if (!text) throw new Error(`no Arabic text for Titus ${chapter}:${v[1]}`);
    return `\\v ${v[1]} ${text}`;
  }
  if (/^\\id /.test(line)) return '\\id TIT ar_tit';
  for (const marker of ['h', 'toc1', 'toc2', 'toc3', 'mt']) {
    if (line.startsWith(`\\${marker} `) && header(marker)) return `\\${marker} ${header(marker)}`;
  }
  return line;
}).join('\n').normalize('NFC'); // The burrito declares NFC (meta.normalization); the Bible's text is not.

// The pins: the English package on both rungs, as a newly created project holds them.
const resources = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'ingredients', 'checking', 'resources.json'), 'utf8'));
resources.languageSets.primary = JSON.parse(JSON.stringify(resources.languageSets.fallback));

const settings = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'ingredients', 'checking', 'settings.json'), 'utf8'));
for (const pane of settings.ui?.paneSettings ?? []) if (pane.bibleId === 'targetBible') pane.languageId = 'ar';

// Write the project, then its metadata with the size and md5 of each ingredient.
fs.rmSync(dest, { recursive: true, force: true });
const write = (rel, bytes) => {
  const p = path.join(dest, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return Buffer.from(bytes);
};
const ingredients = {};
const ingredient = (rel, bytes, extra) => {
  const b = write(path.join('ingredients', rel), bytes);
  ingredients[`ingredients/${rel}`] = {
    checksum: { md5: crypto.createHash('md5').update(b).digest('hex') },
    mimeType: rel.endsWith('.json') ? 'application/json' : 'text/plain',
    size: b.length,
    ...extra,
  };
};
ingredient('TIT.usfm', tit, { scope: { TIT: [] } });
ingredient('vrs.json', fs.readFileSync(path.join(SAMPLE, 'ingredients', 'vrs.json')), {});
ingredient('checking/resources.json', `${JSON.stringify(resources, null, 2)}\n`, { role: 'x-resource-links' });
ingredient('checking/settings.json', `${JSON.stringify(settings, null, 2)}\n`, { role: 'x-check-settings' });

const metadata = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'metadata.json'), 'utf8'));
const name = 'فريق التجربة — تيطس';
metadata.identification = {
  primary: { local: { ar_tit: { revision: '1', timestamp: '2026-10-14T12:00:00.000Z' } } },
  name: { en: name, ar: name },
  description: { en: 'Arabic right-to-left rig project for #650 (Titus 1:1-5 drafted from BSOJ ar_avd)' },
  abbreviation: { en: 'ar_tit' },
};
metadata.languages = [{ tag: 'ar', name: { en: 'Arabic', ar: 'العربية' }, scriptDirection: 'rtl' }];
metadata.type.flavorType.currentScope = { TIT: [] };
metadata.ingredients = ingredients;
write('metadata.json', `${JSON.stringify(metadata, null, 2)}\n`);

execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dest });
execFileSync('git', ['config', 'user.email', 'rig@local'], { cwd: dest });
execFileSync('git', ['config', 'user.name', 'rig'], { cwd: dest });
execFileSync('git', ['add', '-A'], { cwd: dest });
execFileSync('git', ['commit', '-qm', 'seed'], { cwd: dest });
console.log(`arabic fixture: ${dest} — Titus, ar, rtl`);
