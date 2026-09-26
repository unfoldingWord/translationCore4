// #417: every journey imports `test` from here, not from '@playwright/test'.
//
// A write with update_ingredients walks the whole project on the rig while it
// holds the server's repo_dir lock (pankosmia-web 0.18.5, post_raw_ingredient.rs:36
// and :120). When a file or directory disappears during that walk, the server
// panics at utils/burrito.rs:104, :129 or :131 and the lock is poisoned: every
// later request answers 500 (PLATFORM-NOTES #38). The journeys change the rig's
// disk directly between tests (resetSeededChecking, fs.rmSync), and when a test
// ends its page hide handler still sends the pending saves (state.jsx). So the
// next test's reset could race the previous test's save.
//
// This fixture closes that window after each test, while the page is still open:
//   1. it fires the page's hide handler, so the saves a close would send go out
//      now, where they are tracked (later journeys read what they wrote),
//   2. it waits until every rig write has its answer and none follows for QUIET_MS,
//   3. it refuses any new write to the rig from this browser context, and
//   4. it asks GET /burrito/metadata/summaries, which takes the same lock, so it
//      returns only when the server has finished. A 500 there names the rig.
// The page then closes; its hide handler finds nothing left to save.
import { test as base, type Request } from '@playwright/test';
import { assertRigHealthy } from '../rig-health';

/** How long the rig writes may take to settle before the test fails. */
export const SETTLE_TIMEOUT_MS = 30_000;
/** A drain sends its writes after a few event-loop turns, not at once. */
export const QUIET_MS = 500;

const isRigWrite = (request: Request): boolean =>
  request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/');

export const test = base.extend<{ settleRig: void }>({
  settleRig: [
    // `page` is a dependency so this teardown runs before the page closes.
    async ({ context, page }, use, testInfo) => {
      let closing = false;
      const inFlight = new Set<Request>();
      const done = (request: Request) => { inFlight.delete(request); };
      context.on('requestfinished', done);
      context.on('requestfailed', done);
      // A routed request waits in the browser until this handler returns, so the
      // set holds every write before the rig can see it.
      await context.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const request = route.request();
        if (!isRigWrite(request)) return route.fallback();
        if (closing) return route.abort('aborted');
        inFlight.add(request);
        return route.fallback();
      });

      await use();

      const deadline = Date.now() + SETTLE_TIMEOUT_MS;
      const settle = async (quietMs: number) => {
        let quietSince = Date.now();
        while (inFlight.size > 0 || Date.now() - quietSince < quietMs) {
          if (inFlight.size > 0) quietSince = Date.now();
          if (Date.now() > deadline) {
            const urls = [...inFlight].map((r) => `${r.method()} ${r.url()}`).join(', ');
            throw new Error(`#417: the rig writes did not settle ${SETTLE_TIMEOUT_MS} ms after "${testInfo.title}": ${urls || 'writes kept coming'}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      };
      if (!page.isClosed()) {
        await page
          .evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })))
          .catch(() => {}); // a page mid-navigation has no window to call; step 2 still waits
      }
      await settle(QUIET_MS);
      closing = true;
      await settle(0);
      try {
        await assertRigHealthy();
      } catch (error) {
        throw new Error(`After "${testInfo.title}": ${(error as Error).message}`);
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
