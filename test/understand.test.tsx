// @vitest-environment jsdom
// #106 (epic #104, D63): the Understand screen's WRITE BOUNDARY. The
// comprehension-notes box is the ONLY control that writes to the project
// (owner ruling 2026-08-27); every other control is read-only. Plus the
// persistence shape: the §8.5 note.add event addNote() emits seals and
// projects through the conformance reference.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Actions the Understand screen may call WITHOUT writing to the project.
const READ_SIDE = new Set([
  'loadUnderstand', 'setHelpsTab', 'setSourceTab', 'toggleRail', 'setChapter',
  'loadHelpArticle', 'closeHelpArticle', 'openBook', 'go',
]);
const calls: Array<{ name: string; args: unknown[] }> = [];
const actionsProxy = new Proxy({}, {
  get: (_, name: string) => (...args: unknown[]) => { calls.push({ name, args }); },
});

const RAW_ULT = '\\id TIT\n\\c 1\n\\ts\\*\n\\p\n\\v 1 one\n\\v 2 two\n\\ts\\*\n\\p\n\\v 3 three\n';
const srcChapters = {
  '1': {
    '1': { verseObjects: [{ text: 'In the beginning was the Word.' }] },
    '2': { verseObjects: [{ text: 'He was with God.' }] },
    '3': { verseObjects: [{ text: 'All things were made through him.' }] },
  },
};

const noteItem = (verse: number, quote: string, note: string, groupId = 'figs-metaphor') => ({
  contextId: {
    checkId: `n${verse}`, occurrenceNote: note,
    reference: { bookId: 'tit', chapter: 1, verse },
    tool: 'translationNotes', groupId, quote: [], quoteString: quote, occurrence: 1,
  },
  category: 'figures', selections: false, comments: false, reminders: false,
  nothingToSelect: false, verseEdits: false, invalidated: false,
});

const state = {
  view: 'read',
  project: { id: 'p1', name: 'Equipo', languageTag: 'es-419', scriptDirection: 'ltr', bookCodes: ['TIT'] },
  book: 'TIT',
  chapter: 1,
  rail: false,
  helpsTab: 'notes',
  sourceTab: 'ult',
  sources: { ult: { raw: RAW_ULT, chapters: srcChapters }, ust: { raw: RAW_ULT, chapters: srcChapters } },
  understand: {
    loading: false,
    book: 'TIT',
    notes: { state: 'ready', rung: 'primary', items: [noteItem(1, 'the Word', 'A title for Jesus.')], dropped: null },
    words: { state: 'none' },
    questions: {
      state: 'ready', rung: 'fallback', dropped: null,
      items: [{ ...noteItem(1, 'Word', 'The Word was with God.'), question: 'Who was with God?', response: 'The Word.', category: 'questions' }],
    },
    comprehension: {},
  },
  progressByProject: {},
  bookError: null,
};

const bookModel = { code: 'TIT', chapterNums: [1], draftPct: 0, byChapter: { '1': [] } };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({ s: state, book: bookModel, sourceModel: null, actions: actionsProxy }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: [],
  SUITE_VERSION: 'v89',
}));

import Understand from '../src/views/Understand.jsx';

const writes = () => calls.filter((c) => !READ_SIDE.has(c.name));

describe('#106 — the Understand write boundary', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('renders the passage, helps and questions read-only — no write fires from any control', () => {
    render(<Understand />);
    expect(screen.getByTestId('understand')).toBeTruthy();
    // exercise every read-only control
    fireEvent.click(screen.getByRole('button', { name: 'UST' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Academy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simplified' }));
    expect(writes()).toEqual([]);
  });

  it('the tQ questions render with their answers (read-only)', () => {
    state.helpsTab = 'questions'; // the tab lives in app state; the mock is static
    try {
      render(<Understand />);
      expect(screen.getByText('Who was with God?')).toBeTruthy();
      expect(screen.getByText(/The Word\./)).toBeTruthy();
      expect(writes()).toEqual([]);
    } finally {
      state.helpsTab = 'notes';
    }
  });

  it('the comprehension box is the ONLY write: blur with new text calls saveComprehension, and nothing else writes', () => {
    render(<Understand />);
    const boxes = screen.getAllByPlaceholderText('What does this section mean in your own words?');
    fireEvent.change(boxes[0], { target: { value: 'God made everything through the Word.' } });
    expect(writes()).toEqual([]); // typing alone writes nothing
    fireEvent.blur(boxes[0]);
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].name).toBe('saveComprehension');
    expect(w[0].args[2]).toBe('God made everything through the Word.');
  });
});

describe('#106 — the persistence shape: §8.5 note.add seals and projects', () => {
  it('the exact event addNote() emits validates through the reference and folds into notes output', async () => {
    const { sealAction } = await import('../src/data/journal/seal');
    const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
    const refFold = nodeRequire('./conformance/journal/fold.mjs') as { fold(events: unknown[]): { notes: Array<Record<string, unknown>> } };
    const refSkeleton = nodeRequire('./conformance/journal/skeleton.mjs') as { decompose(usfm: string): { skeleton: string; verses: Record<string, string> } };
    const { skeleton, verses } = refSkeleton.decompose('\\id TIT\n\\c 1\n\\p\n\\v 1 one\n');
    const addTs = '2026-08-27T00:00:00.000Z|0000|actor-a';
    const events = [
      { v: 1, op: 'book.add', actor: 'actor-a', ts: addTs, base: null, book: 'TIT', scope: [], skeleton, initialVerses: verses },
      { v: 1, op: 'note.add', actor: 'actor-a', ts: '2026-08-27T00:00:01.000Z|0000|actor-a',
        target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'My comprehension note.', generation: addTs },
    ];
    await expect(sealAction([events[1]] as never)).resolves.toBeDefined();
    const out = refFold.fold(JSON.parse(JSON.stringify(events)));
    expect(out.notes.length).toBe(1);
    expect(out.notes[0].text).toBe('My comprehension note.');
    expect((out.notes[0].target as Record<string, unknown>).verse).toBe('1');
  });
});
