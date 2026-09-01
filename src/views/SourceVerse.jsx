import React from 'react';
import { tokenizeVerse, matchQuote } from '../data/sourceHighlight';
import { verseText } from './verseText.js';

/** Does this verse key (a number, or a span like "8-9") carry the verse the
 * focused help names? The help's reference can itself be a range — a TSV row
 * like "1:1-3" keeps its raw verse string (derive.ts refPart), exactly the
 * shape state.jsx already guards for — so both sides parse as ranges and
 * carry = overlap (2026-08-31 review R4). */
export const keyCarries = (key, verse) => {
  const km = String(key).match(/^(\d+)(?:-(\d+))?$/);
  const vm = String(verse).match(/^(\d+)(?:-(\d+))?$/);
  if (!km || !vm) return false;
  const kFrom = Number(km[1]);
  const kTo = km[2] ? Number(km[2]) : kFrom;
  const vFrom = Number(vm[1]);
  const vTo = vm[2] ? Number(vm[2]) : vFrom;
  return vFrom <= kTo && kFrom <= vTo;
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
