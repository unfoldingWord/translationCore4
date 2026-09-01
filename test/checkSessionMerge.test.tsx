// PR #132 (epic #104 fidelity, F1) review round 1: the check session's async
// completions merge through the reducer, guarded by the session's seq — a
// stale completion from a closed or replaced session (even the same tool and
// book, or another project) must change nothing, and two in-flight decisions
// must never overwrite each other through a whole-array snapshot.
import { describe, it, expect } from 'vitest';
import { __reducerForTests as reducer } from '../src/state.jsx';
import { railGroupsOf } from '../src/views/Check.jsx';

const item = (c: number | string, v: number | string, over: Record<string, unknown> = {}) => ({
  category: 'kt',
  status: 'todo',
  // Undecided per isDecided (derive.ts): no selections, nothing-to-select
  // unclaimed, not invalidated.
  selections: false as const,
  nothingToSelect: false,
  contextId: {
    checkId: `${c}:${v}`,
    groupId: 'god',
    reference: { bookId: 'TIT', chapter: c, verse: v },
    quoteString: 'Θεοῦ',
    occurrence: 1,
  },
  ...over,
});

type Item = ReturnType<typeof item> & { status: string };

interface Session {
  seq: number;
  tool: string;
  book: string;
  items: Item[];
  activeIndex: number;
  progress: { decided: number; total: number };
  saveError?: string | null;
  orig?: Record<string, unknown>;
  article?: { key: string; loading: boolean; found?: { title: string } };
}

const session = (seq: number, items: Item[] = [item(1, 1), item(1, 2)]): Session => ({
  seq,
  tool: 'translationWords',
  book: 'TIT',
  items,
  activeIndex: 0,
  progress: { decided: 0, total: items.length },
});

describe('patchCheckSession — seq-guarded merge', () => {
  it('merges a patch into the session with the matching seq', () => {
    const state = { checkSession: session(3) };
    const next = reducer(state, {
      type: 'patchCheckSession',
      seq: 3,
      patch: { orig: { state: 'ready', testament: 'nt', chapters: {} } },
    });
    expect(next.checkSession.orig).toEqual({ state: 'ready', testament: 'nt', chapters: {} });
    expect(next.checkSession.items).toBe(state.checkSession.items);
  });

  it('a completion from a REPLACED session (same tool+book, new seq) changes nothing', () => {
    const state = { checkSession: session(4) };
    const next = reducer(state, {
      type: 'patchCheckSession',
      seq: 3, // the closed session's identity
      patch: { article: { key: 'stale', loading: false } },
    });
    expect(next).toBe(state);
  });

  it('a completion after the session closed changes nothing', () => {
    const state = { checkSession: null };
    expect(reducer(state, { type: 'patchCheckSession', seq: 3, patch: { orig: {} } })).toBe(state);
  });

  it("concurrent orig and article merges keep each other's results", () => {
    let state = { checkSession: session(5) };
    state = reducer(state, {
      type: 'patchCheckSession',
      seq: 5,
      patch: { article: { key: 'k', loading: false, found: { title: 'T' } } },
    });
    state = reducer(state, {
      type: 'patchCheckSession',
      seq: 5,
      patch: { orig: { state: 'ready', testament: 'nt', chapters: {} } },
    });
    expect(state.checkSession.article?.found?.title).toBe('T');
    expect(state.checkSession.orig?.state).toBe('ready');
  });
});

describe('checkDecisionSaved — item-level completion', () => {
  it('replaces exactly the decided item and recomputes progress', () => {
    const state = { checkSession: session(6) };
    const decided = { ...state.checkSession.items[1], status: 'valid', selections: false, nothingToSelect: true };
    const next = reducer(state, { type: 'checkDecisionSaved', seq: 6, index: 1, item: decided });
    expect(next.checkSession.items[0]).toBe(state.checkSession.items[0]);
    expect(next.checkSession.items[1].status).toBe('valid');
    expect(next.checkSession.progress).toEqual({ decided: 1, total: 2 });
    expect(next.checkSession.saveError).toBeNull();
  });

  it('two in-flight decisions land independently — the later never erases the earlier', () => {
    let state = { checkSession: session(7) };
    const a = { ...state.checkSession.items[0], status: 'valid', selections: false, nothingToSelect: true };
    const b = { ...state.checkSession.items[1], status: 'invalid', selections: false, nothingToSelect: false };
    state = reducer(state, { type: 'checkDecisionSaved', seq: 7, index: 0, item: a });
    state = reducer(state, { type: 'checkDecisionSaved', seq: 7, index: 1, item: b });
    expect(state.checkSession.items[0].status).toBe('valid');
    expect(state.checkSession.items[1].status).toBe('invalid');
    expect(state.checkSession.progress.decided).toBe(2);
  });

  it('a stale-seq decision completion changes nothing', () => {
    const state = { checkSession: session(9) };
    const next = reducer(state, {
      type: 'checkDecisionSaved',
      seq: 8,
      index: 0,
      item: { ...state.checkSession.items[0], status: 'valid' },
    });
    expect(next).toBe(state);
  });
});

describe('railGroupsOf — non-numeric references stay sortable', () => {
  const rows = [
    { it: item(1, 3), i: 0 },
    { it: item('front', 'intro', { category: 'intro' }), i: 1 },
    { it: item(1, '1-2'), i: 2 },
    { it: item(1, 1), i: 3 },
  ];

  it("sorts 'front' and range verses ahead of plain numbers, never NaN-scrambled", () => {
    const [group] = railGroupsOf({ items: rows, sortMode: 'byVerse', book: 'TIT' });
    const order = group.rows.map(({ it }: { it: Item }) => `${it.contextId.reference.chapter}:${it.contextId.reference.verse}`);
    expect(order).toEqual(['front:intro', '1:1-2', '1:1', '1:3']);
  });

  it('byCategory groups by item category', () => {
    const groups = railGroupsOf({ items: rows, sortMode: 'byCategory', book: 'TIT' });
    expect(groups.map((g) => g.label).sort()).toEqual(['intro', 'kt']);
  });
});
