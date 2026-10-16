import React from 'react';

/** #762: one source text of the Check view's compare card. Its `40ch` resolves
 * in the scripture font the row sets, so every card of a row has the same
 * width whatever font its own text uses. */
export const sourceCardStyle = {
  flex: '1 1 calc(40ch + 40px)',
  minWidth: 0,
  padding: '16px 20px',
  background: 'var(--surface-card)',
  border: 'var(--stroke) solid var(--border)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-card)',
};

/** #762: the compare card. The source texts wrap: as many cards in a row as fit
 * at 40ch each, and a card alone in the last row takes the full width (both
 * from flex-wrap). "Your translation" is a card of its own below them. The text
 * of each card stops at 80ch (its own style). */
export function CompareCard({ sources, translation }) {
  return (
    <div data-testid="compare-card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div data-testid="compare-sources" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse)' }}>
        {sources}
      </div>
      <div data-testid="compare-translation" style={{ padding: '16px 20px', background: 'var(--surface-accent-soft)', border: 'var(--stroke) solid var(--accent-ring)', borderTop: '3px solid var(--accent)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card)' }}>
        {translation}
      </div>
    </div>
  );
}
