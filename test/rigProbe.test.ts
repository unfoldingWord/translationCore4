import { describe, expect, it, vi } from 'vitest';
import { assertRigHealthy, RIG_HEALTH_TIMEOUT_MS, type RigFetch } from '../e2e/rig-health';

// #324: global setup probes the rig once after the reseed. A rig that panicked
// during an ingredient rescan answers HTTP 500 until it restarts (PLATFORM-NOTES #38).
const answering = (status: number) => vi.fn<RigFetch>(async () => ({ status }));

describe('#324 — the journey rig health probe', () => {
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

  it('stops waiting when the endpoint never answers, and names the endpoint and both scripts', async () => {
    // A fetch that honours its signal, like the real one, and never answers on its own.
    const silent = vi.fn<RigFetch>((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const failure = await assertRigHealthy(silent, 20).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    for (const part of ['/burrito/metadata/summaries', 'did not answer in 20 ms', 'stop.zsh', 'run.zsh']) {
      expect(message).toContain(part);
    }
    expect(RIG_HEALTH_TIMEOUT_MS).toBe(10_000);
  });

  it('passes a network error through unchanged, so a missing rig is not reported as a sick one', async () => {
    const refused = new TypeError('fetch failed');
    await expect(assertRigHealthy(vi.fn<RigFetch>(async () => { throw refused; }))).rejects.toBe(refused);
  });
});
