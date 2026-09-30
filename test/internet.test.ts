// D86 points 2 and 3 (#486): where the net gate starts, and how a change is stored.
import { describe, expect, it } from 'vitest';
import { changeInternet, internetBusy, startInternet, storedInternet, withInternet, type NetGate } from '../src/data/internet';

/** A fake platform gate that records every call. `stuck` makes a change a no-op. */
const fakeGate = (on: boolean, opts: { stuck?: boolean; failRead?: boolean } = {}) => {
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
      if (!opts.stuck) gate.on = true;
    },
    async disableNet() {
      calls.push('disable');
      if (!opts.stuck) gate.on = false;
    },
  };
  return gate;
};

describe('the stored choice', () => {
  it('is Internet only when the document says internet: true', () => {
    expect(storedInternet({ internet: true })).toBe(true);
    for (const doc of [{}, { internet: false }, { internet: 'true' }, { internet: 1 }, null, undefined])
      expect(storedInternet(doc as Record<string, unknown> | null | undefined)).toBe(false);
  });

  it('Internet adds the one flag, Local removes it, and other keys stay', () => {
    expect(withInternet({ lastUsed: { a: 1 } }, true)).toEqual({ lastUsed: { a: 1 }, internet: true });
    expect(withInternet({ lastUsed: { a: 1 }, internet: true }, false)).toEqual({ lastUsed: { a: 1 } });
  });
});

describe('startInternet', () => {
  it('a stored Internet turns the gate on', async () => {
    const gate = fakeGate(false);
    expect(await startInternet(gate, async () => ({ internet: true }))).toBe(true);
    expect(gate.calls).toEqual(['enable', 'status']);
  });

  it('no stored choice turns a gate that starts on (pankosmia-web 0.18.10) off: a new installation is Local', async () => {
    const gate = fakeGate(true);
    expect(await startInternet(gate, async () => ({}))).toBe(false);
    expect(gate.calls).toEqual(['disable', 'status']);
  });

  it('a stored Local turns the gate off', async () => {
    const gate = fakeGate(true);
    expect(await startInternet(gate, async () => ({ internet: false }))).toBe(false);
  });

  it('a settings document that cannot be read is Local', async () => {
    const gate = fakeGate(true);
    expect(await startInternet(gate, async () => { throw new Error('storage_id.json missing'); })).toBe(false);
    expect(gate.calls).toEqual(['disable', 'status']);
  });

  it('reports what the server holds, not what was asked: an unanswered status read is Local', async () => {
    expect(await startInternet(fakeGate(false, { stuck: true }), async () => ({ internet: true }))).toBe(false);
    expect(await startInternet(fakeGate(true, { failRead: true }), async () => ({ internet: true }))).toBe(false);
  });
});

describe('changeInternet', () => {
  it('a change that the server confirms is stored', async () => {
    const gate = fakeGate(false);
    const stored: boolean[] = [];
    expect(await changeInternet(gate, true, async (v) => { stored.push(v); })).toEqual({ allowed: true, changed: true });
    expect(await changeInternet(gate, false, async (v) => { stored.push(v); })).toEqual({ allowed: false, changed: true });
    expect(stored).toEqual([true, false]);
  });

  it('a gate that does not change stores nothing and reports the gate the server holds', async () => {
    const gate = fakeGate(false, { stuck: true });
    const stored: boolean[] = [];
    expect(await changeInternet(gate, true, async (v) => { stored.push(v); })).toEqual({ allowed: false, changed: false });
    expect(stored).toEqual([]);
  });

  it('a store failure keeps the change for this session', async () => {
    const gate = fakeGate(false);
    expect(await changeInternet(gate, true, async () => { throw new Error('write failed'); })).toEqual({ allowed: true, changed: true });
    expect(gate.on).toBe(true);
  });
});

describe('internetBusy', () => {
  it('is true while a share, a download, an update check or the import lookup runs', () => {
    expect(internetBusy({})).toBe(false);
    expect(internetBusy({ shareCard: { a: { busy: false } }, src: { dl: null }, fix: null, upgrade: {}, im: null })).toBe(false);
    for (const st of [
      { shareCard: { a: { busy: true } } },
      { sh: { busy: true } },
      { src: { dl: 'run' } },
      { fix: { busy: 'fetch' } },
      { upgrade: { checking: true } },
      { upgrade: { installing: 'en' } },
      { im: { versions: { looking: true } } },
    ]) expect(internetBusy(st), JSON.stringify(st)).toBe(true);
  });
});
