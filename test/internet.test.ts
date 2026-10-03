// D88 (#514): the "Ask before using the internet" preference, the net gate a
// permitted task verifies, and the one request boundary (guardFetch).
import { describe, expect, it } from 'vitest';
import { Consent, ensureGate, guardFetch, NO_CONSENT, startGate, storedAsk, withAsk, type NetGate } from '../src/data/internet';

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

describe('the stored preference', () => {
  it('asks unless the document says askInternet: false', () => {
    expect(storedAsk({ askInternet: false })).toBe(false);
    for (const doc of [{}, { askInternet: true }, { askInternet: 'false' }, { askInternet: 0 }, null, undefined])
      expect(storedAsk(doc as Record<string, unknown> | null | undefined)).toBe(true);
  });

  it('an old Internet / Local choice does not turn the confirmations off', () => {
    expect(storedAsk({ internet: true })).toBe(true);
  });

  it('"do not ask" adds the one flag, "ask" removes it, and other keys stay', () => {
    expect(withAsk({ lastUsed: { a: 1 } }, false)).toEqual({ lastUsed: { a: 1 }, askInternet: false });
    expect(withAsk({ lastUsed: { a: 1 }, askInternet: false }, true)).toEqual({ lastUsed: { a: 1 } });
  });
});

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

  it('a permitted task turns it on and reads it back', async () => {
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

describe('consent', () => {
  it('is active only while a task holds it, with tasks that overlap', () => {
    const consent = new Consent();
    expect(consent.active()).toBe(false);
    const first = consent.hold();
    const second = consent.hold();
    first();
    first(); // a second release of the same task changes nothing
    expect(consent.active()).toBe(true);
    second();
    expect(consent.active()).toBe(false);
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

  it('refuses the internet outside a permitted task, before it is sent', async () => {
    const { seen, fetchFn } = recorder();
    const guarded = guardFetch(fetchFn, new Consent(), ORIGIN);
    for (const url of external) await expect(guarded(url), url).rejects.toThrow(NO_CONSENT);
    await expect(guarded(new Request('https://qa.door43.org/x'))).rejects.toThrow(NO_CONSENT);
    expect(seen).toEqual([]);
  });

  it('sends local requests to the platform at any time', async () => {
    const { seen, fetchFn } = recorder();
    const guarded = guardFetch(fetchFn, new Consent(), ORIGIN);
    await guarded('/api/net/status');
    await guarded(`${ORIGIN}/api/git/remotes/_local_/_local_/p`);
    await guarded('/api/client-settings/uw-tc4');
    expect(seen).toHaveLength(3);
  });

  it('control: inside a permitted task the same requests are sent', async () => {
    const { seen, fetchFn } = recorder();
    const consent = new Consent();
    const guarded = guardFetch(fetchFn, consent, ORIGIN);
    const release = consent.hold();
    for (const url of external) await guarded(url);
    release();
    expect(seen).toEqual(external);
    await expect(guarded(external[0])).rejects.toThrow(NO_CONSENT);
  });
});
