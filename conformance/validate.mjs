// Validation harness for the sample tC4 burrito.
// Proves, with the REAL production libraries (usfm-js, word-aligner, word-aligner-lib)
// and Pankosmia's own bundled Scripture Burrito schema, that the proposed structure
// carries everything the tC3 checking tools need.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { scopeError } from './journal/grammar.mjs';
import { writeActionSegment, validateSegment, validateActorDoc, segmentName, readSegments, actorDirFor } from './journal/files.mjs';

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
let pass = 0, fail = 0;
const groups = { stage1: [0, 0], stage2: [0, 0], phase2: [0, 0] };
const check = (name, ok, detail = '', group = 'stage1') => {
  const tag = group === 'stage1' ? '' : ` [${group === 'stage2' ? 'Stage-2/non-durable-by-design (D28)' : 'Phase-2 design'}]`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${tag}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
  groups[group][ok ? 0 : 1]++;
};

const metadata = json(path.join(BURRITO, 'metadata.json'));

// ---------- 1. Scripture Burrito schema validation (Pankosmia's bundled schema) ----------
{
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
  const validate = ajv.getSchema(BASE + 'source_metadata.schema.json');
  if (!validate) { check('SB schema: root schema loaded', false, 'source_metadata.schema.json not resolvable'); }
  else {
    const ok = validate(metadata);
    check('SB schema: metadata.json valid against Pankosmia bundled schema (incl. relationships + x- roles)', !!ok,
      ok ? '' : JSON.stringify(validate.errors.slice(0, 3)));
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
  check('ingredients: 6 role-tagged ingredients present (incl. vrs.json as x-versification)',
    roles.length === 6 && metadata.ingredients['ingredients/vrs.json']?.role === 'x-versification',
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
  const tn = json(ING('checking/translationNotes/TIT.json')).decisions[0];
  check('decisions: tN quote is word-occurrence array (not flattened string)',
    Array.isArray(tn.contextId.quote) && 'word' in tn.contextId.quote[0] && 'occurrence' in tn.contextId.quote[0]);
  const inv = json(ING('checking/translationNotes/TIT.json')).decisions[1];
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
  const pinShape = e => e && e.repoPath && e.version && e.flavor;
  const setOk = s => s && s.gatewayLanguage?.languageId && s.gatewayLanguage?.owner &&
    HELP_SLOTS.every(k => pinShape(s[k]));
  const twoSets = resFile.schemaVersion === 2 &&
    ls && Object.keys(ls).length === 2 && setOk(ls.primary) && setOk(ls.fallback) &&
    ls.fallback.gatewayLanguage.languageId === 'en';
  const indep = pinShape(res?.originalLanguage?.nt) && pinShape(res?.originalLanguage?.ot) &&
    pinShape(res?.lexicon?.nt) && pinShape(res?.lexicon?.ot);
  // Entries MAY carry an OPTIONAL expected commit SHA (`sha`, 40 lowercase hex) for
  // sb-zip pin verification (OPEN-QUESTIONS #24). Grammar enforced when present.
  const entries = [
    ...Object.values(res).flatMap(v => ('repoPath' in v ? [v] : Object.values(v))),
    ...[ls?.primary, ls?.fallback].flatMap(s => HELP_SLOTS.map(k => s?.[k]).filter(Boolean)),
  ];
  const shaOk = entries.every(e => !('sha' in e) || SHA.test(e.sha)) &&
    SHA.test('570e76d0024c847689e48a20e2ac1a1d2c6eb6e3') && !SHA.test('ZZ') && !SHA.test('570e76d');
  check('resources: two language sets pinned (D17/D30) — primary GL + fallback en, each coherent tn+twl+tw+tA; set-independent originals + lexicons; sha 40-hex when present',
    twoSets && indep && shaOk,
    `primary=${ls?.primary?.gatewayLanguage?.languageId}, fallback=${ls?.fallback?.gatewayLanguage?.languageId}; sha grammar + negative controls checked`);

  // §5.2 resolution records (D17; D30 constraint 1): each per-(tool, book) decision file
  // records the resource its check list derived from — tN: the tn pin; tW: the twl pin —
  // and that record MUST equal exactly one rung's pin. Ladder (D30 constraint 2): the
  // automatic fallback is exactly primary → fallback, driven by book coverage.
  const TOOL_SLOT = { translationWords: 'translationWordsLinks', translationNotes: 'translationNotes' };
  const rungOf = df => {
    const slot = TOOL_SLOT[df.tool];
    const matches = ['primary', 'fallback'].filter(r =>
      ls[r][slot].repoPath === df.resource.repoPath && ls[r][slot].version === df.resource.version);
    return matches.length === 1 &&
      (!('languageSet' in df.resource) || df.resource.languageSet === matches[0]) ? matches[0] : null;
  };
  const dfW = json(ING('checking/translationWords/TIT.json'));
  const dfN = json(ING('checking/translationNotes/TIT.json'));
  const foreign = { tool: 'translationNotes', resource: { repoPath: 'git.door43.org/x/other_tn', version: 'v1' } };
  const resolve = (coverage, book) => (coverage.primary.includes(book) ? 'primary' : 'fallback');
  const cov = { primary: ['TIT', 'JON', 'RUT', '3JN'] };   // es-419 tag coverage (evidence 2026-07-31)
  check('resolution: §5.2 files record the resolved (tool, book) resource matching exactly one rung; two-rung coverage ladder primary→fallback (D17/D30)',
    rungOf(dfW) === 'primary' && rungOf(dfN) === 'primary' && rungOf(foreign) === null &&
    resolve(cov, 'TIT') === 'primary' && resolve(cov, 'HEB') === 'fallback' &&
    Object.keys(ls).every(r => ['primary', 'fallback'].includes(r)),
    `tW→${rungOf(dfW)}, tN→${rungOf(dfN)}; foreign record rejected; HEB (uncovered) → fallback`);
  // §5.3 extraScripture (normative since 1.5-draft — D10/OPEN-QUESTIONS #13): gateway source
  // pins for the source panes. Entry shape {id, repoPath, version, flavor}; ids unique;
  // OPTIONAL sha has the main-pin grammar (40 lowercase hex; negative controls above).
  const xs = resFile.extraScripture;
  const xsShapeOk = Array.isArray(xs) && xs.length >= 2 && xs.every(e =>
    typeof e.id === 'string' && e.id.length > 0 && e.repoPath && e.version && e.flavor &&
    (!('sha' in e) || SHA.test(e.sha)));
  const xsIdsUnique = xsShapeOk && new Set(xs.map(e => e.id)).size === xs.length;
  check('resources: extraScripture source pins present ({id,repoPath,version,flavor} complete, ids unique, sha 40-hex when present)',
    xsShapeOk && xsIdsUnique && !SHA.test('84c73ba') && !SHA.test('Z'.repeat(40)),
    xsShapeOk ? `${xs.length} entries (${xs.map(e => e.id).join(', ')}); sha grammar + negative controls checked` : 'array missing or malformed');
  const rels = metadata.relationships;
  check('resources: same pins expressed as SB relationships, schema-valid per test 1',
    Array.isArray(rels) && rels.length === 12 && rels.every(r => r.relationType && r.flavor && r.id.includes('::')), '', 'stage2');
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
  const rmT = () => fs.rmSync(T, { recursive: true, force: true });
  rmT();
  fs.mkdirSync(T, { recursive: true });
  fs.cpSync(path.join(BURRITO, 'ingredients'), path.join(T, 'ingredients'), { recursive: true });
  fs.copyFileSync(path.join(BURRITO, 'metadata.json'), path.join(T, 'metadata.json'));
  fs.writeFileSync(path.join(T, '.gitignore'), '**/*.bak\n');
  const git = args => execSync(`git ${args}`, { cwd: T, stdio: 'pipe' }).toString();

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

const g = groups;
console.log(`\nStage-1 (path-authoritative — holds on today's pankosmia-web): ${g.stage1[0]} passed, ${g.stage1[1]} failed`);
console.log(`Stage-2 (role/relationships durability — x-roles non-durable by design, D28; client re-asserts after remake): ${g.stage2[0]} passed, ${g.stage2[1]} failed`);
console.log(`Phase-2 (journal-merge design checks, §8.7): ${g.phase2[0]} passed, ${g.phase2[1]} failed`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
