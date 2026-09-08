// @vitest-environment jsdom
// #107 (epic #104, D63): the Translate screen's editing card types at the SAME
// size the drafted verse displays at — the design's reading step for both
// Translate columns, --fs-verse-lg (22px); the app once typed at --fs-verse-sm,
// so the text shrank the moment a verse was clicked and grew again on save.
// A Nastaliq project takes its own step (--fs-verse-nastaliq / --lh-nastaliq).
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const verse = { n: '1', drafted: true, para: true, text: 'Pablo, siervo de Dios', body: 'Pablo, siervo de Dios' };
const verse2 = { n: '2', drafted: false, para: false, text: '', body: '' };
const verse3 = { n: '3', drafted: false, para: false, text: '', body: '' };
// A source that chunks the chapter 1–2 | 3, and one with no \ts\* at all.
const CHUNKED = '\\id TIT\n\\c 1\n\\p\n\\v 1 a\n\\v 2 b\n\\ts\\*\n\\v 3 c\n';
const FLAT = '\\id TIT\n\\c 1\n\\p\n\\v 1 a\n\\v 2 b\n\\v 3 c\n';
const state = {
  chapter: 1,
  rail: false,
  editing: null as { key: string; keys?: string[] } | null,
  project: { name: 'Equipo', languageTag: 'es-419', scriptDirection: 'ltr', textFont: null as string | null },
  sourceTab: 'ult',
  sourcePanes: ['ult'],
  sources: { ult: { raw: '', chapters: {}, version: 'v89' } } as Record<string, { raw: string; chapters: object; version: string }>,
  bookRaw: '',
  bookError: null,
};
const bookModel = { code: 'TIT', chapterNums: [1], byChapter: { '1': [verse] } as Record<string, object[]> };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({
    s: state,
    book: bookModel,
    sourceModel: null,
    actions: new Proxy({}, { get: () => () => undefined }),
  }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: [],
  SUITE_VERSION: 'v89',
  isOldTestament: () => false,
}));

import Draft from '../src/views/Draft.jsx';

beforeEach(() => {
  cleanup();
  state.editing = null;
  state.sourceTab = 'ult';
  state.sources = { ult: { raw: '', chapters: {}, version: 'v89' } };
  bookModel.byChapter = { '1': [verse] };
});

describe('#107 — the Translate editing card', () => {
  it('types at the size the drafted verse displays at (no jump on click)', () => {
    render(<Draft />);
    // #141: the verse is a span inside its section paragraph; the type sits on the <p>.
    const display = screen.getByTitle(/edit/i).closest('p')!;
    const displaySize = display.style.fontSize;
    const displayLine = display.style.lineHeight;
    // The design's reading size for both Translate columns (epic #104).
    expect(displaySize).toBe('var(--fs-verse-lg)');

    cleanup();
    state.editing = { key: '1:1' };
    render(<Draft />);
    const editor = screen.getByRole('textbox');
    // The invariant, not a literal: editing must not resize the verse.
    expect(editor.style.fontSize).toBe(displaySize);
    expect(editor.style.lineHeight).toBe(displayLine);
  });

  it('a Nastaliq project takes its own step and face — display and editor alike (typography.css contract)', () => {
    const saved = state.project.textFont;
    state.project.textFont = 'Awami Nastaliq — Nastaliq';
    state.editing = null;
    try {
      render(<Draft />);
      const display = screen.getByTitle(/edit/i).closest('p')!;
      expect(display.style.fontSize).toBe('var(--fs-verse-nastaliq)');
      expect(display.style.lineHeight).toBe('var(--lh-nastaliq)');
      expect(display.style.fontFamily).toBe('var(--font-nastaliq)');
      cleanup();
      state.editing = { key: '1:1' };
      render(<Draft />);
      const editor = screen.getByRole('textbox');
      expect(editor.style.fontSize).toBe('var(--fs-verse-nastaliq)');
      expect(editor.style.fontFamily).toBe('var(--font-nastaliq)');
    } finally {
      state.project.textFont = saved;
      state.editing = null;
    }
  });
});

describe('#141 — the section card keeps the verses it was opened with', () => {
  const openThreeVerseChapter = () => {
    bookModel.byChapter = { '1': [verse, verse2, verse3] };
    state.sources = { ult: { raw: CHUNKED, chapters: {}, version: 'v89' }, ust: { raw: FLAT, chapters: {}, version: 'v89' } };
  };

  it('rows are the source\u2019s \\ts\\* sections', () => {
    openThreeVerseChapter();
    render(<Draft />);
    expect(screen.getByRole('button', { name: 'Draft section 1\u20132' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft section 3' })).toBeTruthy();
  });

  it('a source switch that regroups the rows does not widen the open card\u2019s save targets', () => {
    // Codex round 1: the card saves the keys it holds. If the row it sits in
    // regrouped to 1\u20133, saving would write verse 3 back to a stub.
    openThreeVerseChapter();
    state.editing = { key: '1:s1', keys: ['1', '2'] };
    const { rerender } = render(<Draft />);
    expect(screen.getByRole('textbox', { name: 'Section 1\u20132' })).toBeTruthy();
    state.sourceTab = 'ust'; // no \ts\*: the chapter is one row again
    rerender(<Draft />);
    expect(screen.getByRole('textbox', { name: 'Section 1\u20132' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Section 1\u20133' })).toBeNull();
  });

  it('with no \\ts\\* anywhere the chapter is one section', () => {
    openThreeVerseChapter();
    state.sources = { ult: { raw: FLAT, chapters: {}, version: 'v89' } };
    render(<Draft />);
    expect(screen.getByRole('button', { name: 'Draft section 1\u20133' })).toBeTruthy();
  });

  it('the book\u2019s own \\ts\\* groups the rows when the source has none', () => {
    openThreeVerseChapter();
    state.sources = { ult: { raw: FLAT, chapters: {}, version: 'v89' } };
    state.bookRaw = CHUNKED;
    try {
      render(<Draft />);
      expect(screen.getByRole('button', { name: 'Draft section 1\u20132' })).toBeTruthy();
    } finally {
      state.bookRaw = '';
    }
  });
});
