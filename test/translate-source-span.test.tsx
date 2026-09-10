// @vitest-environment jsdom
// #246: Translate shows source text for bridged verses in both directions.
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

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
const bookModel = { code: 'TIT', chapterNums: [1], byChapter: {} as Record<string, object[]> };
let sourceModel: Record<string, Record<string, { verseObjects: { type: string; text: string }[] }>> = { '1': {} };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({
    s: state,
    book: bookModel,
    sourceModel,
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
  bookModel.byChapter = {};
  sourceModel = { '1': {} };
});

describe('#246 — Translate shows source text for bridged verses', () => {
  it('a 1-2 target shows source verses 1 and 2', () => {
    bookModel.byChapter = {
      '1': [{ n: '1-2', drafted: true, para: true, text: 'x', body: 'x' }],
    };
    sourceModel = {
      '1': {
        '1': { verseObjects: [{ type: 'text', text: 'In the beginning' }] },
        '2': { verseObjects: [{ type: 'text', text: 'the earth was' }] },
      },
    };
    render(<Draft />);
    expect(screen.getByText(/In the beginning/)).toBeTruthy();
    expect(screen.getByText(/the earth was/)).toBeTruthy();
    const p = screen.getByText(/In the beginning/).closest('p')!;
    const sups = Array.from(p.querySelectorAll('sup')).map((el) => el.textContent);
    expect(sups).toEqual(['1', '2']);
    expect(screen.queryByText('source text loads with resources')).toBeNull();
  });

  it('targets 4 and 5 show the bridged source 4-5 once', () => {
    bookModel.byChapter = {
      '1': [
        { n: '4', drafted: true, para: true, text: 'x', body: 'x' },
        { n: '5', drafted: true, para: true, text: 'y', body: 'y' },
      ],
    };
    sourceModel = {
      '1': {
        '4-5': { verseObjects: [{ type: 'text', text: 'Bridged four five' }] },
      },
    };
    render(<Draft />);
    const matches = screen.getAllByText('Bridged four five');
    expect(matches.length).toBe(1);
    const p = matches[0].closest('p')!;
    const sups = Array.from(p.querySelectorAll('sup')).map((el) => el.textContent);
    expect(sups).toEqual(['4-5']);
    expect(screen.queryByText('source text loads with resources')).toBeNull();
  });
});
