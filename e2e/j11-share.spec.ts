// J11 — Share the project to Door43: sign in once, push the working main branch, read the URL
// docs/JOURNEYS.md J11 · Increment 8.5 (#362 share operation, #203 sign-in, #120 authority, #185 journey)
//
// Skeleton until #362 lands. The live leg runs against qa.door43.org only when the QA
// credentials are present (#185) and reports a labelled skip otherwise. Ground truth is the
// Door43 server and the rig's disk, never the app's own claims.
import { test } from './helpers/test';

test.describe('J11 — a facilitator shares the project to Door43', () => {
  test.fixme(
    'the first share signs in once, creates the repository under the account, and pushes main',
    { tag: ['@inc85', '@J11'] },
    async () => {},
  );
  test.fixme(
    'a second share pushes main again with no dialog, and the project is byte-identical',
    { tag: ['@inc85', '@J11'] },
    async () => {},
  );
  test.fixme(
    'a name collision, a non-fast-forward push, and an offline app each refuse with a Report code and push nothing',
    { tag: ['@inc85', '@J11'] },
    async () => {},
  );
  test.fixme(
    'an OBS project shares the same way (J24)',
    { tag: ['@inc85', '@J11', '@J24'] },
    async () => {},
  );
});
