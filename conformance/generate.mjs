// Generates the derived parts of the sample burrito:
//   - ingredients/JON.usfm            (multi-book stub, template style)
//   - ingredients/vrs.json            (versification scheme; platform writes this at creation)
//   - ingredients/checking/alignments/TIT.json  (via real wordaligner.unmerge)
//   - metadata.json                   (SB metadata with real md5/size per ingredient)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const usfmjs = require('usfm-js');
const wordaligner = require('word-aligner').default;

const BURRITO = path.resolve('./sample-burrito');
const ING = p => path.join(BURRITO, 'ingredients', p);
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

// ---------- 1. JON.usfm stub (Jonah 1:17, 2:10, 3:10, 4:11) ----------
// Chapter 2 ends in a verse SPAN (\v 9-10) — the span fixture for BURRITO-SPEC §4.1:
// verse keys are strings; a span uses the exact USFM span string ("9-10"), never Number().
const JON_SPAN_TEXT = 'Mas yo te ofreceré sacrificios con voz de gratitud; pagaré lo que prometí. ¡La salvación viene de Jehová! Y Jehová dio orden al pez, y este vomitó a Jonás en tierra firme.';
const jonChapters = [17, 10, 10, 11];
let jon = `\\id JON ejemplo_tj\n\\usfm 3.0\n\\h Jonás\n\\toc1 El Libro de Jonás\n\\toc2 Jonás\n\\toc3 Jon\n\\mt Jonás\n`;
jonChapters.forEach((n, i) => {
  jon += `\\c ${i + 1}\n\\p\n`;
  if (i === 1) {
    for (let v = 1; v <= 8; v++) jon += `\\v ${v} ___\n`;
    jon += `\\v 9-10 ${JON_SPAN_TEXT}\n`;
  } else {
    for (let v = 1; v <= n; v++) jon += `\\v ${v} ___\n`;
  }
});
fs.writeFileSync(ING('JON.usfm'), jon);

// ---------- 1b. ingredients/vrs.json (BURRITO-SPEC §4.3) ----------
// The platform writes the full chosen versification scheme into every created project
// (new_text_translation.rs). The sample uses eng — the default scheme [decided 2026-07-30].
// fixtures/vrs/eng.json is a byte-for-byte vendored copy of the platform's scheme
// (provenance: fixtures/vrs/README.md).
fs.copyFileSync(path.resolve('fixtures/vrs/eng.json'), ING('vrs.json'));

// ---------- 2. Alignment sidecar for TIT 1:1 ----------
// Original language: UGNT Titus 1:1 (first clause), word-level with strong/lemma/morph.
const G = (text, strong, lemma, morph, occurrence, occurrences) =>
  ({ tag: 'w', type: 'word', text, strong, lemma, morph, occurrence, occurrences });
const origWords = [
  G('Παῦλος', 'G39720', 'Παῦλος', 'Gr,N,,,,,NMS,', 1, 1),
  G('δοῦλος', 'G14010', 'δοῦλος', 'Gr,N,,,,,NMS,', 1, 1),
  G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,', 1, 2),
  G('ἀπόστολος', 'G06520', 'ἀπόστολος', 'Gr,N,,,,,NMS,', 1, 1),
  G('δὲ', 'G11610', 'δέ', 'Gr,CC,,,,,,,,', 1, 1),
  G('Ἰησοῦ', 'G24240', 'Ἰησοῦς', 'Gr,N,,,,,GMS,', 1, 1),
  G('Χριστοῦ', 'G55470', 'χριστός', 'Gr,N,,,,,GMS,', 1, 1),
  G('κατὰ', 'G25960', 'κατά', 'Gr,P,,,,,A,,,', 1, 1),
  G('πίστιν', 'G41020', 'πίστις', 'Gr,N,,,,,AFS,', 1, 1),
  G('ἐκλεκτῶν', 'G15880', 'ἐκλεκτός', 'Gr,AR,,,,GMP,', 1, 1),
  G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,', 2, 2),
];
const origVerseObjects = origWords;

// Target draft verse 1:1 exactly as in TIT.usfm.
const verseText = 'Pablo, siervo de Dios y apóstol de Jesucristo, según la fe de los escogidos de Dios y el conocimiento de la verdad que va con la piedad,';

// Alignment intent: target word (by occurrence) -> orig word indexes (n:1 for Jesucristo).
const alignSpec = [
  { tgt: 'Pablo', tgtOcc: 1, src: [0] },
  { tgt: 'siervo', tgtOcc: 1, src: [1] },
  { tgt: 'Dios', tgtOcc: 1, src: [2] },
  { tgt: 'apóstol', tgtOcc: 1, src: [3] },
  { tgt: 'Jesucristo', tgtOcc: 1, src: [5, 6] },
  { tgt: 'Dios', tgtOcc: 2, src: [10] },
];

// Tokenize the verse keeping punctuation/spacing as separators, count occurrences.
const tokens = verseText.match(/[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+/gu);
const counts = {}, totals = {};
for (const t of tokens) if (/[\p{L}\p{M}\p{N}]/u.test(t)) totals[t] = (totals[t] || 0) + 1;

// Build USFM3-aligned verse text: every word a \w token, aligned words wrapped in zaln milestones.
let alignedUsfm = '';
for (const t of tokens) {
  if (!/[\p{L}\p{M}\p{N}]/u.test(t)) { alignedUsfm += t; continue; }
  counts[t] = (counts[t] || 0) + 1;
  const wTag = `\\w ${t}|x-occurrence="${counts[t]}" x-occurrences="${totals[t]}"\\w*`;
  const spec = alignSpec.find(a => a.tgt === t && a.tgtOcc === counts[t]);
  if (!spec) { alignedUsfm += wTag; continue; }
  const opens = spec.src.map(i => {
    const o = origWords[i];
    return `\\zaln-s |x-strong="${o.strong}" x-lemma="${o.lemma}" x-morph="${o.morph}" x-occurrence="${o.occurrence}" x-occurrences="${o.occurrences}" x-content="${o.text}"\\*`;
  }).join('');
  alignedUsfm += `${opens}${wTag}${'\\zaln-e\\*'.repeat(spec.src.length)}`;
}

// Parse aligned verse and unmerge with the REAL word-aligner (as tC3/uw-client-checks do).
const verseJson = usfmjs.toJSON(`\\v 1 ${alignedUsfm}`, { chunk: true });
const targetVerseObjects = verseJson.verses['1'].verseObjects;
if (!targetVerseObjects?.length) throw new Error('aligned verse failed to parse');
const unmerged = wordaligner.unmerge({ verseObjects: targetVerseObjects }, { verseObjects: origVerseObjects });
console.log('unmerge output keys:', Object.keys(unmerged));
// Normalize occurrence(s) to integers — zaln attributes parse as strings; the checking
// stack requires numbers (uw-client-checks applies the same fix on read: fixOccurrences).
const fixOcc = w => ({ ...w,
  ...(w.occurrence !== undefined ? { occurrence: Number(w.occurrence) } : {}),
  ...(w.occurrences !== undefined ? { occurrences: Number(w.occurrences) } : {}) });
const alignments = (unmerged.alignment || unmerged.alignments).map(a => ({
  topWords: a.topWords.map(fixOcc), bottomWords: a.bottomWords.map(fixOcc) }));
const wordBank = unmerged.wordBank.map(fixOcc);
console.log(`alignments: ${alignments.length}, wordBank: ${wordBank.length}`);

const verseMd5 = crypto.createHash('md5').update(verseText).digest('hex');
const alignmentIngredient = {
  schemaVersion: 1,
  book: 'TIT',
  chapters: {
    '1': {
      '1': {
        alignments,
        wordBank,
        invalid: false,
        targetVerseMd5: verseMd5,
        sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34'
      }
    }
  }
};
fs.mkdirSync(ING('checking/alignments'), { recursive: true });
fs.writeFileSync(ING('checking/alignments/TIT.json'), JSON.stringify(alignmentIngredient, null, 2) + '\n');

// ---------- 3. metadata.json with real ingredient hashes ----------
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const rel = base ? `${base}/${e.name}` : e.name;
  return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
});
const files = walk(path.join(BURRITO, 'ingredients')).sort();
// §4.3 (amended 2026-08-24, issue #15): `vrs.json` carries NO role. It is written
// by the PLATFORM at creation, which registers checksum/mimeType/size and nothing
// else, and no published burrito uses ingredient roles on it. The five below are
// tC4's OWN sidecars, which the client writes and re-asserts (Stage-2, D28/W-2).
const ROLES = {
  'checking/alignments/TIT.json': 'x-alignment',
  'checking/translationWords/TIT.json': 'x-check-decisions',
  'checking/translationNotes/TIT.json': 'x-check-decisions',
  'checking/resources.json': 'x-resource-links',
  'checking/settings.json': 'x-check-settings',
};
const ingredients = {};
for (const rel of files) {
  const full = path.join(BURRITO, 'ingredients', rel);
  const leaf = rel.split('/').pop().split('.')[0];
  const entry = {
    checksum: { md5: md5(full) },
    mimeType: rel.endsWith('.usfm') ? 'text/plain' : 'application/json',
    size: fs.statSync(full).size,
  };
  if (/^[1-6A-Z]{3}$/.test(leaf) && ['TIT', 'JON'].includes(leaf)) entry.scope = { [leaf]: [] };
  if (ROLES[rel]) entry.role = ROLES[rel];
  ingredients[`ingredients/${rel}`] = entry;
}

const metadata = {
  format: 'scripture burrito',
  meta: {
    version: '1.0.0',
    category: 'source',
    generator: {
      softwareName: 'translationCore 4 (sample)',
      softwareVersion: '0.1.0',
      userName: 'Equipo Ejemplo'
    },
    defaultLocale: 'en',
    dateCreated: '2026-07-02T12:00:00.000Z',
    normalization: 'NFC'
  },
  idAuthorities: {
    local: { id: 'http://_local_', name: { en: 'Local Project' } },
    dcs: { id: 'https://git.door43.org', name: { en: 'Door43 Content Service' } }
  },
  identification: {
    primary: { local: { ejemplo_tj: { revision: '1', timestamp: '2026-07-02T12:00:00.000Z' } } },
    name: { en: 'Equipo Ejemplo — Tito y Jonás', 'es-419': 'Equipo Ejemplo — Tito y Jonás' },
    description: { en: 'Sample multi-book tC4 drafting+checking project (Titus mid-check; Jonah barely started, incl. a verse-span fixture at 2:9-10)' },
    abbreviation: { en: 'ejemplo_tj' }
  },
  languages: [
    { tag: 'es-419', name: { en: 'Spanish (Latin America)', 'es-419': 'Español (Latinoamérica)' }, scriptDirection: 'ltr' }
  ],
  type: {
    flavorType: {
      name: 'scripture',
      flavor: {
        name: 'textTranslation',
        usfmVersion: '3.0',
        translationType: 'firstTranslation',
        audience: 'common',
        projectType: 'standard'
      },
      currentScope: { TIT: [], JON: [] }
    }
  },
  confidential: false,
  localizedNames: {},
  ingredients,
  copyright: { shortStatements: [{ statement: 'CC BY-SA 4.0, Equipo Ejemplo' }] },
  // Mirror of checking/resources.json (§5.3 schemaVersion 2, D17 two-set shape):
  // originals + extraScripture + both language sets (primary es-419, fallback en) + lexicons.
  // DISTINCT repos only: under D34 the twl and tw slots name the SAME <lang>_tw repo (its
  // sb-zip export carries links + articles), so each language contributes ONE tW row.
  relationships: [
    { relationType: 'source', flavor: 'textTranslation', id: 'dcs::unfoldingWord/el-x-koine_ugnt', revision: 'v0.34' },
    { relationType: 'source', flavor: 'textTranslation', id: 'dcs::unfoldingWord/hbo_uhb', revision: 'v2.1.30' },
    { relationType: 'source', flavor: 'textTranslation', id: 'dcs::unfoldingWord/en_ult', revision: 'v89' },
    { relationType: 'source', flavor: 'textTranslation', id: 'dcs::unfoldingWord/en_ust', revision: 'v89' },
    { relationType: 'parascriptural', flavor: 'x-bcvnotes', id: 'dcs::es-419_gl/es-419_tn', revision: 'v66' },
    { relationType: 'parascriptural', flavor: 'x-bcvarticles', id: 'dcs::es-419_gl/es-419_tw', revision: 'v37' },
    { relationType: 'peripheral', flavor: 'x-peripheralArticles', id: 'dcs::es-419_gl/es-419_ta', revision: 'v4' },
    { relationType: 'parascriptural', flavor: 'x-bcvnotes', id: 'dcs::unfoldingWord/en_tn', revision: 'v86' },
    { relationType: 'parascriptural', flavor: 'x-bcvarticles', id: 'dcs::unfoldingWord/en_tw', revision: 'v87' },
    { relationType: 'peripheral', flavor: 'x-peripheralArticles', id: 'dcs::unfoldingWord/en_ta', revision: 'v86' },
    { relationType: 'parascriptural', flavor: 'x-bcvquestions', id: 'dcs::unfoldingWord/en_tq', revision: 'v89' },
    { relationType: 'peripheral', flavor: 'x-lexicon', id: 'dcs::unfoldingWord/en_ugl', revision: 'v2' },
    { relationType: 'peripheral', flavor: 'x-lexicon', id: 'dcs::unfoldingWord/en_uhl', revision: 'v1' }
  ]
};
fs.writeFileSync(path.join(BURRITO, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.join(BURRITO, '.gitignore'), '**/*.bak\n');
console.log(`metadata.json written with ${Object.keys(ingredients).length} ingredients`);
