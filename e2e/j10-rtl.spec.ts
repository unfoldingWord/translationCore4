// J10 — RTL project end-to-end (Arabic-script drafting/checking/publishing)
// JOURNEYS-AND-GAPS §2 J10 · PRD FR-30 · TEST-PLAN E-J10 (E-J2/E-J4/E-J7 parameterized
// with the RTL fixture) · Increment 6
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
