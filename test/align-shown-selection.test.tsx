// @vitest-environment jsdom
// #788: the bank shows a selection (the armed words minus the words a standing
// suggestion moved onto a card, #736). The cards and a card click must use that
// same shown selection: a click places only the words the bank shows as
// selected, and no card looks armed when no bank word is. A drag already
// carried the shown selection; a click and a drag now place the same words.
//
// The view runs for real. The store is a mock that records each action and, for
// `placeAlignWordsAt`, repeats what the real action does (state.jsx
// `placeAlignWordsAt` -> `applyAlignEdit(..., disarm = true)`) with the real
// pure record functions. Real inputs: the conformance sample-burrito TIT 1:1
// record and draft text.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { finalizeEdit, linkWord } from '../src/data/align/edit';
import { verseWords } from '../src/data/align/verseWords.mjs';
import { verseTextMd5 } from '../src/data/journal/runtime';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const ROOT = process.cwd();
const FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'conformance/sample-burrito/ingredients/checking/alignments/TIT.json'), 'utf8'));
const RECORD = FILE.chapters['1']['1'];
const USFM = fs.readFileSync(path.join(ROOT, 'conformance/sample-burrito/ingredients/TIT.usfm'), 'utf8');
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/en.json'), 'utf8'));
const HINT_IDLE: string = EN['align.hintIdle'];
const HINT_ARMED: string = EN['align.hintArmed'];
const TEXT = /\\v 1 (.*)/.exec(USFM)![1].trim();
// The hash the app stamps: the export's own hash of the stored verse (#795); the sample record carries the same one.
const MD5 = verseTextMd5(TEXT);

type W = { word: string; occurrence: number; occurrences: number };
type Card = { topWords: W[]; bottomWords: W[] };
const bankWord = (word: string): W => RECORD.wordBank.find((w: W) => w.word === word);
const ESCOGIDOS = bankWord('escogidos');
const FE = bankWord('fe');
// The engine proposes "escogidos" for the ἐκλεκτῶν card (index 8 in the record).
const SUGGESTION = { cardIndex: 8, source: { word: 'ἐκλεκτῶν', occurrence: 1 }, word: ESCOGIDOS, confidence: 0.9 };

const calls: Array<[string, unknown[]]> = [];
const spy = (name: string) => (...args: unknown[]) => { calls.push([name, args]); };
const session = (armed: W[] | null, suggestions: unknown[] | null) => ({
  loading: false, ref: '1:1', book: 'tit', record: RECORD, origObjects: [],
  stale: false, armed, suggestions, testament: 'nt', targetDir: 'ltr', origDir: 'ltr', seq: 1,
});
const state: Record<string, unknown> = {
  project: { id: 'p1', repoPath: 'p1', flavor: 'textTranslation', scriptDirection: 'ltr' },
  book: 'tit', bookRaw: USFM, bookError: null, aligning: true, alignVerse: '1:1', alignIndex: null,
  alignSuggest: { status: 'ready', verses: 12, boosted: true, testament: 'nt' }, alignSuggestions: { p1: true },
  projectPins: null, sources: {}, sourcePanes: null, alignSession: null,
};
const known: Record<string, unknown> = {
  // The real action places the words and disarms in one edit.
  placeAlignWordsAt: (cardIndex: number, words: W[]) => {
    calls.push(['placeAlignWordsAt', [cardIndex, words]]);
    const a = state.alignSession as ReturnType<typeof session>;
    const next = words.reduce((r, w) => linkWord(r, cardIndex, w), a.record);
    const record = finalizeEdit(next, verseWords(TEXT), MD5);
    state.alignSession = { ...a, record, armed: null };
  },
};
vi.mock('../src/state.jsx', () => ({
  // Any other action is recorded by name, so a click on a card that still
  // reached the old `placeAlignWord` would show in `calls`.
  useApp: () => ({ s: state, actions: new Proxy(known, { get: (o, k: string) => o[k] ?? spy(k) }) }),
  isOldTestament: () => false,
}));
const { default: Align } = await import('../src/views/Align.jsx');

const dt = () => {
  const store: Record<string, string> = {};
  return { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '', store };
};
const placements = () => calls.filter(([name]) => name.startsWith('place'));
const wordsOf = (ws: W[]) => ws.map((w) => w.word);
const cardsEl = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-testid^="align-card-"]')];
const armedChips = (root: HTMLElement) => [...root.querySelectorAll('[data-testid="align-bank"] [data-armed="1"]')].map((e) => e.getAttribute('data-word'));
// The hint every bank chip carries: it must follow the shown selection, not the raw armed list.
const chipTitles = (root: HTMLElement) => [...new Set([...root.querySelectorAll('[data-testid="align-bank"] button')].map((e) => e.getAttribute('title')))];

afterEach(() => { cleanup(); calls.length = 0; });

describe('#788: a card click places the shown selection', () => {
  it('B1: the only selected word is on a card as a suggestion: no bank chip is armed, no card is armed, a click places nothing', () => {
    state.alignSession = session([ESCOGIDOS], [SUGGESTION]);
    const { getByTestId, container } = render(<Align embedded />);
    expect(getByTestId('align-bank').querySelector('[data-word="escogidos"]')).toBeNull();
    expect(armedChips(container)).toEqual([]);
    // Every chip shows the idle hint: no card accepts a click, so none may say "click the card".
    expect(HINT_IDLE).not.toBe(HINT_ARMED);
    expect(chipTitles(container)).toEqual([HINT_IDLE]);
    // No card shows the armed state (pointer cursor, armed border).
    for (const card of cardsEl(container)) {
      expect(card.style.cursor, card.dataset.testid).toBe('');
      expect(card.style.borderColor, card.dataset.testid).not.toContain('rgba');
    }
    fireEvent.click(getByTestId('align-card-0'));
    fireEvent.click(getByTestId('align-card-4'));
    expect(placements()).toEqual([]);
  });

  it('B1: a suggestion moved one of two selected words: a click places only the word the bank shows', () => {
    state.alignSession = session([ESCOGIDOS, FE], [SUGGESTION]);
    const { getByTestId, container } = render(<Align embedded />);
    expect(armedChips(container)).toEqual(['fe']);
    expect(chipTitles(container)).toEqual([HINT_ARMED]);
    fireEvent.click(getByTestId('align-card-0'));
    expect(placements().map(([name, args]) => [name, (args[0] as number), wordsOf(args[1] as W[])])).toEqual([['placeAlignWordsAt', 0, ['fe']]]);
    const record = (state.alignSession as ReturnType<typeof session>).record;
    expect(record.alignments[0].bottomWords.map((w: W) => w.word)).toEqual(['Pablo', 'fe']);
    // escogidos stays in the record's bank, still proposed for its own card.
    expect(record.wordBank.some((w: W) => w.word === 'escogidos')).toBe(true);
  });

  it('B2: a drag and a card click with the same visible selection place the same words', () => {
    for (const suggestions of [[SUGGESTION], null]) {
      state.alignSession = session([ESCOGIDOS, FE], suggestions);
      const { getByTestId, container, unmount } = render(<Align embedded />);
      const shown = armedChips(container);
      expect(shown).toEqual(suggestions ? ['fe'] : ['fe', 'escogidos']);

      const d = dt();
      fireEvent.dragStart(getByTestId('align-bank').querySelector('[data-word="fe"]')!, { dataTransfer: d });
      fireEvent.drop(getByTestId('align-card-4'), { dataTransfer: d });
      const dragged = placements().pop()!;
      expect(dragged[0]).toBe('placeAlignWordsAt');
      expect(wordsOf(dragged[1][1] as W[])).toEqual(shown);

      // The drag disarmed the selection (the real action does); select again, then click.
      unmount();
      calls.length = 0;
      state.alignSession = session([ESCOGIDOS, FE], suggestions);
      const second = render(<Align embedded />);
      fireEvent.click(second.getByTestId('align-card-4'));
      const clicked = placements().pop()!;
      expect(clicked[0]).toBe('placeAlignWordsAt');
      expect(clicked[1]).toEqual(dragged[1]);
      second.unmount();
      calls.length = 0;
    }
  });

  it('B3: a normal selection with no suggestion places the same words as the raw armed list did, and the selection clears', () => {
    const armed = [FE, ESCOGIDOS];
    const s = session(armed, null);
    state.alignSession = s;
    const { getByTestId, container, rerender } = render(<Align embedded />);
    expect(armedChips(container)).toEqual(['fe', 'escogidos']);
    expect(chipTitles(container)).toEqual([HINT_ARMED]);
    for (const card of cardsEl(container)) {
      expect(card.style.cursor).toBe('pointer');
      expect(card.style.borderColor).toContain('rgba'); // the armed border: the B1 check can fire
    }

    fireEvent.click(getByTestId('align-card-4'));
    expect(placements().map(([name, args]) => [name, args[0], wordsOf(args[1] as W[])])).toEqual([['placeAlignWordsAt', 4, ['fe', 'escogidos']]]);
    // The record is what the old click path (linkWord over the raw armed list) wrote.
    const old = finalizeEdit(armed.reduce((r, w) => linkWord(r, 4, w), RECORD), verseWords(TEXT), MD5);
    const after = state.alignSession as ReturnType<typeof session>;
    expect(after.record).toEqual(old);
    expect((after.record.alignments[4] as Card).bottomWords.map((w) => w.word)).toEqual(['fe', 'escogidos']);
    // The selection cleared: no chip is armed and no card is armed.
    expect(after.armed).toBeNull();
    rerender(<Align embedded />);
    expect(armedChips(container)).toEqual([]);
    expect(chipTitles(container)).toEqual([HINT_IDLE]);
    for (const card of cardsEl(container)) expect(card.style.cursor).toBe('');
  });
});
