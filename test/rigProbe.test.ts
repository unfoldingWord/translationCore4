import { describe, expect, it, vi } from 'vitest';
import {
  assertRigHealthy,
  RIG_HEALTH_TIMEOUT_MS,
  RIG_HEALTH_URL,
  RIG_VERSION_URL,
  type RigFetch,
  waitForRigReady,
} from '../e2e/rig-health';

const fetchWithStatus = (status: number) => vi.fn<RigFetch>(async () => ({ status }));

describe('Pankosmia rig health probe', () => {
  it('accepts a healthy metadata response without logging', async () => {
    const fetchFn = fetchWithStatus(200);
    const consoleSpies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];
    const streamSpies = [
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
    ];

    try {
      await expect(assertRigHealthy(fetchFn)).resolves.toBeUndefined();

      for (const consoleSpy of consoleSpies) {
        expect(consoleSpy).not.toHaveBeenCalled();
      }
      for (const streamSpy of streamSpies) {
        expect(streamSpy).not.toHaveBeenCalled();
      }
    } finally {
      for (const consoleSpy of consoleSpies) {
        consoleSpy.mockRestore();
      }
      for (const streamSpy of streamSpies) {
        streamSpy.mockRestore();
      }
    }

    expect(fetchFn.mock.calls[0]?.[0]).toBe('http://127.0.0.1:19998/api/burrito/metadata/summaries');
    expect(fetchFn.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(fetchFn.mock.calls).toHaveLength(1);
  });

  it('reports the poisoned-rig recovery steps for HTTP 500', async () => {
    const fetchFn = fetchWithStatus(500);

    await expect(assertRigHealthy(fetchFn)).rejects.toThrow(
      new RegExp(`${RIG_HEALTH_URL}.*HTTP 500.*poisoned.*stop\\.zsh.*run\\.zsh`, 's'),
    );
    expect(fetchFn.mock.calls).toHaveLength(1);
  });

  it('treats an HTTP 500 as a started server so the health probe can classify it', async () => {
    const fetchFn = fetchWithStatus(500);

    await expect(waitForRigReady(fetchFn)).resolves.toBeUndefined();
    expect(fetchFn.mock.calls).toEqual([
      [RIG_VERSION_URL, expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })],
    ]);
  });

  it('reports another non-200 response without calling it poisoned', async () => {
    const fetchFn = fetchWithStatus(404);
    let failure: unknown;

    try {
      await assertRigHealthy(fetchFn);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error('expected the probe to reject');
    expect(failure.message).toContain(`GET ${RIG_HEALTH_URL} returned HTTP 404`);
    expect(failure.message).not.toContain('poisoned');
    expect(fetchFn.mock.calls).toHaveLength(1);
  });

  it('preserves a network failure from the underlying fetch', async () => {
    const failure = new Error('connect ECONNREFUSED');
    const fetchFn = vi.fn<RigFetch>(async () => {
      throw failure;
    });

    await expect(assertRigHealthy(fetchFn)).rejects.toBe(failure);
    expect(fetchFn.mock.calls).toHaveLength(1);
  });

  it('bounds a request that never responds', async () => {
    const fetchFn = vi.fn<RigFetch>(() => new Promise(() => undefined));

    await expect(assertRigHealthy(fetchFn, 10)).rejects.toThrow(
      new RegExp(`timed out after 10ms.*${RIG_HEALTH_URL}.*run\\.zsh`, 's'),
    );
    expect(fetchFn.mock.calls).toHaveLength(1);
  });

  it('keeps the production timeout explicit', () => {
    expect(RIG_HEALTH_TIMEOUT_MS).toBe(5_000);
  });
});
