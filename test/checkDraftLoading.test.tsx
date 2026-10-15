// @vitest-environment jsdom
// #722 class: a check session opened before its book text arrived holds no
// draft copy. Since #679 a book switch waits in the store queue, so the tool
// can open (and its session can finish) while s.bookRaw is null. The session
// must read the draft again when the text arrives (#532's refreshCheckDraft);
// before this fix it kept "not drafted" until the user left Check.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const TIT = '\\id TIT\n\\c 1\n\\p\n\\v 1 Pablo, siervo de Dios\n';
const refreshCheckDraft = vi.fn();
const item = {
  category: 'kt',
  status: 'todo',
  selections: false,
  nothingToSelect: false,
  contextId: { checkId: 'a1b2', groupId: 'god', reference: { bookId: 'tit', chapter: 1, verse: 1 }, quoteString: 'Θεοῦ', occurrence: 1 },
};
const state = {
  project: { id: 'p1', repoPath: 'p1', flavor: 'textTranslation', scriptDirection: 'ltr' },
  book: 'tit',
  bookRaw: null as string | null,
  aligning: false,
  checkTool: 'translationNotes',
  checkSession: { seq: 3, tool: 'translationNotes', book: 'tit', items: [item], activeIndex: 0, progress: { decided: 0, total: 1 }, verses: {} },
  preflight: null,
  projectPins: null,
  sources: {},
  sourcePanes: null,
  toolPos: {},
};
const known: Record<string, unknown> = { refreshCheckDraft };
vi.mock('../src/state.jsx', () => ({
  useApp: () => ({ s: state, actions: new Proxy(known, { get: (o, k: string) => o[k] ?? (() => undefined) }) }),
  isOldTestament: () => false,
}));

const { default: Check } = await import('../src/views/Check.jsx');

afterEach(cleanup);

describe('a check session opened while the book is still loading', () => {
  it('reads the draft again when the book text arrives', () => {
    const { rerender } = render(<Check />);
    const before = refreshCheckDraft.mock.calls.length;

    state.bookRaw = TIT;
    rerender(<Check />);
    expect(refreshCheckDraft.mock.calls.length).toBe(before + 1);
  });
});
