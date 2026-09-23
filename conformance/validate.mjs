// Validation harness for the sample tC4 burrito.
// Proves, with the REAL production libraries (usfm-js, word-aligner, word-aligner-lib)
// and Pankosmia's own bundled Scripture Burrito schema, that the proposed structure
// carries everything the tC3 checking tools need.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pinSlotError, scopeError } from '../journal/grammar.mjs';
import { writeActionSegment, validateSegment, validateActorDoc, segmentName, readSegments, actorDirFor } from '../journal/files.mjs';
import { parseStory, seedStory, writeFrame, writeRef, applyStoryState, storyIpath, STORY_COUNT } from '../journal/story.mjs';
import { fold } from '../journal/fold.mjs';
import { validateEvent } from '../journal/schema.mjs';
import { derivedProjections } from '../journal/checkpoint.mjs';
import { seedFromSidecars } from '../journal/reconcile.mjs';
import { DRAFT } from './fixtures/obs-draft.mjs';
import { relationshipsFromPins } from '../journal/relationships.mjs';

const require = createRequire(import.meta.url);
const usfmjs = require('usfm-js');
const wordaligner = require('word-aligner').default;
const wal = require('word-aligner-lib');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { doesReferenceContain } = require('bible-reference-range');

const BURRITO = path.resolve(process.env.BURRITO || './sample-burrito');
const ING = p => path.join(BURRITO, 'ingredients', p);
const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

// Check groups (BURRITO-SPEC §7):
//   stage1 — path-authoritative conformance; holds on today's pankosmia-web (stage rules S-1/S-2)
//   stage2 — role/relationships durability. Upstream models both fields at 0.18.5. Regeneration
//            rebuilds the ingredients table FROM DISK and cannot intuit x- roles, so x- roles
//            are non-durable BY DESIGN (STATE D28, 2026-07-30); `relationships` SURVIVES
//            regeneration at >=0.18.5 (rig re-baseline 2026-07-30; dropped at <=0.18.3). S-2
//            (paths authoritative) is permanent; the client re-asserts roles after each remake.
//            On a server-rescanned copy the expected split is 1/2 (roles check fails) — the
//            accepted condition, not a defect. The pristine sample scores 2/2.
//   phase2 — journal-merge design checks (BURRITO-SPEC §8.7); run in an isolated temp git repo
//   obs    — the OBS project kind (BURRITO-SPEC §10, D74) proved on sample-burrito-obs/; every
//            check also fires on a deliberately broken copy (issue #147)
let pass = 0, fail = 0;
const groups = { stage1: [0, 0], stage2: [0, 0], phase2: [0, 0], obs: [0, 0] };
const GROUP_TAG = { stage1: '', stage2: ' [Stage-2/non-durable-by-design (D28)]', phase2: ' [Phase-2 design]', obs: ' [OBS project kind (§10)]' };
const check = (name, ok, detail = '', group = 'stage1') => {
  const tag = GROUP_TAG[group];
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${tag}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
  groups[group][ok ? 0 : 1]++;
};

const metadata = json(path.join(BURRITO, 'metadata.json'));

// ---------- 1. Scripture Burrito schema validation (Pankosmia's bundled schema) ----------
// ONE compiled validator, shared by the Bible sample (here) and the OBS sample (group obs).
const loadSbValidator = () => {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const schemaRoot = path.resolve('sb-schema');
  const walkSchemas = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walkSchemas(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []);
  const BASE = 'https://sb.local/';
  for (const f of walkSchemas(schemaRoot)) {
    let schema;
    // one bundle file has a trailing comma (lenient-parser artifact) — strip before strict parse
    try { schema = JSON.parse(read(f).replace(/,(\s*[}\]])/g, '$1')); }
    catch (e) { console.log(`  note: skipping unparseable schema ${path.relative(schemaRoot, f)} (${e.message.slice(0, 60)})`); continue; }
    // Re-key $id under a proper base URI so bare, subdir, and ../ cross-file $refs all resolve
    // (the bundle ships the root with $id "." and relies on a lenient resolver).
    schema.$id = BASE + path.relative(schemaRoot, f).split(path.sep).join('/');
    try { ajv.addSchema(schema); } catch (e) { /* duplicate $id — first wins */ }
  }
  return ajv.getSchema(BASE + 'source_metadata.schema.json') || null;
};
const sbValidate = loadSbValidator();
{
  if (!sbValidate) { check('SB schema: root schema loaded', false, 'source_metadata.schema.json not resolvable'); }
  else {
    const ok = sbValidate(metadata);
    check('SB schema: metadata.json valid against Pankosmia bundled schema (incl. relationships + x- roles)', !!ok,
      ok ? '' : JSON.stringify(sbValidate.errors.slice(0, 3)));
  }
}

// ---------- 2. Ingredient integrity (mirrors server rescan: md5, size, exact path set) ----------
{
  const walkFiles = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walkFiles(path.join(dir, e.name), rel) : [rel];
  });
  const onDisk = walkFiles(path.join(BURRITO, 'ingredients')).map(r => `ingredients/${r}`).sort();
  const listed = Object.keys(metadata.ingredients).sort();
  check('ingredients: metadata lists exactly the on-disk files', JSON.stringify(onDisk) === JSON.stringify(listed),
    `${listed.length} ingredients`);
  let allMatch = true;
  for (const [rel, entry] of Object.entries(metadata.ingredients)) {
    const buf = fs.readFileSync(path.join(BURRITO, rel));
    if (entry.checksum.md5 !== md5(buf) || entry.size !== buf.length) { allMatch = false; break; }
  }
  check('ingredients: every md5 + size correct', allMatch);
  const roles = Object.values(metadata.ingredients).map(e => e.role).filter(Boolean);
  // §4.3 (amended 2026-08-24, issue #15): the five roles are tC4's OWN sidecars.
  // `vrs.json` is PLATFORM-written and carries no role — the creation endpoints
  // register checksum/mimeType/size only, and no published burrito role-tags it.
  // Asserting a role there described nothing any writer produces.
  check('ingredients: 5 client-owned role-tagged ingredients present; vrs.json carries no role',
    roles.length === 5 && !metadata.ingredients['ingredients/vrs.json']?.role,
    roles.join(', '), 'stage2');
}

// ---------- 2b. Versification + scope (BURRITO-SPEC §3 rules 4-5, §4.3 — D25/D26) ----------
{
  // vrs.json: the full versification scheme the platform writes at creation (§4.3).
  const vrsEntry = metadata.ingredients['ingredients/vrs.json'];
  let vrs = null;
  try { vrs = json(ING('vrs.json')); } catch { /* reported below */ }
  const vrsKeys = ['maxVerses', 'mappedVerses', 'excludedVerses', 'partialVerses'];
  const scopeBooks = Object.keys(metadata.type.flavorType.currentScope);
  // Path-authoritative (Stage-1): presence + shape + scope coverage. The role assertion is
  // Stage-2 (roles are wiped by a server rescan; the client re-asserts them — D28/W-2).
  check('versification: ingredients/vrs.json present, scheme-shaped, covers every book in scope',
    !!vrs && vrsKeys.every(k => k in vrs) && scopeBooks.every(b => b in vrs.maxVerses) &&
    !!vrsEntry,
    vrs ? `scheme has ${Object.keys(vrs.maxVerses).length} books; scope ${scopeBooks.join('+')}` : 'vrs.json missing/unparseable');

  // §4.3 (2026-08-24, issue #15): a `mappedVerses` value is a single range string
  // OR an array of range strings — the second form expresses a one-to-many
  // mapping, and readers MUST accept both. A reader that assumes the string form
  // and iterates the value gets its CHARACTERS, silently, with no exception.
  const mv = vrs?.mappedVerses ?? {};
  const mvEntries = Object.entries(mv);
  const wellFormed = mvEntries.every(([, v]) =>
    typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string')));
  check('versification: every mappedVerses value is a range string or a non-empty array of them',
    !!vrs && wellFormed,
    `${mvEntries.length} mappings; ${mvEntries.filter(([, v]) => Array.isArray(v)).length} in array form`);

  // §4.3: mappedVerses maps THIS scheme's references into `org`, so both sides of
  // every mapping must parse. A malformed side silently drops OUT of the succinct
  // table rather than failing, so this check is the only thing that would catch it.
  //
  // The two sides have DIFFERENT grammars, matching the toolkit's own vrs parser:
  // a key is `BOOK C:V` or `BOOK C:V-V`; a target may additionally carry a
  // sub-verse letter (`ESG 1:1a`). The letter is real data — 103 eng mappings use
  // it — and the integer parse downstream drops it. That is harmless HERE and only
  // here: ZERO letter-suffixed targets fall inside the 66-book canon in any of the
  // six schemes, and D26 excludes non-canonical books. The detail line below is
  // where a change to that would surface.
  const KEY_REF = /^[A-Z0-9]{3} \d+:\d+(-\d+)?$/;
  const TARGET_REF = /^[A-Z0-9]{3} \d+:\d+[a-z]?(-\d+)?$/;
  const badRefs = mvEntries.filter(([k, v]) =>
    !KEY_REF.test(k) || ![].concat(v).every(t => TARGET_REF.test(t)));
  const subVerse = mvEntries.filter(([, v]) => [].concat(v).some(t => /:\d+[a-z]/.test(t)));
  check('versification: every mappedVerses key and target parses',
    !!vrs && badRefs.length === 0,
    badRefs.length
      ? `malformed: ${badRefs.slice(0, 3).map(([k]) => k).join(', ')}`
      : `${mvEntries.length} mappings parse; ${subVerse.length} use a sub-verse letter`);

  // Scope grammar (§3 rules 4-5): a scope value is an array; [] = whole book (the default);
  // each element is a range string  C | C-C | C:V | C:V-V | C:V-C:V .
  // ONE grammar (round 8): the same `scopeError` the §8.5 `book.add` schema applies, so a
  // stored scope and a journaled scope can never be judged by two different rules.
  const validScope = v => scopeError(v) === null;
  const allScopes = [
    ...Object.values(metadata.type.flavorType.currentScope),
    ...Object.values(metadata.ingredients).map(e => e.scope).filter(Boolean).flatMap(s => Object.values(s)),
  ];
  const fixturesPass = validScope([]) && validScope(['1:1-2:5']) && validScope(['3']) && validScope(['1:2-16', '3:1-15']);
  const negativesFail = !validScope('1:1') && !validScope(['banana']) && !validScope([1]) && !validScope(['1:1–2:5']);
  check('scope: grammar accepts [] (whole book) and range arrays; rejects non-arrays and malformed ranges; all stored scopes valid',
    allScopes.every(validScope) && fixturesPass && negativesFail,
    `${allScopes.length} stored scope values checked; range fixture "1:1-2:5" accepted; 4 negative controls rejected`);
}

// ---------- 3. targetBible derivation from the draft USFM (what Checker receives) ----------
const bookJson = usfmjs.toJSON(read(ING('TIT.usfm')));
{
  const ch = bookJson.chapters;
  const vCounts = [16, 15, 15].every((n, i) =>
    Object.keys(ch[String(i + 1)]).filter(k => /^\d+/.test(k)).length === n);
  check('targetBible: usfm-js toJSON yields chapters 1-3 with 16/15/15 verses', !!ch['1'] && !!ch['3'] && vCounts);
  const v1 = ch['1']['1'].verseObjects.map(vo => vo.text || '').join('');
  check('targetBible: 1:1 draft text accessible', v1.includes('Pablo') && v1.includes('piedad'),
    JSON.stringify(v1.slice(0, 40) + '…'));
  check('targetBible: headers present for manifest/book naming', bookJson.headers.some(h => h.tag === 'h' && h.content === 'Tito'));
}

// ---------- 4. Alignment round-trip: sidecar -> zaln USFM -> sidecar ----------
const alignIng = json(ING('checking/alignments/TIT.json'));
const stored = alignIng.chapters['1']['1'];
const verseText = bookJson.chapters['1']['1'].verseObjects.filter(vo => vo.type === 'text' || vo.text).map(vo => vo.text).join('');
let mergedVerseObjects = null;
{
  const merged = wordaligner.merge(stored.alignments, stored.wordBank, verseText.trim(), true);
  mergedVerseObjects = merged;
  const usfmOut = wal.UsfmFileConversionHelpers.convertVerseDataToUSFM({ verseObjects: merged });
  const zalnCount = (usfmOut.match(/\\zaln-s/g) || []).length;
  check('alignment: sidecar merges into zaln USFM (7 zaln-s opens: 6 alignments, one 2-source)', zalnCount === 7,
    `zaln-s count=${zalnCount}`);
  check('alignment: original-language attributes survive (strong/lemma/morph/content)',
    usfmOut.includes('x-strong="G39720"') && usfmOut.includes('x-lemma="χριστός"') && usfmOut.includes('x-content="Θεοῦ"'));
  // reverse: re-extract with the same machinery used at generation
  const reparsed = usfmjs.toJSON(`\\v 1 ${usfmOut}`, { chunk: true }).verses['1'].verseObjects;
  const origWords = stored.alignments.flatMap(a => a.topWords)
    .map(t => ({ tag: 'w', type: 'word', text: t.word, strong: t.strong, lemma: t.lemma, morph: t.morph, occurrence: t.occurrence, occurrences: t.occurrences }));
  const re = wordaligner.unmerge({ verseObjects: reparsed }, { verseObjects: origWords });
  const proj = als => als.filter(a => a.bottomWords.length).map(a => [
    a.topWords.map(w => `${w.word}/${w.occurrence}`).join('+'),
    a.bottomWords.map(w => `${w.word}/${w.occurrence}`).join('+')
  ].join('=>')).sort();
  const bankProj = wb => wb.map(w => `${w.word}/${w.occurrence}/${w.occurrences}`).sort();
  check('alignment: round-trip re-extraction equals stored sidecar (alignments)',
    JSON.stringify(proj(re.alignment)) === JSON.stringify(proj(stored.alignments)));
  check('alignment: round-trip wordBank equals stored (21 unaligned words, occurrences intact)',
    JSON.stringify(bankProj(re.wordBank)) === JSON.stringify(bankProj(stored.wordBank)), `${re.wordBank.length} words`);
  check('alignment: staleness guard — targetVerseMd5 matches current draft verse',
    stored.targetVerseMd5 === md5(Buffer.from(verseText.trim())));
  // §5.1 `done` (1.13, D73): a record-level, additive flag about the translator's work.
  // The zaln export is built from alignments/wordBank alone, so a record carrying
  // done:true exports byte-identically; where the field is present it is a boolean.
  const withDone = { ...stored, done: true };
  const usfmWithDone = wal.UsfmFileConversionHelpers.convertVerseDataToUSFM({
    verseObjects: wordaligner.merge(withDone.alignments, withDone.wordBank, verseText.trim(), true),
  });
  const everyRecord = Object.values(alignIng.chapters).flatMap(ch => Object.values(ch));
  check('alignment: done is additive — a record with done:true exports the same zaln and the field is boolean where present',
    usfmWithDone === usfmOut && everyRecord.every(r => !('done' in r) || typeof r.done === 'boolean'),
    `${everyRecord.length} records, ${everyRecord.filter(r => 'done' in r).length} carry done`);
}

// ---------- 5. Selections validity against the draft text (RCL invalidation machinery) ----------
{
  const twDecisions = json(ING('checking/translationWords/TIT.json')).decisions;
  const tnDecisions = json(ING('checking/translationNotes/TIT.json')).decisions;
  const v1Selections = [...twDecisions, ...tnDecisions]
    .filter(d => d.contextId.reference.verse === 1 && Array.isArray(d.selections))
    .flatMap(d => d.selections);
  const { selectionsChanged } = wal.selectionsHelpers.validateVerseSelections(verseText.trim(), v1Selections);
  check('selections: all stored 1:1 selections valid against current draft verse', selectionsChanged === false,
    v1Selections.map(s => s.text).join(', '));
  const tampered = verseText.trim().replace('Dios y apóstol', 'Señor y apóstol');
  const t = wal.selectionsHelpers.validateVerseSelections(tampered, v1Selections);
  check('selections: editing the verse is DETECTED (invalidation fires)', t.selectionsChanged === true);
}

// ---------- 6. Decision shape: every field the RCL contract requires ----------
{
  const files = ['checking/translationWords/TIT.json', 'checking/translationNotes/TIT.json'];
  const ctxFields = ['checkId', 'occurrenceNote', 'reference', 'tool', 'groupId', 'quote', 'quoteString', 'glQuote', 'occurrence'];
  const decFields = ['selections', 'comments', 'reminders', 'nothingToSelect', 'verseEdits', 'invalidated'];
  let ok = true, count = 0;
  for (const f of files) {
    for (const d of json(ING(f)).decisions) {
      count++;
      for (const c of ctxFields) if (!(c in d.contextId)) { ok = false; console.log(`  missing contextId.${c} in ${f}`); }
      for (const c of decFields) if (!(c in d)) { ok = false; console.log(`  missing ${c} in ${f}`); }
      const r = d.contextId.reference;
      if (!('bookId' in r && 'chapter' in r && 'verse' in r)) ok = false;
    }
  }
  check('decisions: all tC3 check-item fields present on every stored decision', ok, `${count} decisions`);
  // Select by checkId, not array position: the sample stores decisions in the
  // fold's canonical projection order (§8.8 seedability), and a check pinned to
  // an index breaks whenever a record is added or the canon changes.
  const tnDecisions = json(ING('checking/translationNotes/TIT.json')).decisions;
  const tn = tnDecisions.find(d => d.contextId.checkId === 'swi9');
  check('decisions: tN quote is word-occurrence array (not flattened string)',
    Array.isArray(tn.contextId.quote) && 'word' in tn.contextId.quote[0] && 'occurrence' in tn.contextId.quote[0]);
  const inv = tnDecisions.find(d => d.contextId.checkId === 'gr8c');
  check('decisions: verse-edit invalidation state representable (verseEdits+invalidated flags)',
    inv.verseEdits === true && inv.invalidated === true);
}

// ---------- 7. Derive-at-load + merge-by-key (progress reconstruction) ----------
{
  const miniTwl = [
    'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink',
    '1:1\tt1g7\tkeyterm\tΘεοῦ\t1\trc://*/tw/dict/bible/kt/god',
    '1:1\ta9p2\tkeyterm\tἀπόστολος\t1\trc://*/tw/dict/bible/kt/apostle',
    '1:1\tx7k2\tkeyterm\tἸησοῦ\t1\trc://*/tw/dict/bible/kt/jesus',
  ].join('\n');
  const derived = miniTwl.split('\n').slice(1).map(row => {
    const [ref, id, , origWords, occurrence, link] = row.split('\t');
    const [chapter, verse] = ref.split(':').map(Number);
    return {
      contextId: {
        checkId: id, reference: { bookId: 'tit', chapter, verse }, tool: 'translationWords',
        groupId: link.split('/').pop(), quote: origWords, quoteString: origWords, occurrence: Number(occurrence),
      },
      selections: false, comments: false, reminders: false, nothingToSelect: false, verseEdits: false, invalidated: false,
    };
  });
  const saved = json(ING('checking/translationWords/TIT.json')).decisions;
  const key = c => [c.checkId, c.reference.chapter, c.reference.verse, c.quoteString, c.occurrence].join('|');
  const savedByKey = new Map(saved.map(d => [key(d.contextId), d]));
  const mergedItems = derived.map(item => savedByKey.get(key(item.contextId)) || item);
  const decided = mergedItems.filter(i => i.selections !== false || i.nothingToSelect).length;
  check('derive+merge: saved decisions re-attach to freshly derived TSV items by stable key',
    decided === 2 && mergedItems[2].selections === false, `progress ${decided}/${derived.length} reconstructed`);

  // Scope-filtered derivation (§4.2 — D26): derive MUST filter check items to the project
  // scope, and the progress denominator MUST come from the in-scope derived total, not the
  // whole book. Miniature fixture: items at 1:1 and 1:2; scope limits TIT to 1:1.
  // Containment via the tested uW range engine (bible-reference-range), the SAME
  // library the app's refInScope uses — so the parity contract (S-0c) holds and
  // the C:V-V end (F6) and ITEM verse-span (B19) edge cases are handled once,
  // not re-hand-rolled in two places.
  const refInScope = (ranges, chapter, verse) => {
    if (ranges.length === 0) return true;                       // [] = whole book
    const ref = `${chapter}:${verse}`;                          // `verse` may be a span like "23-24"
    return ranges.some(r => doesReferenceContain(r, ref));
  };
  const scopedRows = [
    { chapter: 1, verse: 1, checkId: 't1g7' },
    { chapter: 1, verse: 1, checkId: 'a9p2' },
    { chapter: 1, verse: 2, checkId: 'q3z8' },   // out of scope under TIT ["1:1"]
  ];
  const scoped = scopedRows.filter(r => refInScope(['1:1'], r.chapter, r.verse));
  const wholeBook = scopedRows.filter(r => refInScope([], r.chapter, r.verse));
  check('derive honors scope: items filter to the scope ranges; progress denominator = in-scope total (D26)',
    scoped.length === 2 && scoped.every(r => r.verse === 1) && wholeBook.length === 3 &&
    refInScope(['1:1-2:5'], 2, 5) && !refInScope(['1:1-2:5'], 2, 6) && refInScope(['3'], 3, 15) && !refInScope(['3'], 2, 1) &&
    // C:V-V (same-chapter verse span): 1:3-5 admits 1:3..1:5 only — never 1:6, never chapter 2.
    refInScope(['1:3-5'], 1, 3) && refInScope(['1:3-5'], 1, 5) && !refInScope(['1:3-5'], 1, 6) && !refInScope(['1:3-5'], 2, 1) &&
    // ITEM verse-span (B19): a note at 15:23-24 is OUT of scope 15:1-22; a span that overlaps is IN.
    !refInScope(['15:1-22'], 15, '23-24') && refInScope(['15:1-22'], 15, '22-23') && refInScope(['15:1-22'], 15, '20-21'),
    `scope ["1:1"] → ${scoped.length}/${scopedRows.length} items; [] → ${wholeBook.length}/${scopedRows.length}`);

  // Cross-language re-attach (D17, §5.2): a resolution change swaps the TSV language, so
  // checkIds no longer match. Fallback key: (reference + original-language quote +
  // occurrence). That key is NOT unique (verified duplicate quote+occurrence rows in en_tn
  // 2TI/ACT), so tiebreak by groupId — the language-independent slug (tN: the
  // SupportReference tA module; tW: the TWLink slug). A decision the two passes cannot
  // place is UNPLACED: it is never auto-attached, and — because the resource is the
  // primary key (D36) — it is written back invalidated, not queued for review.
  const xKey = c => [c.reference.bookId, String(c.reference.chapter), String(c.reference.verse), c.quoteString, c.occurrence].join('|');
  const reattach = (savedList, derivedList) => {
    const byId = new Map(derivedList.map(d => [d.checkId, d]));
    return savedList.map(s => {
      if (byId.has(s.contextId.checkId)) return { saved: s, to: byId.get(s.contextId.checkId) };
      let cand = derivedList.filter(d => xKey(d) === xKey(s.contextId));
      if (cand.length > 1) cand = cand.filter(d => d.groupId === s.contextId.groupId);
      return cand.length === 1 ? { saved: s, to: cand[0] } : { saved: s, unplaced: true };
    });
  };
  const mk = (checkId, verse, groupId, quoteString, occurrence = 1) =>
    ({ checkId, reference: { bookId: 'tit', chapter: 1, verse }, groupId, quoteString, occurrence });
  const savedX = [
    { contextId: mk('swi9', 1, 'figs-abstractnouns', 'κατὰ πίστιν') },   // en id — must re-key
    { contextId: mk('gr8c', 4, 'translate-blessing', 'χάρις καὶ εἰρήνη') },
    { contextId: mk('old7', 6, 'figs-explicit', 'λόγον') },              // ambiguous below
  ];
  const derivedX = [
    mk('zz10', 1, 'figs-abstractnouns', 'κατὰ πίστιν'),
    mk('zz11', 4, 'translate-blessing', 'χάρις καὶ εἰρήνη'),
    mk('zz12', 4, 'figs-metaphor', 'χάρις καὶ εἰρήνη'),                  // same key, other group — tiebreak target
    mk('dupA', 6, 'figs-explicit', 'λόγον'),
    mk('dupB', 6, 'figs-explicit', 'λόγον'),                             // same key AND group — irreducible
  ];
  const rx = reattach(savedX, derivedX);
  check('derive+merge: cross-language re-attach by (reference + orig quote + occurrence), groupId tiebreak; irreducible ambiguity stays unattached (D17)',
    rx[0].to?.checkId === 'zz10' && rx[1].to?.checkId === 'zz11' && rx[2].unplaced === true &&
    rx.filter(r => r.unplaced).length === 1,
    `re-keyed ${rx.filter(r => r.to).length}/3, tiebreak resolved zz11 vs zz12, 1 → unplaced`);

  // The resource is the primary key (D36, §5.2). The check list derived from the pinned
  // resource IS the work: a decision that neither pass can place no longer describes a
  // check that exists. It is written back with `invalidated: true` + `status: "invalid"`
  // — kept in full, never deleted, and never counted as progress.
  const carryOver = (savedList, derivedList) => {
    const placed = reattach(savedList, derivedList);
    const carried = placed.filter(r => r.to).map(r => ({ ...r.saved, contextId: r.to }));
    const invalidated = placed.filter(r => !r.to)
      .map(r => ({ ...r.saved, invalidated: true, status: 'invalid' }));
    return { decisions: [...carried, ...invalidated], carried: carried.length, invalidated: invalidated.length };
  };
  const co = carryOver(savedX, derivedX);
  const inv = co.decisions.filter(d => d.invalidated);
  check('carry-over: an unplaceable decision is invalidated, kept in full, and re-keyed decisions take the NEW resource contextId (D36)',
    co.carried === 2 && co.invalidated === 1 && co.decisions.length === savedX.length &&
    inv.length === 1 && inv[0].status === 'invalid' &&
    inv[0].contextId.checkId === 'old7' &&
    co.decisions.filter(d => !d.invalidated).map(d => d.contextId.checkId).join(',') === 'zz10,zz11',
    `${co.carried} carried (re-keyed to the new resource), ${co.invalidated} invalidated and retained, 0 deleted`);
}

// ---------- 8. Multi-book + resource pinning completeness ----------
{
  const scope = metadata.type.flavorType.currentScope;
  check('multi-book: currentScope covers TIT + JON; both USFM ingredients scoped',
    'TIT' in scope && 'JON' in scope &&
    metadata.ingredients['ingredients/TIT.usfm'].scope.TIT !== undefined &&
    metadata.ingredients['ingredients/JON.usfm'].scope.JON !== undefined);
  const resFile = json(ING('checking/resources.json'));
  const res = resFile.resources;
  // §5.3 schemaVersion 2 (D17/D30): TWO language sets — primary GL + the English fallback
  // that ships with the install — each a coherent tn+twl+tw+tA at pinned versions, plus
  // set-independent originals and lexicons. Exactly two rungs (D30 constraint 2).
  const SHA = /^[0-9a-f]{40}$/;
  const HELP_SLOTS = ['translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy'];
  const ls = resFile.languageSets;
  // D58: the sha IS the pin's identity (required); `version` is an OPTIONAL
  // display label, non-empty when present.
  const pinShape = e => e && e.repoPath && SHA.test(e.sha ?? '') && e.flavor &&
    (!('version' in e) || (typeof e.version === 'string' && e.version !== ''));
  const setOk = s => s && s.gatewayLanguage?.languageId && s.gatewayLanguage?.owner &&
    HELP_SLOTS.every(k => pinShape(s[k]));
  const twoSets = resFile.schemaVersion === 2 &&
    ls && Object.keys(ls).length === 2 && setOk(ls.primary) && setOk(ls.fallback) &&
    ls.fallback.gatewayLanguage.languageId === 'en';
  const indep = pinShape(res?.originalLanguage?.nt) && pinShape(res?.originalLanguage?.ot) &&
    pinShape(res?.lexicon?.nt) && pinShape(res?.lexicon?.ot);
  const shaOk = SHA.test('570e76d0024c847689e48a20e2ac1a1d2c6eb6e3') && !SHA.test('ZZ') && !SHA.test('570e76d') &&
    !pinShape({ repoPath: 'x', version: 'v1', flavor: 'f' }) && // sha-less pin refused (D58)
    pinShape({ repoPath: 'x', sha: '570e76d0024c847689e48a20e2ac1a1d2c6eb6e3', flavor: 'f' }); // version-less accepted
  check('resources: two language sets pinned (D17/D30) — primary GL + fallback en, each coherent tn+twl+tw+tA; set-independent originals + lexicons; sha REQUIRED as the pin identity, version an optional label (D58)',
    twoSets && indep && shaOk,
    `primary=${ls?.primary?.gatewayLanguage?.languageId}, fallback=${ls?.fallback?.gatewayLanguage?.languageId}; sha grammar + negative controls checked`);

  // §5.3 per-pin book coverage (D41 — issue #16). OPTIONAL and additive, so a pin
  // without `books` is conformant; when present it MUST be an array of uppercase
  // 3-character book codes. The point of the field is that it stays true when the
  // resource is NOT installed, which is what lets the resolver tell "does not
  // contain this book" from "not downloaded yet".
  const allPins = [
    ...['primary', 'fallback'].flatMap(r =>
      ['translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy',
        'translationQuestions', 'simplifiedText']
        .map(slot => ls?.[r]?.[slot]).filter(Boolean)),
    ...(resFile.extraScripture ?? []),
  ];
  const BOOK = /^[A-Z0-9]{3}$/;
  // §5.3 whole-collection form: EXACTLY ["BIBLE"] — covers every book. The
  // marker mixed into a book list is NOT valid.
  const isWholeCollection = books =>
    Array.isArray(books) && books.length === 1 && books[0] === 'BIBLE';
  const booksValid = books =>
    Array.isArray(books) &&
    (isWholeCollection(books) || books.every(b => typeof b === 'string' && BOOK.test(b)));
  const withBooks = allPins.filter(p => 'books' in p);
  const booksWellFormed = withBooks.every(p => booksValid(p.books));
  check('resources: `books` (per-pin coverage, D41) is optional; when present it is an array of uppercase book codes or the whole-collection form ["BIBLE"]',
    booksWellFormed &&
    withBooks.some(p => isWholeCollection(p.books)) &&  // the form occurs in the sample
    !booksValid(['BIBLE', 'TIT']),                      // marker mixed with codes refuses
    `${withBooks.length}/${allPins.length} pins record coverage`);

  // The three states the field exists to separate (§5.3). Driven here as pure
  // predicates so the harness proves the RULE, not one client's wiring: a
  // recorded coverage decides the answer whether or not anything is installed,
  // and only the no-record case is ambiguous enough to warrant a warning.
  const coverageOf = pin => (Array.isArray(pin.books) && pin.books.length ? pin.books : null);
  const verdict = (primaryPin, book, primaryLocal) => {
    const rec = coverageOf(primaryPin);
    if (rec) {
      const covered = isWholeCollection(rec) || rec.includes(book);
      return covered ? (primaryLocal ? 'ready' : 'fetch') : 'fallback-unwarned';
    }
    return primaryLocal ? 'ready' : 'fallback-warned';
  };
  const pinWith = books => ({ repoPath: 'x/y', sha: '0'.repeat(40), ...(books ? { books } : {}) });
  check('resources: recorded coverage separates "resource lacks this book" from "not downloaded yet" (D41)',
    verdict(pinWith(['TIT']), 'TIT', false) === 'fetch' &&           // covered, absent -> FETCH, never substitute
    verdict(pinWith(['TIT']), 'MRK', false) === 'fallback-unwarned' && // not covered -> fall back, no warning
    verdict(pinWith(null), 'TIT', false) === 'fallback-warned' &&    // unknown -> warned fallback (migration only)
    verdict(pinWith([]), 'TIT', false) === 'fallback-warned' &&      // empty list is NOT a record
    verdict(pinWith(['TIT']), 'TIT', true) === 'ready' &&
    verdict(pinWith(['BIBLE']), 'MRK', false) === 'fetch',           // whole-collection covers every book cross-machine
    'covered+absent→fetch; uncovered→unwarned fallback; no record→warned fallback; ["BIBLE"]→every book');

  // §5.2 resolution records (D17; D30 constraint 1): each per-(tool, book) decision file
  // records the resource its check list derived from — tN: the tn pin; tW: the twl pin —
  // and that record MUST equal exactly one rung's pin. Ladder (D30 constraint 2): the
  // automatic fallback is exactly primary → fallback, driven by book coverage.
  const TOOL_SLOT = { translationWords: 'translationWordsLinks', translationNotes: 'translationNotes' };
  // D58: the pin match is (repoPath + sha) — the sha is the identity; release
  // tags are not enforced upstream, so `version` is a display label only.
  const rungOf = df => {
    const slot = TOOL_SLOT[df.tool];
    const matches = ['primary', 'fallback'].filter(r =>
      ls[r][slot].repoPath === df.resource.repoPath && ls[r][slot].sha === df.resource.sha);
    return matches.length === 1 &&
      (!('languageSet' in df.resource) || df.resource.languageSet === matches[0]) ? matches[0] : null;
  };
  const dfW = json(ING('checking/translationWords/TIT.json'));
  const dfN = json(ING('checking/translationNotes/TIT.json'));
  const foreign = { tool: 'translationNotes', resource: { repoPath: 'git.door43.org/x/other_tn', sha: '0'.repeat(40) } };
  const resolve = (coverage, book) => (coverage.primary.includes(book) ? 'primary' : 'fallback');
  const cov = { primary: ['TIT', 'JON', 'RUT', '3JN'] };   // es-419 tag coverage (evidence 2026-07-31)
  check('resolution: §5.2 files record the resolved (tool, book) resource matching exactly one rung; two-rung coverage ladder primary→fallback (D17/D30)',
    rungOf(dfW) === 'primary' && rungOf(dfN) === 'primary' && rungOf(foreign) === null &&
    resolve(cov, 'TIT') === 'primary' && resolve(cov, 'HEB') === 'fallback' &&
    Object.keys(ls).every(r => ['primary', 'fallback'].includes(r)),
    `tW→${rungOf(dfW)}, tN→${rungOf(dfN)}; foreign record rejected; HEB (uncovered) → fallback`);
  // §5.3 extraScripture (normative since 1.5-draft — D10/OPEN-QUESTIONS #13; D58 re-based
  // identity): gateway source pins for the source panes. Entry shape {id, repoPath, sha,
  // flavor} with sha REQUIRED (40 lowercase hex — the pin's identity) and `version` an
  // OPTIONAL non-empty display label; ids unique. Same grammar as the main pins.
  const xs = resFile.extraScripture;
  const xsEntryOk = e =>
    typeof e.id === 'string' && e.id.length > 0 && e.repoPath && e.flavor &&
    SHA.test(e.sha) &&
    (!('version' in e) || (typeof e.version === 'string' && e.version.length > 0));
  const xsShapeOk = Array.isArray(xs) && xs.length >= 2 && xs.every(xsEntryOk);
  const xsIdsUnique = xsShapeOk && new Set(xs.map(e => e.id)).size === xs.length;
  // Firing negative controls (D58): a sha-less entry and an empty version label REFUSE;
  // a sha-only entry (no version) is VALID.
  const xsNegShaLess = !xsEntryOk({ id: 'x', repoPath: 'git.door43.org/o/r', flavor: 'scripture/textTranslation' });
  const xsNegEmptyVersion = !xsEntryOk({ id: 'x', repoPath: 'git.door43.org/o/r', sha: 'a'.repeat(40), flavor: 'scripture/textTranslation', version: '' });
  const xsPosShaOnly = xsEntryOk({ id: 'x', repoPath: 'git.door43.org/o/r', sha: 'a'.repeat(40), flavor: 'scripture/textTranslation' });
  check('resources: extraScripture source pins present ({id,repoPath,sha,flavor} complete — sha REQUIRED 40-hex, version an OPTIONAL non-empty label (D58), ids unique)',
    xsShapeOk && xsIdsUnique && xsNegShaLess && xsNegEmptyVersion && xsPosShaOnly &&
    !SHA.test('84c73ba') && !SHA.test('Z'.repeat(40)),
    xsShapeOk ? `${xs.length} entries (${xs.map(e => e.id).join(', ')}); sha-required + sha-only-valid + empty-label controls fired` : 'array missing or malformed');
  // §5.3 1.10 (D64, epic #104/#110): OPTIONAL per-set help slots. A set MAY pin
  // `translationQuestions` (tq) and `simplifiedText`; when present each uses the
  // unchanged §5.3 pin grammar, and an ABSENT slot keeps the set complete —
  // completeness stays tn+twl+tw+tA, so pre-1.10 files remain conformant.
  const OPTIONAL_SLOTS = ['translationQuestions', 'simplifiedText'];
  const optOk = set => OPTIONAL_SLOTS.every(k => !(k in set) || pinShape(set[k]));
  const sampleCarriesBoth = OPTIONAL_SLOTS.every(k => pinShape(ls?.fallback?.[k]));
  const absentSlotLegal = setOk({ ...ls.primary }) && optOk(ls.primary);   // primary omits both — still a complete set
  const malformedRefused = !optOk({ translationQuestions: { repoPath: 'x' } }); // pin grammar still binds when present
  check('resources: optional tq + simplifiedText set slots (§5.3 1.10, D64) — pin grammar when present, absent slot keeps the set complete',
    sampleCarriesBoth && absentSlotLegal && malformedRefused &&
    ls.fallback.translationQuestions.flavor === 'parascriptural/x-bcvquestions' &&
    ls.fallback.simplifiedText.flavor === 'scripture/textTranslation',
    `fallback carries both (tq ${ls?.fallback?.translationQuestions?.version}, simplified ${ls?.fallback?.simplifiedText?.version}); primary omits both and stays complete`);
  // The mirror is DERIVED (§3 rule 6, issue #359): it must equal relationshipsFromPins of this
  // burrito's own resources.json, so an exported project whose pins grew (D64 adoption) still
  // checks, and a stale mirror (one row short) fires.
  const rels = metadata.relationships;
  const derivedRels = JSON.stringify(relationshipsFromPins(resFile));
  check('resources: same pins expressed as SB relationships, schema-valid per test 1',
    Array.isArray(rels) && rels.length > 0 && rels.every(r => r.relationType && r.flavor && r.id.includes('::')) &&
    JSON.stringify(rels) === derivedRels && JSON.stringify(rels.slice(1)) !== derivedRels,
    Array.isArray(rels) ? `${rels.length} relationships` : 'missing', 'stage2');
}

// ---------- 9. Whole-book aligned USFM export (tC3 interchange from burrito alone) ----------
{
  const exportJson = usfmjs.toJSON(read(ING('TIT.usfm')));
  exportJson.chapters['1']['1'].verseObjects = mergedVerseObjects;
  const out = usfmjs.toUSFM(exportJson, { forcedNewLines: true });
  check('export: full-book USFM with zaln alignments produced from burrito data alone',
    out.includes('\\zaln-s') && out.includes('x-strong="G23160"') && out.includes('\\v 2 con la esperanza'),
    'draft + sidecar -> aligned USFM3');
}

// ---------- 10. Verse spans (BURRITO-SPEC §4.1/§5.2 — verse keys are strings; spans use the exact span string) ----------
{
  const jon = usfmjs.toJSON(read(ING('JON.usfm')));
  const ch2 = jon.chapters['2'];
  const spanKey = '9-10';
  const spanParsed = !!ch2 && spanKey in ch2 && !('9' in ch2) && !('10' in ch2);
  const spanText = spanParsed ? ch2[spanKey].verseObjects.map(vo => vo.text || '').join('').trim() : '';
  check('spans: usfm-js parses \\v 9-10 to the exact string key "9-10" (no separate 9/10 keys)',
    spanParsed && spanText.includes('Jonás'), spanParsed ? `text ${spanText.length} chars` : 'span key missing');
  // The rule the span fixture enforces: identity keys and I-3 hashes key by the exact verse
  // string — Number("9-10") is NaN, which is the bug class (fixtureStore `+vNum`) this bans.
  const idKey = r => [r.checkId, r.bookId, String(r.chapter), String(r.verse), r.occurrence].join('|');
  check('spans: §5.2 identity-key string normalization — numeric and span refs key consistently; Number() coercion banned [covers R-8.4.4]',
    Number.isNaN(Number(spanKey)) &&
    idKey({ checkId: 'x1', bookId: 'jon', chapter: 2, verse: spanKey, occurrence: 1 }) ===
    idKey({ checkId: 'x1', bookId: 'jon', chapter: '2', verse: spanKey, occurrence: 1 }) &&
    md5(Buffer.from(spanText)).length === 32);
}

// ---------- 11. Triage status (additive D2 field, BURRITO-SPEC §5.2) ----------
{
  const all = ['checking/translationWords/TIT.json', 'checking/translationNotes/TIT.json']
    .flatMap(f => json(ING(f)).decisions);
  const withStatus = all.filter(d => 'status' in d);
  check('decisions: additive triage `status` within {valid,invalid,todo}; fixture carries one',
    withStatus.length >= 1 && withStatus.every(d => ['valid', 'invalid', 'todo'].includes(d.status)),
    `${withStatus.length}/${all.length} decisions carry status`);
}

// ---------- 12. Phase 2 two-actor journal merge (BURRITO-SPEC §8.7 derived-file rule) ----------
// Journal files are disjoint by construction, but metadata.json is shared (its ingredients
// table must list every file). This section proves (a) the problem: a naive git merge of two
// actors' checkpoints conflicts on metadata.json; (b) the §8.7 rule: derived files resolve by
// taking either side wholesale, then regenerating post-union (rescan), completes cleanly.
{
  const { execSync } = require('child_process');
  const T = path.resolve('tmp-merge-test');
  // Removal of the scratch repo raced once in CI (#178): ENOTEMPTY on `.git` while the tree
  // was being walked [VERIFIED — run 33976695938 at cb87b66, attempt 1 red, attempt 2 green,
  // 2026-09-05]. Two guards, each documented by its tool: rmSync retries EBUSY, EMFILE,
  // ENFILE, ENOTEMPTY and EPERM with linear backoff (`maxRetries`/`retryDelay`, recursive
  // mode only) [VERIFIED — Node v22.14.0 fs.rmSync reference (release commit 5d2feb2),
  // read 2026-09-05], and every git call disables the automatic gc and maintenance that
  // `git commit` and `git merge` run after their own work (`gc.auto=0`,
  // `maintenance.auto=false`) [VERIFIED — git v2.46.0 (release commit 39bf06a): git-config(1)
  // gc.auto, gc.autoDetach, maintenance.auto; the call sites builtin/commit.c:1872 and
  // builtin/merge.c:464 `run_auto_maintenance`; read 2026-09-05]. The cause is inferred from
  // the error and the code shape; the retry covers the error class whatever the writer.
  const rmT = () => fs.rmSync(T, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmT();
  fs.mkdirSync(T, { recursive: true });
  fs.cpSync(path.join(BURRITO, 'ingredients'), path.join(T, 'ingredients'), { recursive: true });
  fs.copyFileSync(path.join(BURRITO, 'metadata.json'), path.join(T, 'metadata.json'));
  fs.writeFileSync(path.join(T, '.gitignore'), '**/*.bak\n');
  const git = args => execSync(`git -c gc.auto=0 -c maintenance.auto=false ${args}`, { cwd: T, stdio: 'pipe' }).toString();

  const walkF = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walkF(path.join(dir, e.name), rel) : [rel];
  });
  // metadata regeneration = ingredient rescan: fresh scan wins for checksum/size/mimeType,
  // prior extras (role, scope) carry forward for surviving paths (§8.7 / Change-1 semantics).
  const rescan = () => {
    const meta = JSON.parse(fs.readFileSync(path.join(T, 'metadata.json'), 'utf8'));
    const prev = meta.ingredients;
    const next = {};
    for (const rel of walkF(path.join(T, 'ingredients')).sort()) {
      const key = `ingredients/${rel}`;
      const buf = fs.readFileSync(path.join(T, key));
      const { checksum: _c, mimeType: _m, size: _s, ...extras } = prev[key] || {};
      next[key] = {
        checksum: { md5: md5(buf) },
        mimeType: rel.endsWith('.usfm') ? 'text/plain' : 'application/json',
        size: buf.length,
        ...extras,
        ...(rel.startsWith('checking/journal/') ? { role: 'x-journal' } : {}),
      };
    }
    meta.ingredients = next;
    fs.writeFileSync(path.join(T, 'metadata.json'), JSON.stringify(meta, null, 2) + '\n');
  };
  // ONE stream form (§8.1): each actor's journal is a SEALED action segment written by
  // the implementation's own writer (seal + name + containment all in files.mjs), plus
  // the §8.1 actor.json — never a hand-rolled stream shape.
  const checkpointTs = actor => `2026-07-07T00:00:00.000Z|0000|${actor}`;
  const actorCheckpoint = actor => {
    const journalRoot = path.join(T, 'ingredients/checking/journal');
    const ev = {
      v: 1, op: 'check.decision.set', actor, ts: checkpointTs(actor), base: null,
      toolId: 'translationWords', generation: `2026-07-06T00:00:00.000Z|0000|${actor}`,
      decision: { contextId: { checkId: 'm1', occurrence: 1, reference: { bookId: 'tit', chapter: 1, verse: 1 } }, selections: false },
    };
    writeActionSegment(actorDirFor(journalRoot, actor), [ev]);
    fs.writeFileSync(path.join(journalRoot, actor, 'actor.json'),
      JSON.stringify({ schemaVersion: 1, actorId: actor, createdAt: '2026-07-07T00:00:00.000Z' }) + '\n');
    rescan();
    git('add -A');
    git(`commit -qm "checkpoint ${actor}"`);
  };

  git('init -q -b main');
  git('config user.email harness@tc4.local');
  git('config user.name tC4-harness');
  git('config commit.gpgsign false');
  git('add -A');
  git('commit -qm base');
  git('checkout -qb actor-a');
  actorCheckpoint('actor-a');
  git('checkout -q main');
  git('checkout -qb actor-b');
  actorCheckpoint('actor-b');
  git('checkout -q actor-a');

  // (a) the problem, reproduced
  let naiveConflict = false;
  try {
    git('merge --no-edit actor-b');
  } catch {
    naiveConflict = /^(UU|AA)\s+metadata\.json/m.test(git('status --porcelain'));
    git('merge --abort');
  }
  check('journal merge: naive two-actor git merge conflicts on shared metadata.json (the §8.7 problem)',
    naiveConflict, 'journal files are disjoint; the ingredients table is not', 'phase2');

  // (b) the rule: conflicts confined to derived files -> take either side, regenerate, commit
  let mergedClean = false;
  try {
    git('merge --no-edit actor-b');
    mergedClean = true; // would only happen if (a) unexpectedly passed too
  } catch {
    const conflicted = git('diff --name-only --diff-filter=U').trim().split('\n').filter(Boolean);
    const onlyDerived = conflicted.length > 0 &&
      conflicted.every(p => p === 'metadata.json' || /^ingredients\/[A-Z0-9]{3}\.usfm$/.test(p));
    if (onlyDerived) {
      git(`checkout --ours -- ${conflicted.map(p => `"${p}"`).join(' ')}`);
      rescan(); // regenerate post-union: both actors' journals are already in the working tree
      git('add -A');
      git('commit -qm "integrate actor-b (derived files regenerated post-union)"');
      mergedClean = true;
    }
  }
  const meta2 = JSON.parse(fs.readFileSync(path.join(T, 'metadata.json'), 'utf8'));
  const journalKeys = ['actor-a', 'actor-b'].map(a => `ingredients/checking/journal/${a}/segments/${segmentName(checkpointTs(a))}`);
  const unionOk = journalKeys.every(k => fs.existsSync(path.join(T, k)) && meta2.ingredients[k]?.role === 'x-journal');
  const onDisk2 = walkF(path.join(T, 'ingredients')).map(r => `ingredients/${r}`).sort();
  const tableOk = JSON.stringify(onDisk2) === JSON.stringify(Object.keys(meta2.ingredients).sort()) &&
    Object.entries(meta2.ingredients).every(([k, e]) => e.checksum.md5 === md5(fs.readFileSync(path.join(T, k))));
  const statusClean = git('status --porcelain').trim() === '';
  const twoParents = git('log -1 --format=%P').trim().split(' ').length === 2;
  check('journal merge: resolve-derived-either-side + regenerate-post-union completes cleanly (two-parent commit; both journals listed; ingredients table matches disk)',
    mergedClean && unionOk && tableOk && statusClean && twoParents,
    `${Object.keys(meta2.ingredients).length} ingredients post-union`, 'phase2');
  // §8.1 — ONE stream form: the fixture journals must be what the implementation itself
  // defines (journal/<actorId>/segments/<encoded-ts>.action.json sealed containers, plus
  // actor.json), proven by the implementation's OWN validator and reader — never a
  // hand-rolled stream shape.
  const journalRoot = path.join(T, 'ingredients/checking/journal');
  const streamProblems = [];
  for (const a of ['actor-a', 'actor-b']) {
    const dir = path.join(journalRoot, a);
    for (const rel of walkF(dir)) {
      if (rel === 'actor.json') {
        const r = validateActorDoc(fs.readFileSync(path.join(dir, rel), 'utf8'), a);
        if (!r.ok) streamProblems.push(`${a}/actor.json: ${r.reason}`);
      } else if (/^segments\/[^/]+\.action\.json$/.test(rel)) {
        const r = validateSegment(fs.readFileSync(path.join(dir, rel), 'utf8'));
        if (!r.ok) streamProblems.push(`${a}/${rel}: ${r.reason}`);
        else if (path.basename(rel) !== segmentName(r.events[0].ts)) streamProblems.push(`${a}/${rel}: misnamed`);
      } else streamProblems.push(`${a}/${rel}: not a §8.1 sealed-segment stream file`);
    }
    if (!fs.existsSync(path.join(dir, 'actor.json'))) streamProblems.push(`${a}: no actor.json`);
    let invalid = 0;
    const evs = readSegments(actorDirFor(journalRoot, a), () => invalid++);
    if (invalid > 0 || evs.length === 0) streamProblems.push(`${a}: reader accepted ${evs.length} events (${invalid} invalid segments)`);
  }
  check('journal merge: the fixture journals are the §8.1 SEALED-SEGMENT stream form the implementation defines — every file is a sealed container the implementation\'s own validator and reader accept (plus a valid actor.json); no hand-rolled stream shape survives here [covers R-8.1.10]',
    streamProblems.length === 0, streamProblems.slice(0, 4).join(' · '), 'phase2');
  rmT();
}

// ---------- 8. The OBS project kind (BURRITO-SPEC §10, D74) — sample-burrito-obs/ ----------
// Six checks, one per #147 acceptance item. Each check's `ok` is the POSITIVE on the sample
// AND the NEGATIVE on a deliberately broken copy: a check that cannot fire proves nothing.
{
  const OBS = path.resolve(process.env.OBS_BURRITO || './sample-burrito-obs');
  const TEMPLATE = path.resolve('./fixtures/text_stories');
  const OING = (p) => path.join(OBS, 'ingredients', p);
  const TING = (p) => path.join(TEMPLATE, 'ingredients', p);
  const obsMeta = json(path.join(OBS, 'metadata.json'));
  const tmplMeta = JSON.parse(read(path.join(TEMPLATE, 'metadata.json')).replace(/%%LANGUAGE%%/, '{"tag":"und"}').replace(/%%[A-Z_]+%%/g, 'x'));
  const walkFiles = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walkFiles(path.join(dir, e.name), rel) : [rel];
  });
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // O1 — schema validity: the SB flavor block is `gloss/textStories` and nothing else in it
  {
    const ok = !!sbValidate && !!sbValidate(obsMeta);
    const broken = clone(obsMeta); broken.type.flavorType.flavor.name = 'textStorie';
    const broken2 = clone(obsMeta); broken2.type.flavorType.flavor.usfmVersion = '3.0';
    const fires = !!sbValidate && !sbValidate(broken) && !sbValidate(broken2);
    // R-10.1.1 also fixes the story files' mimeType — asserted here, not left to the schema
    const storyMime = (m) => Object.entries(m.ingredients).filter(([k]) => /^ingredients\/content\/\d\d\.md$/.test(k)).every(([, e]) => e.mimeType === 'text/markdown');
    const brokenMime = clone(obsMeta); brokenMime.ingredients['ingredients/content/01.md'].mimeType = 'text/plain';
    check('OBS schema: metadata.json is valid against the bundled SB schema with flavor gloss/textStories; every story ingredient is text/markdown; a misspelt flavor and an extra flavor field both fail (the core flavor object allows only name), and a text/plain story fires [covers R-10.1.1]',
      ok && fires && obsMeta.type.flavorType.name === 'gloss' && obsMeta.type.flavorType.flavor.name === 'textStories' && storyMime(obsMeta) && !storyMime(brokenMime),
      ok ? '' : JSON.stringify((sbValidate?.errors || []).slice(0, 2)), 'obs');
  }

  // O2 — layout equality with the template: the same ingredient set (plus the §5 sidecars),
  // the non-story files byte-identical, every story in the seed form or drafted from it
  {
    const onDisk = walkFiles(OING('')).sort();
    const tmpl = walkFiles(TING('')).sort();
    const sidecars = onDisk.filter((p) => p.startsWith('checking/'));
    const sameSet = JSON.stringify(onDisk.filter((p) => !p.startsWith('checking/'))) === JSON.stringify(tmpl);
    const nonStory = tmpl.filter((p) => !/^content\/\d\d\.md$/.test(p));
    const nonStoryIdentical = nonStory.every((p) => read(OING(p)) === read(TING(p)).replace(/\r\n/g, '\n'));
    let seedOrDrafted = true, undrafted = 0;
    for (let n = 1; n <= STORY_COUNT; n++) {
      const seed = seedStory(read(TING(storyIpath(n))).replace(/\r\n/g, '\n'));
      const bytes = read(OING(storyIpath(n)));
      if (bytes === seed) { undrafted++; continue; }
      // a drafted story is the seed plus §10 writes of exactly what it now carries
      const p = parseStory(bytes);
      const frames = {}; if (p.title) frames[0] = p.title;
      p.frames.forEach((f, i) => { if (f.text) frames[i + 1] = f.text; });
      if (applyStoryState(seed, { frames, ref: p.ref }) !== bytes) seedOrDrafted = false;
    }
    const pathRule = onDisk.filter((p) => /^content\/\d+\.md$/.test(p)).every((p) => /^content\/\d\d\.md$/.test(p));
    // negatives: a copy missing 50.md is not the layout; a story whose image URL changed is
    // neither the seed form nor a §10 draft of it
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(require('os').tmpdir()), 'obs-layout-'));
    fs.cpSync(OING(''), dir, { recursive: true });
    fs.rmSync(path.join(dir, 'content/50.md'));
    const firesMissing = JSON.stringify(walkFiles(dir).filter((p) => !p.startsWith('checking/')).sort()) !== JSON.stringify(tmpl);
    const seed02 = seedStory(read(TING(storyIpath(2))).replace(/\r\n/g, '\n'));
    const mutated02 = seed02.replace('obs-en-02-01.jpg', 'obs-en-02-99.jpg');
    const p2 = parseStory(mutated02);
    const firesMutated = mutated02 !== seed02 && applyStoryState(seed02, { frames: {}, ref: p2.ref }) !== mutated02;
    fs.rmSync(dir, { recursive: true, force: true });
    check(`OBS layout: the ingredient set equals the pankosmia text_stories template (content/01..50.md, front/title, front/intro, back/intro, LICENSE.md) plus the §5 sidecars; front, back and LICENSE byte-identical; every story is the template's SEED FORM (title \`# N.\`, empty frames, no reference line) or a §10 draft of it; two-digit story paths; a missing 50.md and a changed image line both fire [covers R-10.2.1 R-10.2.2 R-10.2.4]`,
      sameSet && nonStoryIdentical && seedOrDrafted && pathRule && undrafted === STORY_COUNT - 1 && firesMissing && firesMutated,
      `${onDisk.length} ingredients (${sidecars.length} sidecars), ${undrafted} undrafted stories`, 'obs');
  }

  // O3 — the frame model: the image line splits frames; exactly one paragraph per frame;
  // the reference line is the last `_…_` line; single newlines inside a paragraph survive
  {
    const s1 = parseStory(read(OING(storyIpath(1))));
    const f1 = s1.frames[0].text, f2 = s1.frames[1].text;
    const positive = s1.number === 1 && s1.title === DRAFT.title && s1.frames.length === 16 &&
      f1 === DRAFT.frames[1] && f1.includes('\n') && !f1.includes('\n\n') && f2 === DRAFT.frames[2] &&
      s1.frames.slice(2).every((f) => f.text === '') && s1.ref === DRAFT.ref &&
      s1.frames.every((f, i) => f.image.endsWith(`obs-en-01-${String(i + 1).padStart(2, '0')}.jpg)`));
    let allParse = true;
    for (let n = 1; n <= STORY_COUNT; n++) { const p = parseStory(read(OING(storyIpath(n)))); if (p.number !== n || p.frames.length < 7) allParse = false; }
    const img = '![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)';
    const twoParagraphs = `# 1. T\n\n${img}\n\nuno\n\ndos\n`;
    const textBeforeImage = `# 1. T\n\nuno\n\n${img}\n\n`;
    const noTitle = `${img}\n\nuno\n`;
    const storyZero = `# 0. T\n\n${img}\n\nuno\n`;
    const emptyRef = `# 1. T\n\n${img}\n\nuno\n\n__\n`;
    const emptyRefAfterEmptyFrame = `# 1. T\n\n${img}\n\n__\n`; // `__` right after an empty frame is a blank reference, not frame text
    const blankRef = `# 1. T\n\n${img}\n\nuno\n\n_ _\n`;
    const fires = throws(() => parseStory(twoParagraphs)) && throws(() => parseStory(textBeforeImage)) && throws(() => parseStory(noTitle)) &&
      throws(() => parseStory(storyZero)) && throws(() => parseStory(emptyRef)) && throws(() => parseStory(emptyRefAfterEmptyFrame)) && throws(() => parseStory(blankRef));
    // a frame text with a blank line is refused by the writer, not normalized (§10: the app
    // removes blank lines BEFORE it seals; the format refuses what is left). The writer and
    // the parser share ONE blank-line predicate, so whatever the writer accepts parses back
    // to itself: a whitespace-only text and a NBSP line are blank for both.
    const seed1 = seedStory(read(TING(storyIpath(1))).replace(/\r\n/g, '\n'));
    const writerRefuses = ['uno\n\ndos', ' ', 'a\n \nb', 'uno\n', '\nuno', '__', '_ref_', 'a\n__'].every((t) => throws(() => writeFrame(seed1, 1, t)));
    const roundTrip = [DRAFT.frames[1], DRAFT.frames[2], 'x', 'a b\nc d'].every((t) => parseStory(writeFrame(seed1, 1, t)).frames[0].text === t);
    check('OBS frame model: story 1 parses to its title, 16 frames (the image line splits them) and the reference line; frames 1-2 carry the drafted paragraphs with a single newline kept inside frame 1; all 50 stories parse; two paragraphs in one frame, text before the first image line, a missing title line, a story number 0 and an empty `__` reference all refuse; the writer refuses a blank, whitespace-only or NBSP line and a leading/trailing newline, and every accepted text parses back to itself [covers R-10.3.1 R-10.3.2 R-10.3.3]',
      positive && allParse && fires && writerRefuses && roundTrip, `story 1: ${s1.frames.length} frames, ref "${s1.ref}"`, 'obs');
  }

  // O4 — the byte-strict frame write (the D8 analogue): a write changes ONLY its own region
  {
    const seed = seedStory(read(TING(storyIpath(1))).replace(/\r\n/g, '\n'));
    // the region of frame F: the lines after its image line up to the next image line
    const lines = seed.split('\n');
    const imageIdx = lines.map((l, i) => (l.startsWith('![') ? i : -1)).filter((i) => i >= 0);
    const regionOf = (f, arr = lines) => ({ start: imageIdx[f - 1] + 1, end: f < imageIdx.length ? arr.indexOf(lines[imageIdx[f]], imageIdx[f - 1] + 1) : arr.length });
    const outsideIdentical = (before, after, f) => {
      const b = before.split('\n'), a = after.split('\n');
      const rb = regionOf(f, b), ra = regionOf(f, a);
      return b.slice(0, rb.start).join('\n') === a.slice(0, ra.start).join('\n') && b.slice(rb.end).join('\n') === a.slice(ra.end).join('\n');
    };
    const w3 = writeFrame(seed, 3, 'tres');
    const w3b = writeFrame(w3, 3, 'tres cambiado\nsegunda línea');
    const w3c = writeFrame(w3b, 3, ''); // clearing restores the template's empty-frame form
    const wLast = writeFrame(seed, 16, 'dieciséis');
    const wRef = writeRef(wLast, 'ref');
    const positive = outsideIdentical(seed, w3, 3) && outsideIdentical(w3, w3b, 3) && w3c === seed &&
      parseStory(w3b).frames[2].text === 'tres cambiado\nsegunda línea' &&
      outsideIdentical(seed, wLast, 16) && wRef.startsWith(wLast.trimEnd()) && parseStory(wRef).ref === 'ref' &&
      writeRef(wRef, 'ref2').slice(0, -('_ref2_\n'.length)) === wRef.slice(0, -('_ref_\n'.length));
    // negative: a copy where a DIFFERENT frame also changed is caught by the same predicate,
    // and a frame beyond the story's frame count refuses
    const tampered = w3.replace('obs-en-01-05.jpg', 'obs-en-01-05.jpeg');
    const fires = !outsideIdentical(seed, tampered, 3) && throws(() => writeFrame(seed, 17, 'x')) && throws(() => writeFrame(seed, 0, 'a\nb'));
    check('OBS byte-strict write: writing, rewriting and clearing frame 3 of a seed story changes only that frame\'s region (clearing restores the template form byte for byte); the last frame and the reference line follow the same rule; a copy tampered elsewhere fires; frame 17 of a 16-frame story and a multi-line title refuse [covers R-10.3.4 R-10.7.5]',
      positive && fires, '', 'obs');
  }

  // O5 — currentScope equality with the template's table, verbatim
  {
    const same = JSON.stringify(obsMeta.type.flavorType.currentScope) === JSON.stringify(tmplMeta.type.flavorType.currentScope);
    const broken = clone(obsMeta.type.flavorType.currentScope); delete broken.JAS;
    const reordered = Object.fromEntries(Object.entries(clone(obsMeta.type.flavorType.currentScope)).reverse());
    const fires = JSON.stringify(broken) !== JSON.stringify(tmplMeta.type.flavorType.currentScope) &&
      JSON.stringify(reordered) !== JSON.stringify(tmplMeta.type.flavorType.currentScope);
    const grammar = Object.values(obsMeta.type.flavorType.currentScope).every((v) => scopeError(v) === null);
    check('OBS scope: type.flavorType.currentScope equals the template\'s table VERBATIM (same keys, same order, same ranges — 33 books the stories retell) and every value passes the §3 rule 4 grammar; a dropped key and a reordered table both fire [covers R-10.2.3]',
      same && fires && grammar, `${Object.keys(obsMeta.type.flavorType.currentScope).length} books`, 'obs');
  }

  // O7 — the OPTIONAL OBS questions member (R-10.6.3, D75 amendment, #331): the sample's
  // English fallback set pins `obs-tq` with the export's flavor; the primary set omits it
  // and is still a complete OBS set; the §8.5 slot grammar accepts the slot and refuses a
  // misspelling; the member sits after `obs-twl` and before `obs-images` in the file.
  {
    const obsRes = json(OING('checking/resources.json'));
    const fb = obsRes.languageSets.fallback;
    const pr = obsRes.languageSets.primary;
    const tq = fb['obs-tq'];
    const pinned = !!tq && tq.repoPath === 'git.door43.org/unfoldingWord/en_obs-tq' && /^[0-9a-f]{40}$/.test(tq.sha) && tq.flavor === 'peripheral/x-obsquestions';
    const optional = !('obs-tq' in pr) && !!pr.obs && !!pr['obs-tn'] && !!pr['obs-twl'] && !!pr.translationWords && !!pr.translationAcademy;
    const grammar = pinSlotError('languageSets.fallback.obs-tq') === null && pinSlotError('languageSets.primary.obs-tq') === null && pinSlotError('languageSets.fallback.obs-tqx') !== null;
    const keys = Object.keys(fb);
    const ordered = keys.indexOf('obs-twl') < keys.indexOf('obs-tq') && keys.indexOf('obs-tq') < keys.indexOf('obs-images');
    check('OBS questions member: the fallback set pins obs-tq (flavor peripheral/x-obsquestions, 40-hex sha); the primary set omits it and stays a complete OBS set; the slot grammar accepts obs-tq and refuses a misspelling; the member follows obs-twl and precedes obs-images [covers R-10.6.3]',
      pinned && optional && grammar && ordered, `fallback obs-tq ${tq?.version ?? '?'} @ ${(tq?.sha ?? '').slice(0, 12)}`, 'obs');
  }

  // O6 — the version 2 fold: the drafted story as four `v: 2` segments folds and projects,
  // at checkpoint, to the sample file byte for byte; a `v: 1` set folds unchanged
  {
    const actor = 'obs-actor';
    const ts = (i) => `2026-09-15T12:00:0${i}.000Z|0000|${actor}`;
    const ev = (i, o) => ({ v: 2, actor, ts: ts(i), base: null, ...o });
    const events = [
      ev(0, { op: 'text.frame.set', story: 1, frame: 0, text: DRAFT.title }),
      ev(1, { op: 'text.frame.set', story: 1, frame: 1, text: DRAFT.frames[1] }),
      ev(2, { op: 'text.frame.set', story: 1, frame: 2, text: DRAFT.frames[2] }),
      ev(3, { op: 'text.story.ref.set', story: 1, text: DRAFT.ref }),
    ];
    const out = fold(events);
    const seed = seedStory(read(TING(storyIpath(1))).replace(/\r\n/g, '\n'));
    const proj = derivedProjections(out, { baseMetadata: obsMeta, baseStories: { 1: seed } });
    // R-10.2.3 at checkpoint: the projected metadata.json keeps the template's scope table
    // verbatim (the fold has no story scope; a Bible project's scope is reconstructed)
    const scopeKept = JSON.stringify(JSON.parse(proj['metadata.json']).type.flavorType.currentScope) === JSON.stringify(tmplMeta.type.flavorType.currentScope);
    const positive = out.stories[1].frames[0] === DRAFT.title && out.stories[1].ref === DRAFT.ref && out.forks.length === 0 &&
      proj[storyIpath(1)] === read(OING(storyIpath(1))) && Object.keys(out.books).length === 0 && scopeKept;
    // a v: 1 segment set (the Bible sample's seed) folds unchanged: books project, no story
    const seedBible = seedFromSidecars({ actor: 'seed-actor', books: { TIT: read(ING('TIT.usfm')) }, vrs: { name: 'eng', bytes: read(ING('vrs.json')) } });
    const v1 = fold(seedBible);
    const v1ok = seedBible.every((e) => e.v === 1) && v1.books.TIT.usfm === read(ING('TIT.usfm')) && Object.keys(v1.stories).length === 0;
    // negatives: a v: 1 envelope refuses the story ops and the story targets; a fold whose
    // frame text differs does not project the sample's bytes; no base story refuses
    const v1Refuses = validateEvent({ ...events[1], v: 1 }) !== null &&
      validateEvent({ v: 1, actor, ts: ts(5), base: null, op: 'note.add', target: { story: 1, frame: 1 }, text: 'n' }) !== null &&
      validateEvent({ v: 2, actor, ts: ts(5), base: null, op: 'note.add', target: { story: 1, frame: 1 }, text: 'n' }) === null;
    const mutated = fold([...events.slice(0, 2), ev(2, { op: 'text.frame.set', story: 1, frame: 2, text: 'otro' }), events[3]]);
    const differs = derivedProjections(mutated, { baseMetadata: obsMeta, baseStories: { 1: seed } })[storyIpath(1)] !== read(OING(storyIpath(1)));
    const noBase = throws(() => derivedProjections(out, { baseMetadata: obsMeta }));
    check('OBS v2 fold: the drafted story as four v: 2 segments (title = frame 0, frames 1-2, reference line) folds without forks and the checkpoint projection onto the seed story equals sample content/01.md BYTE FOR BYTE, with the projected metadata.json keeping the template\'s currentScope verbatim; a v: 1 seed set still folds to its USFM with no story; v: 1 refuses the story ops and story targets; a different frame text does not project the sample; a missing base story refuses the checkpoint [covers R-10.7.1 R-10.7.4 R-10.2.3]',
      positive && v1ok && v1Refuses && differs && noBase, '', 'obs');
  }
}

const g = groups;
console.log(`\nStage-1 (path-authoritative — holds on today's pankosmia-web): ${g.stage1[0]} passed, ${g.stage1[1]} failed`);
console.log(`Stage-2 (role/relationships durability — x-roles non-durable by design, D28; client re-asserts after remake): ${g.stage2[0]} passed, ${g.stage2[1]} failed`);
console.log(`Phase-2 (journal-merge design checks, §8.7): ${g.phase2[0]} passed, ${g.phase2[1]} failed`);
console.log(`OBS (the OBS project kind, §10 — sample-burrito-obs): ${g.obs[0]} passed, ${g.obs[1]} failed`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
