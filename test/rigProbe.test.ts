import { describe, expect, it, vi } from 'vitest';
import { assertRigHealthy, RIG_HEALTH_URL, type RigFetch } from '../e2e/rig-health';

// #324: global setup probes the rig once after the reseed. A rig that panicked
// during an ingredient rescan answers HTTP 500 until it restarts (PLATFORM-NOTES #38).
const answering = (status: number) => vi.fn<RigFetch>(async () => ({ status }));

describe('#324 — the journey rig health probe', () => {
  it('accepts HTTP 200 with one request and no output', async () => {
    const fetchFn = answering(200);
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    try {
      await expect(assertRigHealthy(fetchFn)).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
    expect(fetchFn.mock.calls).toEqual([[RIG_HEALTH_URL]]);
    expect(RIG_HEALTH_URL).toBe('http://127.0.0.1:19998/api/burrito/metadata/summaries');
  });

  it('refuses HTTP 500 and names the endpoint, the status and both scripts', async () => {
    const failure = await assertRigHealthy(answering(500)).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    for (const part of ['/burrito/metadata/summaries', 'HTTP 500', 'stop.zsh', 'run.zsh']) {
      expect(message).toContain(part);
    }
  });

  it('refuses any other non-200 status with that status in the message', async () => {
    await expect(assertRigHealthy(answering(404))).rejects.toThrow(/summaries answered HTTP 404/);
  });

  it('passes a network error through unchanged, so a missing rig is not reported as a sick one', async () => {
    const refused = new TypeError('fetch failed');
    await expect(assertRigHealthy(vi.fn<RigFetch>(async () => { throw refused; }))).rejects.toBe(refused);
  });
});
