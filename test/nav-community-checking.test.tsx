// @vitest-environment jsdom
// #108 (epic #104, D63): Publish is retired as a top-level tab. It must not be
// reachable from the top navigation, and it must be reachable from Check's
// Community Checking card, which opens the typeset preview with both exports
// disabled until J7.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const go = vi.fn();

const baseState = {
  view: 'check',
  project: { id: 'p1', name: 'Equipo Ejemplo', languageTag: 'es-419', scriptDirection: 'ltr', bookCodes: ['TIT'] },
  saveState: 'saved',
  book: 'TIT',
  chapter: 1,
  // Two resolvable tools in a designed non-ready state — enough for the picker
  // to render its cards without a platform.
  preflight: {
    translationWords: { state: 'unpinned' },
    translationNotes: { state: 'unpinned' },
  },
  checkTool: null,
  checkSession: null,
  aligning: false,
  modal: null,
  np: null,
  ab: null,
  st: null,
  src: { gateway: null, rows: [] },
  gatewayPreview: null,
  bookError: null,
  progressByProject: {},
  projects: [],
  netEnabled: false,
  noteSaveErrors: {},
};

const bookModel = {
  code: 'TIT',
  chapterNums: [1],
  draftPct: 50,
  byChapter: {
    '1': [
      { n: 1, drafted: true, text: 'Pablo, siervo de Dios.' },
      { n: 2, drafted: false, text: '' },
    ],
  },
};

let state = { ...baseState };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({
    s: state,
    book: bookModel,
    sourceModel: null,
    actions: new Proxy({}, { get: (_, name) => (name === 'go' ? go : () => {}) }),
  }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: ['Noto Sans (default)'],
  SUITE_VERSION: 'v89',
}));

import App from '../src/App.jsx';

describe('#108 — Publish moves into Check as Community Checking', () => {
  beforeEach(() => {
    cleanup();
    go.mockClear();
    state = { ...baseState };
  });

  it('the top navigation offers Translate and Check, and no Publish tab', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Translate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByText('Publish')).toBeNull();
  });

  it("Check's picker shows the Community Checking card, and opening it goes to the publish view", () => {
    render(<App />);
    expect(screen.getByTestId('community-checking-card')).toBeTruthy();
    fireEvent.click(screen.getByTestId('open-community-checking'));
    expect(go).toHaveBeenCalledWith('publish');
  });

  it('a failed comprehension write surfaces on the GLOBAL save indicator with its own retry (2026-08-27 adversarial round 2, B1)', () => {
    state = { ...baseState, noteSaveErrors: { 'p1|1:1': { message: 'refused', repoPath: 'p1', book: 'TIT', chapter: 1, verse: '1', text: 'x' } } } as never;
    render(<App />);
    const indicator = screen.getByTestId('save-indicator');
    expect(indicator.getAttribute('data-state')).toBe('error');
    expect(screen.getByTestId('retry-note-save')).toBeTruthy();
  });

  it('the publish view is the typeset preview with both exports disabled', () => {
    state = { ...baseState, view: 'publish' };
    render(<App />);
    expect(screen.getByTestId('community-checking')).toBeTruthy();
    const pdf = screen.getByRole('button', { name: 'Export PDF' }) as HTMLButtonElement;
    const usfm = screen.getByRole('button', { name: 'Export USFM' }) as HTMLButtonElement;
    expect(pdf.disabled).toBe(true);
    expect(usfm.disabled).toBe(true);
    // The preview renders the project's own text, not fixture copy.
    expect(screen.getByText(/Pablo, siervo de Dios\./)).toBeTruthy();
    // An undrafted verse is stated, never silently skipped in the preview.
    expect(screen.getByText(/verse not yet drafted/)).toBeTruthy();
  });
});
