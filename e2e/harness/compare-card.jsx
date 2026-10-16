import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ds/styles.css';
import { CompareCard, sourceCardStyle } from '../../src/views/CompareCard.jsx';

// #762: the compare card with n source texts (1 to 6), in the Check view's
// geometry: the 300px check rail, then the detail column's 32px side padding.
const n = Number(new URLSearchParams(location.search).get('n') ?? 2);
const text = 'Paul, a servant of God and an apostle of Jesus Christ, for the faith of the chosen people of God and knowledge of the truth that agrees with godliness,';

createRoot(document.getElementById('root')).render(
  <div style={{ marginInlineStart: 300, padding: '28px 32px' }}>
    <CompareCard
      sources={<>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} data-testid="harness-source" style={sourceCardStyle}>
            <p style={{ fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse-md)', margin: 0, maxWidth: '80ch' }}>{i + 1}. {text}</p>
          </div>
        ))}
        {/* The width of one card at the minimum, in the row's own font. */}
        <span data-testid="harness-min" aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', width: 'calc(40ch + 40px)' }} />
      </>}
      translation={<p style={{ margin: 0 }}>Your translation</p>} />
  </div>,
);
