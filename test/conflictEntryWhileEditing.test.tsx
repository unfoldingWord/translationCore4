// @vitest-environment jsdom
// #679, bench finding P1 (PR #687): opening the conflict review unmounts the
// section editing card, whose draft lives only in the card, so the typed text
// was lost. No exit from the card saves its draft; the rule the app already
// has is the Section/Verse switch's: off while an editing card is open (#238).
// The review entries follow it: the toolbar button and the verse markers are
// disabled, a press keeps the focus in the card, and the draft stays.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const verse = { n: '1', drafted: true, para: true, text: 'Pablo, siervo de Dios', body: 'Pablo, siervo de Dios' };
const verse2 = { n: '2', drafted: false, para: false, text: '', body: '' };
const verse3 = { n: '3', drafted: false, para: false, text: '', body: '' };
// The source chunks the chapter 1–2 | 3.
const CHUNKED = '\\id TIT\n\\c 1\n\\p\n\\v 1 a\n\\v 2 b\n\\ts\\*\n\\v 3 c\n';
const CONFLICT = {
  key: 'text|TIT|1:1', book: 'TIT', chapter: '1', verse: '1',
  versions: [
    { ts: '2026-10-13T10:00:00.000Z|0000|a', actor: 'a', text: 'uno\n', provisional: false },
    { ts: '2026-10-13T10:01:00.000Z|0000|b', actor: 'b', text: 'dos\n', provisional: true },
  ],
};
const state = {
  chapter: 1,
  rail: false,
  editing: null as { key: string; keys?: string[] } | null,
  project: { id: 'p1', name: 'Equipo', languageTag: 'es-419', scriptDirection: 'ltr', textFont: null },
  sourceTab: 'ult',
  sourcePanes: ['ult'],
  sources: { ult: { raw: CHUNKED, chapters: {}, version: 'v89' } },
  bookRaw: '',
  bookError: null,
  draftUnits: {} as Record<string, string>,
  understand: null,
  verseConflicts: [CONFLICT],
  conflictReview: null,
};
const bookModel = { code: 'TIT', chapterNums: [1], byChapter: { '1': [verse, verse2, verse3] } };
const actions = { openConflictReview: vi.fn(), startSection: vi.fn(), saveSection: vi.fn(), blurVerse: vi.fn() };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({
    s: state,
    book: bookModel,
    sourceModel: null,
    actions: new Proxy(actions, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }),
  }),
  isOldTestament: () => false,
}));

import Draft from '../src/views/Draft.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.editing = null;
});

describe('#679 the review does not open over an editing card', () => {
  it('control: with no editing card, the toolbar button and the marker open the review', () => {
    render(<Draft />);
    fireEvent.click(screen.getByTestId('conflicts-review'));
    fireEvent.click(screen.getByTestId('conflict-marker-1:1'));
    expect(actions.openConflictReview.mock.calls).toEqual([[], ['text|TIT|1:1']]);
  });

  it('with a section draft typed, the toolbar button and the marker are off, and the draft stays in the card', () => {
    state.editing = { key: '1:s3', keys: ['3'] };
    render(<Draft />);
    const card = screen.getByRole('textbox', { name: 'Section 3' }) as HTMLTextAreaElement;
    fireEvent.change(card, { target: { value: 'texto que no se pierde' } });
    for (const id of ['conflicts-review', 'conflict-marker-1:1']) {
      const entry = screen.getByTestId(id) as HTMLButtonElement;
      expect(entry.disabled, id).toBe(true);
      // A press keeps the focus in the card: the pointerdown is default-prevented.
      expect(fireEvent.pointerDown(entry), id).toBe(false);
      fireEvent.click(entry);
    }
    expect(actions.openConflictReview).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Section 3' }) as HTMLTextAreaElement).value).toBe('texto que no se pierde');
  });
});
