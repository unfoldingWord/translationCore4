// Derive at full strength (OPEN-QUESTIONS #15; TEST-PLAN derive row) — the
// harness's miniature-TSV proof upgraded to REAL published resources: whole
// Titus slices of en_tn v86, en_twl v86, es-419_tn v66 + the en_ta v86
// translate toc, vendored from the pinned sb-zip exports (provenance:
// test/fixtures/resources/README.md). Expected numbers were counted at vendor
// time; this suite must reproduce them through src/data/derive.ts.
import { describe, expect, it } from 'vitest';
import {
  deriveTnItems,
  deriveTwlItems,
  tnQuoteWords,
  reattachAcrossResource,
  sameOrigQuote,
} from '../src/data/derive';
import type { CheckItem } from '../src/data/derive';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks even under
// the Vitest node environment [VERIFIED in this toolchain — see s0c test].
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const FIX = path.resolve(process.cwd(), 'test/fixtures/resources');
const read = (p: string) => fs.readFileSync(path.join(FIX, p), 'utf8');

const enTn = read('en_tn@v86/TIT.tsv');
const esTn = read('es-419_tn@v66/TIT.tsv');
const enTwl = read('en_twl@v86/TIT.tsv');

describe('versioned TSV parsing (§4.2 — the header row is the contract)', () => {
  it('rejects an unknown tN header instead of guess-parsing', () => {
    const mutated = enTn.replace('SupportReference', 'SupportRef');
    expect(() => deriveTnItems(mutated, 'tit')).toThrow(/versioned parsing/);
  });
});

describe('en_twl v86 TIT — real TWL derivation', () => {
  const items = deriveTwlItems(enTwl, 'tit');

  it('category distribution from TWLink: kt 111, other 71, names 6', () => {
    const dist: { [c: string]: number } = {};
    for (const i of items) dist[i.category as string] = (dist[i.category as string] ?? 0) + 1;
    expect(dist).toEqual({ kt: 111, other: 71, names: 6 });
  });
});

describe('en_tw v87 TIT — the COMBINED export form (D34): repo-relative TWLinks', () => {
  // D34: tC4 pins <lang>_tw and fetches its sb-zip, which carries the TWL link
  // TSVs AND the payload articles. Those TSVs use repo-relative TWLinks
  // (./payload/kt/god.md) rather than the rc:// form a standalone _twl export
  // uses. BURRITO-SPEC §5.3 requires readers to accept BOTH.
  const enTw = read('en_tw@v87/TIT.tsv');
  const items = deriveTwlItems(enTw, 'tit');

  it('category comes from the segment before the slug in BOTH forms: kt 110, other 66, names 6', () => {
    const dist: { [c: string]: number } = {};
    for (const i of items) dist[i.category as string] = (dist[i.category as string] ?? 0) + 1;
    expect(dist).toEqual({ kt: 110, other: 66, names: 6 });
    // Same article, both link forms → same groupId and category.
    const rel = deriveTwlItems(
      'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\n1:1\tx1\tkeyterm\tΘεοῦ\t1\t./payload/kt/god.md',
      'tit',
    )[0];
    const rc = deriveTwlItems(
      'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\n1:1\tx1\tkeyterm\tΘεοῦ\t1\trc://*/tw/dict/bible/kt/god',
      'tit',
    )[0];
    expect(rel.contextId.groupId).toBe('god');
    expect(rc.contextId.groupId).toBe('god');
    expect(rel.category).toBe('kt');
    expect(rc.category).toBe('kt');
  });
});

describe('en_tn v86 TIT — real 7-column tN derivation + the tC3 category map', () => {
  const items = deriveTnItems(enTn, 'tit');

  it('category distribution through the map: grammar 71, figures 53, culture 26, other 6, discourse 1', () => {
    const dist: { [c: string]: number } = {};
    for (const i of items) dist[i.category as string] = (dist[i.category as string] ?? 0) + 1;
    expect(dist).toEqual({ grammar: 71, figures: 53, culture: 26, other: 6, discourse: 1 });
  });

  it('tN quote is a word-occurrence ARRAY (§5.2); "&" is a separator, never a word', () => {
    const discontinuous = items.filter((i) => i.contextId.quoteString.includes('&'));
    expect(discontinuous.length).toBe(12); // counted at vendor time (among derivable rows)
    for (const i of items) {
      const words = i.contextId.quote as Array<{ word: string; occurrence: number }>;
      expect(Array.isArray(words)).toBe(true);
      expect(words.some((w) => w.word === '&')).toBe(false);
    }
    expect(tnQuoteWords('ἐφανέρωσεν & τὸν λόγον αὐτοῦ').map((w) => w.word)).toEqual([
      'ἐφανέρωσεν', 'τὸν', 'λόγον', 'αὐτοῦ',
    ]);
    // Repeated word inside one quote: ordinal occurrences, no Set-dedup.
    expect(tnQuoteWords('τοῦ Θεοῦ & τοῦ Σωτῆρος')).toEqual([
      { word: 'τοῦ', occurrence: 1 },
      { word: 'Θεοῦ', occurrence: 1 },
      { word: 'τοῦ', occurrence: 2 },
      { word: 'Σωτῆρος', occurrence: 1 },
    ]);
  });
});

describe('cross-language re-attach on REAL en→es data (D17)', () => {
  const en = deriveTnItems(enTn, 'tit');
  const es = deriveTnItems(esTn, 'tit');

  it('a checkId-survivor re-attaches ONLY when the original-language quote also matches (B18, §5.2)', () => {
    // A shared checkId with a DIFFERENT quote span is a DIFFERENT check, not the
    // saved one. Real case: rtc9 is `κατὰ πίστιν ἐκλεκτῶν Θεοῦ…` in en_tn but
    // just `κατὰ πίστιν` in es-419_tn. It MUST NOT ride the shared id onto the
    // other span; reattach never lands on an item whose quote differs.
    const enRtc9 = en.find((i) => i.contextId.checkId === 'rtc9') as CheckItem;
    const esRtc9 = es.find((i) => i.contextId.checkId === 'rtc9') as CheckItem;
    expect(enRtc9.contextId.quoteString).not.toBe(esRtc9.contextId.quoteString);
    const [bad] = reattachAcrossResource([enRtc9], es);
    if (bad.to) expect(bad.to.contextId.quoteString).toBe(enRtc9.contextId.quoteString);
    else expect(bad.unplaced).toBe(true);
    // A genuine survivor — same checkId AND same quote — still carries.
    const esById = new Map(es.map((i) => [i.contextId.checkId, i]));
    const survivor = en.find(
      (i) => esById.get(i.contextId.checkId)?.contextId.quoteString === i.contextId.quoteString,
    ) as CheckItem;
    expect(survivor).toBeDefined();
    const [ok] = reattachAcrossResource([survivor], es);
    expect(ok.to?.contextId.checkId).toBe(survivor.contextId.checkId);
  });

  it('76 of the 157 en decisions re-attach by checkId with a MATCHING quote (B18; was 89 before quote-gating)', () => {
    // Shared checkId + genuinely different Greek span no longer auto-carries;
    // the quote is compared via the uW tokenizer, so a merely cosmetic quote
    // difference still matches (that is why this is 76, not the 75 a naive
    // string=== gave — one pair differs only cosmetically).
    const results = reattachAcrossResource(en, es);
    const byId = results.filter(
      (r) => r.to && r.to.contextId.checkId === r.saved.contextId.checkId,
    );
    expect(byId.length).toBe(76);
    // A checkId match only carries when the ORIGINAL-language quote agrees.
    expect(byId.every((r) => sameOrigQuote(r.to!.contextId.quoteString, r.saved.contextId.quoteString))).toBe(true);
  });

  it('no decision is ever guessed: every result either re-attaches on a matching quote or goes to review', () => {
    const results = reattachAcrossResource(en, es);
    for (const r of results) {
      expect(Boolean(r.to) !== Boolean(r.unplaced)).toBe(true);
    }
    const reviews = results.filter((r) => r.unplaced).length;
    const attached = results.filter((r) => r.to);
    expect(attached.length + reviews).toBe(157);
    // THE core B18 guarantee: NO attached decision ever rides a changed quote.
    expect(attached.every((r) => sameOrigQuote(r.to!.contextId.quoteString, r.saved.contextId.quoteString))).toBe(true);
    // The es slice covers fewer notes than en (112 < 157) and quote-gating sends
    // shared-id/changed-quote items to review: a substantial queue is CORRECT.
    expect(reviews).toBe(68);
    expect(attached.length).toBe(89);
  });
});
