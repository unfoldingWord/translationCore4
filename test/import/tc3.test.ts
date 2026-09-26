// The tC3 parser (issue #21, J9a): one or several tC3 project zips are one
// bundle. The golden test reads the fixture zip itself and proves: the text is
// tC3's own USFM export of the chapter JSON, byte for byte; the alignments are
// the `alignmentData` records (I-2 normalized) and agree with the export's
// `wordAlignments/<project>.usfm`; the decisions are the check index items with
// user data, record for record, and each equals the latest record of its check
// in `checkData/` (no history is converted, D80 point 3). The version step
// never stores a pin without its sha (D82).
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { TC3_PARSER, applyVersions, carryOverNeeds, resolveVersions, unresolvedSlots } from '../../src/data/import/tc3';
import { runImport } from '../../src/data/import/shell';
import type { ImportBundle, ImportFile } from '../../src/data/import/types';
import { INSTALLED_SUITE } from '../../src/data/installedSuite';
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

/** The zip's files, without its folder entries. */
const zip = (rel: string) => Object.fromEntries(Object.entries(unzipSync(fixtureFile(rel).bytes)).filter(([name]) => !name.endsWith('/')));
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

describe('#21 the tC3 parser', () => {
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
      const bundle = await TC3_PARSER.parse([fixtureFile(rel)]);
      expect(damagedOf(bundle)).toEqual([]);
      expect(bundle.books).toEqual([{ code: book.toUpperCase(), usfm: tc3Usfm(files, book) }]);
    }
  });

  it('golden: every alignmentData record is stored, I-2 normalized, keyed to its verse text (I-3)', async () => {
    const files = zip(TIT);
    const bundle = await TC3_PARSER.parse([fixtureFile(TIT)]);
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
      const bundle = await TC3_PARSER.parse([fixtureFile(rel)]);
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
    const bundle = await TC3_PARSER.parse([fixtureFile(TIT)]);
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
    const bundle = await TC3_PARSER.parse(MULTI.map((rel) => fixtureFile(rel)));
    expect(damagedOf(bundle)).toEqual([]);
    expect(bundle.books.map((b) => b.code)).toEqual(['JHN', 'JOB', 'LUK']);
    expect(bundle.facts.language).toBe('en');
    expect(bundle.facts.license).toBeUndefined();
    expect(bundle.licenseChoices).toEqual(['CC0 1.0 Public Domain', 'CC BY-SA 4.0']);
    expect(bundle.findings.find((f) => f.kind === 'license')?.warn).toBe(true);
  });

  it('refuses: no manifest.json, two languages, one book twice', async () => {
    const noManifest = await TC3_PARSER.parse([fixtureFile('tc3/no-manifest')]);
    expect(damagedOf(noManifest).map((f) => f.code)).toEqual(['import.damaged.no-manifest']);
    const langs = await TC3_PARSER.parse([fixtureFile(TIT), fixtureFile(MULTI[0])]);
    expect(damagedOf(langs)).toHaveLength(1);
    const twice = await TC3_PARSER.parse([fixtureFile(TIT), fixtureFile(TIT)]);
    expect(damagedOf(twice)).toHaveLength(1);
  });

  it('the versions: each slot takes the newest version DCS has; a version DCS does not have is unresolved', async () => {
    const bundle = await TC3_PARSER.parse(MULTI.map((rel) => fixtureFile(rel)));
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
    const bundle = await TC3_PARSER.parse([fixtureFile(TIT)]);
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

describe('#21 the tC3 import end to end on the fake rig', () => {
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
