// #812, bench review of PR #810: an edit of en_ult 1 Samuel 2:2, whose body holds
// a blank line and a `\ts\*` between its poem lines, from the Verse card and from
// a Section save. The ways this can fail, written before the fix:
//   1. The card's second write starts from the book as it is, not as the card
//      opened, so a `\ts\*` left after the verse's last words is written twice,
//      or Cancel leaves it behind (the session contract, state.jsx startVerse).
//   2. A Section save trims each verse's text, so the blank lines left after its
//      last words are gone before they can take back their `\ts\*`: the
//      milestone is lost (Codex round 3 on 1ca28b7b1).
//   3. The blank line before a verse that starts a paragraph (its `\p` format)
//      is read as the verse before's break.
import { describe, expect, it } from 'vitest';
import { cancelVerse, openVerse, writeVerse } from '../src/data/usfm/verseEdit';
import { findVerse, indexBook } from '../src/data/usfm/indexer';
import { bodyToEditorText } from '../src/data/usfm/poemLines';
import { spliceVerseGap } from '../src/data/usfm/splice';
import { bookModel } from '../src/data/bookModel.js';
import { expandKeys, initialDraftText, parseDraft, sectionVerses } from '../src/views/sectionDraft.js';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const raw: string = fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/en_ult/1SA-2-812.usfm'), 'utf8');
const TS = '\\ts\\*';
const count = (s: string, needle: string) => s.split(needle).length - 1;

/** The editor text of 2:2 with every line after its last blank line taken away:
 * its blank line and its `\ts\*` are left after its last words. */
const cutAfterBreaks = (text: string) => {
  const lines = text.split('\n');
  return lines.slice(0, lines.lastIndexOf('') + 1).join('\n');
};

/** Where the `\ts\*` sits: after the end of 2:2's body and before 2:3's `\v`. */
const tsBetween22And23 = (book: string) => {
  const e = findVerse(indexBook(book), 2, '2')!;
  const v3 = book.indexOf('\\v 3 ', e.end);
  return count(book.slice(e.end, v3), TS);
};

describe('#812 — 1 Samuel 2:2: the `\\ts\\*` left after the verse\'s last words is kept once', () => {
  it('the fixture verse holds one `\\ts\\*` inside it', () => {
    const e = findVerse(indexBook(raw), 2, '2')!;
    expect(count(raw.slice(e.start, e.end), TS)).toBe(1);
  });

  it('the Verse card: two writes from the open session, then Cancel (way 1)', () => {
    const session = openVerse(raw, 2, '2');
    const text = bodyToEditorText(session.before);
    const cut = cutAfterBreaks(text);
    // The text after the breaks goes in two keystrokes: half of it, then the rest.
    const half = text.slice(0, cut.length + Math.floor((text.length - cut.length) / 2));
    let book = writeVerse(raw, session, 2, '2', half).raw;
    book = writeVerse(book, session, 2, '2', cut).raw;
    expect(count(book, TS)).toBe(count(raw, TS));
    expect(tsBetween22And23(book)).toBe(1);
    expect(cancelVerse(book, session, 2, '2').raw).toBe(raw);
  });

  // The app's section for 2:2 is 2:1-2 (the source's `\ts\*` grouping), so 2:2
  // is the section's last verse; 2:1-3 has a verse line after it.
  it.each([['2:1-2', 2], ['2:1-3', 3]])('a Section save of %s with that text cut keeps the `\\ts\\*` once, after 2:2 (ways 2, 3)', (_label, upTo) => {
    const verses = (bookModel(raw).byChapter['2'] as Array<{ n: string; body: string; format?: string }>).slice(0, upTo);
    const keys = verses.map((v) => v.n);
    const pins = expandKeys(keys);
    const text = initialDraftText(verses, pins);
    const v2 = bodyToEditorText(findVerse(indexBook(raw), 2, '2') ? raw.slice(findVerse(indexBook(raw), 2, '2')!.start, findVerse(indexBook(raw), 2, '2')!.end) : '');
    expect(text).toContain(v2.slice(0, 40));
    const edited = text.replace(v2, cutAfterBreaks(v2));
    expect(edited).not.toBe(text);
    const d = parseDraft(edited, pins);
    const texts = sectionVerses(d.words, d.seps, d.markers, pins, keys, d.blocks) as Record<string, string>;
    // As saveSection does: each changed verse through the one write, then the formats.
    let book = raw;
    for (const k of keys) {
      const stored = bodyToEditorText(raw.slice(findVerse(indexBook(raw), 2, k)!.start, findVerse(indexBook(raw), 2, k)!.end).trim());
      if ((texts[k] ?? '').trim() !== stored) book = writeVerse(book, null, 2, k, texts[k] ?? '').raw;
    }
    for (const v of verses.slice(1)) {
      const prev = keys[keys.indexOf(v.n) - 1];
      book = spliceVerseGap(book, 2, prev, (v.format as 'p' | 'q1' | 'q2' | undefined) ?? null);
    }
    expect(count(book, TS)).toBe(count(raw, TS));
    expect(tsBetween22And23(book)).toBe(1);
    // Verses 2:1 and 2:3 are written as they were.
    for (const k of ['1', '3']) {
      const a = findVerse(indexBook(raw), 2, k)!;
      const b = findVerse(indexBook(book), 2, k)!;
      expect(book.slice(b.start, b.end)).toBe(raw.slice(a.start, a.end));
    }
  });
});
