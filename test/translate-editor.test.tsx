// @vitest-environment jsdom
// #107 (epic #104, D63): the Translate screen's editing card types at the SAME
// size the drafted verse displays at — the design's reading step for both
// Translate columns, --fs-verse-lg (22px); the app once typed at --fs-verse-sm,
// so the text shrank the moment a verse was clicked and grew again on save.
// A Nastaliq project takes its own step (--fs-verse-nastaliq / --lh-nastaliq).
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const verse = { n: 1, drafted: true, text: 'Pablo, siervo de Dios', body: 'Pablo, siervo de Dios' };
const state = {
  chapter: 1,
  rail: false,
  editing: null as { key: string } | null,
  project: { name: 'Equipo', languageTag: 'es-419', scriptDirection: 'ltr', textFont: null as string | null },
  sourceTab: 'ult',
  sourcePanes: ['ult'],
  sources: { ult: { raw: '', chapters: {}, version: 'v89' } },
  bookError: null,
};
const bookModel = { code: 'TIT', chapterNums: [1], byChapter: { '1': [verse] } };

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
}));

import Draft from '../src/views/Draft.jsx';

beforeEach(() => {
  cleanup();
  state.editing = null;
});

describe('#107 — the Translate editing card', () => {
  it('types at the size the drafted verse displays at (no jump on click)', () => {
    render(<Draft />);
    const display = screen.getByTitle(/edit/i);
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
      const display = screen.getByTitle(/edit/i);
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
