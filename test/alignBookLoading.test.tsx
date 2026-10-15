// @vitest-environment jsdom
// #722 (the J12 #258 journey failure): Align can open before the book text arrives. Since #679,
// openBook reads the book through the store queue, so a book switch waits for a
// checkpoint in flight, and s.bookRaw stays null for that time. The align
// session and the rail derive from s.bookRaw. When the text arrives, both must
// derive again; before this fix they kept "Nothing to align yet" and an empty rail.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const TIT = '\\id TIT\n\\c 1\n\\p\n\\v 1 Pablo, siervo de Dios\n';
const openAlign = vi.fn();
const loadAlignIndex = vi.fn();
const state = {
  project: { id: 'p1', repoPath: 'p1', flavor: 'textTranslation', scriptDirection: 'ltr' },
  book: 'tit',
  bookRaw: null as string | null,
  bookError: null as string | null,
  aligning: true,
  alignSession: null,
  alignVerse: null,
  alignIndex: null,
  alignSuggest: { status: 'off' },
  checkTool: null,
  preflight: null,
  projectPins: null,
  sources: {},
  sourcePanes: null,
};
const known: Record<string, unknown> = { openAlign, loadAlignIndex };
vi.mock('../src/state.jsx', () => ({
  useApp: () => ({ s: state, actions: new Proxy(known, { get: (o, k: string) => o[k] ?? (() => undefined) }) }),
  isOldTestament: () => false,
}));

const { default: Check } = await import('../src/views/Check.jsx');

afterEach(() => {
  cleanup();
  state.bookRaw = null;
  state.bookError = null;
});

describe('Align opened while the book is still loading', () => {
  it('opens the session and reads the rail again when the book text arrives', () => {
    const { rerender } = render(<Check />);
    const sessionOpens = openAlign.mock.calls.length;
    const railReads = loadAlignIndex.mock.calls.length;
    expect(sessionOpens).toBeGreaterThan(0);
    expect(railReads).toBeGreaterThan(0);

    state.bookRaw = TIT;
    rerender(<Check />);
    expect(openAlign.mock.calls.length).toBe(sessionOpens + 1);
    expect(loadAlignIndex.mock.calls.length).toBe(railReads + 1);
  });

  it('opens the session again when the book load fails, so the failure is stated (D30)', () => {
    const { rerender } = render(<Check />);
    const sessionOpens = openAlign.mock.calls.length;

    state.bookError = 'the project\'s journal holds no TIT';
    rerender(<Check />);
    expect(openAlign.mock.calls.length).toBe(sessionOpens + 1);
  });

  it('does not open the session again when bookError changes while the text is there', () => {
    state.bookRaw = TIT;
    const { rerender } = render(<Check />);
    const sessionOpens = openAlign.mock.calls.length;

    state.bookError = 'the project list could not be read'; // refreshProjects writes bookError too
    rerender(<Check />);
    expect(openAlign.mock.calls.length).toBe(sessionOpens);
  });
});
