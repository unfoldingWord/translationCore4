#!/usr/bin/env node
// seed-large-project.mjs — issue #95: the seeded LARGE fixture for the slow-open journey.
//
// Builds one Scripture Burrito project whose journal holds many saved actions, so a
// production open (one HTTP read per segment) takes long enough to show the progress
// indicator. Everything is built from REAL material with the REFERENCE modules
// (journal/*.mjs — the same modules the production client imports, issue #62):
//
//   - the book: the sample-burrito TIT.usfm, journaled as the app's own seed journals a
//     book (book.add with the decomposed skeleton + initialVerses), after a creation
//     project.vrs.set with the sample's exact vrs.json bytes;
//   - the edits: N text.verse.set events, one per segment (D50: one save = one segment),
//     cycling over the drafted verses, each chained to the slot's previous head exactly
//     as JournalingStore.writeBook chains it (base = the slot's head ts);
//   - the disk: every derived file is written from the reference checkpoint projections
//     (journal/checkpoint.mjs), then self-checked with classifyDivergence — the fixture is
//     CONVERGED by construction, so an open classifies it without regeneration and the
//     fold-compare verifier (e2e teardown) accepts it.
//
// Deterministic: a fixed physical clock, so every run writes the same bytes.
//
// Usage:  node scripts/seed-large-project.mjs <dest-dir> [--edits N]
//   <dest-dir>  the project directory to create (removed first if present), e.g.
//               <rig>/state/work/repos/_local_/_local_/sample_burrito_large
//   --edits N   number of saved edits (default 4000)
//
// Called from dev-env/scripts/seed.zsh so the rig always carries the fixture.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fold } from '../journal/fold.mjs';
import { decompose } from '../journal/skeleton.mjs';
import { makeClock } from '../journal/hlc.mjs';
import { actorDirFor, writeActionSegment } from '../journal/files.mjs';
import { derivedProjections, classifyDivergence } from '../journal/checkpoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SAMPLE = path.join(ROOT, 'conformance', 'sample-burrito');

const args = process.argv.slice(2);
const dest = args.find((a) => !a.startsWith('--'));
if (!dest) {
  console.error('usage: node scripts/seed-large-project.mjs <dest-dir> [--edits N]');
  process.exit(2);
}
const editsArg = args.indexOf('--edits');
const EDITS = editsArg === -1 ? 4000 : Number(args[editsArg + 1]);
if (!Number.isInteger(EDITS) || EDITS < 0) throw new Error(`--edits must be a non-negative integer, got ${args[editsArg + 1]}`);

// A fixed actor slug (§8.1) for the fixture's writer; the app's own actor is a different
// slug, so on open the app's store reads these as a foreign actor's segments (received
// events — R-8.2.4 ratchets past them) and provisions its own actor.json beside them.
const ACTOR = 'fixture-large';
// A fixed physical clock: one millisecond per issue(), so the ts values are stable.
let physical = Date.parse('2026-09-01T00:00:00.000Z');
const clock = makeClock(ACTOR, () => (physical += 1));

// ---------- material ----------
const titUsfm = fs.readFileSync(path.join(SAMPLE, 'ingredients', 'TIT.usfm'), 'utf8').normalize('NFC');
const vrsBytes = fs.readFileSync(path.join(SAMPLE, 'ingredients', 'vrs.json'), 'utf8');
const baseMetadata = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'metadata.json'), 'utf8'));
const { skeleton, verses } = decompose(titUsfm);
const drafted = Object.keys(verses).filter((k) => verses[k].trim() !== '' && !verses[k].includes('___'));
if (drafted.length === 0) throw new Error('no drafted TIT verses in the sample — cannot build edits');

// ---------- events ----------
const actions = []; // one array of events per segment
const vrsTs = clock.issue();
actions.push([{ v: 1, op: 'project.vrs.set', actor: ACTOR, ts: vrsTs, base: null, name: 'eng', bytes: vrsBytes, seed: { source: 'creation' } }]);
const bookAddTs = clock.issue();
actions.push([{ v: 1, op: 'book.add', actor: ACTOR, ts: bookAddTs, base: null, book: 'TIT', scope: [], skeleton, initialVerses: verses }]);
// The slot heads after book.add, read from the fold exactly as writeBook reads them.
const afterAdd = fold(actions.flat());
const headOf = new Map();
for (const key of drafted) {
  const head = afterAdd.headsTs[`text|TIT|${key}`] ?? afterAdd.headsTs['skel|TIT'];
  if (!head) throw new Error(`no head for TIT ${key} after book.add`);
  headOf.set(key, head);
}
for (let i = 0; i < EDITS; i++) {
  const key = drafted[i % drafted.length];
  const sep = key.indexOf(':');
  const ts = clock.issue();
  // `generation` is the book.add ts (R-8.5.6). The app's writer omits it today and the
  // reference schema does not demand it — that disagreement is issue #175 — but a new
  // fixture follows the specification, which wins (CONTRIBUTING hard rule 3).
  actions.push([{
    v: 1, op: 'text.verse.set', actor: ACTOR, ts, base: headOf.get(key), generation: bookAddTs, book: 'TIT',
    chapter: key.slice(0, sep), verse: key.slice(sep + 1),
    text: `${verses[key].trimEnd()} (edición ${i + 1})\n`,
  }]);
  headOf.set(key, ts);
}
const events = actions.flat();

// ---------- fold + projections ----------
const foldOut = fold(events);
if (foldOut.forks.length || foldOut.retained.length || foldOut.invalid.length || foldOut.pendingStructural.length)
  throw new Error(`the fixture journal does not fold clean: forks=${foldOut.forks.length} retained=${foldOut.retained.length} invalid=${foldOut.invalid.length} pending=${foldOut.pendingStructural.length}`);
for (const e of events)
  if (e.op === 'text.verse.set' && e.generation !== bookAddTs)
    throw new Error(`fixture event ${e.ts} lacks the R-8.5.6 generation stamp`);

// metadata.json is the sample's, renamed and re-scoped; its ingredients table is
// rebuilt from the files actually written (the server re-scans it anyway — D28).
const meta = JSON.parse(JSON.stringify(baseMetadata));
meta.identification.primary = { local: { ejemplo_lento: { revision: '1', timestamp: '2026-09-01T00:00:00.000Z' } } };
meta.identification.name = { en: 'Equipo Ejemplo — Tito (proyecto grande)', 'es-419': 'Equipo Ejemplo — Tito (proyecto grande)' };
meta.identification.description = { en: `Large-journal fixture for issue #95: Titus with ${EDITS} saved edits, one segment each` };
meta.identification.abbreviation = { en: 'ejemplo_lento' };
meta.type.flavorType.currentScope = { TIT: [] };
meta.relationships = [];
meta.ingredients = {};
const projections = derivedProjections(foldOut, { baseMetadata: meta });

// ---------- write ----------
fs.rmSync(dest, { recursive: true, force: true });
const ing = path.join(dest, 'ingredients');
fs.mkdirSync(ing, { recursive: true });
for (const [ipath, bytes] of Object.entries(projections)) {
  if (ipath === 'metadata.json') continue; // repo root, below
  const file = path.join(ing, ipath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
const journalDir = path.join(ing, 'checking', 'journal');
const actorDir = actorDirFor(journalDir, ACTOR);
fs.mkdirSync(actorDir, { recursive: true });
fs.writeFileSync(
  path.join(actorDir, 'actor.json'),
  JSON.stringify({ schemaVersion: 1, actorId: ACTOR, createdAt: '2026-09-01T00:00:00.000Z', device: 'fixture generator' }, null, 2),
);
for (const action of actions) writeActionSegment(actorDir, action);

// Self-check: every derived file on disk equals its projection (the §8.8 divergence
// classifier, run from the fold's expected set). metadata.json is server-owned bytes and
// verified semantically (currentScope) by the app's verifier; it is not compared here.
// Every file under ingredients/, as ingredient-relative paths, sorted.
const listFiles = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const rel = base ? `${base}/${e.name}` : e.name;
  return e.isDirectory() ? listFiles(path.join(dir, e.name), rel) : [rel];
}).sort();
const files = listFiles(ing);
const diskFiles = {};
for (const rel of files)
  if (!rel.startsWith('checking/journal/')) diskFiles[rel] = fs.readFileSync(path.join(ing, rel), 'utf8');
const expected = { ...projections };
delete expected['metadata.json'];
const verdict = classifyDivergence(diskFiles, expected);
if (verdict.diverged.length) throw new Error(`fixture diverges from its own projections: ${verdict.diverged.join(', ')}`);

// metadata.json: the projected document (scope from the fold) with a real ingredients table.
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const metaDoc = JSON.parse(projections['metadata.json']);
const ingredients = {};
for (const rel of files) {
  const full = path.join(ing, rel);
  const entry = { checksum: { md5: md5(full) }, mimeType: rel.endsWith('.usfm') ? 'text/plain' : 'application/json', size: fs.statSync(full).size };
  if (rel === 'TIT.usfm') entry.scope = { TIT: [] };
  ingredients[`ingredients/${rel}`] = entry;
}
metaDoc.ingredients = ingredients;
fs.writeFileSync(path.join(dest, 'metadata.json'), JSON.stringify(metaDoc, null, 2) + '\n');
fs.writeFileSync(path.join(dest, '.gitignore'), '**/*.bak\n');

// A local project on the rig is a git repository (seed.zsh does the same for the sample).
// Fixed author and committer dates too, so the repository state is the same bytes every seed.
const gitEnv = { ...process.env, GIT_AUTHOR_DATE: '2026-09-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z' };
execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dest, env: gitEnv });
execFileSync('git', ['add', '-A'], { cwd: dest, env: gitEnv });
execFileSync('git', ['-c', 'user.email=rig@local', '-c', 'user.name=rig', 'commit', '-qm', 'seed (large fixture, issue #95)'], { cwd: dest, env: gitEnv });

console.log(`large fixture: ${dest} — ${actions.length} segments (${EDITS} edits + seed + book), ${files.length} ingredient files, clean fold`);
