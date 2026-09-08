// @vitest-environment jsdom
// Issue #111 — A read-only "Comments" tab in the helps panel lists the
// translator's own user comments for the current chapter.
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const calls: Array<{ name: string; args: unknown[] }> = [];

// Aligned verse in the REAL usfm-js shape (zaln milestone → gateway w
// children; content + verse-level occurrence). "of God" renders Θεοῦ#2; the
// verse also carries Θεοῦ#1 ("a servant of God") to prove occurrence
// discrimination in the rendered DOM.
const zw = (text: string) => ({ text, tag: 'w', type: 'word', occurrence: '1', occurrences: '1' });
const zg = (content: string, occurrence: string, children: unknown[]) => ({
  tag: 'zaln', type: 'milestone', content, occurrence, occurrences: '2', children,
});
const sp = { type: 'text', text: ' ' };
const alignedV1 = {
  verseObjects: [
    zg('δοῦλος', '1', [zw('servant')]), sp,
    zg('Θεοῦ', '1', [zw('of'), sp, zw('God')]), sp,
    zg('ἐκλεκτῶν', '1', [zw('chosen')]), sp,
    zg('Θεοῦ', '2', [zw('of'), sp, zw('God')]), { type: 'text', text: '.' },
  ],
};

const noteItem = {
  contextId: {
    checkId: 'n1', occurrenceNote: 'A note about the elect of God.',
    reference: { bookId: 'tit', chapter: 1, verse: 1 },
    tool: 'translationNotes', groupId: 'figs-metaphor',
    quote: [{ word: 'ἐκλεκτῶν', occurrence: 1 }, { word: 'Θεοῦ', occurrence: 1 }],
    quoteString: 'ἐκλεκτῶν Θεοῦ', occurrence: 1,
  },
  category: 'figures', selections: false, comments: false, reminders: false,
  nothingToSelect: false, verseEdits: false, invalidated: false,
};

const state: Record<string, unknown> = {};
const resetState = () => {
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, {
    view: 'read',
    project: { id: 'p1', name: 'Equipo', languageTag: 'es-419', scriptDirection: 'ltr', bookCodes: ['TIT'] },
    book: 'TIT', chapter: 1, rail: false, helps: true, helpsTab: 'notes',
    helpsHover: null, helpsActive: null,
    sourceTab: 'ult', sourcePanes: ['ult'],
    sources: { ult: { raw: '\\id TIT\n\\c 1\n\\p\n\\v 1 x\n', chapters: { '1': { '1': alignedV1 } } } },
    editing: null,
    understand: {
      loading: false, book: 'TIT',
      notes: { state: 'ready', rung: 'primary', items: [noteItem], dropped: null },
      words: { state: 'none' }, questions: { state: 'none' },
      comprehension: {},
    },
    progressByProject: {}, bookError: null,
  });
};

// The mock actions MUTATE the shared state the way the reducer would, so a
// rerender shows the post-dispatch UI.
const actionsProxy = new Proxy({}, {
  get: (_, name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
    if (name === 'hoverHelp') state.helpsHover = args[0];
    if (name === 'focusHelp')
      state.helpsActive =
        (state.helpsActive as { id?: string } | null)?.id === (args[0] as { id?: string })?.id
          ? null
          : args[0];
    if (name === 'toggleHelps') state.helps = !state.helps;
    if (name === 'stagedNote') return null;
    return undefined;
  },
});

const bookModel = {
  code: 'TIT', chapterNums: [1], draftPct: 0,
  byChapter: { '1': [{ n: 1, drafted: true, text: 'siervo de Dios', body: 'siervo de Dios' }] },
};
const sourceModel = { '1': { 1: alignedV1 } };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({ s: state, book: bookModel, sourceModel, actions: actionsProxy }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: [],
  SUITE_VERSION: 'v89',
  isOldTestament: () => false,
}));

import Draft from '../src/views/Draft.jsx';

beforeEach(() => {
  cleanup();
  resetState();
  calls.length = 0;
  state.helpsTab = 'comments';
  (state.understand as Record<string, unknown>).comprehension = {
    '1:3': { text: 'comment on verse three', ts: '2026-08-27T00:00:00.000Z|0000|a' },
    '1:1': { text: 'comment on verse one', ts: '2026-08-27T00:00:00.000Z|0000|a' },
    '2:1': { text: 'other chapter', ts: '2026-08-27T00:00:00.000Z|0000|a' },
  };
});

describe('Helps comments tab (#111)', () => {
  it('lists stored comments for current chapter in verse order', () => {
    render(<Draft />);
    const comments = screen.getAllByTestId('helps-comment');
    expect(comments).toHaveLength(2);
    expect(comments[0].textContent).toContain('Verse 1');
    expect(comments[1].textContent).toContain('Verse 3');
    expect(screen.queryByText('other chapter')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Comments' })).toBeTruthy();
  });

  it('does not fire write actions when rows are clicked', () => {
    render(<Draft />);
    const comments = screen.getAllByTestId('helps-comment');
    comments.forEach((row) => fireEvent.click(row));
    const READ_SIDE = new Set(['loadUnderstand', 'setHelpsTab', 'hoverHelp', 'focusHelp', 'stagedNote', 'toggleHelps']);
    expect(calls.filter((c) => !READ_SIDE.has(c.name))).toEqual([]);
  });
});
