// #324: a rig that panicked during an ingredient rescan answers HTTP 500 to every
// metadata request until it restarts (PLATFORM-NOTES #38). Its /version still
// answers 200, so Playwright's web-server check passes and every journey fails
// with a 500 that looks like a client defect. Global setup calls this probe once,
// after the reseed, so the run stops before the first test and names the cause.

export const RIG_HEALTH_URL = 'http://127.0.0.1:19998/api/burrito/metadata/summaries';

export type RigFetch = (url: string) => Promise<{ status: number }>;

/** Resolve on HTTP 200; throw on any other status. A network error passes through unchanged. */
export async function assertRigHealthy(fetchFn: RigFetch = fetch): Promise<void> {
  const { status } = await fetchFn(RIG_HEALTH_URL);
  if (status === 200) return;
  throw new Error(
    `The Pankosmia rig is not healthy: GET /api/burrito/metadata/summaries answered HTTP ${status}. `
      + 'A rig that panicked during an ingredient rescan answers 500 until it restarts (PLATFORM-NOTES #38). '
      + 'Run dev-env/scripts/stop.zsh, then dev-env/scripts/run.zsh, and start the journeys again.',
  );
}
