// The tC3 parser (issue #21, J9a): one or several tC3 project zips are one
// bundle. The golden test reads the fixture zip itself and proves: the text is
// tC3's own USFM export of the chapter JSON, byte for byte; the alignments are
// the `alignmentData` records (I-2 normalized) and agree with the export's
// `wordAlignments/<project>.usfm`; the decisions are the check index items with
// user data, record for record, and each equals the latest record of its check
// in `checkData/` (no history is converted, D80 point 3). The version step
// never stores a pin without its sha (D82).
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { TC3_PARSER, applyVersions, carryOverNeeds, importedAlignmentRecord, resolveVersions, unresolvedSlots } from '../../src/data/import/tc3';
import { runImport } from '../../src/data/import/shell';
import { USFM_PARSER } from '../../src/data/import/usfm';
import type { ImportBundle, ImportFile } from '../../src/data/import/types';
import { INSTALLED_SUITE } from '../../src/data/installedSuite';
import type { DcsRelease } from '../../src/data/resourceFetch';
import { decompose, verseTextMd5 } from '../../src/data/journal/runtime';
import { usfmjs } from '../../src/data/vendor';
import { ServerApi } from '../../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../../src/data/journal/journalStore';
import { journalingRig, memKv, tickingNow } from '../helpers/journalingRig';
import { fixtureFile } from '../helpers/import';
import { extractVerseFromZalnUsfm } from '../helpers/zaln';

const decoder = new TextDecoder();
const TIT = 'tc3/cfm_fbt_tit_book.zip';
const MULTI = ['tc3/multi/en_kjv_jhn_book.zip', 'tc3/multi/en_kjv_job_book.zip', 'tc3/multi/en_kjv_luk_book.zip'];
const APP = 'apps/translationCore';
const EN_TN_V87 = '80bced5d47685a39ebb2c80fd41461d3cff0d94a';
const UGNT_V034 = 'fc95b2b8aad08bb65ab54628ab685413a1139e97';
const UGNT_V021 = 'e01ef34d7dcf42aabd46f7aa1d110af0391c6b77';
/** The DCS tags the fixtures name [VERIFIED — git.door43.org tags API, 2026-09-26; v999 404 as the control]. */
const DCS: Record<string, string> = {
  'git.door43.org/unfoldingWord/en_tn@v87': EN_TN_V87,
  'git.door43.org/unfoldingWord/el-x-koine_ugnt@v0.34': UGNT_V034,
  'git.door43.org/unfoldingWord/el-x-koine_ugnt@v0.21': UGNT_V021,
  'git.door43.org/unfoldingWord/hbo_uhb@v2.1.30': '106a441a788d9465846cd427538ea80b8cec6770',
};
const lookup = async (repoPath: string, version: string) => DCS[`${repoPath}@${version}`] ?? null;

// Each fixture is unzipped and parsed once per file: the KJV zips are about 5 MB.
// No test mutates a cached value (applyVersions and carry-over return new objects).
const cache = new Map<string, unknown>();
const once = <T>(key: string, make: () => T): T => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
};
/** The zip's files, without its folder entries. */
const zip = (rel: string) =>
  once(`zip:${rel}`, () => Object.fromEntries(Object.entries(unzipSync(fixtureFile(rel).bytes)).filter(([name]) => !name.endsWith('/'))));
/** The parser's bundle for these fixture files, in this order. */
const parsed = (...rels: string[]) => once(`parse:${rels.join('|')}`, () => TC3_PARSER.parse(rels.map((rel) => fixtureFile(rel))));
const json = (files: Record<string, Uint8Array>, name: string) => JSON.parse(decoder.decode(files[name]));
const damagedOf = (bundle: ImportBundle) => bundle.findings.filter((f) => f.kind === 'damaged');
const sidecar = <T>(bundle: ImportBundle, rel: string) => bundle.sidecars![rel] as T;

/** tC3's USFM export (`USFMExportActions.setUpUSFMJSONObject` + `toUSFM`), written out again as the oracle. */
function tc3Usfm(files: Record<string, Uint8Array>, book: string): string {
  const chapters: Record<string, Record<string, unknown>> = {};
  for (const name of Object.keys(files).filter((n) => new RegExp(`^${book}/\\d+\\.json$`).test(n))) {
    const verses = json(files, name) as Record<string, string>;
    chapters[parseInt(name.split('/')[1], 10)] = Object.fromEntries(Object.entries(verses).map(([v, text]) => [v, { verseObjects: [{ text: `${text}\n`, type: 'text' }] }]));
  }
  const headers = json(files, `${book}/headers.json`) as Array<{ tag: string; content: string }>;
  const usfm = headers.find((h) => h.tag === 'usfm');
  if (usfm) usfm.content = '3.0';
  else if (headers.length < 2) headers.push({ tag: 'usfm', content: '3.0' });
  else headers.splice(1, 0, { tag: 'usfm', content: '3.0' });
  return usfmjs.toUSFM({ headers, chapters }, { forcedNewLines: true });
}

// The KJV fixtures are about 5 MB of zips: a parse of the three takes seconds under the full suite.
describe('#21 the tC3 parser', { timeout: 60_000 }, () => {
  it('accepts one or several .zip files, and nothing else', () => {
    const f = (name: string): ImportFile => ({ name, bytes: new Uint8Array() });
    expect(TC3_PARSER.accepts([f('a.zip')])).toBe(true);
    expect(TC3_PARSER.accepts([f('a.zip'), f('b.ZIP')])).toBe(true);
    expect(TC3_PARSER.accepts([f('a.zip'), f('b.usfm')])).toBe(false);
    expect(TC3_PARSER.accepts([])).toBe(false);
  });

  it('golden: the text is tC3\'s own USFM export of the chapter JSON, byte for byte', async () => {
    for (const rel of [TIT, ...MULTI]) {
      const files = zip(rel);
      const book = json(files, 'manifest.json').project.id as string;
      const bundle = await parsed(rel);
      expect(damagedOf(bundle)).toEqual([]);
      expect(bundle.books).toEqual([{ code: book.toUpperCase(), usfm: tc3Usfm(files, book) }]);
    }
  });

  it('golden: every alignmentData record is stored, I-2 normalized, keyed to its verse text (I-3)', async () => {
    const files = zip(TIT);
    const bundle = await parsed(TIT);
    const stored = sidecar<{ schemaVersion: number; book: string; chapters: Record<string, Record<string, Record<string, unknown>>> }>(bundle, 'checking/alignments/TIT.json');
    expect(stored.schemaVersion).toBe(1);
    expect(stored.book).toBe('TIT');
    const { verses } = decompose(bundle.books[0].usfm);
    let n = 0;
    for (const name of Object.keys(files).filter((f) => /^apps\/translationCore\/alignmentData\/tit\/\d+\.json$/.test(f))) {
      const chapter = name.split('/').pop()!.replace('.json', '');
      for (const [verse, original] of Object.entries(json(files, name) as Record<string, { alignments: Array<{ bottomWords: unknown[] }>; wordBank: unknown[] }>)) {
        // `front` is the text before verse 1: not a verse, and it holds no aligned word
        if (verse === 'front') {
          expect(original.alignments.every((a) => a.bottomWords.length === 0)).toBe(true);
          continue;
        }
        const record = stored.chapters[chapter][verse];
        const intify = (list: unknown) => JSON.parse(JSON.stringify(list), (k, v) => (k === 'occurrence' || k === 'occurrences' ? Number(v) : typeof v === 'string' ? v.normalize('NFC') : v));
        // the one field `unmerge` does not give (§5.1): tC3's `type: "bottomWord"`
        const unmerged = (original.alignments as Array<{ topWords: unknown[]; bottomWords: Array<Record<string, unknown>> }>).map((a) => ({ topWords: a.topWords, bottomWords: a.bottomWords.map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'type'))) }));
        expect(record.alignments).toEqual(intify(unmerged));
        expect(record.wordBank).toEqual(intify(original.wordBank));
        expect(record.targetVerseMd5).toBe(verseTextMd5(verses[`${chapter}:${verse}`]));
        expect(record.sourceVersion).toBe('dcs::unfoldingWord/el-x-koine_ugnt@master');
        expect(record.invalid).toBe(false);
        n += 1;
      }
    }
    expect(n).toBe(bundle.alignments!.TIT.length);
    expect(n).toBeGreaterThan(40);
  });

  // tC3's aligned export drops words inside nested character markers (`\wj … \+w`,
  // `\nd \+w`): in the KJV fixtures 28 JHN verses and 23 JOB verses lose text.
  // So the chapter JSON and `alignmentData` are the source, and the export is
  // the cross-check: every aligned word agrees, and the text agrees word for
  // word in every verse but those the export damaged (their count is pinned).
  it('golden: alignmentData and wordAlignments/<project>.usfm agree: every aligned word, and the text where the export is complete', async () => {
    const LOSSY: Record<string, number> = { TIT: 0, JHN: 28, JOB: 23, LUK: 0 };
    const plain = (content: string) => {
      const parts: string[] = [];
      const walk = (objects: Array<{ text?: string; children?: never[] }> = []) => objects.forEach((o) => (o.text && parts.push(o.text), walk(o.children)));
      walk((usfmjs.toJSON(`\\v 1 ${content}`, { chunk: true }) as { verses: Record<string, { verseObjects: never[] }> }).verses['1'].verseObjects);
      return parts.join('').split(/\s+/).filter(Boolean);
    };
    const withoutType = (list: Array<{ topWords: unknown[]; bottomWords: Array<Record<string, unknown>> }>) =>
      list.filter((a) => a.bottomWords.length).map((a) => ({ topWords: a.topWords, bottomWords: a.bottomWords.map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'type'))) }));
    let alignedVerses = 0;
    for (const rel of [TIT, ...MULTI]) {
      const files = zip(rel);
      const code = (json(files, 'manifest.json').project.id as string).toUpperCase();
      const bundle = await parsed(rel);
      const stored = sidecar<{ chapters: Record<string, Record<string, { alignments: never[] }>> }>(bundle, `checking/alignments/${code}.json`);
      const aligned = decompose(decoder.decode(files[Object.keys(files).find((f) => /^wordAlignments\/.+\.usfm$/.test(f))!])).verses;
      const text = decompose(bundle.books[0].usfm).verses;
      let lossy = 0;
      for (const key of Object.keys(text).filter((k) => !k.startsWith('0:'))) {
        const [a, t] = [plain(aligned[key] ?? ''), plain(text[key])];
        if (a.join(' ') !== t.join(' ')) lossy += 1;
        const [chapter, verse] = key.split(':');
        const record = stored.chapters[chapter]?.[verse];
        if (!record || !withoutType(record.alignments).length) continue;
        const words = (record.alignments as Array<{ topWords: Array<Record<string, unknown>> }>).flatMap((x) => x.topWords);
        const back = extractVerseFromZalnUsfm(aligned[key], words.map((w) => ({ tag: 'w', type: 'word', text: w.word, strong: w.strong, lemma: w.lemma, morph: w.morph, occurrence: w.occurrence, occurrences: w.occurrences })));
        expect(withoutType(back.alignments as never), `${code} ${key}`).toEqual(withoutType(record.alignments));
        alignedVerses += 1;
      }
      expect(lossy, `${code}: verses where the export lost text`).toBe(LOSSY[code]);
    }
    expect(alignedVerses).toBeGreaterThan(0);
  });

  it('golden: the decisions are the index items with user data, record for record; each equals its latest checkData record', async () => {
    const files = zip(TIT);
    const bundle = await parsed(TIT);
    const originals = Object.keys(files)
      .filter((f) => /^apps\/translationCore\/index\/translation(Notes|Words)\/tit\/[^/]+\.json$/.test(f))
      .flatMap((f) => json(files, f) as Array<Record<string, unknown>>)
      .filter((i) => (Array.isArray(i.selections) && i.selections.length) || i.nothingToSelect || i.comments || i.reminders || i.verseEdits || i.invalidated);
    expect(originals).toHaveLength(5);
    expect(bundle.decisions).toHaveLength(5);
    const pick = ({ contextId, selections, comments, reminders, nothingToSelect, verseEdits, invalidated }: Record<string, unknown>) => ({ contextId, selections, comments, reminders, nothingToSelect, verseEdits, invalidated });
    expect(bundle.decisions!.map(pick)).toEqual(originals.map(pick));
    for (const d of bundle.decisions! as Array<Record<string, unknown> & { contextId: { groupId: string; reference: { chapter: number; verse: number } } }>) {
      expect(d.category).not.toBe('');
      // the latest selections record of the check in the history
      const dir = `${APP}/checkData/selections/tit/${d.contextId.reference.chapter}/${d.contextId.reference.verse}/`;
      const history = Object.keys(files)
        .filter((f) => f.startsWith(dir))
        .map((f) => json(files, f))
        .filter((r) => JSON.stringify(r.contextId) === JSON.stringify(d.contextId))
        .sort((a, b) => String(a.modifiedTimestamp).localeCompare(String(b.modifiedTimestamp)));
      if (!history.length) continue;
      const latest = history.pop();
      expect(d.selections).toEqual(latest.selections.length ? latest.selections : false);
      expect(String(d.modifiedTimestamp) >= latest.modifiedTimestamp).toBe(true);
    }
    const categories = Object.keys(files).filter((f) => f.includes('/categoryIndex/')).length;
    expect(categories).toBeGreaterThan(0);
  });

  it('several zips of one language are one bundle; different licenses ask the review page', async () => {
    const bundle = await parsed(...MULTI);
    expect(damagedOf(bundle)).toEqual([]);
    expect(bundle.books.map((b) => b.code)).toEqual(['JHN', 'JOB', 'LUK']);
    expect(bundle.facts.language).toBe('en');
    expect(bundle.facts.license).toBeUndefined();
    expect(bundle.licenseChoices).toEqual(['CC0 1.0 Public Domain', 'CC BY-SA 4.0']);
    expect(bundle.findings.find((f) => f.kind === 'license')?.warn).toBe(true);
  });

  it('refuses: no manifest.json, two languages, one book twice', async () => {
    const noManifest = await parsed('damaged/tc3-no-manifest');
    expect(damagedOf(noManifest).map((f) => f.code)).toEqual(['import.damaged.no-manifest']);
    const langs = await parsed(TIT, MULTI[0]);
    expect(damagedOf(langs)).toHaveLength(1);
    const twice = await parsed(TIT, TIT);
    expect(damagedOf(twice)).toHaveLength(1);
  });

  it('the versions: each slot takes the newest version DCS has; a version DCS does not have is unresolved', async () => {
    const bundle = await parsed(...MULTI);
    const found = await resolveVersions(bundle.versions!, lookup);
    // LUK names Door43-Catalog ugnt v0.24 (gone from DCS) and v0.34; JHN names v0.21: v0.34 is the newest found
    expect(found['originalLanguage.nt']).toEqual({ repoPath: 'git.door43.org/unfoldingWord/el-x-koine_ugnt', version: 'v0.34', sha: UGNT_V034 });
    expect(found.translationNotes).toEqual({ repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v87', sha: EN_TN_V87 });
    // LUK's tW decisions name no version: unresolved
    expect(unresolvedSlots(bundle.versions!, found)).toEqual(['translationWords']);
    expect(carryOverNeeds(bundle, found)).toEqual([{ tool: 'translationWords', book: 'LUK' }]);
    // offline: every slot is unresolved
    const offline = await resolveVersions(bundle.versions!, async () => null);
    expect(unresolvedSlots(bundle.versions!, offline).sort()).toEqual(['originalLanguage.nt', 'originalLanguage.ot', 'translationNotes', 'translationWords']);
  });

  it('the versions: books that name different helps versions leave the slot unresolved, so every book carries over', async () => {
    const nt = { slot: 'originalLanguage.nt' as const, candidates: [] };
    const requests = [
      { slot: 'translationNotes' as const, book: 'JHN', candidates: [{ repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v87' }] },
      { slot: 'translationNotes' as const, book: 'LUK', candidates: [{ repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v86' }] },
      { ...nt, book: 'JHN' },
    ];
    const asked: string[] = [];
    const found = await resolveVersions(requests, async (repoPath, version) => (asked.push(version), lookup(repoPath, version)));
    expect(found.translationNotes).toBeUndefined();
    expect(asked).not.toContain('v87');
    expect(unresolvedSlots(requests, found)).toContain('translationNotes');
    // one book names v87, the other names none: the other book does not get v87's sha
    const oneSilent = [requests[0], { ...requests[1], candidates: [] }, requests[2]];
    expect((await resolveVersions(oneSilent, lookup)).translationNotes).toBeUndefined();
    // DCS does not answer for the newest candidate: the slot stays unresolved, and
    // the older v0.34 is not pinned in its place; the other slots keep their shas
    const ol = [{ slot: 'originalLanguage.nt' as const, book: 'LUK', candidates: [{ repoPath: 'git.door43.org/unfoldingWord/el-x-koine_ugnt', version: 'v0.99' }, { repoPath: 'git.door43.org/unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }] }];
    const tn = { slot: 'translationNotes' as const, book: 'LUK', candidates: [{ repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v87' }] };
    const failing = async (repoPath: string, version: string) => (version === 'v0.99' ? undefined : lookup(repoPath, version));
    const partial = await resolveVersions([...ol, tn], failing);
    expect(partial['originalLanguage.nt']).toBeUndefined();
    expect(partial.translationNotes?.sha).toBe(EN_TN_V87);
    // DCS has no v0.99 (a conclusive answer): the next candidate is pinned
    expect((await resolveVersions(ol, lookup))['originalLanguage.nt']?.sha).toBe(UGNT_V034);
    // a lookup result that is not a 40-hex sha is no pin
    expect((await resolveVersions(ol, async () => 'not-a-sha'))['originalLanguage.nt']).toBeUndefined();
  });

  it('applyVersions: a found version is a full pin and its decisions stay as they are; an installed one carries over (D36)', async () => {
    const bundle = await parsed(TIT);
    const found = await resolveVersions(bundle.versions!, lookup);
    const { bundle: out } = applyVersions(bundle, INSTALLED_SUITE as never, found);
    const resources = sidecar<{ languageSets: { primary: Record<string, { sha: string; version?: string }> }; resources: { originalLanguage: { nt: { sha: string } } } }>(out, 'checking/resources.json');
    expect(resources.languageSets.primary.translationNotes).toMatchObject({ version: 'v87', sha: EN_TN_V87 });
    expect(resources.resources.originalLanguage.nt.sha).toBe(UGNT_V034);
    const tn = sidecar<{ resource: unknown; decisions: unknown[] }>(out, 'checking/translationNotes/TIT.json');
    expect(tn.resource).toEqual({ repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v87', sha: EN_TN_V87, languageSet: 'primary' });
    expect(tn.decisions).toEqual(sidecar<{ decisions: unknown[] }>(bundle, 'checking/translationNotes/TIT.json').decisions);
    // every pin in the file has a sha (D58)
    const shas = JSON.stringify(resources).match(/"repoPath"/g)!.length;
    expect(JSON.stringify(resources).match(/"sha":"[0-9a-f]{40}"/g)!.length).toBe(shas);

    // installed: the decisions move to the installed en_tn; a check list without the items invalidates them
    const offline = await resolveVersions(bundle.versions!, async () => null);
    expect(() => applyVersions(bundle, INSTALLED_SUITE as never, offline)).toThrow(/no check list/);
    const moved = applyVersions(bundle, INSTALLED_SUITE as never, offline, { 'translationNotes/TIT': [] });
    expect(moved.invalidated).toBe(5);
    const tnMoved = sidecar<{ resource: { sha: string }; decisions: Array<{ invalidated: boolean }> }>(moved.bundle, 'checking/translationNotes/TIT.json');
    expect(tnMoved.resource.sha).toBe(INSTALLED_SUITE.languageSets.primary.translationNotes.sha);
    expect(tnMoved.decisions.every((d) => d.invalidated)).toBe(true);
    // the same list the decisions came from: every one carries over
    const same = bundle.decisions!.map((d) => ({ ...d, selections: false, nothingToSelect: false, verseEdits: false, invalidated: false, comments: false, reminders: false }));
    expect(applyVersions(bundle, INSTALLED_SUITE as never, offline, { 'translationNotes/TIT': same as never }).carried).toBe(5);
  });
});

// A tC3 project records one tW version (`tWordsGateway`). The TWL pin is the
// `<lang>_twl` release closest in date to that tw release; no date, the latest
// release; a gateway with no `_twl` repository (`hasTwl: false`), the bundled
// `en_twl` (ruling 7). The one-repo form is never written (ruling 6).
describe('#646 the tW version of a tC3 import pins its own _twl release (D97 ruling 8)', () => {
  const EN_TW = 'git.door43.org/unfoldingWord/en_tw';
  const EN_TWL = 'git.door43.org/unfoldingWord/en_twl';
  const UR_TW = 'git.door43.org/Door43-Catalog/ur-deva_tw';
  const UR_TWL = 'git.door43.org/Door43-Catalog/ur-deva_twl';
  const EN_TW_V90 = '014524aebf4f997c123777e952856d24e3b246d2';
  const EN_TWL_V91 = '7cbb3419f79780ce84b92ad7d42bd476cc5d8a64';
  const EN_TWL_V90 = '5429bf17520c4c0bc1be7f4454c36adaeed75485';
  const EN_TWL_V89 = '4bf5ba649b489a906d68f89477d83204b7c79b61';
  const UR_TW_V83 = 'cb2ed7b86a183da372036f02165f3fceab2321ef';
  /** The DCS tags and releases these cases name [VERIFIED — git.door43.org tags
   * and releases APIs, 2026-10-13; `Door43-Catalog/ur-deva_tw` v8.3 and its release, and
   * `Door43-Catalog/ur-deva_twl` answering HTTP 404 as the control, 2026-10-14]. */
  const TAGS: Record<string, string> = {
    [`${EN_TW}@v90`]: EN_TW_V90,
    [`${EN_TWL}@v91`]: EN_TWL_V91,
    [`${EN_TWL}@v90`]: EN_TWL_V90,
    [`${EN_TWL}@v89`]: EN_TWL_V89,
    [`${UR_TW}@v8.3`]: UR_TW_V83,
  };
  const RELEASES: Record<string, DcsRelease[] | null> = {
    [EN_TW]: [{ version: 'v91', createdAt: '2026-09-26T15:47:38Z' }, { version: 'v90', createdAt: '2026-08-14T20:41:43Z' }, { version: 'v89', createdAt: '2026-06-23T22:01:45Z' }],
    [EN_TWL]: [{ version: 'v91', createdAt: '2026-09-26T15:47:29Z' }, { version: 'v90', createdAt: '2026-08-15T10:12:43Z' }, { version: 'v89', createdAt: '2026-06-23T22:01:33Z' }],
    [UR_TW]: [{ version: 'v8.3', createdAt: '2021-02-23T20:10:54Z' }],
    [UR_TWL]: null, // HTTP 404: no such repository
  };
  const tags = async (repoPath: string, version: string) => TAGS[`${repoPath}@${version}`] ?? null;
  const releases = async (repoPath: string) => RELEASES[repoPath];
  const twRequest = (repoPath: string, version: string) => [{ slot: 'translationWords' as const, book: 'TIT', candidates: [{ repoPath, version }] }];
  /** One book with tW decisions and no other tool: the tw slot is the only version. */
  const bundle: ImportBundle = {
    kind: 'bible',
    facts: { language: 'cfm', name: 'cfm_fbt' },
    books: [{ code: 'TIT', usfm: '' }],
    sidecars: { 'checking/translationWords/TIT.json': { schemaVersion: 1, tool: 'translationWords', book: 'TIT', decisions: [] } },
    findings: [],
  };
  type Pins = { languageSets: Record<'primary' | 'fallback', Record<string, { repoPath: string; version?: string; sha: string; books?: string[] }>> };
  const pinsOf = (found: Awaited<ReturnType<typeof resolveVersions>>, derived?: Record<string, never[]>) =>
    sidecar<Pins>(applyVersions(bundle, INSTALLED_SUITE as never, found, derived).bundle, 'checking/resources.json').languageSets;

  it('en_tw v90 (2026-08-14) pins en_twl v90 (2026-08-15), the release closest in date; the decisions record the _twl pin', async () => {
    const requests = twRequest(EN_TW, 'v90');
    const found = await resolveVersions(requests, tags, releases);
    expect(found.translationWords).toEqual({ repoPath: EN_TW, version: 'v90', sha: EN_TW_V90 });
    expect(found.translationWordsLinks).toEqual({ repoPath: EN_TWL, version: 'v90', sha: EN_TWL_V90 });
    expect(unresolvedSlots(requests, found)).toEqual([]);
    const { bundle: out } = applyVersions(bundle, INSTALLED_SUITE as never, found);
    const { primary } = sidecar<Pins>(out, 'checking/resources.json').languageSets;
    expect(primary.translationWords).toMatchObject({ repoPath: EN_TW, version: 'v90', sha: EN_TW_V90 });
    expect(primary.translationWordsLinks).toMatchObject({ repoPath: EN_TWL, version: 'v90', sha: EN_TWL_V90, books: ['TIT'] });
    expect(sidecar<{ resource: unknown }>(out, 'checking/translationWords/TIT.json').resource).toEqual({ repoPath: EN_TWL, version: 'v90', sha: EN_TWL_V90, languageSet: 'primary' });
  });

  it('a tw tag with no release date pins the latest _twl release', async () => {
    const noTwDate = async (repoPath: string) => (repoPath === EN_TW ? [] : RELEASES[repoPath]);
    const found = await resolveVersions(twRequest(EN_TW, 'v90'), tags, noTwDate);
    expect(found.translationWordsLinks).toEqual({ repoPath: EN_TWL, version: 'v91', sha: EN_TWL_V91 });
  });

  it('a gateway with no _twl repository (ur-deva, hasTwl: false) pins the bundled en_twl and asks DCS for no _twl (ruling 7)', async () => {
    const asked: string[] = [];
    const found = await resolveVersions(twRequest(UR_TW, 'v8.3'), tags, async (repoPath) => (asked.push(repoPath), RELEASES[repoPath]));
    expect(found.translationWords).toEqual({ repoPath: UR_TW, version: 'v8.3', sha: UR_TW_V83 });
    const bundled = INSTALLED_SUITE.languageSets.fallback.translationWordsLinks;
    expect(found.translationWordsLinks).toEqual({ repoPath: bundled.repoPath, version: bundled.version, sha: bundled.sha });
    expect(asked).not.toContain(UR_TWL);
    const { primary, fallback } = pinsOf(found);
    expect(primary.translationWords).toMatchObject({ repoPath: UR_TW, version: 'v8.3', sha: UR_TW_V83 });
    expect(primary.translationWordsLinks).toMatchObject({ repoPath: bundled.repoPath, sha: bundled.sha });
    expect(primary.translationWordsLinks.repoPath).toBe(fallback.translationWordsLinks.repoPath);
    // D41: the books tC3 checked are a fact about the commit it checked against, not about a pin that was never looked up
    expect(primary.translationWordsLinks.books).toBeUndefined();
  });

  it('the tw slot stays unresolved, and the one-repo form is never written, when the _twl release cannot be pinned', async () => {
    const requests = twRequest(EN_TW, 'v90');
    // DCS did not answer the releases
    const silent = await resolveVersions(requests, tags, async () => undefined);
    expect(silent.translationWords).toBeUndefined();
    expect(unresolvedSlots(requests, silent)).toEqual(['translationWords']);
    // DCS confirms that a gateway which publishes _twl (hasTwl: true) has no _twl release
    const none = await resolveVersions(requests, tags, async (repoPath) => (repoPath === EN_TWL ? [] : RELEASES[repoPath]));
    expect(none.translationWords).toBeUndefined();
    // no release lookup at all: unresolved, never a guess
    const dflt = await resolveVersions(requests, tags);
    expect(dflt.translationWords).toBeUndefined();
    // the closest release names no commit: the next closest one is pinned (v91 is 43 days from the tw date, v89 is 52)
    const noV90 = async (repoPath: string, version: string) => (repoPath === EN_TWL && version === 'v90' ? null : tags(repoPath, version));
    expect((await resolveVersions(requests, noV90, releases)).translationWordsLinks).toEqual({ repoPath: EN_TWL, version: 'v91', sha: EN_TWL_V91 });
    // whichever way, the stored twl slot names a _twl repository (ruling 6) and the decisions carry over to it
    for (const found of [silent, none, dflt]) {
      const { primary } = pinsOf(found, { 'translationWords/TIT': [] });
      expect(primary.translationWordsLinks.repoPath).toMatch(/_twl$/);
      expect(primary.translationWords.repoPath).toMatch(/_tw$/);
    }
  });
});

describe('#21 the tC3 import end to end on the fake rig', { timeout: 60_000 }, () => {
  const setup = () => {
    forgetSharedClocks();
    forgetProjectQueues();
    const rig = journalingRig();
    const clock = tickingNow('2026-09-26T12:00:00.000Z');
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
    return { rig, api, store };
  };
  const resolveWith = (found: Awaited<ReturnType<typeof resolveVersions>> | null = null) => async (bundle: ImportBundle) =>
    applyVersions(bundle, INSTALLED_SUITE as never, found ?? (await resolveVersions(bundle.versions!, lookup))).bundle;

  it('a region-tagged language imports with its tag (the #361 create rule)', async () => {
    const { rig, api, store } = setup();
    const report = await runImport(TC3_PARSER, [fixtureFile(TIT)], { name: 'Tito', language: 'es-419' }, { api, store, resolve: resolveWith() });
    expect(report.ok, JSON.stringify(report)).toBe(true);
    expect((rig.repos.get('_local_/_local_/tito')!.meta as { languages: Array<{ tag: string }> }).languages[0].tag).toBe('es-419');
  });

  it('one zip with a license and one without: "no license" is a choice, and it writes no copyright; a book with no alignment data imports', async () => {
    const { rig, api, store } = setup();
    // Titus again as Philemon, with no license in its manifest
    const entries = zip(TIT);
    const phm: Record<string, Uint8Array> = {};
    for (const [name, bytes] of Object.entries(entries)) phm[name.replace(/^tit\//, 'phm/')] = bytes;
    const manifest = json(entries, 'manifest.json');
    manifest.project.id = 'phm';
    delete manifest.license;
    phm['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    const files = [fixtureFile(TIT), { name: 'cfm_fbt_phm_book.zip', bytes: zipSync(phm) }];
    const bundle = await TC3_PARSER.parse(files);
    expect(bundle.licenseChoices).toEqual(['', 'CC BY-SA 4.0']); // PHM, TIT
    expect(bundle.sidecars!['checking/alignments/PHM.json']).toBeUndefined(); // no alignmentData for phm
    const notChosen = await runImport(TC3_PARSER, files, { name: 'Mixed' }, { api, store, resolve: resolveWith() });
    expect(notChosen.ok).toBe(false);
    const none = await runImport(TC3_PARSER, files, { name: 'Mixed', license: '' }, { api, store, resolve: resolveWith() });
    expect(none.ok, JSON.stringify(none)).toBe(true);
    // the copyright stays what the create route wrote: the same as a USFM import, which carries no license
    const plain = await runImport(USFM_PARSER, [fixtureFile('usfm/57-TIT.usfm')], { name: 'Plain', language: 'cfm' }, { api, store });
    expect(plain.ok).toBe(true);
    const copyright = (repo: string) => (rig.repos.get(`_local_/_local_/${repo}`)!.meta as { copyright?: unknown }).copyright;
    expect(copyright('mixed')).toEqual(copyright('plain'));
  });

  it('refuses before any write: versions not resolved; different licenses and none chosen', async () => {
    const { rig, api, store } = setup();
    const before = [...rig.repos.keys()];
    const unresolved = await runImport(TC3_PARSER, [fixtureFile(TIT)], {}, { api, store });
    expect(unresolved.ok).toBe(false);
    const noLicense = await runImport(TC3_PARSER, MULTI.map((rel) => fixtureFile(rel)), {}, { api, store, resolve: async (b) => applyVersions(b, INSTALLED_SUITE as never, await resolveVersions(b.versions!, lookup), { 'translationWords/LUK': [] }).bundle });
    expect(noLicense.ok).toBe(false);
    expect([...rig.repos.keys()]).toEqual(before);
  });
});

// #796 slice 4 (D36, D105 point 7): tC3 writes an invalid marker when its own editor changes a
// linked word. A text edited outside tC3 leaves no marker, so the record imported as current
// with a hash that vouched for words the verse no longer holds. The import now tests the
// record's words against the verse, flags a record that fails, and never rewrites it.
//
// The ways this can fail, written before the code:
// 1. a linked word left the text and the record imports with `invalid: false` (B1b, the parse);
// 2. the import rewrites the record to fit: the link or the bank changes (B1b, the parse);
// 3. the flag lands on a record that fits: the three tC3 fixtures change (B2);
// 4. the flag lands on a record that holds no link, which vouches for nothing (B1d);
// 5. the clause reads NFD text as other words (B1e), or NFD tC3 words as other words (B1g);
// 6. a marker is dropped when the words do not fit (B1c).
describe('#796 the tC3 import flags a record whose words do not fit the verse', { timeout: 60_000 }, () => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const SAMPLE = path.resolve(__dirname, '../../conformance/sample-burrito/ingredients');
  const RAW: string = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
  const SLOT = (decompose(RAW).verses as Record<string, string>)['1:1'];
  const STORED = (JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8')) as { chapters: Record<string, Record<string, { alignments: Array<{ topWords: unknown[]; bottomWords: Array<{ word: string }> }>; wordBank: unknown[] }>> }).chapters['1']['1'];
  /** What tC3 holds for the verse: the two lists, no stamp. */
  const DATA = { alignments: STORED.alignments, wordBank: STORED.wordBank } as Parameters<typeof importedAlignmentRecord>[0];
  const SV = 'dcs::unfoldingWord/el-x-koine_ugnt@master';
  const bytes = (value: unknown) => JSON.stringify(value);

  it('preconditions: the sample slot holds the linked word, and the record links it', () => {
    expect(SLOT).toContain('siervo');
    expect(STORED.alignments.flatMap((a) => a.bottomWords).map((w) => w.word)).toContain('siervo');
    expect(STORED.alignments.flatMap((a) => a.bottomWords).length).toBeGreaterThan(0);
  });

  it('B1a the text is unchanged: the record is current, and its lists are what tC3 held', () => {
    const record = importedAlignmentRecord(DATA, SLOT, false, SV);
    expect(record.invalid).toBe(false);
    expect(record.alignments).toEqual(STORED.alignments);
    expect(record.wordBank).toEqual(STORED.wordBank);
    expect(record.targetVerseMd5).toBe(verseTextMd5(SLOT));
    expect(record.sourceVersion).toBe(SV);
  });

  it('B1b a linked word left the text: the record is flagged, and its lists are byte for byte what tC3 held', () => {
    const edited = SLOT.replace('siervo', 'esclavo');
    expect(edited).not.toBe(SLOT);
    const record = importedAlignmentRecord(DATA, edited, false, SV);
    expect(record.invalid).toBe(true);
    expect(bytes(record.alignments)).toBe(bytes(STORED.alignments));
    expect(bytes(record.wordBank)).toBe(bytes(STORED.wordBank));
    // the hash is the text's, as before: the flag, not a stale hash, carries the news
    expect(record.targetVerseMd5).toBe(verseTextMd5(edited));
  });

  it('B1b a word more or fewer in the text, and a changed count, are flagged too', () => {
    for (const edited of [`${SLOT} extra`, SLOT.replace('Pablo, ', ''), SLOT.replace('siervo', 'siervo siervo')]) {
      expect(edited, 'the edit changes the text').not.toBe(SLOT);
      expect(importedAlignmentRecord(DATA, edited, false, SV).invalid, edited).toBe(true);
    }
  });

  it('B1c tC3 kept an invalid marker: the record is flagged though its words fit, and when they do not', () => {
    const record = importedAlignmentRecord(DATA, SLOT, true, SV);
    expect(record.invalid).toBe(true);
    expect(record.alignments).toEqual(STORED.alignments);
    // the usual real tC3 case: the marker is there and a linked word has left the text
    expect(importedAlignmentRecord(DATA, SLOT.replace('siervo', 'esclavo'), true, SV).invalid).toBe(true);
    // a marker on a record with no link that does not fit: the marker alone flags it
    const unlinked = { ...DATA, alignments: DATA.alignments!.map((a) => ({ ...a, bottomWords: [] })) } as Parameters<typeof importedAlignmentRecord>[0];
    expect(importedAlignmentRecord(unlinked, SLOT, true, SV).invalid).toBe(true);
  });

  it('B1d a record with no link vouches for nothing: no flag, though its words do not fit the verse', () => {
    const bare = {
      alignments: STORED.alignments.map((a) => ({ topWords: a.topWords, bottomWords: [] })),
      wordBank: [{ word: 'zzz', occurrence: 1, occurrences: 1 }],
    } as Parameters<typeof importedAlignmentRecord>[0];
    expect(importedAlignmentRecord(bare, SLOT, false, SV).invalid).toBe(false);
    // the control: one link on the same record and the clause answers yes
    const linked = { ...bare, alignments: bare.alignments!.map((a, i) => (i === 0 ? { ...a, bottomWords: [{ word: 'Pablo', occurrence: 1, occurrences: 1 }] } : a)) } as Parameters<typeof importedAlignmentRecord>[0];
    expect(importedAlignmentRecord(linked, SLOT, false, SV).invalid).toBe(true);
  });

  it('B1e NFD content is compared as its NFC words: the verse in NFD fits its NFC record', () => {
    expect(SLOT.normalize('NFD')).not.toBe(SLOT);
    expect(importedAlignmentRecord(DATA, SLOT.normalize('NFD'), false, SV).invalid).toBe(false);
  });

  it('B1f occurrence numbers written as strings (tC3 does this) fit as the numbers', () => {
    const asStrings = JSON.parse(JSON.stringify(DATA), (k, v) => (k === 'occurrence' || k === 'occurrences' ? String(v) : v));
    const record = importedAlignmentRecord(asStrings, SLOT, false, SV);
    expect(record.invalid).toBe(false);
    expect(record.alignments).toEqual(STORED.alignments);
  });

  it('B1g tC3 words in NFD (bank and placed) fit the verse in NFD: they are compared as NFC words', () => {
    const nfd = JSON.parse(JSON.stringify(DATA), (_k, v) => (typeof v === 'string' ? v.normalize('NFD') : v)) as typeof DATA;
    expect(bytes(nfd), 'the tC3 words are NFD').not.toBe(bytes(DATA));
    expect(importedAlignmentRecord(nfd, SLOT.normalize('NFD'), false, SV).invalid).toBe(false);
  });

  it('B2 the fixtures: a parsed record is invalid exactly where tC3 kept a marker', async () => {
    let linked = 0;
    let marked = 0;
    for (const rel of [TIT, ...MULTI]) {
      const files = zip(rel);
      const book = json(files, 'manifest.json').project.id as string;
      const bundle = await parsed(rel);
      const stored = sidecar<{ chapters: Record<string, Record<string, { invalid: boolean; alignments: Array<{ bottomWords: unknown[] }> }>> }>(bundle, `checking/alignments/${book.toUpperCase()}.json`)?.chapters ?? {};
      for (const [chapter, verses] of Object.entries(stored)) {
        for (const [verse, record] of Object.entries(verses)) {
          const marker = `${APP}/tools/wordAlignment/invalid/${chapter}/${verse}.json` in files;
          expect(record.invalid, `${book} ${chapter}:${verse}`).toBe(marker);
          if (record.alignments.some((a) => a.bottomWords.length)) linked += 1;
          if (marker) marked += 1;
        }
      }
    }
    // the fixtures hold two linked records (JHN 1:1, LUK 1:1) and one marker (LUK 1:1)
    expect(linked).toBe(2);
    expect(marked).toBe(1);
  });

  it('B1b through the parse: a linked word edited out of the text outside tC3 imports flagged, the record kept', async () => {
    const files = zip(MULTI[0]);
    const aligned = json(files, `${APP}/alignmentData/jhn/1.json`) as Record<string, { alignments: Array<{ bottomWords: Array<{ word: string }> }> }>;
    const word = aligned['1'].alignments.flatMap((a) => a.bottomWords)[0].word;
    const chapter = json(files, 'jhn/1.json') as Record<string, string>;
    const text = chapter['1'].replace(new RegExp(`\\b${word}\\b`), 'Zzzzz');
    expect(text, 'the edit changes the text').not.toBe(chapter['1']);
    const outside = { ...files, 'jhn/1.json': new TextEncoder().encode(JSON.stringify({ ...chapter, 1: text })) };
    const before = sidecar<{ chapters: Record<string, Record<string, Record<string, unknown>>> }>(await parsed(MULTI[0]), 'checking/alignments/JHN.json').chapters['1']['1'];
    const after = sidecar<{ chapters: Record<string, Record<string, Record<string, unknown>>> }>(await TC3_PARSER.parse([{ name: 'outside_jhn_book.zip', bytes: zipSync(outside) }]), 'checking/alignments/JHN.json').chapters['1']['1'];
    expect(before.invalid).toBe(false);
    expect(after.invalid).toBe(true);
    const lists = (record: Record<string, unknown>) => ({ alignments: record.alignments, wordBank: record.wordBank });
    expect(bytes(lists(after))).toBe(bytes(lists(before)));
  });
});
