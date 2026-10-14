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
  /** The keepVersion action's reload: openBook → loadEditorBook; a failure is a book error, never a throw. */
  const reloadBook = async (book: string) => {
    try {
      const text = await loadEditorBook(store, book);
      scheduler.loadBook(book, text);
      rawRef.current = text;
      dispatch({ type: 'set', patch: { bookRaw: text } });
    } catch (e) {
      dispatch({ type: 'set', patch: { bookError: String((e as Error).message ?? e) } });
    }
  };
  const ctx = { storeRef: { current: store }, stateRef, schedulerRef: { current: scheduler }, rawRef, saveRefs: [], dispatch, conflictsGen: new Map(), reloadBook };
  /** An edit of verse 2 in Translate, saved. */
  const editVerseTwo = async (text: string) => {
    scheduler.markDirty('TIT', 1, '2', text);
    expect(await scheduler.drain()).toBe(true);
  };
  return { box, ctx, scheduler, rawRef, editVerseTwo };
};

/** The journal's last text.verse.set of TIT 1:1, by ts. */
const lastOnVerseOne = async (own: () => Promise<JournalEvent[]>) =>
  (await own()).filter((e) => e.op === 'text.verse.set' && e.chapter === '1' && e.verse === '1').sort((a, b) => (a.ts < b.ts ? -1 : 1)).at(-1)!;

// "Keep this version" never meets a loaded book (bench rounds 1–6): the book is
// unloaded before the store writes, loads again through loadEditorBook
// (openBook's path), and only then is the outcome read from the fold, once.
describe('#679 "Keep this version"', () => {
  it('keeps the chosen version: the book is unloaded while the store writes; the list, the Home count and the outcome come from the fold', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { box, ctx, scheduler, rawRef } = await session(store, conflict);
    const real = store.resolveVerse.bind(store);
    const atWrite: Array<string | null> = [];
    vi.spyOn(store, 'resolveVerse').mockImplementation(async (key, head, shown) => {
      atWrite.push(scheduler.bookText('TIT'), rawRef.current);
      expect(() => scheduler.markDirty('TIT', 1, '2', 'x')).toThrow(/not loaded/); // no edit can reach the book now
      return real(key, head, shown);
    });
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(true);
    expect(store.resolveVerse).toHaveBeenCalledWith(KEY, mine.ts, conflict.versions.map((v) => v.ts));
    expect(atWrite).toEqual([null, null]);
    expect(box.state.verseConflicts).toEqual([]);
    expect(box.state.conflictsByProject).toEqual({ [REPO]: {} });
    expect(box.state.conflictReview).toEqual({ key: KEY, error: null, kept: true });
    // The book loaded again through the one load path, with the kept text.
    expect(scheduler.bookText('TIT')).toContain('\\v 1 Pablo, siervo de Dios (mío).');
    expect(box.state.bookRaw).toBe(rawRef.current);
  });

  it('the review moves to the conflict after the kept one', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    // A list as the review shows it: the kept conflict between two others that stay open.
    const other = (key: string) => ({ key, book: 'TIT', chapter: '1', verse: key.slice(-1), versions: [] }) as never;
    const [before, after] = [other('text|TIT|1:0'), other('text|TIT|1:9')];
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: {}, verseConflicts: [before, conflict, after] });
    const stateRef = { get current() { return box.state; } };
    // The fold after the keep lists the two others (stand-ins: the rig project has one conflict).
    vi.spyOn(store, 'readVerseConflicts').mockReturnValue([before, after]);
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, mine.ts);
    expect(box.state.conflictReview).toEqual({ key: 'text|TIT|1:9', error: null, kept: true });
  });

  it('a refused keep shows its error in the review and changes nothing', async () => {
    const { store } = await conflicted();
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: { [REPO]: { TIT: 1 } } });
    const stateRef = { get current() { return box.state; } };
    const ok = await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, 'not-a-head');
    expect(ok).toBe(false);
    expect((box.state.conflictReview as { error: string }).error).toBeTruthy();
    expect(store.readVerseConflicts().map((c) => c.key)).toEqual([KEY]);
  });

  // Frank, round 5: a keep that failed after it was staged is replayed by the
  // next store mutation. The reported result must match the fold — for the
  // first keep (its staged action is published before the outcome is read)
  // and for a later keep of ANOTHER version (the fold holds the first).
  it('a keep of Mine whose first write fails, then a keep of the teammate version: each reported result matches the fold', async () => {
    const { store, rig } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const theirs = conflict.versions.find((v) => v.actor === TEAMMATE)!;
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: { [REPO]: { TIT: 1 } }, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    const ctx = { storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() };
    // Keep Mine: the segment write fails after the action is staged.
    rig.failOn((c: { method: string; ipath?: string }) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(true);
    expect(box.state.conflictReview).toEqual({ key: KEY, error: null, kept: true });
    // A press on the teammate's version with the review from before (a second window, a stale screen).
    dispatch({ type: 'set', patch: { verseConflicts: [conflict] } });
    expect(await keepVersion(ctx, KEY, theirs.ts)).toBe(false);
    expect((box.state.conflictReview as { error: string | null }).error).toMatch(/another version/i);
    expect(box.state.verseConflicts).toEqual([]);
    expect(box.state.conflictsByProject).toEqual({ [REPO]: {} });
    expect(store.projectedVerse('TIT', '1', '1')).toBe(mine.text);
  });

  // George, bench round 6 (High): an unsaved edit of the conflicted verse itself
  // is written by the keep's drain. It is a version the person never saw on the
  // review, so the keep must not replace it: the keep is refused, the edit stays
  // a live version, and the review shows the new list.
  it('an unsaved edit of the conflicted verse, written by the keep\'s drain, is not replaced by the keep', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { box, ctx, scheduler } = await session(store, conflict);
    ctx.saveRefs = [ctx.schedulerRef] as never;
    // Typed in Translate, not yet saved, when the review opened from the fold.
    // The save's base is the projected head (the teammate's), so Mine stays a
    // head beside the new text, and a keep of Mine would supersede the new text.
    scheduler.markDirty('TIT', 1, '1', 'Pablo, siervo de Dios (nuevo).');
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(false);
    const [still] = store.readVerseConflicts();
    expect(still?.key).toBe(KEY);
    expect(still.versions.map((v) => v.text.trim())).toContain('Pablo, siervo de Dios (nuevo).');
    expect(box.state.verseConflicts).toEqual([still]);
    expect((box.state.conflictReview as { error: string | null; kept: boolean }).kept).toBe(false);
    expect((box.state.conflictReview as { error: string | null }).error).toBeTruthy();
  });

  it('a keep whose regeneration fails, but whose chosen text the fold holds, is success', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const theirs = conflict.versions.find((v) => v.actor === TEAMMATE)!;
    vi.spyOn(store as unknown as { installAndConverge: () => Promise<void> }, 'installAndConverge').mockRejectedValueOnce(new Error('converge failed'));
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: {}, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    expect(await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: null }, rawRef: { current: null }, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, theirs.ts)).toBe(true);
    expect(box.state.conflictReview).toEqual({ key: KEY, error: null, kept: true });
    expect(store.projectedVerse('TIT', '1', '1')).toBe(theirs.text);
  });
});

// Frank, round 6: a staged keep whose publish failed was undone by the next
// save of another verse — the editor's buffer still held the text from before
// the keep, and the save replayed the keep and then diffed the old text over it.
describe('#679 no save after a keep can undo it', () => {
  it('a keep of Mine whose segment write fails once: the reload publishes it, the outcome is read after the reload; then edit and save verse 2', async () => {
    const { store, rig, own } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { box, ctx, editVerseTwo } = await session(store, conflict);
    rig.failOn((c: { method: string; ipath?: string }) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(true);
    // The state after the reload: kept, no conflict listed, Home count 0 — so no Translate marker and no second press.
    expect(box.state.conflictReview).toEqual({ key: KEY, error: null, kept: true });
    expect(box.state.verseConflicts).toEqual([]);
    expect(box.state.conflictsByProject).toEqual({ [REPO]: {} });
    expect(box.state.bookRaw as string).toContain('\\v 1 Pablo, siervo de Dios (mío).');
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
    const { ctx, editVerseTwo } = await session(store, conflict);
    vi.spyOn(store as unknown as { installAndConverge: () => Promise<void> }, 'installAndConverge').mockRejectedValueOnce(new Error('converge failed'));
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(true);
    expect((await store.readBook('TIT')).usfm).toContain('(suyo)'); // positive control: the disk file is stale
    await editVerseTwo('editado después');
    expect(store.readVerseConflicts()).toEqual([]);
    expect((await lastOnVerseOne(own)).text).toBe(mine.text);
    expect((await store.readBook('TIT')).usfm).toContain('\\v 2 editado después');
  });

  it('the write and the reload both fail: the review says not kept and the book did not open; a later load publishes the keep', async () => {
    const { store, rig } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { box, ctx, rawRef } = await session(store, conflict);
    rig.failOn((c: { method: string; ipath?: string }) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 2);
    expect(await keepVersion(ctx, KEY, mine.ts)).toBe(false);
    expect(rawRef.current).toBeNull(); // no editable book
    expect(box.state.bookRaw).toBeNull();
    const review = box.state.conflictReview as { error: string; kept: boolean };
    expect(review.kept).toBe(false);
    expect(review.error).toContain('The book did not open again.');
    expect(box.state.verseConflicts).toEqual([conflict]); // the fold as it is: the conflict is still open
    // The staged keep is not lost: the next load publishes it.
    expect(await loadEditorBook(store, 'TIT')).toContain('(mío)');
    expect(store.readVerseConflicts()).toEqual([]);
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
