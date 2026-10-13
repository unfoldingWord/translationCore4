// #675 — the sync core (journal/sync.mjs), over the shared team-sync fixture
// (conformance/fixtures/team-sync/, D98). Each test name starts with the guarantee it
// proves (epic #24: `git grep "\[G1\]"` lists the proofs). Tests assert codes, never
// message text. Each refusal test asserts that `write` is empty.
//
// The scenario: translator A syncs for the first time after B and C shared all their work.
// Door43 main holds A's actor.json and A's creation, every file of B and C, the derived
// files of an older checkpoint (with a stale TIT.usfm and a forged translationWords
// resource record), and the base metadata.json. A's journal holds A's own files.
import { describe, expect, it } from 'vitest';
import { derivedProjections, fold, syncCore, type FoldOutput, type SyncFacts, type SyncFileLayer } from '../../src/data/journal/runtime';
import * as seal from '../../src/data/journal/seal';
import { assertReport } from '../../journal/report.mjs';

// journal/files.mjs and the fixture generator are Node-bound (fs, node:crypto), so they load
// by a NATIVE require, outside the vite pipeline (the pattern of test/journalStore.test.ts).
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
const refFiles = nodeRequire('./journal/files.mjs') as Omit<SyncFileLayer, 'validateSegment'> & {
  sealAction(events: unknown[]): string;
  validateSegment(raw: string): { ok: boolean; reason?: string; events: Array<Record<string, unknown>> };
};
const { sampleInputs } = nodeRequire('./conformance/fixtures/team-sync/generate.mjs') as {
  sampleInputs(): { baseMetadata: Record<string, unknown>; decisionFiles: Record<string, { resource: Record<string, unknown> }> };
};

const FIX = path.resolve(process.cwd(), 'conformance/fixtures/team-sync');
const SAMPLE = path.resolve(process.cwd(), 'conformance/sample-burrito');
const idx = JSON.parse(fs.readFileSync(path.join(FIX, 'cases.json'), 'utf8'));
const readFix = (rel: string): string => fs.readFileSync(path.join(FIX, rel), 'utf8');
/** fixture path (`journals/<actor>/…` or `cases/<case>/<actor>/…`) → ingredient path */
const ipathOf = (rel: string): string => `checking/journal/${rel.replace(/^journals\//, '').replace(/^cases\/[^/]+\//, '')}`;

const A = 'translator-a';
const B = 'translator-b';
const C = 'translator-c';
type Actor = typeof A | typeof B | typeof C;
const filesOf = (actor: Actor): string[] => [idx.actors[actor].actor, ...idx.actors[actor].segments];
const toMap = (rels: string[]): Map<string, string> => new Map(rels.map((rel) => [ipathOf(rel), readFix(rel)]));

const s = sampleInputs();
const resources = { translationWords: s.decisionFiles.translationWords.resource, translationNotes: s.decisionFiles.translationNotes.resource };
const creation: string = idx.cases.creation.segments[0];

/** Door43 main before A's sync: A's actor.json and creation, all of B and C, stale derived files. */
const door43 = (): Map<string, string> => {
  const remote = toMap([idx.actors[A].actor, creation, ...filesOf(B), ...filesOf(C)]);
  const sample = (rel: string): string => fs.readFileSync(path.join(SAMPLE, rel), 'utf8');
  remote.set('metadata.json', sample('metadata.json'));
  remote.set('TIT.usfm', sample('ingredients/TIT.usfm')); // stale: carries none of the fixture verses
  remote.set('JON.usfm', sample('ingredients/JON.usfm'));
  remote.set('vrs.json', sample('ingredients/vrs.json'));
  const tw = JSON.parse(sample('ingredients/checking/translationWords/TIT.json'));
  remote.set('checking/translationWords/TIT.json', JSON.stringify({ ...tw, resource: { ...tw.resource, repoPath: 'forged/forged_twl' } }));
  // translationNotes/TIT.json is absent: its (tool, book) file is new in this copy
  return remote;
};
/** A's computer before its sync: A's own files only. */
const mineA = (outbox: string[] = []) => ({
  actor: A,
  journal: toMap(filesOf(A).filter((rel) => !outbox.includes(rel))),
  outbox: toMap(outbox),
});
const resolveCalls: Array<[string, string]> = [];
const resolve = (tool: string, book: string): Record<string, unknown> => {
  resolveCalls.push([tool, book]);
  return resources[tool as keyof typeof resources];
};
const run = (remote = door43(), mine = mineA(), files: SyncFileLayer = refFiles) => syncCore({ remote, mine, resolve, files });
const factsOf = (report: { facts: Record<string, unknown> }): SyncFacts => report.facts as SyncFacts;
const refused = (report: { ok: boolean; code?: string }) => [report.ok, report.code];

/** The expected projection: the fold of every fixture segment, over the named base inputs. */
const allEvents = Object.values(idx.actors as Record<Actor, { segments: string[] }>)
  .flatMap((a) => a.segments)
  .flatMap((rel) => refFiles.validateSegment(readFix(rel)).events);
const fullFold = fold(allEvents as never) as FoldOutput;
const expected = derivedProjections(fullFold, {
  baseMetadata: s.baseMetadata,
  resolutions: { translationWords: { TIT: resources.translationWords }, translationNotes: { TIT: resources.translationNotes } },
});
delete expected['metadata.json'];
const isJournal = (p: string): boolean => p.startsWith('checking/journal/');

describe('#675 the sync core', () => {
  it('[G1] keeps every own file and outbox entry', async () => {
    const outboxEntry: string = idx.cases['verse-two-ways'].segments[0]; // A's TIT 1:4 change, staged
    const remote = door43();
    const mine = mineA([outboxEntry]);
    const { write, report } = await run(remote, mine);
    expect(report.ok).toBe(true);
    const own = new Map([...mine.journal, ...mine.outbox]);
    expect(own.size).toBe(5); // actor.json + 4 segments, one of them in the outbox
    for (const [p, bytes] of own) expect(write.get(p) ?? remote.get(p), p).toBe(bytes);
    expect(write.get(ipathOf(outboxEntry))).toBe(readFix(outboxEntry));
    // the own files that Door43 main holds already are not written again
    expect(write.has(ipathOf(creation))).toBe(false);
    expect(factsOf(report).carried).toBe(3);
  });

  it('[G1] refuses a changed own file', async () => {
    const chg = idx.cases['changed-own-file'];
    const remote = door43();
    // negative control: the SAME bytes at that own path are accepted (R-8.1.5)
    const same = door43();
    same.set(ipathOf(chg.own), readFix(chg.own));
    const control = await run(same);
    expect(control.report.ok).toBe(true);
    expect(control.write.has(ipathOf(chg.own))).toBe(false); // already there, not carried
    remote.set(ipathOf(chg.own), readFix(chg.path)); // a different valid action at A's own 1:1 path
    const { write, report } = await run(remote);
    expect(refused(report)).toEqual([false, 'sync.own-file-differs']);
    expect(report.rule).toBe('R-8.7.7');
    expect((report.facts.refusal as { paths: string[] }).paths).toEqual([ipathOf(chg.own)]);
    expect(write.size).toBe(0);
  });

  it('[G2] refuses an invalid file', async () => {
    const inv = idx.cases['invalid-file'];
    expect((await run()).report.ok).toBe(true); // negative control: the clean copy passes
    const remote = door43();
    remote.set(ipathOf(inv.path), readFix(inv.path)); // C's segment whose body fails its sha256
    remote.set(`checking/journal/${B}/segments/old.jsonl`, '{}\n'); // not a journal file (R-8.1.10)
    const { write, report } = await run(remote);
    expect(refused(report)).toEqual([false, 'sync.incoming-invalid']);
    expect(report.rule).toBe('R-8.7.8');
    const failures = (report.facts.refusal as { failures: Array<{ path: string; reason: string }> }).failures;
    expect(failures.map((f) => f.path).sort()).toEqual([`checking/journal/${B}/segments/old.jsonl`, ipathOf(inv.path)].sort());
    expect(failures.find((f) => f.path === ipathOf(inv.path))?.reason).toBe('checksum');
    expect(write.size).toBe(0);
    // ONE invalid file is enough to refuse the whole sync
    const onlyOne = door43();
    onlyOne.set(ipathOf(inv.path), readFix(inv.path));
    const single = await run(onlyOne);
    expect(refused(single.report)).toEqual([false, 'sync.incoming-invalid']);
    expect(single.write.size).toBe(0);
  });

  it('[G3] rebuilds with resolve', async () => {
    resolveCalls.length = 0;
    const remote = door43();
    const { write, report } = await run(remote);
    expect(report.ok).toBe(true);
    const derived = [...write.keys()].filter((p) => !isJournal(p));
    expect(derived).toEqual(Object.keys(expected).sort());
    for (const p of derived) expect(write.get(p), p).toBe(expected[p]);
    // the stale and forged files on Door43 main are no input: each is replaced
    expect(write.get('TIT.usfm')).not.toBe(remote.get('TIT.usfm'));
    expect(JSON.parse(write.get('checking/translationWords/TIT.json')!).resource).toEqual(resources.translationWords);
    // the new (tool, book) file takes its resource record from resolve
    expect(remote.has('checking/translationNotes/TIT.json')).toBe(false);
    expect(JSON.parse(write.get('checking/translationNotes/TIT.json')!).resource).toEqual(resources.translationNotes);
    expect(resolveCalls).toEqual([['translationNotes', 'TIT'], ['translationWords', 'TIT']]);
    // R-8.7.9 (b): a stub record that no incoming file carries is the record that is written
    const stub = (tool: string, book: string) => ({ repoPath: `stub/${tool}`, book, sha: 'stub' });
    const stubbed = await syncCore({ remote: door43(), mine: mineA(), resolve: stub, files: refFiles });
    expect(stubbed.report.ok).toBe(true);
    for (const tool of ['translationWords', 'translationNotes'])
      expect(JSON.parse(stubbed.write.get(`checking/${tool}/TIT.json`)!).resource).toEqual(stub(tool, 'TIT'));
  });

  it('[G3] never writes metadata.json', async () => {
    const remote = door43();
    const { write, report } = await run(remote);
    expect(report.ok).toBe(true);
    expect(remote.has('metadata.json')).toBe(true); // the base input is there, and it is read
    expect(write.has('metadata.json')).toBe(false);
  });

  it('refuses OBS and a metadata overlay', async () => {
    const obs = door43();
    const meta = JSON.parse(obs.get('metadata.json')!);
    meta.type.flavorType = { name: 'gloss', flavor: { name: 'textStories' } };
    obs.set('metadata.json', JSON.stringify(meta));
    const one = await run(obs);
    expect(refused(one.report)).toEqual([false, 'sync.obs-unsupported']);
    expect(one.write.size).toBe(0);

    // B shared one project.meta.set: the fold carries an overlay that only metadata.json could show
    const overlayEvent = { v: 1, op: 'project.meta.set', actor: B, ts: '2026-10-13T11:00:00.000Z|0000|translator-b', base: null, path: 'identification.name.en', value: 'Tito (equipo)' };
    // negative control: the same copy without the overlay syncs, and writes no metadata.json
    const plain = await run();
    expect(plain.report.ok).toBe(true);
    expect(plain.write.has('metadata.json')).toBe(false);
    const withOverlay = door43();
    withOverlay.set(`checking/journal/${B}/segments/${refFiles.segmentName(overlayEvent.ts)}`, refFiles.sealAction([overlayEvent]));
    const two = await run(withOverlay);
    expect(refused(two.report)).toEqual([false, 'sync.metadata-overlay']);
    expect(two.report.rule).toBe('R-8.7.10');
    expect(two.write.size).toBe(0);
  });

  it('[G6] same journals same files', async () => {
    const one = await run();
    const two = await run();
    expect([...two.write]).toEqual([...one.write]);
    // the same files read in another order, and checked by the app's own validator (seal.ts)
    const reversed = new Map([...door43()].reverse());
    const mine = mineA();
    const three = await run(reversed, { ...mine, journal: new Map([...mine.journal].reverse()) }, seal);
    expect([...three.write]).toEqual([...one.write]);
    expect(one.write.size).toBeGreaterThan(0);
  });

  it('[G7] counts a non-text conflict once', async () => {
    const ct = idx.cases['check-two-ways'];
    const remote = door43();
    const first = await run(remote);
    expect(factsOf(first.report).newestWins).toEqual([{ key: ct.key, kind: 'dec', winner: ct.newest }]);
    // the next sync: A holds every file now, and Door43 main holds A's pushed files
    const after = new Map([...remote, ...first.write]);
    const journal = new Map([...after].filter(([p]) => isJournal(p)));
    const second = await run(after, { actor: A, journal, outbox: new Map() });
    expect(second.report.ok).toBe(true);
    expect(factsOf(second.report).newestWins).toEqual([]);
    expect(factsOf(second.report).received).toEqual({});
    expect(factsOf(second.report).carried).toBe(0);
  });

  it('[G7] an alignment set two ways keeps the newest and is counted once', async () => {
    // D98 ruling 8: alignments follow the newest head too. B and C each set the TIT 1:1
    // alignment from the seed head; C is newest. (Built here, not in the #674 fixture, whose
    // JC-35 checks count its forks.)
    const seedAlign = refFiles.validateSegment(readFix(creation)).events.find((e) => e.op === 'align.verse.set')!;
    const record = { ...seedAlign };
    delete record.seed; // an edit is not seeded
    const alignBy = (actor: Actor, iso: string, done: boolean) => {
      const ev = { ...record, actor, ts: `${iso}|0000|${actor}`, base: seedAlign.ts, ...(done ? { done: true } : {}) };
      return [`checking/journal/${actor}/segments/${refFiles.segmentName(ev.ts)}`, refFiles.sealAction([ev])] as const;
    };
    const remote = door43();
    const [bPath, bBytes] = alignBy(B, '2026-10-13T10:40:00.000Z', true);
    const [cPath, cBytes] = alignBy(C, '2026-10-13T10:41:00.000Z', false);
    remote.set(bPath, bBytes);
    remote.set(cPath, cBytes);
    const first = await run(remote);
    expect(first.report.ok).toBe(true);
    const wins = factsOf(first.report).newestWins;
    expect(wins.filter((w) => w.kind === 'align')).toEqual([{ key: 'align|TIT|1:1', kind: 'align', winner: '2026-10-13T10:41:00.000Z|0000|translator-c' }]);
    expect(factsOf(first.report).textConflicts.map((c) => c.key)).not.toContain('align|TIT|1:1');
    expect(JSON.parse(first.write.get('checking/alignments/TIT.json')!).chapters['1']['1'].done).toBeUndefined(); // C's record, the newest
    const after = new Map([...remote, ...first.write]);
    const second = await run(after, { actor: A, journal: new Map([...after].filter(([p]) => isJournal(p))), outbox: new Map() });
    expect(factsOf(second.report).newestWins).toEqual([]);
  });

  it('[G7] a verse changed two ways appears once in textConflicts', async () => {
    const vt = idx.cases['verse-two-ways'];
    const { report } = await run();
    const { textConflicts } = factsOf(report);
    expect(textConflicts.map((c) => c.key)).toEqual([vt.key]);
    const [conflict] = textConflicts;
    expect(conflict.provisional).toBe(vt.newest);
    const heads = vt.segments.map((rel: string) => refFiles.validateSegment(readFix(rel)).events[0]);
    expect(conflict.heads).toEqual(heads.map((e: Record<string, unknown>) => ({ actor: e.actor, ts: e.ts, text: e.text })));
  });

  it('different verses merge', async () => {
    const dv = idx.cases['different-verses'];
    const { write, report } = await run();
    expect(report.ok).toBe(true);
    const keys = factsOf(report).textConflicts.map((c) => c.key);
    for (const key of dv.keys) expect(keys).not.toContain(key);
    const usfm = write.get('TIT.usfm')!;
    for (const rel of dv.segments) expect(usfm).toContain(String(refFiles.validateSegment(readFix(rel)).events[0].text).trim());
    expect(factsOf(report).received).toEqual({ [B]: 4, [C]: 3 });
    expect(factsOf(report).names).toEqual({ [A]: 'fixture-translator-a', [B]: 'fixture-translator-b', [C]: 'fixture-translator-c' });
  });

  it('report passes assertReport', async () => {
    const ok = await run();
    expect(assertReport(ok.report)).toBe(ok.report);
    expect(ok.report.op).toBe('sync');
    const remote = door43();
    remote.set(ipathOf(idx.cases['invalid-file'].path), readFix(idx.cases['invalid-file'].path));
    const failed = await run(remote);
    expect(assertReport(failed.report)).toBe(failed.report);
    expect(failed.report.op).toBe('sync');
  });
});
