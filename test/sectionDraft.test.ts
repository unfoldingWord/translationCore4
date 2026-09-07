// #141 — section drafting rules (src/views/sectionDraft.js): verse-number
// placement never loses or reorders text, a pin never passes another pin, and
// the section's first verse number is fixed.
import { describe, expect, it } from 'vitest';
import { canDrop, initialDraftText, parseDraft, sectionVerses, serializeDraft, spanEnd } from '../src/views/sectionDraft.js';

const KEYS = ['9', '10'];
const THREE = ['3', '4', '5'];

describe('#141 — parseDraft', () => {
  it('typed straight through: every word belongs to the first verse, which is fixed at word 0', () => {
    const d = parseDraft('Exhorta a los siervos a que se sujeten', KEYS);
    expect(d.words).toEqual(['Exhorta', 'a', 'los', 'siervos', 'a', 'que', 'se', 'sujeten']);
    expect(d.markers).toEqual({ '9': 0 });
  });

  it('a line that starts with a section verse key begins that verse', () => {
    const d = parseDraft('9 Exhorta a los siervos\n10 no defraudando', KEYS);
    expect(d.markers).toEqual({ '9': 0, '10': 4 });
    expect(d.words).toHaveLength(6);
  });

  it('a number that is not one of the section keys is text, not a marker', () => {
    const d = parseDraft('9 Exhorta\n12 talentos', KEYS);
    expect(d.words).toEqual(['Exhorta', '12', 'talentos']);
    expect(d.markers).toEqual({ '9': 0 });
  });

  it('the first verse is pinned at 0 even when text precedes its line; out-of-order pins return to the bank', () => {
    const d = parseDraft('antes\n9 Exhorta\n10 no', KEYS);
    expect(d.markers['9']).toBe(0);
    expect(d.markers['10']).toBe(2);
    const out = parseDraft('10 aaa\n9 bbb', KEYS);
    expect(out.words).toEqual(['aaa', 'bbb']);
    expect(out.markers).toEqual({ '9': 0 }); // 10 at 0 would tie the fixed first pin: unplaced
  });

  it('an empty section has no words and no markers', () => {
    expect(parseDraft('', KEYS)).toEqual({ words: [], seps: [], markers: {} });
    expect(parseDraft('  \n ', KEYS)).toEqual({ words: [], seps: [], markers: {} });
  });

  it('a stub verse before a drafted one keeps the text with ITS OWN verse (Codex round 1)', () => {
    // The card writes an empty numbered line for an undrafted verse; without
    // it verse 10's words would be saved as verse 9's.
    const d = parseDraft('9 \n10 no defraudando', KEYS);
    expect(d.markers).toEqual({ '9': 0, '10': 0 });
    expect(sectionVerses(d.words, d.seps, d.markers, KEYS)).toEqual({ '10': 'no defraudando' });
  });

  it('bridged keys work as markers ("9-10")', () => {
    const d = parseDraft('9-10 Exhorta a los siervos', ['9-10']);
    expect(d.markers).toEqual({ '9-10': 0 });
    expect(d.words[0]).toBe('Exhorta');
  });

  it('every separator inside a verse survives the round trip — a save must not rewrite untouched text (Codex round 1)', () => {
    // A verse body may hold a line break or a non-breaking space (the indexer
    // permits multiline bodies); rebuilding it with ASCII spaces would write
    // every other verse of the section back changed.
    const body9 = 'l\u00ednea uno\nl\u00ednea dos';
    const body10 = 'no\u00a0defraudando';
    const d = parseDraft(`9 ${body9}\n10 ${body10}`, KEYS);
    expect(sectionVerses(d.words, d.seps, d.markers, KEYS)).toEqual({ '9': body9, '10': body10 });
  });
});

describe('#141 — serializeDraft / sectionVerses keep every word in order', () => {
  const words = ['a', 'b', 'c', 'd', 'e'];
  const seps = [' ', ' ', ' ', ' ', ''];

  it('round-trips through Type-mode text', () => {
    const markers = { '3': 0, '4': 2, '5': 4 };
    const text = serializeDraft(words, seps, markers, THREE);
    expect(text).toBe('3 a b\n4 c d\n5 e');
    const back = parseDraft(text, THREE);
    expect(back.words).toEqual(words);
    expect(back.markers).toEqual(markers);
    // The line breaks the serializer wrote are separators, not lost bytes.
    expect(back.seps).toEqual([' ', '\n', ' ', '\n', '']);
    expect(serializeDraft(back.words, back.seps, back.markers, THREE)).toBe(text);
  });

  it('an unplaced verse gets no text; its words stay with the verse before it', () => {
    expect(sectionVerses(words, seps, { '3': 0, '5': 3 }, THREE)).toEqual({ '3': 'a b c', '5': 'd e' });
    expect(serializeDraft(words, seps, { '3': 0 }, THREE)).toBe('3 a b c d e');
  });

  it('the words of every placement concatenate back to the original list', () => {
    for (const markers of [{ '3': 0 }, { '3': 0, '4': 1 }, { '3': 0, '4': 1, '5': 2 }, { '3': 0, '5': 4 }]) {
      const verses = sectionVerses(words, seps, markers, THREE);
      expect(Object.values(verses).join(' ').split(' ')).toEqual(words);
    }
  });
});

describe('#141 — canDrop: a pin never passes another pin; the first is fixed', () => {
  const markers = { '3': 0, '4': 2, '5': 4 };

  it('the first verse cannot be moved anywhere', () => {
    expect(canDrop(markers, THREE, '3', 1)).toBe(false);
    expect(canDrop(markers, THREE, '3', 0)).toBe(false);
  });

  it('a middle pin may move only strictly between its neighbours', () => {
    expect(canDrop(markers, THREE, '4', 1)).toBe(true);
    expect(canDrop(markers, THREE, '4', 3)).toBe(true);
    expect(canDrop(markers, THREE, '4', 0)).toBe(false); // on the fixed first pin
    expect(canDrop(markers, THREE, '4', 4)).toBe(false); // on verse 5's pin
    expect(canDrop(markers, THREE, '4', 5)).toBe(false); // past verse 5
  });

  it('the last pin may move anywhere after the pin before it', () => {
    expect(canDrop(markers, THREE, '5', 3)).toBe(true);
    expect(canDrop(markers, THREE, '5', 9)).toBe(true);
    expect(canDrop(markers, THREE, '5', 2)).toBe(false);
    expect(canDrop(markers, THREE, '5', 1)).toBe(false);
  });

  it('an unplaced pin obeys the same order against the placed ones', () => {
    expect(canDrop({ '3': 0, '5': 4 }, THREE, '4', 2)).toBe(true);
    expect(canDrop({ '3': 0, '5': 4 }, THREE, '4', 4)).toBe(false);
    expect(canDrop({ '3': 0, '5': 4 }, THREE, '4', 6)).toBe(false);
    expect(canDrop({ '3': 0, '4': 2 }, THREE, '5', 2)).toBe(false);
    expect(canDrop({ '3': 0, '4': 2 }, THREE, '5', 3)).toBe(true);
  });

  it('a pin unknown to the section cannot be dropped', () => {
    expect(canDrop(markers, THREE, '7', 1)).toBe(false);
  });
});

describe('#141 — spanEnd', () => {
  it('a verse runs to the next pin after it, the held pin ignored', () => {
    const markers = { '3': 0, '4': 2, '5': 4 };
    expect(spanEnd(markers, 0, null, 6)).toBe(2);
    expect(spanEnd(markers, 1, '4', 6)).toBe(4);
    expect(spanEnd(markers, 4, null, 6)).toBe(6);
  });
});

describe('#141 — a verse body that wraps onto a marker-shaped line (Codex round 2)', () => {
  // Verse 9 wraps, and its second line begins with the number 10 — which is
  // also this section's next verse key. Reading it as a marker would move
  // "talentos" into verse 10 and rewrite verse 9, which nobody edited.
  const verses = [
    { n: '9', drafted: true, body: 'y le dio\n10 talentos' },
    { n: '10', drafted: true, body: 'no defraudando' },
  ];

  it('the card writes that line escaped, and the parse gives every verse its own words back', () => {
    const text = initialDraftText(verses, KEYS);
    expect(text).toBe('9 y le dio\n 10 talentos\n10 no defraudando');
    const d = parseDraft(text, KEYS);
    expect(sectionVerses(d.words, d.seps, d.markers, KEYS)).toEqual({
      '9': 'y le dio\n10 talentos',
      '10': 'no defraudando',
    });
  });

  it('the escape survives a Type → Place → Type round trip', () => {
    const d = parseDraft(initialDraftText(verses, KEYS), KEYS);
    const back = serializeDraft(d.words, d.seps, d.markers, KEYS);
    expect(back).toBe('9 y le dio\n 10 talentos\n10 no defraudando');
    const again = parseDraft(back, KEYS);
    expect(sectionVerses(again.words, again.seps, again.markers, KEYS)).toEqual({
      '9': 'y le dio\n10 talentos',
      '10': 'no defraudando',
    });
  });

  it('a number that is not one of the section keys needs no escape (the negative control)', () => {
    const other = [{ n: '9', drafted: true, body: 'y le dio\n12 talentos' }, verses[1]];
    expect(initialDraftText(other, KEYS)).toBe('9 y le dio\n12 talentos\n10 no defraudando');
    const d = parseDraft(initialDraftText(other, KEYS), KEYS);
    expect(sectionVerses(d.words, d.seps, d.markers, KEYS)).toEqual({
      '9': 'y le dio\n12 talentos',
      '10': 'no defraudando',
    });
  });

  it('a section with no draft opens empty', () => {
    expect(initialDraftText([{ n: '9', drafted: false, body: '' }, { n: '10', drafted: false, body: '' }], KEYS)).toBe('');
  });
});
