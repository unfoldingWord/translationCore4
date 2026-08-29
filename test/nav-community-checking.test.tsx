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
  noteSaveState: 'saved',
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

  it('every checking tool is a PEER in one card grid — the two derived tools, Align and Community Checking', () => {
    render(<App />);
    // The mockup lays the picker out as one responsive grid (App.jsx L445), so
    // the cards must be siblings in a single container. They used to be three
    // stacked blocks, which no arrangement of that container could line up.
    const cards = [
      screen.getByTestId('preflight-translationWords'),
      screen.getByTestId('preflight-translationNotes'),
      screen.getByTestId('align-card'),
      screen.getByTestId('community-checking-card'),
    ];
    const parents = new Set(cards.map((c) => c.parentElement));
    expect(parents.size).toBe(1);
    expect([...parents][0]?.style.display).toBe('grid');
  });

  it('a READY tool card says what the tool does — no state badge, no resource citation (owner ruling, #108)', () => {
    state = {
      ...baseState,
      preflight: {
        translationWords: { state: 'ready', resolution: { pin: { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37' }, rung: 'primary' } },
        translationNotes: { state: 'unpinned' },
      },
    } as never;
    render(<App />);
    const readyCard = screen.getByTestId('preflight-translationWords');
    // A checking resource is local in the normal flow, so saying so is noise.
    expect(readyCard.textContent).toContain('Check every key term');
    expect(readyCard.textContent).not.toContain('Ready');
    expect(readyCard.textContent).not.toContain('on this computer');
    expect(readyCard.textContent).not.toContain('git.door43.org');
    // …but a card that needs something still states it, with its citation.
    const problemCard = screen.getByTestId('preflight-translationNotes');
    expect(problemCard.textContent).toContain('No resources pinned');
  });

  it('a WARNED FALLBACK still names the resource the checks derive from, even though it is ready (D41/B20)', () => {
    // The substitute is local, so the state is 'ready' — but suppressing the
    // citation here would leave the user checking against English with only
    // the MISSING primary named. Both identities have to be visible.
    state = {
      ...baseState,
      preflight: {
        translationWords: { state: 'unpinned' },
        translationNotes: {
          state: 'ready',
          resolution: { pin: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89' }, rung: 'fallback', usedFallback: true },
          unavailablePrimary: { repoPath: 'git.door43.org/es-419_gl/es-419_tn', version: 'v66' },
        },
      },
    } as never;
    render(<App />);
    const card = screen.getByTestId('preflight-translationNotes');
    expect(card.textContent).toContain('git.door43.org/es-419_gl/es-419_tn'); // missing primary
    expect(card.textContent).toContain('git.door43.org/unfoldingWord/en_tn'); // what is actually used
    expect(card.textContent).toContain('English fallback');
  });

  it('a failed comprehension write surfaces on the GLOBAL save indicator with its own retry (B1/D65)', () => {
    state = { ...baseState, noteSaveState: 'error' } as never;
    render(<App />);
    const indicator = screen.getByTestId('save-indicator');
    expect(indicator.getAttribute('data-state')).toBe('error');
    expect(screen.getByTestId('retry-note-save')).toBeTruthy();
  });

  it("the indicator never claims Saved while the note scheduler holds work — the WORST of the two schedulers wins (Q2/D65)", () => {
    state = { ...baseState, noteSaveState: 'dirty' } as never;
    render(<App />);
    expect(screen.getByTestId('save-indicator').getAttribute('data-state')).toBe('dirty');
    cleanup();
    state = { ...baseState, noteSaveState: 'saving' } as never;
    render(<App />);
    expect(screen.getByTestId('save-indicator').getAttribute('data-state')).toBe('saving');
    cleanup();
    // and the verse scheduler's worse state wins symmetrically
    state = { ...baseState, noteSaveState: 'dirty', saveState: 'error' } as never;
    render(<App />);
    expect(screen.getByTestId('save-indicator').getAttribute('data-state')).toBe('error');
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
