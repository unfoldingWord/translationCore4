// #324: a rig that panicked during an ingredient rescan answers HTTP 500 to every
// metadata request until it restarts (PLATFORM-NOTES #38). Its /version still
// answers 200, so Playwright's web-server check passes and every journey fails
// with a 500 that looks like a client defect. Global setup calls this probe once,
// after the reseed, so the run stops before the first test and names the cause.

export const RIG_HEALTH_URL = 'http://127.0.0.1:19998/api/burrito/metadata/summaries';

/** A rig that accepts the connection but never answers must not hold the run forever. */
export const RIG_HEALTH_TIMEOUT_MS = 10_000;

export type RigFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number }>;

const REMEDY = 'Run dev-env/scripts/stop.zsh, then dev-env/scripts/run.zsh, and start the journeys again.';

/**
 * Resolve on HTTP 200; throw on any other status, or when the rig does not answer in time.
 * A network error passes through unchanged.
 */
export async function assertRigHealthy(
  fetchFn: RigFetch = fetch,
  timeoutMs: number = RIG_HEALTH_TIMEOUT_MS,
): Promise<void> {
  let status: number;
  try {
    ({ status } = await fetchFn(RIG_HEALTH_URL, { signal: AbortSignal.timeout(timeoutMs) }));
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `The Pankosmia rig is not healthy: GET /api/burrito/metadata/summaries did not answer in ${timeoutMs} ms. ${REMEDY}`,
      );
    }
    throw error;
  }
  if (status === 200) return;
  throw new Error(
    `The Pankosmia rig is not healthy: GET /api/burrito/metadata/summaries answered HTTP ${status}. `
      + 'A rig that panicked during an ingredient rescan answers 500 until it restarts (PLATFORM-NOTES #38). '
      + REMEDY,
  );
}
