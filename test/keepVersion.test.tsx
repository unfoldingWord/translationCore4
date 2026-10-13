// @vitest-environment jsdom
// #679 — the state glue of the conflict review, on the fake rig: the Home count
// is folded read-only from the project's journal (never a stored Report), and
// "Keep this version" calls resolveVerse with the kept head, reads the open
// book again and lists the conflicts the new fold shows.
import { describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { fold } from '../src/data/journal/runtime';
import { sealAction, segmentName, validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { SaveScheduler } from '../src/data/saveScheduler';
import { spliceVerse } from '../src/data/usfm/splice';
import { __performKeepVersionForTests as keepVersion, __performLoadConflictsForTests as loadConflicts, __reducerForTests as reducer } from '../src/state.jsx';

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
  return { api, files, store };
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

describe('#679 "Keep this version"', () => {
  it('calls resolveVerse with the kept head, reads the open book again, and the conflict leaves the list and the Home count', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const resolve = vi.spyOn(store, 'resolveVerse');
    const loadBook = vi.fn();
    const rawRef = { current: 'stale' };
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'TIT', conflictReview: { key: KEY, error: null }, conflictsByProject: { [REPO]: { TIT: 1 } }, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    const ok = await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: { loadBook } }, rawRef, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, mine.ts);
    expect(ok).toBe(true);
    expect(resolve).toHaveBeenCalledWith(KEY, mine.ts);
    expect(box.state.verseConflicts).toEqual([]);
    expect(box.state.conflictsByProject).toEqual({ [REPO]: {} });
    expect(rawRef.current).toContain('\\v 1 Pablo, siervo de Dios (mío).');
    expect(loadBook).toHaveBeenCalledWith('TIT', rawRef.current);
    expect(box.state.bookRaw).toBe(rawRef.current);
    // No conflict is left: the review stays open on the kept key and shows that none is open.
    expect(box.state.conflictReview).toEqual({ key: KEY, error: null });
  });

  it('the review moves to the conflict after the kept one', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    // A list as the review shows it: the kept conflict between two others that stay open.
    const other = (key: string) => ({ key, book: 'TIT', chapter: '1', verse: key.slice(-1), versions: [] }) as never;
    const [before, after] = [other('text|TIT|1:0'), other('text|TIT|1:9')];
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'JON', conflictReview: { key: KEY, error: null }, conflictsByProject: {}, verseConflicts: [before, conflict, after] });
    const stateRef = { get current() { return box.state; } };
    // The store's fold after the keep lists the two others (stand-ins: the rig project has one conflict).
    vi.spyOn(store, 'readVerseConflicts').mockReturnValue([before, after]);
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
});

// Review finding B1 (2026-10-13): a keep must never leave the text from before
// the keep in the editor. A later save of that book diffs against the fold and
// would write the replaced version back as a new edit: the keep is undone in
// silence, and the next sync sends that to the team.
describe('#679 a keep cannot be undone by the next save', () => {
  /** The open book as the app holds it: the real SaveScheduler over the real store. */
  const openBook = async (store: JournalingStore) => {
    const { usfm } = await store.readBook('TIT');
    const scheduler = new SaveScheduler({ writeBook: (book, whole) => store.writeBook(book, whole), splice: spliceVerse });
    scheduler.loadBook('TIT', usfm);
    return { scheduler, rawRef: { current: usfm as string | null } };
  };
  /** Edit another verse of the book and save it, as Translate does. */
  const editVerseTwo = async (scheduler: SaveScheduler) => {
    scheduler.markDirty('TIT', 1, '2', 'otro versículo');
    expect(await scheduler.drain()).toBe(true);
  };
  const keptText = async (store: JournalingStore) => (await store.readBook('TIT')).usfm;

  it('a book read that fails after the keep: the editor holds the kept text, and the next save keeps it', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { scheduler, rawRef } = await openBook(store);
    expect(rawRef.current).toContain('(suyo)'); // positive control: the editor holds the provisional text
    vi.spyOn(store, 'readBook').mockRejectedValue(new Error('read failed'));
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'TIT', bookRaw: rawRef.current, conflictReview: { key: KEY, error: null }, conflictsByProject: {}, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    expect(await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: scheduler }, rawRef, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, mine.ts)).toBe(true);
    // The editor holds the kept text, or no text at all (unloaded); never the replaced one.
    for (const held of [rawRef.current, scheduler.bookText('TIT'), box.state.bookRaw as string | null])
      if (held !== null) expect(held).not.toContain('(suyo)');
    vi.mocked(store.readBook).mockRestore();
    if (scheduler.bookText('TIT') !== null) await editVerseTwo(scheduler);
    expect(store.readVerseConflicts()).toEqual([]);
    expect(await keptText(store)).toContain('\\v 1 Pablo, siervo de Dios (mío).');
  });

  it('regeneration that fails after the publish: the keep is reported, the list refreshes, and the next save keeps it', async () => {
    const { store } = await conflicted();
    const [conflict] = store.readVerseConflicts();
    const mine = conflict.versions.find((v) => v.actor === store.actorId)!;
    const { scheduler, rawRef } = await openBook(store);
    vi.spyOn(store as unknown as { installAndConverge: () => Promise<void> }, 'installAndConverge').mockRejectedValueOnce(new Error('converge failed'));
    const { box, dispatch } = recorder({ project: { repoPath: REPO }, book: 'TIT', bookRaw: rawRef.current, conflictReview: { key: KEY, error: null }, conflictsByProject: { [REPO]: { TIT: 1 } }, verseConflicts: [conflict] });
    const stateRef = { get current() { return box.state; } };
    const ok = await keepVersion({ storeRef: { current: store }, stateRef, schedulerRef: { current: scheduler }, rawRef, saveRefs: [], dispatch, conflictsGen: new Map() }, KEY, mine.ts);
    expect(ok).toBe(true);
    expect((box.state.conflictReview as { error: string | null }).error).toBeNull();
    expect(box.state.verseConflicts).toEqual([]);
    expect(box.state.conflictsByProject).toEqual({ [REPO]: {} });
    expect(scheduler.bookText('TIT')).toContain('\\v 1 Pablo, siervo de Dios (mío).');
    await editVerseTwo(scheduler);
    expect(store.readVerseConflicts()).toEqual([]);
    expect(await keptText(store)).toContain('\\v 1 Pablo, siervo de Dios (mío).');
  });
});
