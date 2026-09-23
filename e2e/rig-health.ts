/** The direct rig endpoint used to detect a poisoned Pankosmia process. */
export const RIG_PORT = 19998;
export const RIG_VERSION_URL = `http://127.0.0.1:${RIG_PORT}/api/version`;
export const RIG_HEALTH_URL = `http://127.0.0.1:${RIG_PORT}/api/burrito/metadata/summaries`;

/** A hung rig must fail setup instead of holding the journey run forever. */
export const RIG_HEALTH_TIMEOUT_MS = 5_000;
export const RIG_STARTUP_TIMEOUT_MS = 5_000;

/** The small response surface the probe needs, kept injectable for unit tests. */
export type RigFetch = (input: string, init?: RequestInit) => Promise<{ status: number }>;

/** Wait until the server has completed bootstrap, regardless of its HTTP status. */
export async function waitForRigReady(
  fetchFn: RigFetch,
  timeoutMs: number = RIG_STARTUP_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const attemptTimeout = Math.min(250, remaining);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = fetchFn(RIG_VERSION_URL, { method: 'GET', signal: controller.signal });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('rig startup attempt timed out'));
      }, attemptTimeout);
    });

    try {
      await Promise.race([request, timeout]);
      return;
    } catch (error) {
      lastError = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(0, deadline - Date.now()))));
  }

  if (lastError instanceof Error && lastError.message !== 'rig startup attempt timed out') {
    throw lastError;
  }

  throw new Error(
    `Pankosmia rig startup timed out after ${timeoutMs}ms: `
    + `GET ${RIG_VERSION_URL} did not respond.`,
  );
}

/**
 * Confirm that the rig can serve metadata before a journey starts.
 *
 * Network failures are deliberately not caught: Playwright's web-server
 * diagnostics are more useful for a rig that never started or disappeared.
 */
export async function assertRigHealthy(
  fetchFn: RigFetch,
  timeoutMs: number = RIG_HEALTH_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = fetchFn(RIG_HEALTH_URL, { method: 'GET', signal: controller.signal });
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(
        `Pankosmia rig health check timed out after ${timeoutMs}ms: `
        + `GET ${RIG_HEALTH_URL} did not respond. `
        + 'The rig may not have started. Start it with run.zsh, then rerun the journeys.',
      ));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([request, deadline]);
    if (response.status === 200) return;

    if (response.status === 500) {
      throw new Error(
        `Pankosmia rig health check failed: GET ${RIG_HEALTH_URL} returned HTTP 500. `
        + 'The rig may be poisoned. Run stop.zsh, then run.zsh, and rerun the journeys.',
      );
    }

    throw new Error(`Pankosmia rig health check failed: GET ${RIG_HEALTH_URL} returned HTTP ${response.status}.`);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
