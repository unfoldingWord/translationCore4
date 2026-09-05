// Issue #95 — JournalingStore.open() scans the journal ONCE and reports its
// progress. The old pipeline read every segment for the HLC ratchet and then
// again for the union; the ratchet now rides the union read.
import { describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues, type OpenProgress } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';

const REPO = '_local_/_local_/lento';
const TIT_USFM = [
  '\\id TIT lento',
  '\\usfm 3.0',
  '\\h Tito',
  '\\mt Tito',
  '\\c 1',
  '\\p',
  '\\v 1 Pablo, siervo de Dios.',
  '\\v 2 ___',
  '\\v 3 ___',
  '',
].join('\n');

const SEGMENT_RE = /^checking\/journal\/[a-z0-9-]+\/segments\/.+\.action\.json$/;

/** A project with a seed and several saved edits, then the store is dropped so
 * a fresh open must read everything from the rig. */
const seeded = async (edits: number) => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-09-05T10:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await store.createProject({
    content_name: 'Lento',
    content_abbr: 'lento',
    content_language_code: 'es',
    add_book: false,
    versification: 'eng',
  });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM });
  let usfm = TIT_USFM;
  for (let i = 0; i < edits; i++) {
    usfm = usfm.replace(/\\v 2 .*/, `\\v 2 Edición ${i}.`);
    await store.writeBook('TIT', usfm);
  }
  const project = rig.repos.get(REPO);
  const segments = [...(project?.files.keys() ?? [])].filter((p) => SEGMENT_RE.test(p));
  return { rig, kv, api, clock, segments };
};

describe('#95: one journal scan per open, with progress', () => {
  it('a fresh open reads every segment exactly once', async () => {
    const { rig, kv, clock, segments } = await seeded(5);
    expect(segments.length).toBeGreaterThanOrEqual(7); // seed + book + 5 edits
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const reads = vi.spyOn(api, 'readIngredient');
    forgetSharedClocks();
    const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
    await store.open(REPO);
    const segmentReads = reads.mock.calls.map((c) => c[1]).filter((ipath) => SEGMENT_RE.test(ipath));
    const counts = new Map<string, number>();
    for (const ipath of segmentReads) counts.set(ipath, (counts.get(ipath) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual([...segments].sort());
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    // The open still mints strictly after everything it read (R-8.2.4).
    const last = segments.map((p) => p.split('/').pop()!).sort().at(-1)!;
    await store.writeBook('TIT', TIT_USFM.replace('\\v 3 ___', '\\v 3 Después.'));
    const after = [...(rig.repos.get(REPO)?.files.keys() ?? [])].filter((p) => SEGMENT_RE.test(p)).map((p) => p.split('/').pop()!).sort();
    expect(after.at(-1)! > last).toBe(true);
  });

  it('progress runs journal 0..total, then the state stage, and total equals the segment count', async () => {
    const { rig, kv, clock, segments } = await seeded(4);
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    forgetSharedClocks();
    const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
    const seen: OpenProgress[] = [];
    await store.open(REPO, { onProgress: (p) => seen.push({ ...p }) });
    const journal = seen.filter((p) => p.stage === 'journal');
    expect(journal[0]).toEqual({ stage: 'journal', done: 0, total: segments.length });
    expect(journal.at(-1)).toEqual({ stage: 'journal', done: segments.length, total: segments.length });
    expect(journal.map((p) => p.done)).toEqual([...Array(segments.length + 1).keys()]);
    expect(seen.at(-1)).toEqual({ stage: 'state', done: 0, total: 0 });
    expect(seen.findIndex((p) => p.stage === 'state')).toBe(journal.length);
  });

  it('a corrupt segment still stops the open with its report — progress hooks change nothing', async () => {
    const { rig, kv, clock, segments } = await seeded(2);
    const project = rig.repos.get(REPO)!;
    project.files.set(segments[segments.length - 1], '{"container":1,"body":"{');
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    forgetSharedClocks();
    const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
    const seen: OpenProgress[] = [];
    await expect(store.open(REPO, { onProgress: (p) => seen.push({ ...p }) })).rejects.toThrow(/unusable files/);
    expect(seen.some((p) => p.stage === 'journal' && p.done === p.total)).toBe(true);
  });
});
