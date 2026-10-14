// resolveVerse — the store half of the conflict review, issue #679 (epic #24).
//
// The client contract: keeping one version sends ONE segment through the
// ServerApi (journal writes go over HTTP to Pankosmia, never to the disk), and
// that segment holds ONE text.verse.set with the kept text whose `supersedes`
// names every head of the fork (R-8.3.5). The fold after it shows no conflict
// and keeps both old versions in history (R-8.3.6).
import { describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { fold } from '../src/data/journal/runtime';
import { sealAction, segmentName, validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { describeVerifierReport, verifyProjectAgainstJournal } from '../src/data/journal/verify';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';

const REPO = '_local_/_local_/prueba';
const TIT_USFM = ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', ''].join('\n');
const KEY = 'text|TIT|1:1';
const TEAMMATE = 'teammate-device';
const SEGMENT = /^checking\/journal\/[a-z0-9-]+\/segments\//;

/** One project with a verse-text conflict on TIT 1:1: this installation and a
 * teammate each changed the verse from the same base. */
const conflicted = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-10-13T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const first = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await first.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await first.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM });
  const files = rig.repos.get(REPO)!.files;
  const own = async (): Promise<JournalEvent[]> => {
    const out: JournalEvent[] = [];
    for (const path of [...files.keys()].filter((p) => SEGMENT.test(p)).sort()) {
      const verdict = await validateSegment(files.get(path)!);
      if (!verdict.ok) throw new Error(`invalid segment ${path}: ${verdict.reason}`);
      out.push(...verdict.events);
    }
    return out;
  };
  const base = fold(await own()).headsTs[KEY];
  await first.writeBook('TIT', TIT_USFM.replace('Pablo, siervo de Dios.', 'Pablo, siervo de Dios (mío).'));
  // The teammate's edit of the same verse from the same base, sealed by the one sealer.
  const theirs: JournalEvent = {
    v: 1, op: 'text.verse.set', actor: TEAMMATE, ts: `2026-10-13T12:00:00.000Z|0000|${TEAMMATE}`,
    base, book: 'TIT', chapter: '1', verse: '1', text: 'Pablo, siervo de Dios (suyo).\n',
  };
  files.set(`checking/journal/${TEAMMATE}/segments/${segmentName(theirs.ts)}`, await sealAction([theirs]));
  files.set(
    `checking/journal/${TEAMMATE}/actor.json`,
    `${JSON.stringify({ schemaVersion: 1, actorId: TEAMMATE, createdAt: '2026-10-13T08:00:00.000Z', device: 'teammate' }, null, 2)}\n`,
  );
  const reopen = async (): Promise<JournalingStore> => {
    forgetSharedClocks();
    forgetProjectQueues();
    const store = new JournalingStore({ api, kv, now: () => clock.advance(29) });
    await store.open(REPO);
    return store;
  };
  return { api, own, store: await reopen(), reopen };
};

describe('#679 resolveVerse keeps one version', () => {
  it('writes ONE segment over the ServerApi: one verse edit with the kept text that supersedes every head', async () => {
    const { api, own, store, reopen } = await conflicted();
    // Positive control: the store lists the conflict, the teammate's newer edit provisional.
    const [conflict] = store.readVerseConflicts();
    expect(conflict.key).toBe(KEY);
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const theirs = conflict.versions.find((v) => v.actor === TEAMMATE)!;
    expect(theirs.provisional).toBe(true);
    expect(mine.text).toBe('Pablo, siervo de Dios (mío).\n');

    const write = vi.spyOn(api, 'writeIngredient');
    await store.resolveVerse(KEY, mine.ts);
    const segmentWrites = write.mock.calls.filter(([, ipath]) => SEGMENT.test(ipath));
    expect(segmentWrites).toHaveLength(1);
    const [, ipath, payload] = segmentWrites[0];
    expect(ipath).toMatch(new RegExp(`^checking/journal/${store.actorId}/segments/`));
    const verdict = await validateSegment(payload as string);
    if (!verdict.ok) throw new Error(`the written segment is invalid: ${verdict.reason}`);
    expect(verdict.events).toHaveLength(1);
    const [resolving] = verdict.events;
    expect(resolving).toMatchObject({ op: 'text.verse.set', actor: store.actorId, book: 'TIT', chapter: '1', verse: '1', text: mine.text });
    expect(resolving.supersedes).toEqual([mine.ts, theirs.ts].sort());
    expect(resolving.base).toBe(theirs.ts); // the projected head the person reviewed
    write.mockRestore();

    // The store's own view: no conflict left.
    expect(store.readVerseConflicts()).toEqual([]);
    // A fresh open folds the published journal the same way: no conflict, both old versions in history.
    const after = await reopen();
    expect(after.readVerseConflicts()).toEqual([]);
    expect(await after.readBook('TIT')).toMatchObject({ usfm: expect.stringContaining('\\v 1 Pablo, siervo de Dios (mío).') });
    expect(fold(await own()).retained.filter((r) => r.key === KEY)).toEqual(
      [mine.ts, theirs.ts].sort().map((ts) => ({ key: KEY, ts, reason: 'superseded' })),
    );
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });

  it('refuses a key with no verse-text conflict and a head outside the conflict, writing nothing', async () => {
    const { api, store } = await conflicted();
    const write = vi.spyOn(api, 'writeIngredient');
    await expect(store.resolveVerse('text|TIT|1:2', 'x')).rejects.toThrow();
    await expect(store.resolveVerse(KEY, `2026-10-13T12:00:00.000Z|0000|someone-else`)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(store.readVerseConflicts().map((c) => c.key)).toEqual([KEY]);
  });
});

// Bench finding P2 (PR #687): a verse head can come from a structural action. A
// teammate renumbers Titus 1 while another edits 1:2 from the state before it; the
// review lists the fork, and keeping either version through the store resolves it.
describe('#679 resolveVerse keeps a version of a renumber conflict', () => {
  const RENUMBERER = 'teammate-renumber';
  const EDITOR = 'teammate-editor';
  const RKEY = 'text|TIT|1:2';
  const withRenumberConflict = async () => {
    const { shiftChapter } = await import('../conformance/fixtures/renumber.mjs');
    forgetSharedClocks();
    forgetProjectQueues();
    const rig = journalingRig();
    const kv = memKv();
    const clock = tickingNow('2026-10-13T09:00:00.000Z');
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const first = new JournalingStore({ api, kv, now: () => clock.advance(13) });
    await first.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
    await first.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM.replace('\\v 2 ___', '\\v 2 Segundo versículo.') });
    const files = rig.repos.get(REPO)!.files;
    const own = async (): Promise<JournalEvent[]> => {
      const out: JournalEvent[] = [];
      for (const path of [...files.keys()].filter((p) => SEGMENT.test(p)).sort()) {
        const verdict = await validateSegment(files.get(path)!);
        if (!verdict.ok) throw new Error(`invalid segment ${path}: ${verdict.reason}`);
        out.push(...verdict.events);
      }
      return out;
    };
    const before = fold(await own());
    const renumber = shiftChapter(before, 'TIT', 1, { actor: RENUMBERER, ts: `2026-10-13T12:00:00.000Z|0000|${RENUMBERER}` }) as JournalEvent;
    const edit: JournalEvent = {
      v: 1, op: 'text.verse.set', actor: EDITOR, ts: `2026-10-13T12:01:00.000Z|0000|${EDITOR}`,
      base: before.headsTs[RKEY], book: 'TIT', chapter: '1', verse: '2', text: 'Segundo, editado.\n',
    };
    for (const [actor, e] of [[RENUMBERER, renumber], [EDITOR, edit]] as const) {
      files.set(`checking/journal/${actor}/segments/${segmentName(e.ts)}`, await sealAction([e]));
      files.set(`checking/journal/${actor}/actor.json`, `${JSON.stringify({ schemaVersion: 1, actorId: actor, createdAt: '2026-10-13T08:00:00.000Z', device: 'teammate' }, null, 2)}\n`);
    }
    forgetSharedClocks();
    forgetProjectQueues();
    const store = new JournalingStore({ api, kv, now: () => clock.advance(29) });
    await store.open(REPO);
    return { api, store, renumber, edit };
  };

  for (const which of ['renumber', 'edit'] as const)
    it(`keeping the ${which} version removes the conflict; the book holds the kept text`, async () => {
      const { api, store, renumber, edit } = await withRenumberConflict();
      const conflict = store.readVerseConflicts().find((c) => c.key === RKEY);
      // Positive control: the review lists the structural fork with both versions.
      expect(conflict?.versions.map((v) => v.ts)).toEqual([renumber.ts, edit.ts]);
      const kept = conflict!.versions.find((v) => v.ts === (which === 'renumber' ? renumber.ts : edit.ts))!;
      expect(kept.text).toBe(which === 'renumber' ? 'Pablo, siervo de Dios.\n' : edit.text);
      await store.resolveVerse(RKEY, kept.ts);
      expect(store.readVerseConflicts().map((c) => c.key)).not.toContain(RKEY);
      expect((await store.readBook('TIT')).usfm).toContain(`\\v 2 ${kept.text.trim()}`);
      const report = await verifyProjectAgainstJournal(api, REPO);
      expect(report.ok, describeVerifierReport(report)).toBe(true);
    });
});
