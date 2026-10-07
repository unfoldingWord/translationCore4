// #492: the order of the language suggestions in New Bible and New Open Bible Stories.
// The journey (e2e/language-suggestions.spec.ts) proves the field; it cannot hold every
// rank case, so the ranker is tested here on the list the app ships.
//
// Ways the ranker can fail, written before the ranker (AGENTS.md "How to test" rule 3):
// 1. A code typed whole is not first: "en" must give English before the names that
//    start with "en", and "es-419" must give Latin American Spanish.
// 2. A name typed whole is not ahead of the longer names that start with it.
// 3. Capital letters or accents change the result.
// 4. A language that only an alternate name reaches is missed, or it comes before a
//    language whose own name matches as well.
// 5. A word inside the name, or the name's acronym, is missed, or it comes before a
//    name that starts with the query.
// 6. A name that only contains the query comes before a better match, or is missed.
// 7. A language with no anglicized name cannot be found, or has an empty name.
// 8. Two languages with the same rank change places between runs.
// 9. The empty query, or a query that matches nothing, returns languages.
// 10. More languages come back than the limit.
import { describe, expect, it } from 'vitest';
import { indexLanguages, languageName, suggestLanguages, type LanguageRow } from '../src/data/languageSearch';

// The real builtin, not `import 'node:fs'` (CONTRIBUTING.md, "Write a test that reads files").
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// Every input and every expected code below is a row of the list the app ships.
const ROWS: LanguageRow[] = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'src/data/langnames.json'), 'utf8'),
);
const INDEX = indexLanguages(ROWS);
const codes = (query: string, limit?: number) => suggestLanguages(INDEX, query, limit).map((row) => row.lc);

describe('#492 language suggestions: the order', () => {
  it('a code typed whole comes first (1)', () => {
    expect(codes('en')[0]).toBe('en');
    expect(codes('es-419')).toEqual(['es-419']);
    // `las` is the code of Lama. Four names start with "las", then two alternate
    // names do (Balochi, Western; Marghi Central), then the acronym of "Latin
    // American Spanish". Names that only contain "las" follow.
    expect(codes('las').slice(0, 8)).toEqual(['las', 'llm', 'lsa', 'lsi', 'lss', 'bgn', 'mrt', 'es-419']);
  });

  it('a name typed whole comes before the longer names that start with it (2)', () => {
    expect(codes('Hausa').slice(0, 2)).toEqual(['ha', 'hsl']);
    expect(codes('arabic')[0]).toBe('ar');
  });

  it('capital letters and accents do not change the result (3)', () => {
    expect(codes('hausa')).toEqual(codes('Hausa'));
    expect(codes('HAUSA')).toEqual(codes('Hausa'));
    expect(codes('Espanol')).toEqual(codes('español'));
    expect(codes('Espanol')[0]).toBe('es');
  });

  it('an alternate name finds the language, after a language whose own name matches (4)', () => {
    expect(codes('Castilian')).toEqual(['es']);
    // "Kiswahili" is the own name of `sw` and an alternate name of `swh`.
    const kiswahili = codes('Kiswahili');
    expect(kiswahili[0]).toBe('sw');
    expect(kiswahili).toContain('swh');
    // "Oromo" is the own name of `om` and an alternate name of `gax`.
    const oromo = codes('Oromo');
    expect(oromo[0]).toBe('om');
    expect(oromo.indexOf('om')).toBeLessThan(oromo.indexOf('gax'));
  });

  it('a word inside the name matches after a name that starts with the query (5)', () => {
    // "American Sign Language" starts with it; "Latin American Spanish" holds the word.
    const american = codes('american');
    expect(american.indexOf('ase')).toBeGreaterThanOrEqual(0);
    expect(american.indexOf('ase')).toBeLessThan(american.indexOf('es-419'));
  });

  it('a name that only contains the query comes last, in name order (6, 8)', () => {
    // Hausa, Hausa Sign Language and Lausaha are the three names that contain "ausa".
    // Barí, Paiwan, Suau and Teop have an alternate name that does.
    expect(codes('ausa')).toEqual(['ha', 'hsl', 'swp-x-lausaha', 'mot', 'pwn', 'swp', 'tio']);
  });

  it('a language with no anglicized name is found and named by its own name (7)', () => {
    const [aramaic] = suggestLanguages(INDEX, 'Official Aramaic');
    expect(aramaic.lc).toBe('arc');
    expect(aramaic.ang).toBe('');
    expect(languageName(aramaic)).toBe('Official Aramaic (700-300 BCE)');
  });

  it('two languages with the same name keep one order: by code (8)', () => {
    expect(codes('Acholi').slice(0, 2)).toEqual(['ach', 'ach-ss-acholi']);
    expect(codes('Acholi')).toEqual(codes('Acholi'));
  });

  it('no query and no match give no language (9)', () => {
    expect(codes('')).toEqual([]);
    expect(codes('   ')).toEqual([]);
    expect(codes('zzzzqqq')).toEqual([]);
  });

  it('the limit holds (10)', () => {
    expect(codes('a')).toHaveLength(100);
    expect(codes('a', 5)).toHaveLength(5);
  });
});
