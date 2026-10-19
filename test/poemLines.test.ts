// #786: a poetry verse spans several lines (`\q1 \v 15 …` / `\q2 …`). The
// editors show its inner poem lines with leading tabs, as the section editor
// shows `\q1`/`\q2` verse lines (#54). The ways this can fail, written before
// the code:
//   1. A verse opened and saved with no change is not byte-identical (LF, CRLF).
//   2. A tab line is written to the file as a literal tab, not as its marker.
//   3. The first line of the body gets a marker: it already has the verse's own.
//   4. The spaces after a marker, or inside a line, are lost.
//   5. A line with no tabs gets a marker (a typed line break is only a break).
//   6. A CRLF file gets LF inner lines after an edit.
// Found by the review of PR #810, written before the fix:
//   7. The editor saves on every keystroke, and the next one splices the range
//      the index reads back. A line written that the index does not read as
//      part of the verse (an emptied tab line `\q2 `, a space after the tabs
//      `\q2  x`, a blank first line, a blank last line) shortens that range,
//      and the next keystroke leaves old lines after the verse.
// #812, written before the fix:
//   8. A break inside a verse (`\ts\*`, `\p`, `\m`, `\pi1`, `\b`) shows as a
//      blank line, and the save does not give it back its own marker: a
//      `\ts\*` comes back as `\p`, or a blank line gets no marker at all.
//   9. A heading or a paragraph line with text (`\s1 …`, `\pmo …`) is changed
//      or lost; a `\q3` line comes back as `\q2`.
import { describe, expect, it } from 'vitest';
import { bodyToEditorText, editorTextToBody } from '../src/data/usfm/poemLines';
import { indexBook, findVerse } from '../src/data/usfm/indexer';
import { spliceVerse, verseBody } from '../src/data/usfm/splice';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const FIXTURES = ['en_ult/GEN-773', 'en_ult/PSA-3', 'en_ult/1SA-2-812', 'en_ult/REV-7-812', 'en_ult/PSA-9-812', 'en_ult/MAT-27-812', 'en_ust/GEN-29-812'];

describe('#786 poem lines: body <-> editor text', () => {
  const body = 'I will also put hostility\n\\q2 between you and the woman,\n\\q1 and between your offspring.';

  it('shows \\q1 lines with one tab and \\q2 lines with two', () => {
    expect(bodyToEditorText(body)).toBe('I will also put hostility\n\t\tbetween you and the woman,\n\tand between your offspring.');
  });

  it('writes the tabs back as the markers, and an unchanged verse is byte-identical (ways 1, 2, 4)', () => {
    expect(editorTextToBody(bodyToEditorText(body), '\n', body)).toBe(body);
    const spaced = 'a\n\\q2 two  spaces\tand a tab \n\\q1 b';
    expect(editorTextToBody(bodyToEditorText(spaced), '\n', spaced)).toBe(spaced);
  });

  it('every verse body of the fixtures round-trips byte for byte (ways 1, 8, 9)', () => {
    for (const file of FIXTURES) {
      const raw = read(`test/fixtures/${file}.usfm`);
      for (const e of indexBook(raw)) {
        const b = raw.slice(e.start, e.end);
        expect(editorTextToBody(bodyToEditorText(b), '\n', b), `${file} ${e.chapter}:${e.verseKey}`).toBe(b);
      }
    }
  });

  it('never puts a marker on the first line, nor on a line with no tabs (ways 3, 5)', () => {
    expect(editorTextToBody('\tfirst\nplain break\n\tpoem', '\n')).toBe('\tfirst\nplain break\n\\q1 poem');
  });

  it('a CRLF verse keeps CRLF on every line, also after an edit (way 6)', () => {
    const crlf = 'one\r\n\\q2 two\r\n\\ts\\*\r\n\\q1 three';
    const text = bodyToEditorText(crlf);
    expect(text).toBe('one\n\t\ttwo\n\n\tthree');
    expect(editorTextToBody(text, '\r\n', crlf)).toBe(crlf);
    expect(editorTextToBody(text.replace('two', 'dos'), '\r\n', crlf)).toBe('one\r\n\\q2 dos\r\n\\ts\\*\r\n\\q1 three');
  });

  it('a bare \\q shows as one tab, like \\q1', () => {
    expect(bodyToEditorText('a\n\\q b')).toBe('a\n\tb');
  });
});

describe('#812 breaks, headings and \\q3 inside a verse', () => {
  const body = 'saying,\n\\pi1\nAmen! Praise\n\\ts\\*\n\\m\nand glory.\n\\q3 deeper\n\\s1 A heading\n\\pmo “Quoted”';

  it('a break shows as a blank line, \\q3 as three tabs, a heading or a paragraph line with text as it is', () => {
    expect(bodyToEditorText(body)).toBe('saying,\n\nAmen! Praise\n\n\nand glory.\n\t\t\tdeeper\n\\s1 A heading\n\\pmo “Quoted”');
  });

  it('each blank line takes back the break it had, in order (way 8)', () => {
    const text = bodyToEditorText(body).replace('Amen! Praise', 'Amén, alabanza');
    expect(editorTextToBody(text, '\n', body)).toBe(body.replace('Amen! Praise', 'Amén, alabanza'));
  });

  it('a new blank line is a \\p; one taken away gives its break to the next blank line', () => {
    expect(editorTextToBody('one\n\ntwo', '\n', 'one')).toBe('one\n\\p\ntwo');
    expect(editorTextToBody('one\n\ntwo', '\n', 'one\n\\ts\\*\ntwo\n\\b\nthree')).toBe('one\n\\ts\\*\ntwo');
  });

  it('a \\q3 line keeps its level (way 9)', () => {
    expect(editorTextToBody('a\n\t\t\tdeeper', '\n')).toBe('a\n\\q3 deeper');
  });
});

// Way 7. editVerse's write, as the Verse editor calls it on every keystroke:
// the breaks come from the verse as it was when the editor opened.
const keystroke = (book: string, chapter: string, key: string, text: string, opened: string): string =>
  spliceVerse(book, chapter, key, text.trim() === '' ? '___' : editorTextToBody(text, '\n', opened));

/** Every editor text on the way from `from`: one character off the end at a
 * time, the way Backspace takes a line away. */
const backspaces = (from: string, upTo: number): string[] => {
  const out: string[] = [];
  for (let i = from.length - 1; i >= upTo; i--) out.push(from.slice(0, i) + from.slice(from.length));
  return out;
};

const keystrokeSuite = (file: string, chapter: string, verse: string, lineToEdit: RegExp) =>
  describe(`#786/#812 way 7 — every keystroke leaves the file holding exactly the verse (${file} ${chapter}:${verse})`, () => {
    const raw = read(`test/fixtures/${file}.usfm`);
    const e = findVerse(indexBook(raw), chapter, verse)!;
    const opened = raw.slice(e.start, e.end);
    const outside = (book: string) => {
      const f = findVerse(indexBook(book), chapter, verse)!;
      return [book.slice(0, f.start), book.slice(f.end)];
    };
    const start = bodyToEditorText(opened);
    const lines = start.split('\n');

    /** Type each text in turn; after each one the index reads back exactly the
     * body written, and every byte outside the verse is the original's. */
    const typeAll = (texts: string[]) => {
      let book = raw;
      for (const text of texts) {
        book = keystroke(book, chapter, verse, text, opened);
        const written = text.trim() === '' ? '___' : editorTextToBody(text, '\n', opened);
        expect(verseBody(book, chapter, verse), JSON.stringify(text)).toBe(written);
        expect(outside(book), JSON.stringify(text)).toEqual([raw.slice(0, e.start), raw.slice(e.end)]);
      }
      return book;
    };

    // The first line of the kind to edit that has a line after it.
    const k = lines.findIndex((l, i) => i > 0 && lineToEdit.test(l) && i < lines.length - 1);

    it('the fixture verse has that line to edit', () => {
      expect(k).toBeGreaterThan(0);
    });

    it('Backspace through that line and its line break', () => {
      const head = lines.slice(0, k).join('\n');
      const tail = lines.slice(k + 1).join('\n');
      const steps: string[] = [];
      for (let n = lines[k].length; n >= 0; n--) steps.push(`${head}\n${lines[k].slice(0, n)}\n${tail}`);
      steps.push(`${head}\n${tail}`);
      typeAll(steps);
    });

    it('a space typed at the start of that line, after any tabs, then more text', () => {
      const at = lines.slice(0, k).join('\n').length + 1 + (/^\t*/.exec(lines[k])![0].length);
      typeAll([`${start.slice(0, at)} ${start.slice(at)}`, `${start.slice(0, at)} x${start.slice(at)}`]);
    });

    it('the first line emptied, then typed again', () => {
      const rest = start.slice(lines[0].length);
      typeAll([...backspaces(lines[0], 0).map((l) => l + rest), `N${rest}`]);
    });

    it('the last line taken away to its line break, then the verse typed again', () => {
      const last = start.lastIndexOf('\n');
      typeAll(backspaces(start, last));
      const book = typeAll([start.slice(0, last), start]);
      expect(book).toBe(raw);
    });

    it('Cancel after those keystrokes restores the file byte for byte', () => {
      let book = raw;
      for (const text of backspaces(start, start.lastIndexOf('\n'))) book = keystroke(book, chapter, verse, text, opened);
      expect(spliceVerse(book, chapter, verse, opened)).toBe(raw);
    });
  });

keystrokeSuite('en_ult/GEN-773', '49', '6', /^\t/);
// 1SA 2:2: a `\ts\*` between its poem lines — the blank line is the one edited.
keystrokeSuite('en_ult/1SA-2-812', '2', '2', /^$/);
// REV 7:12: `\pi1`, `\ts\*` and `\m` lines between its words.
keystrokeSuite('en_ult/REV-7-812', '7', '12', /^$/);
// GEN 29:14 (en_ust): an `\s1` heading and an `\sr` line inside the verse.
keystrokeSuite('en_ust/GEN-29-812', '29', '14', /^\\s1 /);
