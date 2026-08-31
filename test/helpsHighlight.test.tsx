// @vitest-environment jsdom
// Epic #104 fidelity (F2+F3, 2026-08-31): the helps panel is one
// implementation mounted on BOTH screens, and hovering (or clicking) a note or
// key-word card highlights the quoted gateway words in the source passage —
// source only, never the target (the mockup's hl() rule).
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
}));

import Understand from '../src/views/Understand.jsx';
import Draft from '../src/views/Draft.jsx';

beforeEach(() => { cleanup(); resetState(); calls.length = 0; });

const highlightedWords = () => screen.queryAllByTestId('source-hl').map((el) => el.textContent);

describe('F3 — helps cards highlight their quote in the source passage', () => {
  it('hovering a note card lights the quoted words, at the RIGHT occurrence, and leaving clears', () => {
    const { rerender } = render(<Understand />);
    expect(highlightedWords()).toEqual([]);
    fireEvent.mouseEnter(screen.getByText(/A note about the elect/));
    rerender(<Understand />);
    // ἐκλεκτῶν Θεοῦ → "chosen of God" — the SECOND "of God", never the
    // servant's (Θεοῦ#1).
    expect(highlightedWords()).toEqual(['chosen', 'of', 'God']);
    fireEvent.mouseLeave(screen.getByText(/A note about the elect/));
    rerender(<Understand />);
    expect(highlightedWords()).toEqual([]);
  });

  it('clicking makes the focus sticky: it survives mouse-leave and a second click clears it', () => {
    const { rerender } = render(<Understand />);
    const card = screen.getByText(/A note about the elect/);
    fireEvent.click(card);
    fireEvent.mouseLeave(card);
    rerender(<Understand />);
    expect(highlightedWords()).toEqual(['chosen', 'of', 'God']);
    fireEvent.click(screen.getByText(/A note about the elect/));
    rerender(<Understand />);
    expect(highlightedWords()).toEqual([]);
  });

  it('Translate: the source pane highlights the same way; the target column never does', () => {
    const { rerender } = render(<Draft />);
    fireEvent.mouseEnter(screen.getByText(/A note about the elect/));
    rerender(<Draft />);
    expect(highlightedWords()).toEqual(['chosen', 'of', 'God']);
    // The drafted target text carries no <mark> — highlight is source-only.
    expect(screen.getByText(/siervo de Dios/).querySelector('[data-testid="source-hl"]')).toBeNull();
  });
});

describe('gateway titles (owner ruling 2026-08-31)', () => {
  it('the note card titles in the GATEWAY language derived from the alignment, not the original', () => {
    render(<Understand />);
    // quote ἐκλεκτῶν Θεοῦ → the aligned fixture's "chosen of God".
    expect(screen.getByText('“chosen of God”')).toBeTruthy();
    expect(screen.queryByText(/ἐκλεκτῶν/)).toBeNull();
  });
});

describe('F2 — Translate mounts the shared helps panel', () => {
  it('renders the panel with its tabs, and the header toggle hides it', () => {
    const { rerender } = render(<Draft />);
    expect(screen.getByTestId('helps-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
    fireEvent.click(screen.getByTitle('Toggle helps panel'));
    rerender(<Draft />);
    expect(screen.queryByTestId('helps-panel')).toBeNull();
  });

  it('loads the helps the same way Understand does', () => {
    render(<Draft />);
    expect(calls.some((c) => c.name === 'loadUnderstand')).toBe(true);
  });
});

describe('cross-frame projects (2026-08-31 Codex adversarial finding)', () => {
  // The reviewer's exact shape: the note references PROJECT 2:2, the source
  // renders at SOURCE 1:1 through a mapped sourceRefs row. Before the fix the
  // frames were compared raw — no highlight ever fired and the title fell
  // back to Greek.
  const crossFrame = () => {
    state.chapter = 2;
    (state.understand as Record<string, unknown>).sourceRefs = {
      '2': [
        { c: 1, v: '1', pc: 2, pv: '1' },
        { c: 1, v: '1', pc: 2, pv: '2' },
      ],
    };
    (state.understand as { notes: { items: unknown[] } }).notes.items = [
      { ...noteItem, contextId: { ...noteItem.contextId, reference: { bookId: 'tit', chapter: 2, verse: 2 } } },
    ];
  };

  it('a help at project 2:2 highlights source 1:1 — in ITS fan-out unit only', () => {
    crossFrame();
    const { rerender } = render(<Understand />);
    // Fan-out: two units both render source 1:1.
    expect(screen.getAllByText(/servant/).length).toBe(2);
    fireEvent.mouseEnter(screen.getByText(/A note about the elect/));
    rerender(<Understand />);
    // The highlight lands once — in the project-2:2 unit — not in both
    // renderings of the same source verse.
    expect(highlightedWords()).toEqual(['chosen', 'of', 'God']);
    const unit = screen.getByTestId('understand-unit-m2:2');
    expect(unit.querySelectorAll('[data-testid="source-hl"]').length).toBe(3);
    expect(screen.getByTestId('understand-unit-m2:1').querySelectorAll('[data-testid="source-hl"]').length).toBe(0);
  });

  it('the gateway title resolves through the mapped row, not the project coordinates', () => {
    crossFrame();
    render(<Understand />);
    expect(screen.getByText('“chosen of God”')).toBeTruthy();
    expect(screen.queryByText(/ἐκλεκτῶν/)).toBeNull();
  });
});
