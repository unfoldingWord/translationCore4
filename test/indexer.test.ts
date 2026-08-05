// C1a.2 property tests — the verse-range indexer over the real corpora:
// plain drafts with `___` stubs (sample-burrito TIT/JON, span verse JON 2:9-10)
// and aligned tC3-shaped USFM (en_ult/en_ust TIT v89, see test/fixtures/README.md).
import { describe, expect, it } from 'vitest';
import usfmjs from 'usfm-js';
import { findVerse, indexBook } from '../src/data/usfm/indexer';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment [VERIFIED in this toolchain].
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// Relative to the repo root (the Vitest cwd), as the S-0 suites do.
const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

// test/fixtures/sample-burrito/* is a dated snapshot of the generated sample-burrito
// drafts (see test/fixtures/README.md). The harness regenerates the live copy.
// (verified 2026-07-30) — the in-repo copy keeps tests independent of siblings.
const corpora: Record<string, string> = {
  'sample TIT (plain draft, ___ stubs)': read('test/fixtures/sample-burrito/TIT.usfm'),
  'sample JON (plain draft, span verse 2:9-10)': read('test/fixtures/sample-burrito/JON.usfm'),
  'en_ult TIT (aligned: 705 zaln-s, 23 ts milestones)': read('test/fixtures/en_ult/TIT.usfm'),
  'en_ust TIT (aligned)': read('test/fixtures/en_ust/TIT.usfm'),
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
  it('sample TIT covers chapters 1-3 with 16/15/15 verses (property 4)', () => {
    const entries = indexBook(corpora['sample TIT (plain draft, ___ stubs)']);
    const perChapter = new Map<string, number>();
    for (const e of entries) perChapter.set(e.chapter, (perChapter.get(e.chapter) ?? 0) + 1);
    expect([...perChapter.entries()]).toEqual([
      ['1', 16],
      ['2', 15],
      ['3', 15],
    ]);
    expect(entries).toHaveLength(46);
  });

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
  it('plain verse body is the text after `\\v N ` up to the line end', () => {
    const b = body(corpora['sample TIT (plain draft, ___ stubs)'], 1, '1');
    expect(b.startsWith('Pablo, siervo de Dios')).toBe(true);
    expect(b.endsWith('piedad,')).toBe(true);
    expect(b).not.toContain('\n');
  });

  it('untranslated stubs index as the body `___`', () => {
    const raw = corpora['sample TIT (plain draft, ___ stubs)'];
    expect(body(raw, 1, '6')).toBe('___');
    const stubCount = indexBook(raw).filter((e) => raw.slice(e.start, e.end) === '___').length;
    expect(stubCount).toBe(41); // 46 verses, 5 translated in chapter 1
  });

  it('aligned verse bodies keep inline zaln/w markup, across lines (T7 input)', () => {
    const b = body(corpora['en_ult TIT (aligned: 705 zaln-s, 23 ts milestones)'], 1, '1');
    expect(b).toContain('\\zaln-s |x-strong="G39720"');
    expect(b).toContain('\\w Paul|x-occurrence="1"');
    expect(b).toContain('\n'); // multi-line body
    expect(b).not.toContain('\\v 2');
  });

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

  it('trailing line terminators stay outside the body', () => {
    for (const raw of Object.values(corpora)) {
      for (const e of indexBook(raw)) {
        const b = raw.slice(e.start, e.end);
        expect(b.endsWith('\n')).toBe(false);
        expect(b.endsWith('\r')).toBe(false);
      }
    }
  });
});

describe('span verse keys (property 3)', () => {
  const jon = () => corpora['sample JON (plain draft, span verse 2:9-10)'];

  it('JON 2 uses the exact span key "9-10"', () => {
    const entries = indexBook(jon());
    const ch2 = entries.filter((e) => e.chapter === '2').map((e) => e.verseKey);
    expect(ch2).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9-10']);
    expect(body(jon(), 2, '9-10')).toContain('Mas yo te ofreceré sacrificios');
  });

  it('lookup is exact — "9" and "10" do not resolve inside the span', () => {
    const entries = indexBook(jon());
    expect(findVerse(entries, 2, '9-10')).not.toBeNull();
    expect(findVerse(entries, 2, '9')).toBeNull();
    expect(findVerse(entries, '2', '10')).toBeNull();
  });

  it('never yields Number()-coerced keys (regression: Number("9-10") is NaN)', () => {
    expect(Number('9-10')).toBeNaN(); // the prototype fixtureStore bug class
    for (const raw of Object.values(corpora)) {
      for (const e of indexBook(raw)) {
        expect(e.verseKey).not.toBe('NaN');
        expect(e.verseKey).toMatch(/^\S+$/);
      }
    }
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

  it('a line-start poetry marker ends the body (only the first segment is the body)', () => {
    const raw = [
      '\\id TST synthetic',
      '\\c 1',
      '\\p',
      '\\v 8 first segment',
      '\\q1 second printed segment of the verse',
      '\\q2 third printed segment',
      '\\v 9 next verse',
      '',
    ].join('\n');
    expect(body(raw, 1, '8')).toBe('first segment');
    expect(body(raw, 1, '9')).toBe('next verse');
  });

  it('numbered paragraph variants (\\pi2, \\q3) end the body like their base marker', () => {
    const raw = ['\\id TST', '\\c 1', '\\v 1 head', '\\pi2 indented', '\\v 2 x', ''].join('\n');
    expect(body(raw, 1, '1')).toBe('head');
  });
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
