// #492: the language suggestions of New Bible and New Open Bible Stories. The
// list is Door43's (`langnames.json` beside this file, refreshed by
// scripts/refresh-langnames.mjs); this module only orders it for a query.
//
// The order (owner decisions 2026-09-30): the code typed whole, then a name
// typed whole, then a name or a code that starts with the query, then a word or
// the acronym inside a name, then a name that contains the query. At one rank,
// a language whose own name matches comes before a language that only an
// alternate name reaches. Capital letters and accents do not count. Languages
// that are still equal go by name, then by code.

/** One language of the shipped list: the fields the app reads from Door43's. */
export interface LanguageRow {
  /** The language code. */
  lc: string;
  /** The anglicized name; empty for some languages. */
  ang: string;
  /** The name in the language itself. Never empty. */
  ln: string;
  ld: 'ltr' | 'rtl';
  /** Alternate names. */
  alt: string[];
}

interface Name {
  folded: string;
  /** The words of the name, joined by one space. */
  words: string;
  acronym: string;
}

export interface IndexedLanguage {
  row: LanguageRow;
  code: string;
  /** The folded display name: the sort key among equal ranks. */
  name: string;
  own: Name[];
  alternate: Name[];
}

const CODE = 0;
const WHOLE = 1;
const STARTS = 2;
const WORD = 3;
const CONTAINS = 4;
const NONE = 5;

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const words = (folded: string): string[] => folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const toName = (text: string): Name => {
  const folded = fold(text);
  const parts = words(folded);
  return { folded, words: parts.join(' '), acronym: parts.map((part) => part[0]).join('') };
};

/** The name a suggestion shows and a choice stores: the anglicized name, or
 * the language's own name where Door43 has no anglicized one. */
export const languageName = (row: LanguageRow): string => row.ang || row.ln;

/** Fold the list once; `suggestLanguages` reads the result on every keystroke. */
export function indexLanguages(rows: readonly LanguageRow[]): IndexedLanguage[] {
  return rows.map((row) => ({
    row,
    code: fold(row.lc),
    name: fold(languageName(row)),
    own: [row.ang, row.ln].filter(Boolean).map(toName),
    alternate: row.alt.map(toName),
  }));
}

function rankNames(names: readonly Name[], query: string, queryWords: string): number {
  let best = NONE;
  for (const name of names) {
    let rank = NONE;
    if (name.folded === query) rank = WHOLE;
    else if (name.folded.startsWith(query)) rank = STARTS;
    else if (queryWords && ` ${name.words}`.includes(` ${queryWords}`)) rank = WORD;
    else if (query.length > 1 && name.acronym.includes(query)) rank = WORD;
    else if (name.folded.includes(query)) rank = CONTAINS;
    if (rank < best) best = rank;
  }
  return best;
}

/** The languages that match `query`, best first, `limit` at most. */
export function suggestLanguages(
  index: readonly IndexedLanguage[],
  query: string,
  limit = 100,
): LanguageRow[] {
  const folded = fold(query);
  if (!folded) return [];
  const queryWords = words(folded).join(' ');
  const hits: { language: IndexedLanguage; rank: number; alternate: number }[] = [];
  for (const language of index) {
    let own = rankNames(language.own, folded, queryWords);
    if (language.code === folded) own = CODE;
    else if (language.code.startsWith(folded)) own = Math.min(own, STARTS);
    const alternate = rankNames(language.alternate, folded, queryWords);
    if (own === NONE && alternate === NONE) continue;
    hits.push({ language, rank: Math.min(own, alternate), alternate: alternate < own ? 1 : 0 });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.alternate - b.alternate ||
      (a.language.name < b.language.name ? -1 : a.language.name > b.language.name ? 1 : 0) ||
      (a.language.code < b.language.code ? -1 : a.language.code > b.language.code ? 1 : 0),
  );
  return hits.slice(0, limit).map((hit) => hit.language.row);
}
