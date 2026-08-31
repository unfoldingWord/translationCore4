import React from 'react';
import { tokenizeVerse, matchQuote } from '../data/sourceHighlight';
import { verseText } from './verseText.js';

/** Does this verse key (a number, or a span like "8-9") carry the verse the
 * focused help names? */
export const keyCarries = (key, verse) => {
  const want = Number(verse);
  if (!Number.isFinite(want)) return false;
  const m = String(key).match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return false;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return want >= from && want <= to;
};

/** One source verse, tokenized so the focused help's quote can highlight the
 * gateway words it names (epic #104 fidelity, F3 — the mockup's `hl()`:
 * source only, never the target). `focus` is the hovered-or-active helps card
 * ({ verse, quote, occurrence }) or null. Verses without alignment data (or
 * with no focus on them) render their flattened text unchanged. */
export function SourceVerse({ vObj, verseKey, focus }) {
  const focused = focus != null && keyCarries(verseKey, focus.verse);
  const tokens = React.useMemo(() => (focused ? tokenizeVerse(vObj) : null), [focused, vObj]);
  if (!focused || !tokens || tokens.length === 0) return <>{verseText(vObj)}</>;
  const hits = matchQuote(tokens, focus.quote ?? '', focus.occurrence ?? 1);
  return (
    <>
      {tokens.map((tok, i) =>
        hits.has(i) ? (
          <mark key={i} data-testid="source-hl" style={{ background: 'var(--tc-highlight-soft)', color: 'var(--text-heading)', borderRadius: 'var(--radius-xs)', padding: '0 .06em' }}>
            {tok.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{tok.text}</React.Fragment>
        ),
      )}
    </>
  );
}
