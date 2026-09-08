// #100 — check decisions ride the SaveScheduler. The bar: recording a
// decision returns control at once; a D59 refusal surfaces on the affected
// item after the fact; later queued saves are not silently lost. The writer
// is the production one (state.jsx test hook); the store is a fake whose
// upsertDecision refuses one item the way the journaling store refuses a
// resolution disagreement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveScheduler } from '../src/data/saveScheduler';
import { __alignSaveForTests, __reducerForTests as reducer, checkKeyFor } from '../src/state.jsx';

const { makeCheckWriter, releaseParkedDecision } = __alignSaveForTests;
const TOOL = 'translationNotes';
const BOOK = 'TIT';
const RESOURCE = { repoPath: 'git.door43.org/unfoldingWord/en_tn', sha: 'abc', version: 'v86' };

const item = (checkId: string, status = 'todo') => ({
  contextId: { checkId, reference: { chapter: 1, verse: 1 }, groupId: 'g' },
  status,
});

const makeStore = (refuse: string, failOnce?: string) => {
  const writes: Array<{ tool: string; book: string; decision: { contextId: { checkId: string }; status: string }; resource: unknown }> = [];
  return {
    writes,
    upsertDecision: async (tool: string, book: string, decision: { contextId: { checkId: string }; status: string }, resource?: unknown) => {
      if (decision.contextId.checkId === failOnce) {
        failOnce = undefined;
        throw new Error('EIO: write failed');
      }
      if (decision.contextId.checkId === refuse)
        throw new Error(`upsertDecision(${tool}, ${book}): the stored §5.2 record does not match the session's resolution (D36/D59)`);
      writes.push({ tool, book, decision, resource });
    },
    reconcileStaged: async () => {},
  };
};

const settle = async () => {
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(0);
};

/** recordDecision's staging half (state.jsx), on a bare scheduler. */
const record = (
  sched: SaveScheduler,
  targets: Map<string, unknown>,
  it0: ReturnType<typeof item>,
  patch: Record<string, unknown>,
) => {
  const key = checkKeyFor(TOOL, BOOK, it0.contextId.checkId);
  targets.set(key, { tool: TOOL, book: BOOK, resource: RESOURCE });
  sched.seedIfAbsent(key, JSON.stringify(it0));
  sched.markDirty(key, 0, '0', JSON.stringify({ ...it0, ...patch }));
  return key;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('#100 — decisions return at once; a D59 refusal lands on its item; later decisions are kept', () => {
  it('three rapid decisions: control returns, A writes, B is refused and named, C stays buffered — then released', async () => {
    const store = makeStore('B');
    const targets = { current: new Map() };
    const sched = new SaveScheduler({
      writeBook: makeCheckWriter({ store, checkTargetsRef: targets }),
      splice: (_raw, _c, _v, body) => body,
    });
    const keyA = record(sched, targets.current, item('A'), { status: 'valid' });
    const keyB = record(sched, targets.current, item('B'), { status: 'valid' });
    const keyC = record(sched, targets.current, item('C'), { status: 'invalid' });
    expect(store.writes).toHaveLength(0); // nothing awaited
    expect(sched.getState()).toBe('dirty');
    await settle();
    // A landed with the session's resolution; B was refused; the failure names B.
    expect(store.writes.map((w) => w.decision.contextId.checkId)).toEqual(['A']);
    expect(store.writes[0].resource).toEqual(RESOURCE);
    expect(sched.getState()).toBe('error');
    expect(sched.getFailure()?.book).toBe(keyB);
    expect(String(sched.getFailure()?.error)).toContain('D59');
    // C is parked behind the failure, not lost: still dirty, still in the buffer.
    expect(sched.isDirty(keyC)).toBe(true);
    expect(JSON.parse(sched.bookText(keyC)!).status).toBe('invalid');
    expect(sched.isDirty(keyA)).toBe(false);
    // openCheckTool's release: B reverts to its persisted item, the retry writes C.
    sched.revertToPersisted(keyB);
    await sched.retry();
    expect(store.writes.map((w) => w.decision.contextId.checkId)).toEqual(['A', 'C']);
    expect(sched.getState()).toBe('saved');
    expect(JSON.parse(sched.bookText(keyB)!).status).toBe('todo');
  });

  it('re-opening the tool releases a D59 refusal by reverting it, but keeps a decision behind an ordinary write failure (Codex round 1)', async () => {
    const store = makeStore('B', 'A');
    const targets = { current: new Map() };
    const sched = new SaveScheduler({
      writeBook: makeCheckWriter({ store, checkTargetsRef: targets }),
      splice: (_raw, _c, _v, body) => body,
    });
    const keyA = record(sched, targets.current, item('A'), { status: 'valid' });
    await settle();
    // A failed on I/O: the payload is retained, and the release RETRIES it as is.
    expect(sched.getFailure()?.book).toBe(keyA);
    await releaseParkedDecision(sched, TOOL, BOOK);
    expect(store.writes.map((w) => w.decision.contextId.checkId)).toEqual(['A']);
    expect(store.writes[0].decision.status).toBe('valid');
    expect(sched.getState()).toBe('saved');
    // B is a D59 refusal: the release reverts it to the stored item.
    const keyB = record(sched, targets.current, item('B'), { status: 'valid' });
    await settle();
    expect(sched.getFailure()?.book).toBe(keyB);
    await releaseParkedDecision(sched, TOOL, BOOK);
    expect(sched.getState()).toBe('saved');
    expect(JSON.parse(sched.bookText(keyB)!).status).toBe('todo');
    // Another tool's failure is not this tool's to release.
    const other = record(sched, targets.current, item('B'), { status: 'invalid' });
    await settle();
    expect(sched.getFailure()?.book).toBe(other);
    await releaseParkedDecision(sched, 'translationWords', BOOK);
    expect(sched.getState()).toBe('error');
  });

  it('an unregistered key throws instead of guessing a target', async () => {
    const store = makeStore('none');
    const targets = { current: new Map() };
    const writer = makeCheckWriter({ store, checkTargetsRef: targets });
    await expect(writer('x|y|z', '{}')).rejects.toThrow(/target unknown/);
  });
});

describe('#100 — the checkSaveState mirror marks the RIGHT item and clears on recovery', () => {
  const session = () => ({
    seq: 1,
    tool: TOOL,
    book: BOOK,
    items: [item('A'), item('B')],
    activeIndex: 0,
    progress: { decided: 0, total: 2 },
    saveError: null,
    saveErrorKey: null,
  });

  it('error names the key; saved clears both; no session is a no-op', () => {
    const keyB = checkKeyFor(TOOL, BOOK, 'B');
    const err = reducer({ checkSession: session() }, { type: 'checkSaveState', state: 'error', saveError: 'refused', saveErrorKey: keyB });
    expect(err.checkSaveState).toBe('error');
    expect(err.checkSession.saveError).toBe('refused');
    expect(err.checkSession.saveErrorKey).toBe(keyB);
    const ok = reducer(err, { type: 'checkSaveState', state: 'saved', saveError: null, saveErrorKey: null });
    expect(ok.checkSaveState).toBe('saved');
    expect(ok.checkSession.saveError).toBeNull();
    expect(ok.checkSession.saveErrorKey).toBeNull();
    const none = reducer({ checkSession: null }, { type: 'checkSaveState', state: 'error', saveError: 'x', saveErrorKey: 'k' });
    expect(none.checkSaveState).toBe('error');
    expect(none.checkSession).toBeNull();
  });

  it('checkDecisionSaved no longer owns saveError: a later decision does not hide a standing refusal', () => {
    const keyB = checkKeyFor(TOOL, BOOK, 'B');
    const err = reducer({ checkSession: session() }, { type: 'checkSaveState', state: 'error', saveError: 'refused', saveErrorKey: keyB });
    const next = reducer(err, { type: 'checkDecisionSaved', seq: 1, index: 0, item: item('A', 'valid') });
    expect(next.checkSession.items[0].status).toBe('valid');
    expect(next.checkSession.saveError).toBe('refused');
    expect(next.checkSession.saveErrorKey).toBe(keyB);
  });
});
