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
import { describe, expect, it } from 'vitest';
import { bodyToEditorText, editorTextToBody } from '../src/data/usfm/poemLines';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

describe('#786 poem lines: body <-> editor text', () => {
  const body = 'I will also put hostility\n\\q2 between you and the woman,\n\\q1 and between your offspring.';

  it('shows \\q1 lines with one tab and \\q2 lines with two', () => {
    expect(bodyToEditorText(body)).toBe('I will also put hostility\n\t\tbetween you and the woman,\n\tand between your offspring.');
  });

  it('writes the tabs back as the markers, and an unchanged verse is byte-identical (ways 1, 2, 4)', () => {
    expect(editorTextToBody(bodyToEditorText(body), '\n')).toBe(body);
    const spaced = 'a\n\\q2 two  spaces\tand a tab \n\\q1 b';
    expect(editorTextToBody(bodyToEditorText(spaced), '\n')).toBe(spaced);
  });

  it('every verse body of the en_ult fixtures round-trips byte for byte (way 1)', async () => {
    const { indexBook } = await import('../src/data/usfm/indexer');
    for (const file of ['test/fixtures/en_ult/GEN-773.usfm', 'test/fixtures/en_ult/PSA-3.usfm']) {
      const raw = read(file);
      for (const e of indexBook(raw)) {
        const b = raw.slice(e.start, e.end);
        expect(editorTextToBody(bodyToEditorText(b), '\n')).toBe(b);
      }
    }
  });

  it('never puts a marker on the first line, nor on a line with no tabs (ways 3, 5)', () => {
    expect(editorTextToBody('\tfirst\nplain break\n\tpoem', '\n')).toBe('\tfirst\nplain break\n\\q1 poem');
  });

  it('a CRLF verse keeps CRLF on every line, also after an edit (way 6)', () => {
    const crlf = 'one\r\n\\q2 two\r\n\\q1 three';
    const text = bodyToEditorText(crlf);
    expect(text).toBe('one\n\t\ttwo\n\tthree');
    expect(editorTextToBody(text, '\r\n')).toBe(crlf);
    expect(editorTextToBody(text.replace('two', 'dos'), '\r\n')).toBe('one\r\n\\q2 dos\r\n\\q1 three');
  });

  it('a bare \\q shows as one tab, like \\q1', () => {
    expect(bodyToEditorText('a\n\\q b')).toBe('a\n\tb');
  });
});
