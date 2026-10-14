// @vitest-environment jsdom
// #679 — the state glue of the conflict review, on the fake rig: the Home count
// is folded read-only from the project's journal (never a stored Report), and
// "Keep this version" unloads the open book, calls resolveVerse with the kept
// head, and reads the list and the outcome from the new fold.
import { describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { fold } from '../src/data/journal/runtime';
import { sealAction, segmentName, validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { SaveScheduler } from '../src/data/saveScheduler';
import { spliceVerse } from '../src/data/usfm/splice';
import { loadEditorBook, __performKeepVersionForTests as keepVersion, __performLoadConflictsForTests as loadConflicts, __reducerForTests as reducer } from '../src/state.jsx';

const REPO = '_local_/_local_/prueba';
const TIT_USFM = ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', ''].join('\n');
const KEY = 'text|TIT|1:1';
const TEAMMATE = 'teammate-device';
const SEGMENT = /^checking\/journal\/[a-z0-9-]+\/segments\//;

/** One project with a verse-text conflict on TIT 1:1 (the setup of test/resolveVerse.test.ts). */
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
  const theirs: JournalEvent = {
    v: 1, op: 'text.verse.set', actor: TEAMMATE, ts: `2026-10-13T12:00:00.000Z|0000|${TEAMMATE}`,
    base, book: 'TIT', chapter: '1', verse: '1', text: 'Pablo, siervo de Dios (suyo).\n',
  };
  files.set(`checking/journal/${TEAMMATE}/segments/${segmentName(theirs.ts)}`, await sealAction([theirs]));
  files.set(
    `checking/journal/${TEAMMATE}/actor.json`,
    `${JSON.stringify({ schemaVersion: 1, actorId: TEAMMATE, createdAt: '2026-10-13T08:00:00.000Z', device: 'teammate' }, null, 2)}\n`,
  );
  forgetSharedClocks();
  forgetProjectQueues();
  const store = new JournalingStore({ api, kv, now: () => clock.advance(29) });
  await store.open(REPO);
  return { api, files, store, own, rig };
};

/** A dispatch that runs the real reducer, so the test reads the state the app would. */
const recorder = (initial: Record<string, unknown>) => {
  const box = { state: initial };
  return { box, dispatch: (action: unknown) => { box.state = reducer(box.state, action); } };
};

describe('#679 the Home count is folded from the journal', () => {
  it('reads the journal read-only and counts the open verse conflicts per book', async () => {
    const { api, files } = await conflicted();
    const before = new Map(files);
    const { box, dispatch } = recorder({ conflictsByProject: {} });
    await loadConflicts({ project: { id: REPO, flavor: 'textTranslation' }, stateRef: { current: box.state }, dispatch, conflictsGen: new Map(), apiClient: api });
    expect(box.state.conflictsByProject).toEqual({ [REPO]: { TIT: 1 } });
    // Read-only: no file written, not even an actor.json for this reader.
    expect(new Map(files)).toEqual(before);
  });

  it('a journal file the union refuses makes the count unknown (null), never 0', async () => {
    const { api, files } = await conflicted();
    files.set(`checking/journal/${TEAMMATE}/segments/${segmentName('2026-10-13T13:00:00.000Z|0000|teammate-device')}`, '{"broken":');
    const { box, dispatch } = recorder({ conflictsByProject: {} });
    await loadConflicts({ project: { id: REPO, flavor: 'textTranslation' }, stateRef: { current: box.state }, dispatch, conflictsGen: new Map(), apiClient: api });
    expect(box.state.conflictsByProject).toEqual({ [REPO]: null });
  });
});

/** The open book as the app holds it: a real SaveScheduler over the real store,
 * loaded through the one editor load path, and the keep's context. */
const session = async (store: JournalingStore, conflict: unknown, extra: Record<string, unknown> = {}) => {
  const manual = { setTimeout: () => 0, clearTimeout: () => {} };
  const scheduler = new SaveScheduler({ writeBook: (book, whole) => store.writeBook(book, whole), splice: spliceVerse, clock: manual });
  const raw = await loadEditorBook(store, 'TIT');
  scheduler.loadBook('TIT', raw);
  const rawRef = { current: raw as string | null };
  const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'TIT', bookRaw: raw, conflictReview: { key: KEY, error: null }, conflictsByProject: { [REPO]: { TIT: 1 } }, verseConflicts: [conflict], ...extra });
  const stateRef = { get current() { return box.state; } };
  const ctx = { storeRef: { current: store }, stateRef, schedulerRef: { current: scheduler }, rawRef, saveRefs: [], dispatch, conflictsGen: new Map() };
  /** Leave the review: the keepVersion action loads an unloaded book again, as openBook does. */
  const leave = async () => {
    if (rawRef.current !== null) return;
    const text = await loadEditorBook(store, 'TIT');
    scheduler.loadBook('TIT', text);
    rawRef.current = text;
  };
  /** An edit of verse 2 in Translate, saved. */
  const editVerseTwo = async (text: string) => {
    scheduler.markDirty('TIT', 1, '2', text);
    expect(await scheduler.drain()).toBe(true);
  };
  return { box, ctx, scheduler, rawRef, leave, editVerseTwo };
};

/** The journal's last text.verse.set of TIT 1:1, by ts. */
const lastOnVerseOne = async (own: () => Promise<JournalEvent[]>) =>
  (await own()).filter((e) => e.op === 'text.verse.set' && e.chapter === '1' && e.verse === '1').sort((a, b) => (a.ts < b.ts ? -1 : 1)).at(-1)!;

// "Keep this version" never meets a loaded book (bench rounds 1–6): the book is
// unloaded before the store writes, the truth is read from the fold after any
// outcome, and the book loads again through loadEditorBook (openBook's path).
describe('#679 "Keep this version"', () => {
  it('keeps the chosen version: the book is unloaded while the store writes; the list, the Home count and the outcome come from the fold', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { box, ctx, scheduler, rawRef, leave } = await session(store, conflict);
    const real = store.resolveVerse.bind(store);
    const atWrite: Array<string | null> = [];
    vi.spyOn(store, 'resolveVerse').mockImplementation(async (key, head) => {
      atWrite.push(scheduler.bookText('TIT'), rawRef.current);
      expect(() => scheduler.markDirty('TIT', 1, '2', 'x')).toThrow(/not loaded/); // no edit can reach the book now
      return real(key, head);
    });
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(true);
    expect(store.resolveVerse).toHaveBeenCalledWith(KEY, mine.ts);
    expect(atWrite).toEqual([null, null]);
    expect(box.state.bookRaw).toBeNull();
    expect(box.state.verseConflicts).toEqual([]);
    expect(box.state.conflictsByProject).toEqual({ [REPO]: {} });
    expect(box.state.conflictReview).toEqual({ key: KEY, error: null });
    await leave();
    expect(scheduler.bookText('TIT')).toContain('\\v 1 Pablo, siervo de Dios (mío).');
  });

  it('the review moves to the conflict after the kept one', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    // A list as the review shows it: the kept conflict between two others that stay open.
    const other = (key: string) => ({ key, book: 'TIT', chapter: '1', verse: key.slice(-1), versions: [] }) as never;
    const [before, after] = [other('text|TIT|1:0'), other('text|TIT|1:9')];
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: {}, verseConflicts: [before, conflict, after] });
    const stateRef = { get current() { return box.state; } };
    // The fold before the keep lists all three; after it, the two others (stand-ins: the rig project has one conflict).
    vi.spyOn(store, 'readVerseConflicts').mockReturnValueOnce([before, conflict, after]).mockReturnValue([before, after]);
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, mine.ts);
    expect(box.state.conflictReview).toEqual({ key: 'text|TIT|1:9', error: null });
  });

  it('a refused keep shows its error in the review and changes nothing', async () => {
    const { store } = await conflicted();
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'TIT', conflictReview: { key: KEY, error: null }, conflictsByProject: { [REPO]: { TIT: 1 } } });
    const stateRef = { get current() { return box.state; } };
    const ok = await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, 'not-a-head');
    expect(ok).toBe(false);
    expect((box.state.conflictReview as { error: string }).error).toBeTruthy();
    expect(store.readVerseConflicts().map((c) => c.key)).toEqual([KEY]);
  });

  // Frank, round 5: a keep that failed after it was staged is replayed by the
  // next store mutation. A second keep of ANOTHER version then finds no
  // conflict; the reported result must match the fold, which holds the first.
  it('a failed keep of Mine, then a keep of the teammate version: the reported result matches the fold', async () => {
    const { store, rig } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const theirs = conflict.versions.find((v) => v.actor === TEAMMATE)!;
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: { [REPO]: { TIT: 1 } }, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    const ctx = { storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() };
    // Keep Mine: the segment write fails after the action is staged.
    rig.failOn((c: { method: string; ipath?: string }) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(false);
    expect(store.readVerseConflicts().map((c) => c.key)).toEqual([KEY]); // positive control: the first keep is not in the fold
    // Keep the teammate's version: the store replays the staged Mine first.
    expect(await keepVersion(ctx, KEY, theirs.ts)).toBe(false);
    expect((box.state.conflictReview as { error: string | null }).error).toMatch(/another version/i);
    expect(box.state.verseConflicts).toEqual([]);
    expect(box.state.conflictsByProject).toEqual({ [REPO]: {} });
    expect(store.projectedVerse('TIT', '1', '1')).toBe(mine.text);
  });

  it('a keep whose regeneration fails, but whose chosen text the fold holds, is success', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const theirs = conflict.versions.find((v) => v.actor === TEAMMATE)!;
    vi.spyOn(store as unknown as { installAndConverge: () => Promise<void> }, 'installAndConverge').mockRejectedValueOnce(new Error('converge failed'));
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: {}, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    expect(await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, theirs.ts)).toBe(true);
    expect((box.state.conflictReview as { error: string | null }).error).toBeNull();
    expect(store.projectedVerse('TIT', '1', '1')).toBe(theirs.text);
  });
});

// Frank, round 6: a staged keep whose publish failed was undone by the next
// save of another verse — the editor's buffer still held the text from before
// the keep, and the save replayed the keep and then diffed the old text over it.
describe('#679 no save after a keep can undo it', () => {
  it('a keep of Mine whose segment write fails; leave the review, edit and save verse 2: verse 1 holds the fold\'s truth, and the edit is saved', async () => {
    const { store, rig, own } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { box, ctx, leave, editVerseTwo } = await session(store, conflict);
    rig.failOn((c: { method: string; ipath?: string }) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(false);
    expect((box.state.conflictReview as { error: string | null }).error).toBeTruthy(); // not kept, and the review says so
    await leave();
    await editVerseTwo('editado después');
    // The staged keep is published by the load; nothing wrote the replaced version back.
    expect(store.readVerseConflicts()).toEqual([]);
    expect(store.projectedVerse('TIT', '1', '1')).toBe(mine.text);
    expect((await lastOnVerseOne(own)).text).toBe(mine.text);
    const disk = (await store.readBook('TIT')).usfm;
    expect(disk).toContain('\\v 1 Pablo, siervo de Dios (mío).');
    expect(disk).toContain('\\v 2 editado después');
  });

  it('a keep whose regeneration fails; leave the review, edit and save verse 2: the keep survives', async () => {
    const { store, own } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { ctx, leave, editVerseTwo } = await session(store, conflict);
    vi.spyOn(store as unknown as { installAndConverge: () => Promise<void> }, 'installAndConverge').mockRejectedValueOnce(new Error('converge failed'));
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(true);
    expect((await store.readBook('TIT')).usfm).toContain('(suyo)'); // positive control: the disk file is stale
    await leave();
    await editVerseTwo('editado después');
    expect(store.readVerseConflicts()).toEqual([]);
    expect((await lastOnVerseOne(own)).text).toBe(mine.text);
    expect((await store.readBook('TIT')).usfm).toContain('\\v 2 editado después');
  });

  it('a keep in a book that is not open, regeneration fails; then open it, edit, save: the keep survives', async () => {
    const { store, own } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    vi.spyOn(store as unknown as { installAndConverge: () => Promise<void> }, 'installAndConverge').mockRejectedValueOnce(new Error('converge failed'));
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: null, conflictReview: { key: KEY, error: null }, conflictsByProject: {}, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    expect(await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, mine.ts)).toBe(true);
    const { editVerseTwo } = await session(store, conflict); // opening the book: loadEditorBook
    await editVerseTwo('editado después');
    expect(store.readVerseConflicts()).toEqual([]);
    expect((await lastOnVerseOne(own)).text).toBe(mine.text);
  });

  it('normal case: the editor\'s text is byte-identical to the regenerated file; a book the fold lacks is an error', async () => {
    const { store } = await conflicted();
    expect(await loadEditorBook(store, 'TIT')).toBe((await store.readBook('TIT')).usfm);
    await expect(loadEditorBook(store, 'JON')).rejects.toThrow(/JON/);
  });
});

describe('#679 SaveScheduler.unloadBook refuses a retained failed write', () => {
  it('a failed write of the book is kept: unload throws, the buffer stays', async () => {
    const manual = { setTimeout: () => 0, clearTimeout: () => {} };
    const scheduler = new SaveScheduler({ writeBook: async () => { throw new Error('disk full'); }, splice: spliceVerse, clock: manual });
    scheduler.loadBook('TIT', TIT_USFM);
    scheduler.markDirty('TIT', 1, '2', 'nuevo');
    await scheduler.flushOnBlur();
    expect(scheduler.getState()).toBe('error');
    expect(() => scheduler.unloadBook('TIT')).toThrow(/unsaved work/);
    expect(scheduler.bookText('TIT')).toContain('nuevo');
    // The buffer edited back to the stored text is clean, but the failed write is still retained:
    // a retry() would write its snapshot, so the book still cannot be unloaded.
    scheduler.markDirty('TIT', 1, '2', '___');
    expect(scheduler.isDirty('TIT')).toBe(false);
    expect(() => scheduler.unloadBook('TIT')).toThrow(/unsaved work/);
  });
});
