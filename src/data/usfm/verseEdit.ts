// #786, #812: what an edit does to the raw book, as the Verse card and a section
// save run it (state.jsx `startVerse`, `editVerse`, `cancelVerse`). The card
// saves on every keystroke, so each write starts from the book as the card
// opened: the verse's breaks come back from its body then (poemLines.ts), and a
// break or heading left after its last words is written once, right after it
// (splice.ts `spliceVerseWithTail`).
import { editorTextToVerse } from './poemLines';
import { spliceVerseWithTail, verseBody } from './splice';

/** What the Verse card keeps when it opens: the verse's body then (`___` when
 * the verse is empty) and the whole book then. */
export interface VerseSession {
  before: string;
  beforeRaw: string;
}

export const openVerse = (raw: string, chapter: string | number, verseKey: string): VerseSession => ({
  before: verseBody(raw, chapter, verseKey) ?? '___',
  beforeRaw: raw,
});

const lineEnd = (raw: string): '\n' | '\r\n' => (raw.includes('\r\n') ? '\r\n' : '\n');

/** One save of an editor text. `session` is the open card's; a section save
 * passes null and writes each verse once, from the book as it is. An emptied
 * verse is the `___` stub (BURRITO-SPEC §4.1). The new book, and the body
 * written. */
export const writeVerse = (
  raw: string,
  session: VerseSession | null,
  chapter: string | number,
  verseKey: string,
  text: string,
): { raw: string; body: string } => {
  const nl = lineEnd(raw);
  const opened = session ? session.before : verseBody(raw, chapter, verseKey) ?? '';
  const { body, tail } = text.trim() === '' ? { body: '___', tail: [] } : editorTextToVerse(text, nl, opened);
  return { raw: spliceVerseWithTail(raw, session?.beforeRaw ?? raw, chapter, verseKey, body, tail, nl), body };
};

/** Cancel: the body as the card opened, and nothing the edit put after it. */
export const cancelVerse = (raw: string, session: VerseSession, chapter: string | number, verseKey: string): { raw: string; body: string } => {
  const body = session.before.trim() === '' ? '___' : session.before;
  return { raw: spliceVerseWithTail(raw, session.beforeRaw, chapter, verseKey, body, [], lineEnd(raw)), body };
};
