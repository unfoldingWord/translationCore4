// Plain display text for one source verse (verseObjects from usfm-js —
// aligned USFM collapses to its text/word content; display only, never
// re-serialized). ONE flattener for every view (2026-08-27 review): since the
// 2026-08-31 review (R6) the walk itself lives in sourceHighlight.ts —
// tokenizeVerse is the single walker, and this is its collapsed-text form, so
// the highlighted token stream can never diverge from the plain flatten.
import { tokenizeVerse, tokensText } from '../data/sourceHighlight';

export const verseText = (vObj) => tokensText(tokenizeVerse(vObj)).replace(/\s+/g, ' ').trim();
