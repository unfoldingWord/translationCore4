// Quote → source-word highlighting (epic #104 fidelity, F3).
//
// Runs against the REAL aligned en_ult Titus fixture and the real en_tn v89
// quotes for Titus 1:1 — including the two hard cases the verse actually
// carries: a repeated orig word (Θεοῦ ×2, the quote naming the second) and one
// orig word rendered by two gateway groups (ἐκλεκτῶν → "chosen" + "people").
import { describe, expect, it } from 'vitest';
import { usfmjs } from '../src/data/vendor';
import { gatewayQuote, matchQuote, quoteToWords, tokenizeVerse, tokensText } from '../src/data/sourceHighlight';
import { tnQuoteWords } from '../src/data/derive';
import { verseText } from '../src/views/verseText.js';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (issue #35).
const fs = process.getBuiltinModule('node:fs');

const raw = fs.readFileSync('test/fixtures/en_ult/TIT.usfm', 'utf8');
const chapters = (usfmjs.toJSON(raw) as { chapters: Record<string, Record<string, unknown>> })
  .chapters;
const verse = (c: string, v: string) =>
  chapters[c][v] as { verseObjects: Array<Record<string, unknown>> };

const highlighted = (c: string, v: string, quote: Array<{ word: string }> | string, occ = 1) => {
  const tokens = tokenizeVerse(verse(c, v));
  const hits = matchQuote(tokens, quote, occ);
  return [...hits].map((i) => tokens[i].text);
};

describe('tokenizeVerse', () => {
  it('reads the same display text as the plain flatten', () => {
    for (const v of ['1', '2', '3', '4']) {
      const tokens = tokenizeVerse(verse('1', v));
      expect(tokensText(tokens).replace(/\s+/g, ' ').trim()).toBe(verseText(verse('1', v)));
    }
  });

  it('carries the verse-level orig occurrence on every word', () => {
    const tokens = tokenizeVerse(verse('1', '1'));
    const god = tokens.filter((t) => t.orig.some((o) => o.content === 'Θεοῦ'));
    expect(god.map((t) => `${t.text}#${t.orig[0].occurrence}`)).toEqual([
      'of#1',
      'God#1',
      'of#2',
      'God#2',
    ]);
  });
});

describe('quoteToWords', () => {
  it('drops the & span separator and strips TSV punctuation', () => {
    expect(quoteToWords('ἐκλεκτῶν Θεοῦ, & ἀληθείας')).toEqual(['ἐκλεκτῶν', 'Θεοῦ', 'ἀληθείας']);
  });
  it('accepts the tN word-array shape', () => {
    expect(quoteToWords(tnQuoteWords('καὶ ἐπίγνωσιν & καὶ'))).toEqual([
      'καὶ',
      'ἐπίγνωσιν',
      'καὶ',
    ]);
  });
});

describe('matchQuote', () => {
  it('resolves the repeated orig word to the occurrence the quote names', () => {
    // Real en_tn TIT 1:1 quote (with its TSV comma). The verse renders Θεοῦ
    // twice; the quote follows ἐκλεκτῶν, so the SECOND "of God" highlights and
    // the first ("a servant of God") must not.
    const words = highlighted('1', '1', 'κατὰ πίστιν ἐκλεκτῶν Θεοῦ, καὶ ἐπίγνωσιν ἀληθείας');
    expect(words).toContain('faith');
    expect(words).toContain('chosen');
    expect(words).toContain('knowledge');
    // ἐκλεκτῶν is rendered by two gateway groups — both highlight.
    expect(words).toContain('people');
    // "servant" belongs to Θεοῦ#1's neighborhood, not this quote.
    expect(words).not.toContain('servant');
    expect(words).not.toContain('Paul');
    // Exactly one "of God" pair: 2× "of" would mean both instances lit up.
    expect(words.filter((w) => w === 'God')).toHaveLength(1);
  });

  it('resolves a single-word TWL quote through the occurrence attribute', () => {
    expect(highlighted('1', '1', 'Θεοῦ', 1)).toEqual(['of', 'God']);
    expect(highlighted('1', '1', 'Θεοῦ', 2)).not.toContain('servant');
  });


  it('R1 regression: a repeated FIRST word anchors at the tightest rendering, not the earliest', () => {
    // Real en_tn TIT 2:2 quote: the verse renders τῇ three times ("in faith,
    // in love, in patience"); the review caught "in faith in love".
    const words = highlighted('2', '2', 'τῇ ἀγάπῃ');
    expect(words).toContain('love');
    expect(words).not.toContain('faith');
    expect(words).not.toContain('patience');
  });

  it('R1 regression: a long quote never invents a phrase from the wrong clause (TIT 1:15)', () => {
    const words = highlighted('1', '15', 'τοῖς δὲ μεμιαμμένοις καὶ ἀπίστοις, οὐδὲν καθαρόν');
    expect(words).toContain('corrupted');
    expect(words).toContain('unbelieving');
    expect(words).toContain('pure');
    // The wrong-anchor match dragged in the FIRST clause ("to the ones who
    // are pure all things are pure") — its words must stay dark.
    expect(words).not.toContain('all');
  });

  it('R3 regression: an out-of-range occurrence falls back, never returns occurrence 1', () => {
    // TIT 1:1 has ONE ἐκλεκτῶν, rendered by two gateway groups — which must
    // count as ONE occurrence of the quote, so occurrence 2 has no match.
    expect(highlighted('1', '1', 'ἐκλεκτῶν', 2)).toEqual([]);
  });

  it('returns nothing for an intro note with an empty quote', () => {
    expect(highlighted('1', '1', '', 0)).toEqual([]);
    expect(highlighted('1', '1', tnQuoteWords(''), 0)).toEqual([]);
  });

  it('returns nothing when the quote names words the verse lacks', () => {
    expect(highlighted('1', '1', 'λόγος', 1)).toEqual([]);
  });
});

describe('gatewayQuote (owner ruling 2026-08-31: cards title in the gateway language)', () => {
  const gl = (c: string, v: string, quote: string, occ = 1) => {
    const tokens = tokenizeVerse(verse(c, v));
    return gatewayQuote(tokens, quote, occ);
  };

  it('renders the quote in gateway words, occurrence-exact', () => {
    expect(gl('1', '1', 'ἐκλεκτῶν Θεοῦ')).toBe('of the chosen people of God');
    expect(gl('1', '1', 'Θεοῦ', 1)).toBe('of God');
  });

  it('marks a discontinuous quote with an ellipsis', () => {
    expect(gl('1', '1', 'πίστιν & ἀληθείας')).toBe('the faith … of the truth');
  });

  it('returns null when nothing resolves — callers keep the original-language fallback', () => {
    expect(gl('1', '1', 'λόγος')).toBeNull();
    expect(gl('1', '1', '')).toBeNull();
  });
});
