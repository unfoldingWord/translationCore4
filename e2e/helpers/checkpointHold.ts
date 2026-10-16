// #722: hold the checkpoint status reads, so a book open waits.
import type { Page } from '@playwright/test';

/** Hold every `git/status` read until `release()`. A mode switch starts a
 * checkpoint in the project's store queue, and its first step is this read.
 * Since #679 a book open waits behind it in the same queue, so s.bookRaw stays
 * null (the screen says "Loading book…") until the release. `held()` counts the
 * reads that arrived. The route stays after the release (an unroute throws on a
 * held route); later reads pass at once. */
export async function holdCheckpoints(page: Page): Promise<{ release: () => void; held: () => number }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  await page.route('**/api/git/status/**', async (route) => {
    count++;
    await gate;
    await route.continue();
  });
  return { release, held: () => count };
}
