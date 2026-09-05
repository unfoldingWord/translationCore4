// D65 (round-22 checkpoint, owner ruling 2026-08-28): comprehension notes
// ride their own SaveScheduler. This file pins the note WRITER (frame
// mapping, the unmappable refusal, the persisted-text echo) and restates the
// round-21 and round-22 defect classes against the REAL scheduler — they must
// be structurally impossible, not patched.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const resolveProjectFrame = vi.fn();
const mapReference = vi.fn();
vi.mock('../src/data/projectFrame', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveProjectFrame: (...args: unknown[]) => resolveProjectFrame(...args),
}));
vi.mock('../src/data/mapReference', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mapReference: (...args: unknown[]) => mapReference(...args),
}));

import { __makeNoteWriterForTests as makeNoteWriter, noteKeyFor } from '../src/state.jsx';
import { SaveScheduler } from '../src/data/saveScheduler';
import { t } from '../src/i18n';

type Target = {
  store: { addNote: (...a: unknown[]) => Promise<void> };
  repoPath: string;
  book: string;
  chapter: number | string;
  verse: string;
  projectFrame: boolean;
};

const REPO = '_local_/_quarantine_/equipo';
const writerWith = (targets: Map<string, Target>) => {
  const dispatched: Array<Record<string, unknown>> = [];
  const writer = makeNoteWriter({
    noteTargetsRef: { current: targets },
    dispatch: (a: Record<string, unknown>) => dispatched.push(a),
    apiClient: {},
  });
  return { writer, dispatched };
};
const targetFor = (
  addNote: (...a: unknown[]) => Promise<void>,
  over: Partial<Target> = {},
): Target => ({
  store: { addNote },
  repoPath: REPO,
  book: 'TIT',
  chapter: 1,
  verse: '3',
  projectFrame: false,
  ...over,
});

beforeEach(() => {
  resolveProjectFrame.mockReset();
  mapReference.mockReset();
});

describe('D65 — the note writer', () => {
  it('a PROJECT-frame target writes its verbatim reference and echoes noteSaved (I1/J2)', async () => {
    const written: unknown[][] = [];
    const targets = new Map([
      [noteKeyFor(REPO, 'TIT', 2, '2'), targetFor(async (...a) => void written.push(a), { chapter: 2, verse: '2', projectFrame: true })],
    ]);
    const { writer, dispatched } = writerWith(targets);
    await writer(noteKeyFor(REPO, 'TIT', 2, '2'), '  note on project 2:2  ');
    expect(resolveProjectFrame).not.toHaveBeenCalled(); // verbatim — never mapped
    expect(written).toEqual([['TIT', 2, '2', 'note on project 2:2']]);
    expect(dispatched).toEqual([
      expect.objectContaining({ type: 'noteSaved', repoPath: REPO, book: 'TIT', key: '2:2', text: 'note on project 2:2' }),
    ]);
  });

  it('a same-frame target on the eng frame writes unmapped', async () => {
    resolveProjectFrame.mockResolvedValue({ state: 'ready', name: 'eng' });
    const written: unknown[][] = [];
    const key = noteKeyFor(REPO, 'TIT', 1, '3');
    const { writer } = writerWith(new Map([[key, targetFor(async (...a) => void written.push(a))]]));
    await writer(key, 'plain note');
    expect(mapReference).not.toHaveBeenCalled();
    expect(written).toEqual([['TIT', 1, '3', 'plain note']]);
  });

  it('a same-frame target on a NON-eng frame writes the MAPPED reference; the echo keys the original (A1)', async () => {
    resolveProjectFrame.mockResolvedValue({ state: 'ready', name: 'rsc', schemes: {} });
    mapReference.mockResolvedValue({ ok: true, reference: { chapter: 2, verse: '1' } });
    const written: unknown[][] = [];
    const key = noteKeyFor(REPO, 'JON', 1, '17');
    const { writer, dispatched } = writerWith(
      new Map([[key, targetFor(async (...a) => void written.push(a), { book: 'JON', chapter: 1, verse: '17' })]]),
    );
    await writer(key, 'cross-numbering note');
    expect(written).toEqual([['JON', 2, '1', 'cross-numbering note']]); // rsc JON 2:1 = eng JON 1:17
    expect(dispatched[0]).toEqual(expect.objectContaining({ key: '1:17' })); // display echo stays source-side
  });

  it('an UNMAPPABLE target throws with the stated reason — the journal never receives a guess (FR-32)', async () => {
    resolveProjectFrame.mockResolvedValue({ state: 'ready', name: 'rsc', schemes: {} });
    mapReference.mockResolvedValue({ ok: false });
    const written: unknown[][] = [];
    const key = noteKeyFor(REPO, 'TIT', 1, '3');
    const { writer, dispatched } = writerWith(new Map([[key, targetFor(async (...a) => void written.push(a))]]));
    await expect(writer(key, 'never lands')).rejects.toThrow(t('understand.saveUnmappable'));
    expect(written).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('an unregistered key throws instead of guessing a target', async () => {
    const { writer } = writerWith(new Map());
    await expect(writer('nowhere|TIT|1:1', 'text')).rejects.toThrow(/target unknown/);
  });
});

describe('D65 — the defect classes, restated against the REAL scheduler', () => {
  const clock = () => {
    // Manual clock: nothing fires unless the test flushes explicitly.
    return { setTimeout: () => 0, clearTimeout: () => {} };
  };

  it('ROUND 21 restated: after a failed write of A, retry() replays the NEWEST text exactly once — a stale payload cannot exist', async () => {
    const written: string[] = [];
    let failOnce = true;
    const key = noteKeyFor(REPO, 'TIT', 1, '3');
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async (_k, text) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('disk full');
        }
        written.push(text);
      },
      clock: clock(),
    });
    sched.seedIfAbsent(key, '');
    sched.markDirty(key, 1, '3', 'text A');
    await sched.flushOnBlur();
    expect(sched.getState()).toBe('error'); // A failed, retained
    // The user edits to B (the blur-before-Retry-click gesture): the buffer
    // now holds ONLY B — there is no ledger of failed text to replay.
    sched.markDirty(key, 1, '3', 'text B');
    await sched.retry();
    expect(written).toEqual(['text B']); // B once; A never resurfaces
    expect(sched.getState()).toBe('saved');
  });

  it('ROUND 22 restated: an emptied box reconciled to its stored text drains clean — no stranded dirty state, no write', async () => {
    const written: string[] = [];
    const key = noteKeyFor(REPO, 'TIT', 1, '1');
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async (_k, text) => void written.push(text),
      clock: clock(),
    });
    sched.seedIfAbsent(key, 'a saved note');
    sched.markDirty(key, 1, '1', ''); // the user cleared the box…
    sched.markDirty(key, 1, '1', 'a saved note'); // …and the box staged the stored text back (G1)
    expect(await sched.drain()).toBe(true);
    expect(written).toEqual([]); // the grow-only store never sees the clear
    expect(sched.getState()).toBe('saved');
  });

  it('seedIfAbsent never clobbers a staged draft — seeding one key while another is dirty is safe', () => {
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async () => {},
      clock: clock(),
    });
    const k1 = noteKeyFor(REPO, 'TIT', 1, '1');
    const k2 = noteKeyFor(REPO, 'TIT', 1, '2');
    sched.seedIfAbsent(k1, 'stored 1');
    sched.markDirty(k1, 1, '1', 'draft 1');
    sched.seedIfAbsent(k1, 'stored 1 again'); // re-seed is a no-op
    expect(sched.bookText(k1)).toBe('draft 1');
    // loadBook would THROW here (B3 guards unsaved work); seedIfAbsent must not.
    sched.seedIfAbsent(k2, 'stored 2');
    expect(sched.bookText(k2)).toBe('stored 2');
    expect(sched.getState()).toBe('dirty'); // k1's draft still owed
  });
});

describe('2026-08-28 adversarial round 23 regressions', () => {
  const clock = () => ({ setTimeout: () => 0, clearTimeout: () => {} });
  const passthroughSched = (writeBook: (k: string, t: string) => Promise<void | string>) =>
    new SaveScheduler({ splice: (_r, _c, _v, body) => body, writeBook, clock: clock() });

  it('the writer REFUSES empty text at the boundary — the grow-only journal never receives a clear (G1)', async () => {
    const written: unknown[][] = [];
    const key = noteKeyFor(REPO, 'TIT', 1, '1');
    const { writer, dispatched } = writerWith(new Map([[key, targetFor(async (...a) => void written.push(a))]]));
    await writer(key, '   ');
    expect(written).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it("F2: clearing a FRESH note while its first write is in flight never journals an empty note — the buffer reconciles clean", async () => {
    const journal: string[] = [];
    let release: () => void = () => {};
    let started: () => void = () => {};
    const startedP = new Promise<void>((r) => { started = r; });
    let deferOnce = true;
    const key = noteKeyFor(REPO, 'TIT', 1, '1');
    const targets = new Map([[key, targetFor(async (_b, _c, _v, text) => void journal.push(text as string), { projectFrame: true })]]);
    const { writer } = writerWith(targets);
    const sched = passthroughSched(async (k, text) => {
      if (deferOnce) {
        deferOnce = false;
        started();
        await new Promise<void>((r) => { release = r; });
      }
      // The writer's return value is the refusal contract (round 24) — a
      // wrapper must pass it through, as the production writeBook does.
      return writer(k, text);
    });
    // Fresh note: stored is ''. The user types A; the flush starts (held open).
    sched.seedIfAbsent(key, '');
    sched.markDirty(key, 1, '1', 'text A');
    const flush = sched.flushOnBlur();
    await startedP; // A's write is genuinely IN FLIGHT now
    // While A is in flight the user CLEARS the box — the UI stages the stored
    // text, which for a fresh note is ''.
    sched.markDirty(key, 1, '1', '');
    release();
    await flush;
    // persisted advanced to A, so the staged '' is dirty — the next flush
    // hands '' to the writer, which REFUSES it and reports the durable value.
    expect(await sched.drain()).toBe(true);
    expect(journal).toEqual(['text A']); // no empty note.add, ever
    expect(sched.getState()).toBe('saved');
    // Round 24: the buffer must AGREE with the journal after the refusal —
    // a remounting box restores from the buffer, so a blank here would show
    // an empty box over a durable note.
    expect(sched.bookText(key)).toBe('text A');
    // …and retyping the same text compares clean: no duplicate note.add.
    sched.markDirty(key, 1, '1', 'text A');
    expect(await sched.drain()).toBe(true);
    expect(journal).toEqual(['text A']);
  });

  it('round 24: a writer refusal with newer text ALREADY staged keeps the newer text dirty (never clobbered)', async () => {
    const journal: string[] = [];
    let releaseEmpty: () => void = () => {};
    let started: () => void = () => {};
    const startedP = new Promise<void>((r) => { started = r; });
    const key = noteKeyFor(REPO, 'TIT', 1, '1');
    const sched = passthroughSched(async (_k, text) => {
      if (text.trim() === '') {
        started();
        await new Promise<void>((r) => { releaseEmpty = r; });
        return 'durable text'; // the refusal reports the durable value
      }
      journal.push(text);
    });
    sched.seedIfAbsent(key, '');
    sched.markDirty(key, 1, '1', ''); // hmm: clean ('' === ''), force via persisted
    // Make '' genuinely dirty the way the race does: persisted holds text.
    sched.markDirty(key, 1, '1', 'durable text');
    await sched.flushOnBlur(); // journals 'durable text'; persisted = it
    sched.markDirty(key, 1, '1', ''); // now '' is dirty
    const flush = sched.flushOnBlur();
    await startedP; // the refusing write is in flight
    sched.markDirty(key, 1, '1', 'newer draft'); // user types meanwhile
    releaseEmpty();
    await flush;
    // The refusal must not clobber the newer draft: it stays dirty and writes.
    expect(sched.bookText(key)).toBe('newer draft');
    expect(await sched.drain()).toBe(true);
    expect(journal).toEqual(['durable text', 'newer draft']);
  });

  it('F1: a note staged while the VERSE drain awaited is flushed by the drain loop, never disposed unflushed', async () => {
    const { __drainBothSchedulersForTests: drainBoth } = await import('../src/state.jsx');
    const noteJournal: string[] = [];
    const noteKey = noteKeyFor(REPO, 'TIT', 1, '1');
    const noteSched = passthroughSched(async (_k, text) => void noteJournal.push(text));
    noteSched.seedIfAbsent(noteKey, '');
    // The verse write is held open; while it is in flight the user stages a
    // comprehension note (the screen stays editable during a drain).
    let releaseVerse: () => void = () => {};
    const verseSched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async () => {
        await new Promise<void>((r) => { releaseVerse = r; });
        // the note lands mid-drain, AFTER the note scheduler's first pass
        noteSched.markDirty(noteKey, 1, '1', 'typed during the verse drain');
      },
      clock: clock(),
    });
    verseSched.seedIfAbsent('TIT', 'old');
    verseSched.markDirty('TIT', 1, '1', 'new verse text');
    const drained = drainBoth({
      schedulerRef: { current: verseSched },
      noteSchedulerRef: { current: noteSched },
    });
    // let the drain reach the deferred verse write, then release it
    await new Promise((r) => setTimeout(r, 0));
    releaseVerse();
    expect(await drained).toBe(true);
    expect(noteJournal).toEqual(['typed during the verse drain']); // flushed, not lost
    expect(noteSched.getState()).toBe('saved');
  });
});

describe('2026-08-28 adversarial round 25 regression — concurrent project opens', () => {
  const openCtx = () => {
    const dispatched: Array<Record<string, unknown>> = [];
    const openedBooks: unknown[] = [];
    const ctx = {
      openProjectSeqRef: { current: 0 },
      schedulerRef: { current: null as unknown },
      noteSchedulerRef: { current: null as unknown },
      noteTargetsRef: { current: new Map() },
      storeRef: { current: null as unknown },
      stateRef: { current: { project: null } },
      understandSeqRef: { current: 0 },
      dispatch: (a: Record<string, unknown>) => dispatched.push(a),
      actions: {
        resolutionContext: async () => ({ installed: {}, coverage: {} }),
        openBook: async (code: unknown) => void openedBooks.push(code),
        loadUnderstand: async () => void dispatched.push({ type: '__loadUnderstand' }),
      },
      apiClient: {
        setCurrentProject: async () => {},
        getMetadataRaw: async () => ({}),
      },
      makeStore: () => ({}) as never, // overridden per call below
      markUsed: () => {},
    };
    return { ctx, dispatched, openedBooks };
  };
  const fakeStore = (open: (repoPath: string) => Promise<Record<string, unknown>>) => ({
    open,
    readResources: async () => null, // loadProjectPins: "no pins recorded"
    writeBook: async () => {},
    reconcileStaged: async () => {},
  });

  it('the LATEST open exclusively owns the refs and the dispatched state — an earlier open resuming later assigns nothing', async () => {
    const { ctx, dispatched, openedBooks } = openCtx();
    let releaseA: (v: Record<string, unknown>) => void = () => {};
    let aStarted: () => void = () => {};
    const aStartedP = new Promise<void>((r) => { aStarted = r; });
    const storeA = fakeStore(() => new Promise((r) => { releaseA = r; aStarted(); }));
    const storeB = fakeStore(async (repoPath) => ({ repoPath, name: 'B', scriptDirection: 'ltr', bookCodes: ['TIT'] }));
    const stores = [storeA, storeB];
    ctx.makeStore = (() => stores.shift()) as never;

    const { __performProjectOpenForTests: open } = await import('../src/state.jsx');
    const openA = open(ctx, 'repo/A', 'GEN');
    await aStartedP; // A's store.open is genuinely in flight before B begins
    const openB = open(ctx, 'repo/B', 'TIT');
    await openB; // B completes while A's store.open is still pending
    expect(ctx.storeRef.current).toBe(storeB);
    // A's open resolves AFTERWARDS — it must recognize it was superseded.
    releaseA({ repoPath: 'repo/A', name: 'A', scriptDirection: 'ltr', bookCodes: ['GEN'] });
    await openA;
    expect(ctx.storeRef.current).toBe(storeB); // never reassigned to A
    const projects = dispatched.filter((d) => (d.patch as Record<string, unknown>)?.project);
    expect(projects.length).toBe(1); // only B's summary ever dispatched
    expect(((projects[0].patch as Record<string, { name: string }>).project).name).toBe('B');
    expect(openedBooks).toEqual(['TIT']); // only B's book opened
  });

  it("a STALE open's failure never routes the successfully opened project Home", async () => {
    const { ctx, dispatched } = openCtx();
    let failA: (e: Error) => void = () => {};
    let aStarted: () => void = () => {};
    const aStartedP = new Promise<void>((r) => { aStarted = r; });
    const storeA = fakeStore(() => new Promise((_r, reject) => { failA = reject; aStarted(); }));
    const storeB = fakeStore(async (repoPath) => ({ repoPath, name: 'B', scriptDirection: 'ltr', bookCodes: ['TIT'] }));
    const stores = [storeA, storeB];
    ctx.makeStore = (() => stores.shift()) as never;

    const { __performProjectOpenForTests: open } = await import('../src/state.jsx');
    const openA = open(ctx, 'repo/A', undefined);
    await aStartedP; // A's store.open is genuinely in flight before B begins
    const openB = open(ctx, 'repo/B', undefined);
    await openB;
    failA(new Error('repo A is corrupt'));
    await openA;
    expect(dispatched.some((d) => (d.patch as Record<string, unknown>)?.bookError)).toBe(false);
    expect(dispatched.some((d) => (d.patch as Record<string, unknown>)?.view === 'home')).toBe(false);
  });

  it("#95: a newer request whose drain REFUSES clears the earlier request's progress record — no indicator is left standing", async () => {
    const { ctx, dispatched } = openCtx();
    let releaseA: (v: Record<string, unknown>) => void = () => {};
    let aStarted: () => void = () => {};
    const aStartedP = new Promise<void>((r) => { aStarted = r; });
    const storeA = fakeStore(() => new Promise((r) => { releaseA = r; aStarted(); }));
    ctx.makeStore = (() => storeA) as never;
    const { __performProjectOpenForTests: open } = await import('../src/state.jsx');
    const openA = open(ctx, 'repo/A', 'GEN');
    await aStartedP; // A has dispatched its `opening` record and is reading its journal
    const openingPatches = () => dispatched.filter((d) => 'opening' in ((d.patch as Record<string, unknown>) ?? {}));
    expect(openingPatches().length).toBe(1);
    expect((openingPatches()[0].patch as { opening: { repoPath: string } }).opening.repoPath).toBe('repo/A');
    // B arrives while A is in flight, and B's drain refuses (a retained save failure).
    ctx.schedulerRef.current = { drain: async () => false, getState: () => 'error', dispose: () => {} };
    await open(ctx, 'repo/B', 'TIT');
    const last = openingPatches().at(-1)!.patch as { opening: unknown };
    expect(last.opening).toBeNull(); // B, the latest request, cleared A's record
    // A resolves afterwards, superseded: it must not resurrect a record.
    releaseA({ repoPath: 'repo/A', name: 'A', scriptDirection: 'ltr', bookCodes: ['GEN'] });
    await openA;
    expect((openingPatches().at(-1)!.patch as { opening: unknown }).opening).toBeNull();
  });

  it("#95: a newer request whose drain THROWS surfaces the error and clears the earlier request's progress record", async () => {
    const { ctx, dispatched } = openCtx();
    let releaseA: (v: Record<string, unknown>) => void = () => {};
    let aStarted: () => void = () => {};
    const aStartedP = new Promise<void>((r) => { aStarted = r; });
    const storeA = fakeStore(() => new Promise((r) => { releaseA = r; aStarted(); }));
    ctx.makeStore = (() => storeA) as never;
    const { __performProjectOpenForTests: open } = await import('../src/state.jsx');
    const openA = open(ctx, 'repo/A', 'GEN');
    await aStartedP;
    ctx.schedulerRef.current = { drain: async () => { throw new Error('flush exploded'); }, getState: () => 'error', dispose: () => {} };
    await open(ctx, 'repo/B', 'TIT');
    const last = dispatched.at(-1)!.patch as { opening: unknown; bookError: string };
    expect(last.opening).toBeNull();
    expect(last.bookError).toMatch(/flush exploded/);
    releaseA({ repoPath: 'repo/A', name: 'A', scriptDirection: 'ltr', bookCodes: ['GEN'] });
    await openA;
    const openingPatches = dispatched.filter((d) => 'opening' in ((d.patch as Record<string, unknown>) ?? {}));
    expect((openingPatches.at(-1)!.patch as { opening: unknown }).opening).toBeNull();
  });

  it('the production wiring refreshes the Understand notes when the note scheduler reconciles (round 31 F1)', async () => {
    const { ctx, dispatched } = openCtx();
    const storeB = fakeStore(async (repoPath) => ({ repoPath, name: 'B', scriptDirection: 'ltr', bookCodes: ['TIT'] }));
    ctx.makeStore = (() => storeB) as never;
    const { __performProjectOpenForTests: open } = await import('../src/state.jsx');
    await open(ctx, 'repo/B', 'TIT');
    const sched = ctx.noteSchedulerRef.current as InstanceType<typeof SaveScheduler>;
    // Force a failure through the real writer (unregistered key throws),
    // then retry: the injected reconcile must reconcile the store AND call
    // actions.loadUnderstand so a recovered durable note is visible before
    // any Saved claim (round 31 F1).
    sched.seedIfAbsent('unregistered|TIT|1:1', '');
    sched.markDirty('unregistered|TIT|1:1', 1, '1', 'will fail');
    await sched.flushOnBlur();
    expect(sched.getState()).toBe('error');
    dispatched.length = 0;
    sched.markDirty('unregistered|TIT|1:1', 1, '1', ''); // abandoned: buffer clean
    await sched.retry();
    expect(dispatched.some((d) => d.type === '__loadUnderstand')).toBe(true);
    expect(sched.getState()).toBe('saved');
  });
});

describe('2026-08-31-round hardening: the reconcile gate lives INSIDE the scheduler', () => {
  const clock = () => ({ setTimeout: () => 0, clearTimeout: () => {} });

  it('retry() runs reconcile BEFORE clearing a failure; a rejection keeps the error standing and writes nothing', async () => {
    const order: string[] = [];
    let reconcileFails = true;
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async (_k, text) => {
        order.push(`write:${text}`);
        if (text === 'boom') throw new Error('write failed');
      },
      clock: clock(),
      reconcile: async () => {
        order.push('reconcile');
        if (reconcileFails) throw new Error('outbox unreachable');
      },
    });
    sched.seedIfAbsent('k', '');
    sched.markDirty('k', 1, '1', 'boom');
    await sched.flushOnBlur();
    expect(sched.getState()).toBe('error');
    // Rejecting reconcile: the failure STANDS — drain() refuses too, so no
    // navigation or dispose path can claim rest over an unreconciled outbox.
    await sched.retry();
    expect(sched.getState()).toBe('error');
    expect(await sched.drain()).toBe(false);
    // Healed reconcile: the gate passes, the failure clears, the flush runs.
    reconcileFails = false;
    sched.markDirty('k', 1, '1', 'ok now');
    expect(await sched.drain()).toBe(true);
    expect(order.filter((o) => o === 'reconcile').length).toBeGreaterThanOrEqual(2);
    expect(order[order.length - 1]).toBe('write:ok now');
  });

});

describe('2026-08-28 adversarial round 32: a clear during an in-flight save can never journal the stale text', () => {
  it('existing A → in-flight B → clear: only B is journaled, and the buffer re-syncs to B when it lands', async () => {
    const journal: string[] = [];
    let release: () => void = () => {};
    let started: () => void = () => {};
    const startedP = new Promise<void>((r) => { started = r; });
    const key = noteKeyFor(REPO, 'TIT', 1, '1');
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async (_k, text) => {
        started();
        await new Promise<void>((r) => { release = r; });
        journal.push(text);
      },
      clock: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    // Existing note A is the persisted baseline; the user edits it to B.
    sched.seedIfAbsent(key, 'note A');
    sched.markDirty(key, 1, '1', 'note B');
    const flush = sched.flushOnBlur();
    await startedP; // B's write is genuinely in flight
    // The user CLEARS the box: the version-aware revert targets whatever
    // persisted BECOMES — never the stale render-time value A.
    sched.revertToPersisted(key);
    expect(sched.bookText(key)).toBe('note A'); // pre-landing: persisted is still A
    release();
    await flush;
    // B landed: persisted advanced to B and the pending revert re-synced.
    expect(sched.bookText(key)).toBe('note B');
    expect(await sched.drain()).toBe(true);
    expect(journal).toEqual(['note B']); // A is NEVER re-journaled over B
  });

  it('a real edit typed after the revert supersedes it — the new text writes, the revert never clobbers it', async () => {
    const journal: string[] = [];
    let release: () => void = () => {};
    let started: () => void = () => {};
    const startedP = new Promise<void>((r) => { started = r; });
    let deferOnce = true;
    const key = noteKeyFor(REPO, 'TIT', 1, '1');
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async (_k, text) => {
        if (deferOnce) {
          deferOnce = false;
          started();
          await new Promise<void>((r) => { release = r; });
        }
        journal.push(text);
      },
      clock: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    sched.seedIfAbsent(key, 'note A');
    sched.markDirty(key, 1, '1', 'note B');
    const flush = sched.flushOnBlur();
    await startedP;
    sched.revertToPersisted(key); // clear…
    sched.markDirty(key, 1, '1', 'note C'); // …then a NEW edit before B lands
    release();
    await flush;
    expect(await sched.drain()).toBe(true);
    expect(journal).toEqual(['note B', 'note C']); // C written; A never resurfaces
    expect(sched.bookText(key)).toBe('note C');
  });
});
