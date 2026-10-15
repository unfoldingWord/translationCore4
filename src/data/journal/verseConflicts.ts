// The verse-text conflicts the conflict review shows — issue #679 (epic #24, G7).
//
// A pure read of the fold: `forks` lists every register with more than one live
// head, but the review shows verse text only (`text|` keys, G7) — a check-result
// or alignment fork projects its newest head and is not reviewed here. A fork
// names its heads by ts alone, so each head's actor and text come from the
// journal event with that ts — the text by the fold's own rule (verseHeadText),
// because a structural action makes verse heads too.
import { BOOK_CODES } from '../../../journal/grammar.mjs';
import { verseHeadText, type FoldOutput } from './runtime';
import type { JournalEvent } from './seal';

/** One version of a verse in a conflict: one live head of its `text|` register. */
export interface VerseVersion {
  /** The head's §8.2 ts — the value `resolveVerse` takes as the kept head. */
  ts: string;
  actor: string;
  text: string;
  /** This head is the newest one, so its text projects until a person keeps a version (§8.6). */
  provisional: boolean;
}

/** One verse whose text two or more translators changed from the same base. */
export interface VerseConflict {
  /** The register key, `text|BOOK|C:V`. */
  key: string;
  book: string;
  chapter: string;
  verse: string;
  /** Every live head, in ts order (the fork's own order). */
  versions: VerseVersion[];
}

const TEXT_PREFIX = 'text|';

/** Split a `text|BOOK|C:V` register key. */
export const parseVerseKey = (key: string): { book: string; chapter: string; verse: string } => {
  const [prefix, book, vkey] = key.split('|');
  const sep = vkey === undefined ? -1 : vkey.indexOf(':');
  if (`${prefix}|` !== TEXT_PREFIX || !book || sep < 0)
    throw new Error(`"${key}" is not a verse-text register key (text|BOOK|C:V)`);
  return { book, chapter: vkey.slice(0, sep), verse: vkey.slice(sep + 1) };
};

/** The verse-text conflicts of `foldOut`, in canonical verse order: book by the
 * eng canon, then verse by the slot order of the projected book. `events` is the
 * event set `foldOut` was folded from. */
export const verseConflicts = (foldOut: FoldOutput, events: readonly JournalEvent[]): VerseConflict[] => {
  const byTs = new Map<string, JournalEvent>();
  for (const e of events) byTs.set(e.ts, e);
  const bookIndex = (book: string): number => {
    const i = (BOOK_CODES as string[]).indexOf(book);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const slotIndex = (book: string, vkey: string): number => {
    const i = Object.keys(foldOut.books[book]?.verses ?? {}).indexOf(vkey);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const conflicts = foldOut.forks
    .filter((fork) => fork.key.startsWith(TEXT_PREFIX))
    .map((fork): VerseConflict => {
      const { book, chapter, verse } = parseVerseKey(fork.key);
      const versions = fork.heads.map((ts): VerseVersion => {
        const e = byTs.get(ts);
        // A fork head the event set does not hold means the fold and the events disagree.
        if (!e) throw new Error(`fork ${fork.key}: head ${ts} is not in the event set`);
        // A head is a verse edit, a book.add slot or a structural post-image (a
        // renumber, split or merge); its text follows the fold's own rule.
        return { ts, actor: e.actor, text: verseHeadText(e, `${chapter}:${verse}`), provisional: ts === fork.provisional };
      });
      return { key: fork.key, book, chapter, verse, versions };
    });
  const order = (c: VerseConflict): [number, number] => [bookIndex(c.book), slotIndex(c.book, `${c.chapter}:${c.verse}`)];
  return conflicts.sort((a, b) => {
    const [ab, as] = order(a);
    const [bb, bs] = order(b);
    return ab - bb || as - bs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
};
