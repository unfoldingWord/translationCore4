// The way into the conflict review from Translate (#679; owner mockup
// 2026-10-13, artboard c): a marker on each verse with a verse-text conflict,
// and a toolbar button with the number of open conflicts. Both open the review.
import React from 'react';
import { t } from '../i18n';
import { bookName } from '../data/bookNames';

const FORK = ['M6 7v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7', 'M12 13v4'];

function ForkIcon({ size }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', display: 'block' }}>
      <circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" />
      {FORK.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

const WARN = { border: 'var(--stroke-selected) solid var(--uw-kindle)', color: 'var(--tc-warn-text)', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', cursor: 'pointer' };

/** While an editing card is open, the review does not open (bench P1): the
 * section card keeps its draft in the card only, and opening the review would
 * unmount it and lose the draft. The same rule as the Section/Verse switch
 * (Draft.jsx): the entry is disabled, and a press on it keeps the focus in the
 * card (Chromium sends no mousedown to a disabled button, so the pointerdown is
 * stopped). The translator saves or cancels the card first. */
const offWhileEditing = (disabled) => (disabled
  ? { disabled: true, onPointerDownCapture: (e) => e.preventDefault(), style: { cursor: 'default' } }
  : { style: null });

/** Translate's toolbar: "N conflicts · Review" while the project has open verse conflicts. */
export function ConflictsButton({ conflicts, onClick, disabled = false }) {
  const count = conflicts?.length;
  if (!count) return null;
  const off = offWhileEditing(disabled);
  return (
    <button type="button" data-testid="conflicts-review" data-count={count} onClick={onClick} disabled={off.disabled} onPointerDownCapture={off.onPointerDownCapture}
      style={{ ...WARN, display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 14px', borderRadius: 'var(--radius-pill)', background: 'var(--tc-warn-surface)', fontSize: 'var(--fs-caption-lg)', ...off.style }}>
      <ForkIcon size={14} />
      {t(count === 1 ? 'conflicts.reviewOne' : 'conflicts.reviewMany', { n: count })}
    </button>
  );
}

/** One verse in conflict: the warn tint, then the verse number, the marker
 * button and the verse. The marker opens the review at this verse. */
export function ConflictVerse({ conflict, number, onReview, children, disabled = false }) {
  const n = conflict.versions.length;
  const off = offWhileEditing(disabled);
  const ref = `${bookName(conflict.book)} ${conflict.chapter}:${conflict.verse}`;
  return (
    <span data-testid={`conflict-verse-${conflict.chapter}:${conflict.verse}`}
      style={{ background: 'var(--tc-warn-surface)', boxShadow: '0 0 0 4px var(--tc-warn-surface)', borderRadius: 'var(--radius-xs)' }}>
      <span style={{ whiteSpace: 'nowrap' }}>
        {number}
        <button type="button" data-testid={`conflict-marker-${conflict.chapter}:${conflict.verse}`}
          aria-label={t('conflicts.markerLabel', { ref, n })} onClick={() => onReview(conflict.key)}
          disabled={off.disabled} onPointerDownCapture={off.onPointerDownCapture}
          style={{ ...WARN, display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', margin: '0 4px 0 2px', verticalAlign: 3, borderRadius: 'var(--radius-pill)', background: 'var(--surface-card)', fontSize: 'var(--fs-meta)', lineHeight: 1, ...off.style }}>
          <ForkIcon size={13} />
          {t('conflicts.marker', { n })}
        </button>
      </span>
      {children}
    </span>
  );
}
