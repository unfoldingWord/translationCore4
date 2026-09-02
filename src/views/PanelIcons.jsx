// The design's panel toggles: a sidebar glyph with the divider on the side the
// panel lives on. Shared by Understand and Translate.
import React from 'react';

const frame = (x) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <line x1={x} y1="3" x2={x} y2="13" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const RailIcon = () => frame(6);
export const HelpsIcon = () => frame(10);
