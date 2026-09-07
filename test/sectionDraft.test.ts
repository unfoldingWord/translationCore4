// #141 — section drafting rules (src/views/sectionDraft.js): verse-number
// placement never loses or reorders text, a pin never passes another pin, and
// the section's first verse number is fixed.
import { describe, expect, it } from 'vitest';
import { canDrop, parseDraft, sectionVerses, serializeDraft, spanEnd } from '../src/views/sectionDraft.js';

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
    expect(parseDraft('', KEYS)).toEqual({ words: [], markers: {} });
    expect(parseDraft('  \n ', KEYS)).toEqual({ words: [], markers: {} });
  });

  it('bridged keys work as markers ("9-10")', () => {
    const d = parseDraft('9-10 Exhorta a los siervos', ['9-10']);
    expect(d.markers).toEqual({ '9-10': 0 });
    expect(d.words[0]).toBe('Exhorta');
  });
});

describe('#141 — serializeDraft / sectionVerses keep every word in order', () => {
  const words = ['a', 'b', 'c', 'd', 'e'];

  it('round-trips through Type-mode text', () => {
    const text = serializeDraft(words, { '3': 0, '4': 2, '5': 4 }, THREE);
    expect(text).toBe('3 a b\n4 c d\n5 e');
    expect(parseDraft(text, THREE)).toEqual({ words, markers: { '3': 0, '4': 2, '5': 4 } });
  });

  it('an unplaced verse gets no text; its words stay with the verse before it', () => {
    expect(sectionVerses(words, { '3': 0, '5': 3 }, THREE)).toEqual({ '3': 'a b c', '5': 'd e' });
    expect(serializeDraft(words, { '3': 0 }, THREE)).toBe('3 a b c d e');
  });

  it('the words of every placement concatenate back to the original list', () => {
    for (const markers of [{ '3': 0 }, { '3': 0, '4': 1 }, { '3': 0, '4': 1, '5': 2 }, { '3': 0, '5': 4 }]) {
      const verses = sectionVerses(words, markers, THREE);
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
