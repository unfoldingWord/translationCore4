// #736 — the word-bank selection: plain click, Ctrl/Cmd toggle, Shift range in
// bank order (Birch, Q1), discontiguous words (Q2). The bank passed in is the
// shown bank; `shownSelection` keeps only the selected words it shows.
import { describe, expect, it } from 'vitest';
import { nextSelection, shownSelection } from '../src/views/Align.jsx';

const W = (word: string, occurrence = 1) => ({ word, occurrence, occurrences: 1 });
const BANK = ['de', 'y', 'según', 'la', 'fe', 'los'].map((w) => W(w));
const words = (sel: Array<{ word: string }> | null) => sel?.map((w) => w.word) ?? null;
const click = (armed: ReturnType<typeof W>[], i: number, mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) =>
  words(nextSelection(BANK, shownSelection(BANK, armed), mods, i));

describe('#736 nextSelection — the bank selection after a click', () => {
  it('a plain click selects that word alone, and clears it when it is the only one', () => {
    expect(click([], 2)).toEqual(['según']);
    expect(click([W('de'), W('fe')], 2)).toEqual(['según']);
    expect(click([W('según')], 2)).toBeNull();
  });

  it('Ctrl or Cmd adds a word or takes it out, keeping bank order', () => {
    expect(click([W('fe')], 0, { ctrlKey: true })).toEqual(['de', 'fe']);
    expect(click([W('de'), W('fe')], 0, { metaKey: true })).toEqual(['fe']);
  });

  it('Shift adds the range from the first selected word, in bank order, either direction', () => {
    expect(click([W('y')], 4, { shiftKey: true })).toEqual(['y', 'según', 'la', 'fe']);
    expect(click([W('fe')], 1, { shiftKey: true })).toEqual(['y', 'según', 'la', 'fe']);
    expect(click([], 3, { shiftKey: true })).toEqual(['la']);
  });

  it('a selected word the bank no longer shows (now a suggestion) does not break Shift', () => {
    // "escogidos" was selected, then proposed on a card: it left the shown bank.
    expect(click([W('escogidos')], 3, { shiftKey: true })).toEqual(['la']);
    expect(click([W('escogidos'), W('y')], 3, { shiftKey: true })).toEqual(['y', 'según', 'la']);
  });

  it('repeated words are told apart by occurrence', () => {
    const bank = [W('de', 1), W('y'), W('de', 2)];
    expect(words(nextSelection(bank, shownSelection(bank, [W('de', 1)]), { ctrlKey: true }, 2))).toEqual(['de', 'de']);
    expect(shownSelection(bank, [W('de', 2)]).map((w: { occurrence: number }) => w.occurrence)).toEqual([2]);
  });
});
