// J7 — Publish: typeset preview → PDF → aligned USFM export
// docs/JOURNEYS.md J7 · Increment 7 (#19) · run LTR and RTL (the J10 axis)
import { test } from '@playwright/test';

test.describe('J7 — a facilitator publishes the book', () => {
  test.fixme(
    'export produces standards-compliant USFM with alignments folded in from the sidecar (FR-27)',
    { tag: ['@inc4', '@J7'] },
    async () => {},
  );
  test.fixme(
    'the export round-trip is byte-equivalent and the canonical book file is untouched (FR-27)',
    { tag: ['@inc4', '@J7'] },
    async () => {},
  );
  test.fixme(
    'print output applies the chosen page-setup options — not a bare window.print (FR-28)',
    { tag: ['@inc4', '@J7'] },
    async () => {},
  );
});
