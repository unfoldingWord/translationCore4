import React from 'react';

/* Pin outline supplied by unfoldingWord (uploads/location-pin-solid-full.svg), cropped to
   its own bounds: x 128–512, y 64–582 of the original 640 viewBox. The head is a circle of
   r=192 centred at (320, 252.6) — the numeral sits at that centre. */
const PIN = 'M320 64C214 64 128 148.4 128 252.6C128 371.9 248.2 514.9 298.4 569.4C310.2 582.2 329.8 582.2 341.6 569.4C391.8 514.9 512 371.9 512 252.6C512 148.4 426 64 320 64z';
const HEAD = { x: 320, y: 252.6 };
/* Numeral scales down as digits are added so it stays inside the head. */
const FS = { 1: 250, 2: 205, 3: 160 };

/** Draggable verse boundary handle. Kindle pyriform pin — appears only while a verse
 *  boundary is being moved; a settled verse number is a tertiary superscript again.
 *  Default 32px gives a 24x32 target: WCAG 2.5.8 AA, and no larger, because the pin sits
 *  inline among words that are click targets themselves. */
export function VerseMarker({ n, size = 32, state = 'idle', onPickUp, style, ...rest }) {
  const dragging = state === 'dragging';
  const w = Math.round(size * 0.741);
  const digits = String(n).length;
  return (
    <span role="button" tabIndex={0} aria-label={'Move where verse ' + n + ' begins'}
      onPointerDown={onPickUp}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickUp && onPickUp(e); } }}
      style={{ display: 'inline-flex', width: w, height: size, verticalAlign: 'text-bottom',
        cursor: dragging ? 'grabbing' : 'grab', flex: 'none',
        filter: dragging ? 'drop-shadow(0 6px 10px rgba(1,66,99,.28))' : 'drop-shadow(0 1px 2px rgba(1,66,99,.18))',
        transition: 'filter var(--dur-hover) var(--ease-standard)', ...style }} {...rest}>
      <svg viewBox="128 64 384 518" width={w} height={size} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
        <path d={PIN} fill="var(--uw-kindle)" stroke="var(--tc-warn-text)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <text x={HEAD.x} y={HEAD.y} textAnchor="middle" dominantBaseline="central"
          fill="var(--uw-ink)" fontFamily="var(--font-ui)" fontWeight="900" fontSize={FS[digits] || 140}>{n}</text>
      </svg>
    </span>
  );
}
