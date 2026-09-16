// Generates sample-burrito-obs/ — the reference OBS project (BURRITO-SPEC §10, D74):
//   - ingredients/                    the pankosmia `text_stories` template (fixtures/text_stories,
//                                     provenance in its README) in the SEED FORM: every title `# N.`
//                                     with no text, every frame the image line + an empty paragraph,
//                                     no reference line — exactly what a new project is (R-10.2.4)
//   - ingredients/content/01.md       story 1 drafted through the §10 writers: the title, frames 1
//                                     and 2, and the reference line (issue #147's sample)
//   - ingredients/checking/resources.json  §5.3 pins incl. the three OBS members (§10.6)
//   - ingredients/checking/settings.json   §5.4
//   - metadata.json                   the template's metadata with its placeholders filled, §3
//                                     rules applied, `currentScope` VERBATIM (R-10.2.3), and the
//                                     ingredients table rebuilt with real md5/size per file
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { seedStory, writeFrame, writeRef, storyIpath, STORY_COUNT } from '../journal/story.mjs';
import { DRAFT } from './fixtures/obs-draft.mjs'; // the drafted content, shared with validate.mjs

const OBS = path.resolve('./sample-burrito-obs');
const TEMPLATE = path.resolve('./fixtures/text_stories');
const ING = (p) => path.join(OBS, 'ingredients', p);
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

// ---------- 1. ingredients: the template in seed form ----------
fs.rmSync(path.join(OBS, 'ingredients'), { recursive: true, force: true });
fs.cpSync(path.join(TEMPLATE, 'ingredients'), path.join(OBS, 'ingredients'), { recursive: true });
for (let n = 1; n <= STORY_COUNT; n++) {
  const f = ING(storyIpath(n));
  fs.writeFileSync(f, seedStory(fs.readFileSync(f, 'utf8')));
}

// ---------- 2. story 1 drafted: title, two frames, the reference line ----------
{
  const f = ING(storyIpath(1));
  let bytes = fs.readFileSync(f, 'utf8');
  bytes = writeFrame(bytes, 0, DRAFT.title);
  for (const [frame, text] of Object.entries(DRAFT.frames)) bytes = writeFrame(bytes, Number(frame), text);
  bytes = writeRef(bytes, DRAFT.ref);
  fs.writeFileSync(f, bytes);
}

// ---------- 3. checking/resources.json (§5.3 + §10.6) ----------
// Pins are REAL identities [VERIFIED — git.door43.org API, latest release tag and its
// commit, read 2026-09-15]: the tag is the `version` label and the tag's commit is the
// `sha` (D58). The four Bible-suite pins per set are copied from sample-burrito (same
// provenance, docs/evidence/es419-suite-pins-2026-07-31.md). Flavors of the OBS members
// follow D74 §9 (pankosmia's labels) [decided 2026-09-15 — D74].
const bible = JSON.parse(fs.readFileSync(path.resolve('./sample-burrito/ingredients/checking/resources.json'), 'utf8'));
const pick = (set, slot) => { const { books, ...rest } = bible.languageSets[set][slot]; return rest; };
const OBS_PINS = {
  primary: {
    obs:       { repoPath: 'git.door43.org/es-419_gl/es-419_obs',     version: 'v2', sha: '4a239590d543df59f77d5ee624d475a7488b5fc3', flavor: 'gloss/textStories' },
    'obs-tn':  { repoPath: 'git.door43.org/es-419_gl/es-419_obs-tn',  version: 'v2', sha: 'eaa18de94dcb7df1406cc5b20deb87053c0478ca', flavor: 'parascriptural/x-obsnotes' },
    'obs-twl': { repoPath: 'git.door43.org/es-419_gl/es-419_obs-twl', version: 'v2', sha: 'eb5ecd974b19a123e1fe3ee9da21c89c2555d18d', flavor: 'parascriptural/x-obsarticles' },
  },
  fallback: {
    obs:       { repoPath: 'git.door43.org/unfoldingWord/en_obs',     version: 'v9',  sha: 'd39a1dc7a7557ac54e4a8fecc3462147fe7eec3b', flavor: 'gloss/textStories' },
    'obs-tn':  { repoPath: 'git.door43.org/unfoldingWord/en_obs-tn',  version: 'v13', sha: 'e86138ea13f619f09f7a6dcaa60592716d407fe4', flavor: 'parascriptural/x-obsnotes' },
    'obs-twl': { repoPath: 'git.door43.org/unfoldingWord/en_obs-twl', version: 'v3',  sha: '44ebc9fafe8101665f985007d566f5036a2be85b', flavor: 'parascriptural/x-obsarticles' },
  },
};
const languageSets = {};
for (const set of ['primary', 'fallback']) {
  languageSets[set] = {
    gatewayLanguage: bible.languageSets[set].gatewayLanguage,
    translationNotes: pick(set, 'translationNotes'),
    translationWordsLinks: pick(set, 'translationWordsLinks'),
    translationWords: pick(set, 'translationWords'),
    translationAcademy: pick(set, 'translationAcademy'),
    ...OBS_PINS[set],
  };
}
fs.mkdirSync(ING('checking'), { recursive: true });
fs.writeFileSync(ING('checking/resources.json'), JSON.stringify({ schemaVersion: 2, languageSets }, null, 2) + '\n');

// ---------- 4. checking/settings.json (§5.4) ----------
fs.writeFileSync(ING('checking/settings.json'), JSON.stringify({
  schemaVersion: 1,
  checkCategories: { translationWords: ['kt', 'names', 'other'], translationNotes: ['translate'] },
}, null, 2) + '\n');

// ---------- 5. metadata.json: the template's, placeholders filled, §3 rules, real hashes ----------
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const rel = base ? `${base}/${e.name}` : e.name;
  return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
});
const ROLES = {
  'checking/resources.json': 'x-resource-links',
  'checking/settings.json': 'x-check-settings',
};
const ingredients = {};
for (const rel of walk(path.join(OBS, 'ingredients')).sort()) {
  const full = ING(rel);
  const entry = {
    checksum: { md5: md5(full) },
    mimeType: rel.endsWith('.md') ? 'text/markdown' : 'application/json',
    size: fs.statSync(full).size,
  };
  if (ROLES[rel]) entry.role = ROLES[rel];
  ingredients[`ingredients/${rel}`] = entry;
}
const CREATED = '2026-09-15T12:00:00.000Z';
const ABBR = 'ejemplo_obs';
const NAME = 'Equipo Ejemplo — Historias Bíblicas Abiertas';
const LANGUAGE = JSON.stringify({ tag: 'es-419', name: { en: 'Spanish (Latin America)', 'es-419': 'Español (Latinoamérica)' }, scriptDirection: 'ltr' });
const filled = fs.readFileSync(path.join(TEMPLATE, 'metadata.json'), 'utf8')
  .replaceAll('%%CREATED_TIMESTAMP%%', CREATED)
  .replaceAll('%%ABBR%%', ABBR)
  .replaceAll('%%CONTENT_NAME%%', NAME)
  .replace('%%LANGUAGE%%', LANGUAGE);
const metadata = JSON.parse(filled);
// §3 rule 1: the generator identifies tC4; category source and NFC are the template's
metadata.meta.generator = { softwareName: 'translationCore 4 (sample)', softwareVersion: '0.1.0', userName: 'Equipo Ejemplo' };
metadata.identification.description = { en: 'Sample tC4 Open Bible Stories project (story 1 drafted: title, frames 1 and 2, reference line)' };
metadata.copyright.shortStatements.push({ statement: 'Sample text CC BY-SA 4.0, Equipo Ejemplo' });
metadata.ingredients = ingredients; // §3 rule 5 — `currentScope` stays the template's table VERBATIM (R-10.2.3)
fs.writeFileSync(path.join(OBS, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.join(OBS, '.gitignore'), '**/*.bak\n');
console.log(`sample-burrito-obs: metadata.json written with ${Object.keys(ingredients).length} ingredients`);
