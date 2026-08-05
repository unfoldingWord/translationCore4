// J7 — Publish: typeset preview → PDF → aligned USFM export
// JOURNEYS-AND-GAPS §2 J7 · PRD FR-27, FR-28 · TEST-PLAN E-J7 · Increment 4
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
