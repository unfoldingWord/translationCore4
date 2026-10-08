// D95 (#559): the net gate a step verifies, and the one request boundary
// (guardFetch) that follows the app session's on/off internet state.
import { describe, expect, it } from 'vitest';
import { InternetSwitch, ensureGate, guardFetch, NO_CONSENT, startGate, type NetGate } from '../src/data/internet';

/** A fake platform gate that records every call. `stuck` makes a change a no-op. */
const fakeGate = (on: boolean, opts: { stuck?: boolean; failRead?: boolean; failChange?: boolean } = {}) => {
  const calls: string[] = [];
  const gate: NetGate & { on: boolean; calls: string[] } = {
    on,
    calls,
    async getNetEnabled() {
      calls.push('status');
      if (opts.failRead) throw new Error('no answer');
      return gate.on;
    },
    async enableNet() {
      calls.push('enable');
      if (opts.failChange) throw new Error('refused');
      if (!opts.stuck) gate.on = true;
    },
    async disableNet() {
      calls.push('disable');
      if (opts.failChange) throw new Error('refused');
      if (!opts.stuck) gate.on = false;
    },
  };
  return gate;
};

describe('the net gate', () => {
  it('goes off at start, whatever was stored', async () => {
    const gate = fakeGate(true);
    await startGate(gate);
    expect(gate.on).toBe(false);
    expect(gate.calls).toEqual(['disable']);
  });

  it('a start whose disable fails does not throw', async () => {
    await expect(startGate(fakeGate(true, { failChange: true }))).resolves.toBeUndefined();
  });

  it('the first step turns it on and reads it back', async () => {
    const gate = fakeGate(false);
    expect(await ensureGate(gate)).toBe(true);
    expect(gate.calls).toEqual(['status', 'enable', 'status']);
  });

  it('a gate already on is not changed', async () => {
    const gate = fakeGate(true);
    expect(await ensureGate(gate)).toBe(true);
    expect(gate.calls).toEqual(['status']);
  });

  it('an enable that does not read back on is a failure', async () => {
    expect(await ensureGate(fakeGate(false, { stuck: true }))).toBe(false);
    expect(await ensureGate(fakeGate(false, { failChange: true }))).toBe(false);
    expect(await ensureGate(fakeGate(false, { failRead: true }))).toBe(false);
  });
});

describe('the request boundary', () => {
  const ORIGIN = 'http://localhost:5199';
  const recorder = () => {
    const seen: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response('{}');
    }) as typeof fetch;
    return { seen, fetchFn };
  };
  const external = [
    'https://git.door43.org/api/v1/user',
    'http://127.0.0.1:19998/api/net/status', // another origin is not the local server
    '/api/gitea/remote-repos/git.door43.org/unfoldingWord',
    `${ORIGIN}/api/git/push/_local_/_local_/p`,
  ];

  it('starts off, and refuses the internet before it is sent', async () => {
    const { seen, fetchFn } = recorder();
    const internet = new InternetSwitch();
    expect(internet.on).toBe(false);
    const guarded = guardFetch(fetchFn, internet, ORIGIN);
    for (const url of external) await expect(guarded(url), url).rejects.toThrow(NO_CONSENT);
    await expect(guarded(new Request('https://qa.door43.org/x'))).rejects.toThrow(NO_CONSENT);
    expect(seen).toEqual([]);
  });

  it('sends local requests to the platform at any time', async () => {
    const { seen, fetchFn } = recorder();
    const guarded = guardFetch(fetchFn, new InternetSwitch(), ORIGIN);
    await guarded('/api/net/status');
    await guarded(`${ORIGIN}/api/git/remotes/_local_/_local_/p`);
    await guarded('/api/client-settings/uw-tc4');
    expect(seen).toHaveLength(3);
  });

  it('control: while the internet is on the same requests are sent', async () => {
    const { seen, fetchFn } = recorder();
    const internet = new InternetSwitch();
    const guarded = guardFetch(fetchFn, internet, ORIGIN);
    internet.on = true;
    for (const url of external) await guarded(url);
    expect(seen).toEqual(external);
  });

  it('a switch takes effect for the next request: off refuses at once, on allows again', async () => {
    const { seen, fetchFn } = recorder();
    const internet = new InternetSwitch();
    const guarded = guardFetch(fetchFn, internet, ORIGIN);
    internet.on = true;
    await guarded(external[0]);
    internet.on = false;
    await expect(guarded(external[0])).rejects.toThrow(NO_CONSENT);
    await expect(guarded(external[2])).rejects.toThrow(NO_CONSENT);
    internet.on = true;
    await guarded(external[2]);
    expect(seen).toEqual([external[0], external[2]]);
  });

  it('a request sent while on finishes after the switch goes off', async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => { answer = resolve; });
    const fetchFn = (async () => {
      await held;
      return new Response('sent');
    }) as typeof fetch;
    const internet = new InternetSwitch();
    const guarded = guardFetch(fetchFn, internet, ORIGIN);
    internet.on = true;
    const inFlight = guarded(external[0]);
    internet.on = false;
    answer();
    expect(await (await inFlight).text()).toBe('sent');
    await expect(guarded(external[0])).rejects.toThrow(NO_CONSENT);
  });
});
