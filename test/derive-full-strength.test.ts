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
  categoryForTn,
  tnQuoteWords,
  reattachAcrossResource,
  sameOrigQuote,
  mergeSavedDecisions,
  progressOf,
  TN_HEADER,
  TWL_HEADER,
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

describe('fixture provenance — export metadata SHAs match the project pins', () => {
  const revisionOf = (p: string): string => {
    const meta = JSON.parse(read(p)) as {
      identification: { primary: { dcs?: { [k: string]: { revision: string } } } };
    };
    return Object.values(meta.identification.primary.dcs ?? {})[0]?.revision ?? '';
  };

  it('each vendored metadata.json carries the pinned tag commit SHA (OQ #24 verification data)', () => {
    expect(revisionOf('en_twl@v86/metadata.json')).toBe(
      '570e76d0024c847689e48a20e2ac1a1d2c6eb6e3',
    );
    expect(revisionOf('es-419_tn@v66/metadata.json')).toBe(
      '22f3d0c61e2ab4701cb869547de9c3c43da07208',
    );
    expect(revisionOf('en_tn@v86/metadata.json')).toBe(
      'c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5',
    );
    expect(revisionOf('en_ta@v86/metadata.json')).toBe(
      'c7caddfb474efd713f36b35a3ffc927866c7b180',
    );
  });

  it('sample-burrito pins agree with the fixture SHAs (two-set schema, D17)', () => {
    const burrito = path.resolve(process.cwd(), '../sample-burrito');
    if (!fs.existsSync(path.join(burrito, 'metadata.json'))) return; // sibling checkout absent
    const pins = JSON.parse(
      fs.readFileSync(path.join(burrito, 'ingredients/checking/resources.json'), 'utf8'),
    ) as {
      languageSets: {
        [rung: string]: { [slot: string]: { repoPath?: string; version?: string; sha?: string } };
      };
    };
    expect(pins.languageSets.primary.translationNotes.sha).toBe(
      '22f3d0c61e2ab4701cb869547de9c3c43da07208',
    );
    // D34: the tW slots name the SAME <lang>_tw repo — one pin, one fetch, both
    // tool inputs (its export carries the link TSVs and the payload articles).
    for (const rung of ['primary', 'fallback'] as const) {
      expect(pins.languageSets[rung].translationWordsLinks)
        .toEqual(pins.languageSets[rung].translationWords);
      expect(pins.languageSets[rung].translationWords.repoPath).toMatch(/_tw$/);
    }
    expect(pins.languageSets.fallback.translationWords.sha).toBe(
      'eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd',
    );
  });
});

describe('versioned TSV parsing (§4.2 — the header row is the contract)', () => {
  it('rejects an unknown tN header instead of guess-parsing', () => {
    const mutated = enTn.replace('SupportReference', 'SupportRef');
    expect(() => deriveTnItems(mutated, 'tit')).toThrow(/versioned parsing/);
  });

  it('rejects a TWL file fed to the tN parser (and vice versa)', () => {
    expect(() => deriveTnItems(enTwl, 'tit')).toThrow(/versioned parsing/);
    expect(() => deriveTwlItems(enTn, 'tit')).toThrow(/versioned parsing/);
  });

  it('the real fixture headers ARE the expected contracts', () => {
    expect(enTn.split('\n')[0].replace(/\r$/, '')).toBe(TN_HEADER);
    expect(enTwl.split('\n')[0].replace(/\r$/, '')).toBe(TWL_HEADER);
  });
});

describe('en_twl v86 TIT — real TWL derivation', () => {
  const items = deriveTwlItems(enTwl, 'tit');

  it('derives 188 items (counted at vendor time)', () => {
    expect(items.length).toBe(188);
  });

  it('category distribution from TWLink: kt 111, other 71, names 6', () => {
    const dist: { [c: string]: number } = {};
    for (const i of items) dist[i.category as string] = (dist[i.category as string] ?? 0) + 1;
    expect(dist).toEqual({ kt: 111, other: 71, names: 6 });
  });

  it('every item has the §5.2 identity-key fields and a tw slug groupId', () => {
    for (const i of items) {
      expect(i.contextId.checkId).toMatch(/\S/);
      expect(i.contextId.groupId).toMatch(/^[a-z0-9-]+$/i);
      expect(i.contextId.quoteString.length).toBeGreaterThan(0);
      expect(Number.isInteger(i.contextId.occurrence)).toBe(true);
    }
  });
});

describe('en_tw v87 TIT — the COMBINED export form (D34): repo-relative TWLinks', () => {
  // D34: tC4 pins <lang>_tw and fetches its sb-zip, which carries the TWL link
  // TSVs AND the payload articles. Those TSVs use repo-relative TWLinks
  // (./payload/kt/god.md) rather than the rc:// form a standalone _twl export
  // uses. BURRITO-SPEC §5.3 requires readers to accept BOTH.
  const enTw = read('en_tw@v87/TIT.tsv');
  const items = deriveTwlItems(enTw, 'tit');

  it('EVERY sb-zip export uses repo-relative links — go-rc2sb rewrites the RC rc:// form', () => {
    // [VERIFIED 2026-08-03] Both exports are relative; the rc:// form lives in
    // the RC source branch (git.door43.org/unfoldingWord/en_twl@master
    // twl_TIT.tsv → rc://*/tw/dict/bible/names/paul), which we never fetch.
    // Readers still must accept rc:// — tC3-era stored data carries it.
    const allRelative = (tsv: string) =>
      tsv.split('\n').slice(1).filter((r) => r.trim())
        .every((r) => r.split('\t')[5].startsWith('./payload/'));
    expect(allRelative(enTw)).toBe(true);
    expect(allRelative(read('en_twl@v86/TIT.tsv'))).toBe(true);
  });

  it('derives 182 items with the same shape as the rc:// form (counted at vendor time)', () => {
    expect(items.length).toBe(182);
    for (const i of items) {
      expect(i.contextId.groupId).toMatch(/^[a-z0-9-]+$/i); // .md stripped
      expect(i.contextId.groupId).not.toContain('/');
      expect(Number.isInteger(i.contextId.occurrence)).toBe(true);
    }
  });

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

  it('the payload article the links point at is present and is the tW article shape', () => {
    const article = read('en_tw@v87/payload-kt-god.md');
    expect(article).toMatch(/^#\s*\S/); // leading H1 title, per tC3 article shape
    expect(article).toMatch(/## Translation Suggestions/);
  });

  it('the en_tw export metadata carries ITS pinned tag SHA — distinct from the en_twl export', () => {
    const meta = JSON.parse(read('en_tw@v87/metadata.json')) as {
      identification: { primary: { dcs?: { [k: string]: { revision: string } } } };
      type: { flavorType: { name: string; flavor: { name: string } } };
    };
    expect(Object.values(meta.identification.primary.dcs ?? {})[0]?.revision).toBe(
      'eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd',
    );
    // The export declares the parascriptural flavor, NOT the RC catalog's
    // peripheral/x-peripheralArticles — the export is the pin target (D23b).
    expect(`${meta.type.flavorType.name}/${meta.type.flavorType.flavor.name}`)
      .toBe('parascriptural/x-bcvarticles');
  });
});

describe('en_tn v86 TIT — real 7-column tN derivation + the tC3 category map', () => {
  const items = deriveTnItems(enTn, 'tit');

  it('derives 157 items — 206 rows minus the 49 without a SupportReference', () => {
    expect(items.length).toBe(157);
  });

  it('category distribution through the map: grammar 71, figures 53, culture 26, other 6, discourse 1', () => {
    const dist: { [c: string]: number } = {};
    for (const i of items) dist[i.category as string] = (dist[i.category as string] ?? 0) + 1;
    expect(dist).toEqual({ grammar: 71, figures: 53, culture: 26, other: 6, discourse: 1 });
  });

  it('the map defaults unmapped (newer) tA slugs to "other" — v86 has 4 such slugs', () => {
    expect(categoryForTn('figs-yousingular')).toBe('other');
    expect(categoryForTn('translate-blessing')).toBe('other');
    expect(categoryForTn('figs-abstractnouns')).toBe('grammar');
    expect(categoryForTn('figs-metaphor')).toBe('figures');
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

  it('every derived groupId exists in the en_ta v86 translate toc (28/28 — the tA linkage)', () => {
    const toc = read('en_ta@v86/translate-toc.yaml');
    const links = new Set(Array.from(toc.matchAll(/link:\s*(\S+)/g), (m) => m[1]));
    const groupIds = new Set(items.map((i) => i.contextId.groupId));
    expect(groupIds.size).toBe(28);
    for (const g of groupIds) expect(links.has(g), `groupId ${g} missing from tA toc`).toBe(true);
  });

  it('the tA article fixture has the tC3 article shape (title + markdown body)', () => {
    expect(read('en_ta@v86/translate-figs-abstractnouns-title.md').trim()).toBe('Abstract Nouns');
    expect(read('en_ta@v86/translate-figs-abstractnouns-01.md')).toMatch(/abstract nouns/i);
  });
});

describe('derive+merge and progress on real data (§4.2 pipeline)', () => {
  const items = deriveTnItems(enTn, 'tit');

  it('a stored decision re-attaches to its derived twin by the stable key; progress reconstructs', () => {
    const first = items[0];
    const saved: CheckItem[] = [
      {
        ...first,
        selections: [{ text: 'x', occurrence: 1, occurrences: 1 }],
        comments: 'nota',
      },
    ];
    const merged = mergeSavedDecisions(items, saved);
    expect(progressOf(merged)).toEqual({ decided: 1, total: 157 });
    expect(merged[0].comments).toBe('nota');
  });
});

describe('cross-language re-attach on REAL en→es data (D17)', () => {
  const en = deriveTnItems(enTn, 'tit');
  const es = deriveTnItems(esTn, 'tit');

  it('es-419_tn v66 TIT derives 112 items (counted at vendor time)', () => {
    expect(es.length).toBe(112);
  });

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

  it('duplicate (ref+quote+occurrence) keys exist in the REAL data and never auto-attach without a groupId tiebreak', () => {
    const key = (i: CheckItem) =>
      [
        i.contextId.reference.chapter,
        i.contextId.reference.verse,
        i.contextId.quoteString,
        i.contextId.occurrence,
      ].join('|');
    const counts = new Map<string, number>();
    for (const i of en) counts.set(key(i), (counts.get(key(i)) ?? 0) + 1);
    const dupKeys = [...counts.values()].filter((c) => c > 1).length;
    expect(dupKeys).toBe(10); // counted at vendor time — D17's ambiguity class is real in TIT
  });
});

describe('multi-book — the fixture layout is per-book by design (owner, 2026-08-03)', () => {
  // Adding a book is "drop in the files, add expectations" — no restructuring.
  // Counts below were taken from the vendored slices at vendor time.
  it('en_tn v86 JON derives 172 items from 196 rows', () => {
    const items = deriveTnItems(read('en_tn@v86/JON.tsv'), 'jon');
    expect(items.length).toBe(172);
    expect(items.every((i) => i.contextId.reference.bookId === 'jon')).toBe(true);
  });

  it('en_tw v87 JON derives 200 items, all with tW categories', () => {
    const items = deriveTwlItems(read('en_tw@v87/JON.tsv'), 'jon');
    expect(items.length).toBe(200);
    expect(new Set(items.map((i) => i.category))).toEqual(new Set(['kt', 'names', 'other']));
  });

  it('the same parser handles both books without special-casing either', () => {
    const tit = deriveTnItems(read('en_tn@v86/TIT.tsv'), 'tit');
    const jon = deriveTnItems(read('en_tn@v86/JON.tsv'), 'jon');
    // Different books, same shape guarantees.
    for (const items of [tit, jon]) {
      expect(items.every((i) => Array.isArray(i.contextId.quote))).toBe(true);
      expect(items.every((i) => typeof i.category === 'string')).toBe(true);
    }
    expect(tit[0].contextId.reference.bookId).toBe('tit');
    expect(jon[0].contextId.reference.bookId).toBe('jon');
  });
});
