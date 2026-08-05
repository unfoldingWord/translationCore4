// J9 — Import a tC3 project / an x-tcore project
// JOURNEYS-AND-GAPS §2 J9 · PRD FR-23..FR-26 · TEST-PLAN E-J9 · Increment 6
import { test } from '@playwright/test';

test.describe('J9 — a facilitator imports existing work', () => {
  test.fixme(
    'a tC3 project imports in one operation — aligned USFM becomes the alignment sidecar, checks become decisions (FR-23)',
    { tag: ['@inc6', '@J9'] },
    async () => {},
  );
  test.fixme(
    'multiple single-book tC3 projects import into one multi-book project (FR-23)',
    { tag: ['@inc6', '@J9'] },
    async () => {},
  );
  test.fixme(
    'an x-tcore copied project migrates into the originating draft project with no per-book re-selection (FR-24)',
    { tag: ['@inc6', '@J9'] },
    async () => {},
  );
  test.fixme(
    'an unresolvable pinned version still imports — marked unresolved, re-pin flow re-attaches decisions (FR-25)',
    { tag: ['@inc6', '@J9'] },
    async () => {},
  );
  test.fixme(
    'an incomplete manifest imports with synthesized defaults, prompting only for un-derivable gaps (FR-26)',
    { tag: ['@inc6', '@J9'] },
    async () => {},
  );
});
