// C1a.2 property tests — the verse-range indexer over the real corpora:
// plain drafts with `___` stubs (sample-burrito TIT/JON, span verse JON 2:9-10)
// and aligned tC3-shaped USFM (en_ult/en_ust TIT v89, see test/fixtures/README.md).
import { describe, expect, it } from 'vitest';
import usfmjs from 'usfm-js';
import { draftPercent, findVerse, indexBook } from '../src/data/usfm/indexer';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment [VERIFIED in this toolchain].
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// Relative to the repo root (the Vitest cwd).
const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

// test/fixtures/sample-burrito/* is a dated snapshot of the generated sample-burrito
// drafts (see test/fixtures/README.md). The harness regenerates the live copy.
// (verified 2026-07-30) — the in-repo copy keeps tests independent of siblings.
const corpora: Record<string, string> = {
  'sample TIT (plain draft, ___ stubs)': read('test/fixtures/sample-burrito/TIT.usfm'),
  'sample JON (plain draft, span verse 2:9-10)': read('test/fixtures/sample-burrito/JON.usfm'),
  'en_ult TIT (aligned: 705 zaln-s, 23 ts milestones)': read('test/fixtures/en_ult/TIT.usfm'),
  'en_ust TIT (aligned)': read('test/fixtures/en_ust/TIT.usfm'),
  // #784: 49:6 is `\q1 \v 6 …`, the verse marker after a poetry marker on one line.
  'en_ult GEN-773 (49:6 follows \\q1 on its line)': read('test/fixtures/en_ult/GEN-773.usfm'),
};

// The zaln-strip-repro inline shape (sample-burrito-validation/zaln-strip-repro/
// test.mjs): contentless `\v N` marker lines, bodies entirely on following lines.
const zalnSnippet = [
  '\\id TIT unfoldingWord Literal Text',
  '\\usfm 3.0',
  '\\h Titus',
  '\\toc1 The Letter of Paul to Titus',
  '\\toc2 Titus',
  '\\toc3 Tit',
  '\\mt Titus',
  '\\c 1',
  '\\p',
  '\\v 1',
  '\\zaln-s |x-strong="G39720" x-lemma="Παῦλος" x-morph="Gr,N,,,,,NMS," x-occurrence="1" x-occurrences="1" x-content="Παῦλος"\\*\\w Paul|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*,',
  '\\zaln-s |x-strong="G14010" x-lemma="δοῦλος" x-morph="Gr,N,,,,,NMS," x-occurrence="1" x-occurrences="1" x-content="δοῦλος"\\*\\w a|x-occurrence="1" x-occurrences="1"\\w* \\w servant|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*',
  '\\zaln-s |x-strong="G23160" x-lemma="θεός" x-morph="Gr,N,,,,,GMS," x-occurrence="1" x-occurrences="1" x-content="Θεοῦ"\\*\\w of|x-occurrence="1" x-occurrences="1"\\w* \\w God|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*',
  '\\v 2',
  '\\zaln-s |x-strong="G19090" x-lemma="ἐπί" x-morph="Gr,P,,,,,D,,," x-occurrence="1" x-occurrences="1" x-content="ἐπʼ"\\*\\w with|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*',
  '\\zaln-s |x-strong="G16800" x-lemma="ἐλπίς" x-morph="Gr,N,,,,,DFS," x-occurrence="1" x-occurrences="1" x-content="ἐλπίδι"\\*\\w hope|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*',
  '',
].join('\n');

const body = (raw: string, chapter: string | number, verseKey: string): string => {
  const e = findVerse(indexBook(raw), chapter, verseKey);
  if (!e) throw new Error(`fixture is missing ${chapter}:${verseKey}`);
  return raw.slice(e.start, e.end);
};

describe('indexBook — structure over the corpora', () => {
  it.each(Object.entries(corpora))(
    '%s: indexer finds the same verse set as usfm-js toJSON chapters (property 4)',
    (_name, raw) => {
      const entries = indexBook(raw);
      const parsed = usfmjs.toJSON(raw) as {
        chapters: Record<string, Record<string, unknown>>;
      };
      // Whole-book parse returns `chapters` + `headers`; chunk parse would
      // return `verses` (PLATFORM-NOTES #4) — this cross-check is structure-only,
      // usfm-js never re-serializes (D8).
      const expected = new Map(
        Object.entries(parsed.chapters).map(([ch, verses]) => [
          ch,
          new Set(Object.keys(verses).filter((k) => k !== 'front')),
        ]),
      );
      const actual = new Map<string, Set<string>>();
      for (const e of entries) {
        if (!actual.has(e.chapter)) actual.set(e.chapter, new Set());
        actual.get(e.chapter)?.add(e.verseKey);
      }
      expect(actual).toEqual(expected);
    },
  );

  it('enumerates in document order with non-overlapping ranges', () => {
    for (const raw of Object.values(corpora)) {
      const entries = indexBook(raw);
      let previousEnd = -1;
      for (const e of entries) {
        expect(e.start).toBeGreaterThan(previousEnd);
        expect(e.end).toBeGreaterThanOrEqual(e.start);
        previousEnd = e.end;
      }
    }
  });
});

describe('verse bodies', () => {
  it('no indexed body contains a line-start verse/chapter/paragraph/ts marker', () => {
    for (const raw of Object.values(corpora)) {
      for (const e of indexBook(raw)) {
        const b = raw.slice(e.start, e.end);
        expect(/^\\(?:v|c)[ \t]/m.test(b)).toBe(false);
        expect(/^\\(?:p|q\d?|m|b)[ \t]*$/m.test(b)).toBe(false);
        expect(b).not.toContain('\\ts\\*');
      }
    }
  });
});

// #784: Paratext and the unfoldingWord aligned texts write poetry as `\q1 \v 15 …`.
// The ways this can fail, written before the fix:
//   1. The verse is not indexed: Translate and Align do not show it (the defect).
//   2. Its body starts too early and holds `\q1 ` or `\v 15 `: an edit deletes the
//      marker or doubles it.
//   3. The verse before it keeps the `\q1 \v 15 …` line in its body.
//   4. A verse whose `\v` starts its line indexes differently than before.
describe('#784 — a \\v after a paragraph or poetry marker on the same line', () => {
  // `\p\v 5` (no space) is in en_ult and en_ust Zechariah.
  const poetry = ['\\id TST', '\\c 1', '\\q1 \\v 1 one', '\\q2 more of one', '\\q1 \\v 2 two', '\\p \\v 3 three', '\\li1 \\v 4 four', '\\p\\v 5 five', ''].join('\n');

  it('each such verse is indexed, its body starts after `\\v N `, and the marker stays outside every body (ways 1-3)', () => {
    const entries = indexBook(poetry);
    expect(entries.map((e) => e.verseKey)).toEqual(['1', '2', '3', '4', '5']);
    // #786: the inner poem line of verse 1 is part of its body.
    expect(['1', '2', '3', '4', '5'].map((k) => body(poetry, 1, k))).toEqual(['one\n\\q2 more of one', 'two', 'three', 'four', 'five']);
    for (const e of entries) expect(poetry.slice(e.start - `\\v ${e.verseKey} `.length, e.start)).toBe(`\\v ${e.verseKey} `);
  });

  it('en_ult Gen 49:6 is indexed after its `\\q1 ` (ways 1 and 2)', () => {
    const raw = corpora['en_ult GEN-773 (49:6 follows \\q1 on its line)'];
    const e = findVerse(indexBook(raw), 49, '6');
    expect(e).not.toBeNull();
    const lineStart = raw.lastIndexOf('\n', e!.start) + 1;
    expect(raw.slice(lineStart, e!.start)).toBe('\\q1 \\v 6 ');
    expect(raw.slice(e!.start, e!.end)).toMatch(/^\\zaln-s /);
  });

  it('a verse whose \\v starts its line keeps the same entry (way 4)', () => {
    const lineStart = poetry.replace('\\q1 \\v 2 two', '\\q1\n\\v 2 two');
    const before = findVerse(indexBook(lineStart), 1, '2')!;
    expect(lineStart.slice(before.start, before.end)).toBe('two');
    expect(lineStart.slice(before.start - 5, before.start)).toBe('\\v 2 ');
  });
});

describe('span verse keys (property 3)', () => {
  const jon = () => corpora['sample JON (plain draft, span verse 2:9-10)'];

  it('lookup is exact — "9" and "10" do not resolve inside the span', () => {
    const entries = indexBook(jon());
    expect(findVerse(entries, 2, '9-10')).not.toBeNull();
    expect(findVerse(entries, 2, '9')).toBeNull();
    expect(findVerse(entries, '2', '10')).toBeNull();
  });
});

// #572 (D81, D94) — the J2 verse-span journey proves the drafted percentage. This
// one case stays because the journey cannot fail on it: in Titus (46 verses) an
// undrafted span that counts as one verse gives 5 of 45 or 6 of 45, and both
// round to the same percent as 5 of 46 and 6 of 46.
describe('draftPercent — what the J2 span journey cannot show (#572)', () => {
  it('an undrafted span counts its verses as undrafted', () => {
    const raw = ['\\id TST', '\\c 1', '\\p', '\\v 1 uno', '\\v 2-3 ___', '\\v 4 ___', ''].join('\n');
    expect(draftPercent(indexBook(raw), raw)).toBe(25);
  });
});

describe('zaln-strip-repro snippet shape (contentless \\v marker lines)', () => {
  it('indexes bodies that live entirely on the lines after `\\v N`', () => {
    const entries = indexBook(zalnSnippet);
    expect(entries.map((e) => [e.chapter, e.verseKey])).toEqual([
      ['1', '1'],
      ['1', '2'],
    ]);
    const v1 = zalnSnippet.slice(entries[0].start, entries[0].end);
    expect(v1.startsWith('\\zaln-s |x-strong="G39720"')).toBe(true);
    expect(v1.endsWith('\\w God|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*')).toBe(true);
    expect(v1.split('\n')).toHaveLength(3);
  });
});

describe('inline markers belong to the body; paragraph-level markers end it', () => {
  it('a line-start footnote (\\f … \\f*) stays inside the verse body', () => {
    const raw = [
      '\\id TST synthetic',
      '\\c 1',
      '\\p',
      '\\v 1 First words',
      '\\f + \\ft a footnote kept in the body\\f*',
      'and the tail after the note',
      '\\v 2 Second with \\add added\\add* and \\k keyword\\k* inline',
      '',
    ].join('\n');
    expect(body(raw, 1, '1')).toBe(
      'First words\n\\f + \\ft a footnote kept in the body\\f*\nand the tail after the note',
    );
    expect(body(raw, 1, '2')).toBe('Second with \\add added\\add* and \\k keyword\\k* inline');
  });

  it('numbered paragraph variants (\\pi2 alone, \\q3 alone) end the body like their base marker', () => {
    // #812: with text after them they would be verse text; on their own line
    // before the next \v they are the next verse's paragraph.
    const raw = ['\\id TST', '\\c 1', '\\v 1 head', '\\pi2', '\\v 2 x', '\\q3', '\\v 3 y', ''].join('\n');
    expect(body(raw, 1, '1')).toBe('head');
    expect(body(raw, 1, '2')).toBe('x');
  });
});

// #786: a poetry verse spans several lines, one `\q1`/`\q2` line per line of
// the poem. The ways this can fail, written before the fix:
//   1. The body stops at the first inner poem line: the editor shows one line
//      and a save leaves the old lines after the new text (the defect).
//   2. The body swallows the next verse's own `\q1 \v N` line, or a marker-only
//      line (`\p`, `\q1` alone, `\ts\*`) that belongs between two verses.
//   3. A poem line before the first verse joins a body.
// (#812 turned the former ways 3b and 4 around: a `\q3` line and the verse
// text after a mid-verse heading belong to the verse too; see below.)
describe('#786 — the inner poem lines of a verse belong to its body', () => {
  it('\\q, \\q1 and \\q2 lines with text continue the open verse (way 1)', () => {
    const raw = [
      '\\id TST synthetic',
      '\\c 1',
      '\\p',
      '\\v 8 first segment',
      '\\q1 second printed segment of the verse',
      '\\q2 third printed segment',
      '\\q fourth',
      '\\v 9 next verse',
      '',
    ].join('\n');
    expect(body(raw, 1, '8')).toBe('first segment\n\\q1 second printed segment of the verse\n\\q2 third printed segment\n\\q fourth');
    expect(body(raw, 1, '9')).toBe('next verse');
  });

  it('the next verse\'s own line and marker-only lines stay outside (way 2)', () => {
    const raw = ['\\id TST', '\\c 1', '\\q1 \\v 1 one', '\\q2 more of one', '\\q1', '\\v 2 two', '\\q2 more of two', '\\ts\\*', '\\p', '\\v 3 three', ''].join('\n');
    expect(['1', '2', '3'].map((k) => body(raw, 1, k))).toEqual(['one\n\\q2 more of one', 'two\n\\q2 more of two', 'three']);
  });

  it('a `\\v` line with no text: the body starts after the first poem marker, which stays outside (way 2)', () => {
    const raw = ['\\id PSA', '\\c 131', '\\v 2', '\\q1 But I have calmed', '\\q2 and quieted my soul.', '\\q1 \\v 3 Hope', ''].join('\n');
    const e = findVerse(indexBook(raw), 131, '2')!;
    expect(raw.slice(e.start, e.end)).toBe('But I have calmed\n\\q2 and quieted my soul.');
    expect(raw.slice(0, e.start)).toMatch(/\\v 2\n\\q1 $/);
    expect(body(raw, 131, '3')).toBe('Hope');
  });

  it('a poem line before any verse joins no body (way 3)', () => {
    const raw = ['\\id TST', '\\c 1', '\\q1 before any verse', '\\v 1 one', '\\v 2 two', ''].join('\n');
    expect(body(raw, 1, '1')).toBe('one');
    expect(body(raw, 1, '2')).toBe('two');
  });

  it('en_ult Gen 49:6 holds all its poem lines, and the verses around it keep their own', () => {
    const raw = corpora['en_ult GEN-773 (49:6 follows \\q1 on its line)'];
    const b = body(raw, 49, '6');
    expect(b.match(/\n\\q[12] /g)?.length).toBeGreaterThan(0);
    expect(b).not.toMatch(/\\v /);
  });

});

// #812: what else a verse holds between its lines. The ways this can fail,
// written before the fix:
//   1. A paragraph or stanza break (`\p`, `\m`, `\pi1`, `\b`, `\qm1` alone) or a
//      `\ts\*` inside a verse ends its body: the editor shows part of the verse
//      and a save leaves the rest after the new text (the defect).
//   2. A paragraph line with text (`\pmo …`), a `\q3` line, or the verse text
//      after a mid-verse heading (`\s1`, `\sr`, `\sp`) is left out the same way.
//   3. A break or a heading that comes after the verse's last words, before the
//      next `\v` or `\c`, joins the body (it belongs between two verses).
//   4. A `\v` line with no text, then a break: the body starts on the break.
describe('#812 — breaks, headings and \\q3 inside a verse belong to its body', () => {
  it('a break inside a verse continues its body; breaks after its last words stay outside (ways 1, 3)', () => {
    const raw = ['\\id REV', '\\c 7', '\\v 12 saying,', '\\pi1', '“Amen! Praise', '\\ts\\*', '\\m', 'and glory.”', '\\b', '\\qm1', 'Amen.', '\\ts\\*', '\\p', '\\v 13 Then', ''].join('\n');
    expect(body(raw, 7, '12')).toBe('saying,\n\\pi1\n“Amen! Praise\n\\ts\\*\n\\m\nand glory.”\n\\b\n\\qm1\nAmen.');
    expect(body(raw, 7, '13')).toBe('Then');
  });

  it('a paragraph line with text, a \\q3 line, and the text after a heading continue the body (way 2)', () => {
    const raw = ['\\id GEN', '\\c 29', '\\v 14 Laban said,', '\\pmo “You are my bone.”', '\\q3 deeper line', '\\s1 Jacob marries', '\\sr (29:15-30)', 'After a month', '\\v 15 Then', ''].join('\n');
    expect(body(raw, 29, '14')).toBe('Laban said,\n\\pmo “You are my bone.”\n\\q3 deeper line\n\\s1 Jacob marries\n\\sr (29:15-30)\nAfter a month');
  });

  it('a heading after the verse\'s last words stays outside, as LAM 2:5 `\\qa` does (way 3)', () => {
    const raw = ['\\id LAM', '\\c 2', '\\q1 \\v 5 The Lord', '\\q2 has swallowed', '\\qa WAW', '\\q1 \\v 6 He', ''].join('\n');
    expect(body(raw, 2, '5')).toBe('The Lord\n\\q2 has swallowed');
  });

  it('a `\\v` line with no text, then a break: the body starts after the break (way 4)', () => {
    const raw = ['\\id TST', '\\c 1', '\\v 2', '\\p', 'text of two', '\\v 3 three', ''].join('\n');
    const e = findVerse(indexBook(raw), 1, '2')!;
    expect(raw.slice(e.start, e.end)).toBe('text of two');
    expect(raw.slice(0, e.start)).toMatch(/\\v 2\n\\p\n$/);
  });
});

describe('#786/#812 — every verse body holds all the words of its verse', () => {
  type Chapters = Record<string, Record<string, unknown>>;
  const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
  // The words a heading line holds (`\qa WAW` at a verse's end): usfm-js puts
  // them in the verse, and they are not verse text.
  const HEADING = /^\\(?:s\d?|sr|sp|qa|ms\d?|mr|r|d|cl|qd)\s+(.*)$/;
  const check = async (label: string, raw: string) => {
    const { parseChapters, verseText } = await import('../src/data/bookModel.js');
    const chapters = parseChapters(raw) as Chapters;
    const entries = indexBook(raw);
    // The words usfm-js reads in a text put alone in a verse.
    const asVerse = (text: string): string[] => words(verseText((parseChapters(`\\id TST\n\\c 1\n\\v 1 ${text}\n`) as Chapters)['1']?.['1']));
    entries.forEach((e, i) => {
      const whole = words(verseText(chapters[e.chapter]?.[e.verseKey]));
      const got = asVerse(raw.slice(e.start, e.end));
      const next = entries[i + 1]?.start ?? raw.length;
      const after = raw.slice(e.end, next).split('\n').flatMap((l) => asVerse(HEADING.exec(l)?.[1] ?? ''));
      expect(got.length === whole.length ? got : [...got, ...after], `${label} ${e.chapter}:${e.verseKey}`).toEqual(whole);
    });
  };

  // The check that keeps the class closed: a body that stops early fails here,
  // whatever marker stopped it.
  it('every verse of the en_ult and en_ust fixtures', async () => {
    for (const file of ['en_ult/GEN-773', 'en_ult/PSA-3', 'en_ult/1SA-2-812', 'en_ult/REV-7-812', 'en_ult/PSA-9-812', 'en_ult/MAT-27-812', 'en_ust/GEN-29-812']) {
      await check(file, read(`test/fixtures/${file}.usfm`));
    }
  });

  // The same over every book of the rig's en_ult and en_ust (rig required:
  // the books are the rig's sideloaded copies, not in this repository).
  const rigBooks = path.resolve(process.cwd(), 'dev-env/state/work/repos/_local_/_sideloaded_');
  it.skipIf(!fs.existsSync(path.join(rigBooks, 'en_ult/ingredients/GEN.usfm')))('every verse of the rig\'s en_ult and en_ust (rig required)', async () => {
    for (const pkg of ['en_ult', 'en_ust']) {
      const dir = path.join(rigBooks, pkg, 'ingredients');
      for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith('.usfm'))) await check(`${pkg}/${f}`, fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }, 600_000);
});

describe('partial-book files are legal (property 5, D26)', () => {
  const partial = [
    '\\id TST partial book — only chapter 2 present',
    '\\c 2',
    '\\p',
    '\\v 1 uno',
    '\\v 2 dos',
    '',
  ].join('\n');

  it('indexes what is present and nothing else', () => {
    const entries = indexBook(partial);
    expect(entries.map((e) => [e.chapter, e.verseKey])).toEqual([
      ['2', '1'],
      ['2', '2'],
    ]);
    expect(findVerse(entries, 1, '1')).toBeNull();
    expect(findVerse(entries, 2, '2')).not.toBeNull();
    expect(body(partial, '2', '2')).toBe('dos');
  });

  it('a headers-only file and an empty string index to zero verses', () => {
    expect(indexBook('\\id TST\n\\h Title\n')).toEqual([]);
    expect(indexBook('')).toEqual([]);
  });

  it('a \\v before any \\c cannot be addressed by (chapter, verse) and is skipped', () => {
    expect(indexBook('\\id TST\n\\v 1 orphan\n')).toEqual([]);
  });
});
