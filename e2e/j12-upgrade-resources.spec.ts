// J12 — Upgrade pinned resources: explicit upgrade → re-derive → carry over / invalidate
// JOURNEYS-AND-GAPS §2 J12 · PRD FR-22 · TEST-PLAN E-J12 · Increment 5
import { test } from '@playwright/test';

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
