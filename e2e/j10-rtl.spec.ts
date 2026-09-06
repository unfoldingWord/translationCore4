// J10 — RTL project end-to-end (Arabic-script drafting/checking/publishing)
// docs/JOURNEYS.md: J10 is retired. RTL is a fixture axis on J2, J4, J5 and J7 (both runs in their
// proof rows). This file stays until those runs exist; the number is never reassigned.
import { test } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';

test.describe('J10 — the whole loop works right-to-left', () => {
  test.fixme(
    'drafting an RTL fixture project renders and saves correctly, including mixed-direction text (FR-30)',
    { tag: ['@inc6', '@J10'] },
    async () => {},
  );
  test.fixme(
    'checking an RTL project: selections tap the correct words, quotes render RTL (FR-30)',
    { tag: ['@inc6', '@J10'] },
    async () => {},
  );
  test.fixme(
    'publishing an RTL project: correct direction, no mirrored punctuation (FR-30)',
    { tag: ['@inc6', '@J10'] },
    async () => {},
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
