// #136 (D3d, ruled 2026-09-01): the picker cards' progress model. One
// counting rule — the card's entry comes from the SAME assembled session the
// tool opens (pickerEntryFromSession over progressOf/isDecided), the Align
// card from the rail's own derivation, and entries land through a
// seq-guarded reducer merge so a stale run cannot regress a newer one.
import { describe, expect, it } from 'vitest';
import {
  __pickerEntryFromSessionForTests as pickerEntryFromSession,
  __alignPickerEntryForTests as alignPickerEntry,
  __checkStartIndexForTests as checkStartIndex,
  __checkPosOfForTests as checkPosOf,
  __reducerForTests as reducer,
} from '../src/state.jsx';
import { progressOf } from '../src/data/derive';
import { ctaFor } from '../src/views/Check.jsx';

const item = (c: number, v: number, groupId: string, decided = false) => ({
  category: 'kt',
  status: decided ? 'valid' : 'todo',
  selections: decided ? [] : (false as const),
  nothingToSelect: decided,
  contextId: {
    checkId: `${c}:${v}`,
    groupId,
    reference: { bookId: 'TIT', chapter: c, verse: v },
    quoteString: 'Θεοῦ',
    occurrence: 1,
  },
});

const sessionOf = (items: ReturnType<typeof item>[], dropped: unknown = null) => ({
  items,
  progress: progressOf(items as never),
  dropped,
});

describe('#136 pickerEntryFromSession — one counting rule', () => {
  it('done/total equal the session meter exactly, next = first undecided', () => {
    const items = [item(1, 1, 'god', true), item(1, 2, 'faith'), item(1, 3, 'grace')];
    const entry = pickerEntryFromSession(sessionOf(items) as never);
    expect({ done: entry.done, total: entry.total }).toEqual({
      done: progressOf(items as never).decided,
      total: 3,
    });
    expect(entry.nextItem?.contextId.groupId).toBe('faith');
  });

  it('all resolved: next is null; dropped travels with the entry (#15)', () => {
    const items = [item(1, 1, 'god', true)];
    const dropped = { count: 2, scheme: 'org', reasons: ['no-counterpart'] };
    const entry = pickerEntryFromSession(sessionOf(items, dropped) as never);
    expect(entry.nextItem).toBeNull();
    expect(entry.dropped).toBe(dropped);
  });
});

describe('#136 alignPickerEntry — the rail´s own verse model', () => {
  const rows = [
    { ref: '1:1', status: 'valid' },
    { ref: '1:2', status: 'invalid' },
    { ref: '1:3', status: 'todo' },
    { ref: '1:4', status: 'undrafted' },
  ];
  it('counts drafted verses only; next is the first todo/invalid', () => {
    const entry = alignPickerEntry(rows as never);
    expect(entry).toMatchObject({ done: 1, total: 3, nextRef: '1:2' });
  });
  it('an undrafted book yields total 0', () => {
    expect(alignPickerEntry([{ ref: '1:1', status: 'undrafted' }] as never).total).toBe(0);
  });
});

describe('#136 checkStartIndex — remembered place, else first undecided, else 0', () => {
  const items = [item(1, 1, 'god', true), item(1, 2, 'faith'), item(1, 3, 'grace')];
  it('prefers the remembered position when it still exists', () => {
    expect(checkStartIndex(items as never, checkPosOf(items[2] as never))).toBe(2);
  });
  it('falls back to the first undecided when the position is gone', () => {
    expect(checkStartIndex(items as never, { c: 9, v: 9, groupId: 'x', occurrence: 1 })).toBe(1);
  });
  it('falls back to item 1 when everything is decided', () => {
    const done = [item(1, 1, 'god', true), item(1, 2, 'faith', true)];
    expect(checkStartIndex(done as never, undefined)).toBe(0);
  });
});

describe('#136 pickerToolEntry reducer — seq-guarded, atomic per tool', () => {
  it('concurrent tool entries of the SAME run both land', () => {
    let state: Record<string, unknown> = { pickerProgress: { seq: 4 } };
    state = reducer(state, { type: 'pickerToolEntry', seq: 4, tool: 'translationNotes', entry: { done: 1, total: 2 } });
    state = reducer(state, { type: 'pickerToolEntry', seq: 4, tool: 'align', entry: { done: 0, total: 5 } });
    expect(state.pickerProgress).toMatchObject({
      seq: 4,
      translationNotes: { done: 1, total: 2 },
      align: { done: 0, total: 5 },
    });
  });
  it('a stale run´s entry changes nothing', () => {
    const state = { pickerProgress: { seq: 5 } };
    expect(reducer(state, { type: 'pickerToolEntry', seq: 4, tool: 'translationNotes', entry: {} })).toBe(state);
  });
  it('an entry after the picker progress was cleared changes nothing', () => {
    const state = { pickerProgress: null };
    expect(reducer(state, { type: 'pickerToolEntry', seq: 4, tool: 'align', entry: {} })).toBe(state);
  });
});

describe('#136 ctaFor — Start / Continue / Review by state', () => {
  it('maps the mockup states', () => {
    expect(ctaFor({ done: 0, total: 5 })).toBe('Start checking');
    expect(ctaFor({ done: 2, total: 5 })).toBe('Continue');
    expect(ctaFor({ done: 5, total: 5 })).toBe('Review');
  });
  it('loading, empty, and errored entries fall back to the plain open label', () => {
    expect(ctaFor(undefined)).toBe('Open this tool');
    expect(ctaFor({ done: 0, total: 0 })).toBe('Open this tool');
    expect(ctaFor({ error: 'boom' })).toBe('Open this tool');
  });
});
