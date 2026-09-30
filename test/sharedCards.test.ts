// #486 (found while running slice A): Home loads every card's remote at once.
// Two answers that land before a render must both stay: each merge is made on
// the state the reducer holds, not on a snapshot taken before the first one.
import { describe, expect, it } from 'vitest';
import { __reducerForTests as reducer } from '../src/state.jsx';

describe('setShared', () => {
  it('two cards that answer before a render keep both shared states', () => {
    const start = { remoteByProject: {} } as Record<string, unknown>;
    const a = { repository: 'user/a', url: 'https://door43.invalid/user/a' };
    const afterFirst = reducer(start, { type: 'setShared', id: 'p/a', shared: a });
    const afterSecond = reducer(afterFirst, { type: 'setShared', id: 'p/b', shared: null });
    expect(afterSecond.remoteByProject).toEqual({ 'p/a': a, 'p/b': null });
  });

  it('a later answer for the same card replaces its own value only', () => {
    const start = { remoteByProject: { 'p/a': null, 'p/b': { repository: 'user/b', url: 'u' } } } as Record<string, unknown>;
    const next = reducer(start, { type: 'setShared', id: 'p/a', shared: { repository: 'org/a', url: 'v' } });
    expect(next.remoteByProject).toEqual({ 'p/a': { repository: 'org/a', url: 'v' }, 'p/b': { repository: 'user/b', url: 'u' } });
  });
});
