import { describe, expect, it, vi } from 'vitest';
import { prepareRig } from '../e2e/rig-setup';

describe('journey rig setup', () => {
  it('seeds the rig before checking its health', async () => {
    const events: string[] = [];

    await prepareRig(
      () => events.push('seed'),
      async () => { events.push('health'); },
    );

    expect(events).toEqual(['seed', 'health']);
  });

  it('does not probe after a seed failure', async () => {
    const failure = new Error('seed failed');
    const healthCheck = vi.fn(async () => undefined);

    await expect(prepareRig(() => { throw failure; }, healthCheck)).rejects.toBe(failure);
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it('propagates a health failure after a successful seed', async () => {
    const failure = new Error('health failed');
    const seed = vi.fn(() => undefined);

    await expect(prepareRig(seed, async () => { throw failure; })).rejects.toBe(failure);
    expect(seed).toHaveBeenCalledOnce();
  });
});
