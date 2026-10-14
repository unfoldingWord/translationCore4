// @vitest-environment jsdom
// The section editing card (#141) keeps its draft in its own state until Save.
// Five exits from Translate unmount the card and lose the typed text:
// - a chapter or a book in the rail: setChapter and openBook set
//   `editing: null` (state.jsx), so the card closes;
// - "Draft section" on another row: startSection opens that row's card in
//   place of this one;
// - a mode tab (Understand/Check): go(view) changes `view`, so App unmounts
//   Draft, and on return a new card opens from the stored verses;
// - the header's project button: backToProjects unmounts Draft too.
// The rule the app already has is the Section/Verse switch's (#238): the
// control is off while an editing card is open, and a press keeps the focus in
// the card. The exits now follow it. The translator saves or cancels first.
// The mock actions below apply the same patches as the real actions in
// state.jsx. sectionDraftLeaveProject.test.tsx uses the real provider.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const verse = { n: '1', drafted: true, para: true, text: 'Pablo, siervo de Dios', body: 'Pablo, siervo de Dios' };
const verse2 = { n: '2', drafted: false, para: false, text: '', body: '' };
const verse3 = { n: '3', drafted: false, para: false, text: '', body: '' };
// The source chunks chapter 1 as 1–2 | 3.
const CHUNKED = '\\id TIT\n\\c 1\n\\p\n\\v 1 a\n\\v 2 b\n\\ts\\*\n\\v 3 c\n\\c 2\n\\p\n\\v 1 c\n';
type Editing = { key: string; keys?: string[]; before?: string } | null;
const fresh = () => ({
  view: 'draft',
  book: 'TIT',
  chapter: 1,
  rail: true,
  editing: null as Editing,
  project: { id: 'p1', repoPath: 'p1', name: 'Equipo', languageTag: 'es-419', scriptDirection: 'ltr', textFont: null, bookCodes: ['TIT', 'PHM'], flavor: 'textTranslation' },
  progressByProject: {} as Record<string, object>,
  sourceTab: 'ult',
  sourcePanes: ['ult'],
  sources: { ult: { raw: CHUNKED, chapters: {}, version: 'v89' } },
  bookRaw: '',
  bookError: null,
  draftUnits: {} as Record<string, string>,
  understand: null,
  saveState: 'saved',
  helpsHover: null,
  helpsActive: null,
});
let state = fresh();
const bookModel = { code: 'TIT', chapterNums: [1, 2], draftPct: 50, byChapter: { '1': [verse, verse2, verse3], '2': [{ ...verse, text: 'c', body: 'c' }] } };
// The patches of the real actions (state.jsx): setChapter and openBook close
// the card (`editing: null`); go changes the view only.
const actions = {
  setChapter: vi.fn((chapter: number) => { state = { ...state, chapter, editing: null, helpsHover: null, helpsActive: null }; }),
  openBook: vi.fn((code: string) => { state = { ...state, book: code, chapter: 1, editing: null, helpsHover: null, helpsActive: null }; }),
  go: vi.fn((view: string) => { state = { ...state, view }; }),
  startSection: vi.fn((chapter: number, keys: string[]) => { state = { ...state, editing: { key: `${chapter}:s${keys[0]}`, keys } }; }),
  backToProjects: vi.fn(() => { state = { ...state, view: 'home', editing: null }; }),
  saveSection: vi.fn(),
  blurVerse: vi.fn(),
};

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({
    s: state,
    book: bookModel,
    sourceModel: null,
    actions: new Proxy(actions, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }),
  }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: [],
  SUITE_VERSION: 'v89',
  isOldTestament: () => false,
}));
// Only Translate is under test: the other views are placeholders.
vi.mock('../src/views/Understand.jsx', () => ({ default: () => <div data-testid="understand-view" /> }));
vi.mock('../src/views/Home.jsx', () => ({ default: () => <div data-testid="home-view" /> }));
vi.mock('../src/views/Check.jsx', () => ({ default: () => <div data-testid="check-view" /> }));

import App from '../src/App.jsx';

const TYPED = '1 texto que no se pierde';
const card = () => screen.queryByRole('textbox', { name: 'Section 1–2' }) as HTMLTextAreaElement | null;

/** Open the section card for 1–2 and type a draft in it. */
const typeDraft = () => {
  state.editing = { key: '1:s1', keys: ['1', '2'] };
  const view = render(<App />);
  fireEvent.change(card()!, { target: { value: TYPED } });
  return view;
};

/** Press an exit as a user does, then let the app render the result. */
const press = (el: HTMLElement, rerender: (ui: React.ReactElement) => void) => {
  fireEvent.pointerDown(el);
  fireEvent.click(el);
  rerender(<App />);
};

const chapter2 = () => screen.getByRole('button', { name: '2' });
const book = (name: RegExp) => screen.getByRole('button', { name });
const tab = (name: string) => screen.getByRole('tab', { name });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state = fresh();
});

describe('a typed section draft is not lost on an exit from Translate', () => {
  it('control: with no editing card, chapter, book and tab exits work', () => {
    const { rerender } = render(<App />);
    press(chapter2(), rerender);
    press(book(/Philemon/), rerender);
    press(screen.getByRole('button', { name: 'Draft section 3' }), rerender);
    // That opened a card: close it (as Cancel does) before the next exits.
    state = { ...state, editing: null };
    rerender(<App />);
    press(tab('Understand'), rerender);
    press(screen.getByTestId('project-switch'), rerender);
    expect(screen.getByTestId('home-view')).toBeTruthy();
    expect(actions.setChapter).toHaveBeenCalledWith(2);
    expect(actions.openBook).toHaveBeenCalledWith('PHM');
    expect(actions.go).toHaveBeenCalledWith('read');
    expect(actions.startSection).toHaveBeenCalledWith(1, ['3']);
  });

  it('chapter: the chapter button is off and the draft stays in the card', () => {
    const { rerender } = typeDraft();
    press(chapter2(), rerender);
    expect(card()?.value).toBe(TYPED);
    expect(actions.setChapter).not.toHaveBeenCalled();
    expect((chapter2() as HTMLButtonElement).disabled).toBe(true);
    expect(fireEvent.pointerDown(chapter2())).toBe(false);
  });

  it('book: the book button is off and the draft stays in the card', () => {
    const { rerender } = typeDraft();
    press(book(/Philemon/), rerender);
    expect(card()?.value).toBe(TYPED);
    expect(actions.openBook).not.toHaveBeenCalled();
    expect((book(/Philemon/) as HTMLButtonElement).disabled).toBe(true);
    expect(fireEvent.pointerDown(book(/Philemon/))).toBe(false);
  });

  it('mode tab: Understand and Check are off, and the draft stays after a return to Translate', () => {
    const { rerender } = typeDraft();
    for (const name of ['Understand', 'Check']) {
      press(tab(name), rerender);
      press(tab('Translate'), rerender);
      expect(card()?.value, name).toBe(TYPED);
    }
    expect(actions.go).not.toHaveBeenCalledWith('read');
    expect(actions.go).not.toHaveBeenCalledWith('check');
    for (const name of ['Understand', 'Check']) {
      expect((tab(name) as HTMLButtonElement).disabled, name).toBe(true);
      expect(fireEvent.pointerDown(tab(name)), name).toBe(false);
    }
  });

  it('project button: the header does not go to the projects while the card is open', () => {
    const { rerender } = typeDraft();
    press(screen.getByTestId('project-switch'), rerender);
    expect(screen.queryByTestId('home-view')).toBeNull();
    expect(card()?.value).toBe(TYPED);
    expect(actions.backToProjects).not.toHaveBeenCalled();
  });

  it('another section: its Draft section button is off and the draft stays in the card', () => {
    const { rerender } = typeDraft();
    const other = screen.getByRole('button', { name: 'Draft section 3' });
    press(other, rerender);
    expect(card()?.value).toBe(TYPED);
    expect(actions.startSection).not.toHaveBeenCalled();
    expect((other as HTMLButtonElement).disabled).toBe(true);
    expect(fireEvent.pointerDown(other)).toBe(false);
  });
});
