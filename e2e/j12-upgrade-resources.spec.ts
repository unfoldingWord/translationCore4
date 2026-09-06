// J12 — Upgrade pinned resources: explicit upgrade → re-derive → carry over / invalidate
// docs/JOURNEYS.md J12 · Increment 6 (#40)
import { test } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';

test.describe('J12 — a facilitator upgrades the pinned resources', () => {
  test.fixme(
    'upgrading is an explicit user action — pins never move silently (FR-22, #3)',
    { tag: ['@inc5', '@J12'] },
    async () => {},
  );
  test.fixme(
    'after upgrade, check lists re-derive and matching decisions re-attach by identity key (FR-22)',
    { tag: ['@inc5', '@J12'] },
    async () => {},
  );
  test.fixme(
    'unmatched decisions are invalidated and retained, never silently lost (FR-22, #11 / D36)',
    { tag: ['@inc5', '@J12'] },
    async () => {},
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
