// #641 — Project settings opens with two reads in flight: the settings file
// and the gateway-language lookup. Each completion writes the form. On a
// packaged build, 5 of 35 opens left the Checking language row on its loading
// text (issue #641). The two completions landed before one React render, and
// the second write spread a stale `stateRef` copy over the first.
//
// Written before the code (AGENTS.md, "How to test" rule 3). The ways this
// flow can fail, each a case below:
//
//   1. The settings read finishes after the lookup, with no render between:
//      the lookup's result is lost and the row stays on "Looking for the
//      packages…".
//   2. The lookup finishes after the settings read, with no render between:
//      `loaded`, direction, font and language name are lost and Save stays
//      disabled.
//   3. The lookup fails: the form still loads, Save enables, and the row
//      shows the lookup's error.
//   4. The settings read fails: the row still finishes, Save stays disabled
//      with the read's error.
//   5. Another project's Settings opens before the first project's reads
//      finish: the first project's reads write nothing on the second form.
//   6. Settings closes before the reads finish: nothing is written.
//   7. The project does not open: the form states the error, Save stays
//      disabled, and the row leaves its loading text (no lookup ran).
//
// No render between the completions is modelled as a `stateRef` that is set
// once, after the open, and never again (the pattern of #475 in
// homeObsCard.test.tsx). The reducer is the real one.
import { describe, expect, it } from 'vitest';
import { __performOpenSettingsForTests as openSettings, __reducerForTests as reducer, SCRIPT_FONTS } from '../src/state.jsx';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
/** Every microtask queued so far runs, and nothing renders. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const A = { id: '_local_/_local_/alef', name: 'Alef', languageTag: 'ar', flavor: 'textTranslation', scriptDirection: 'ltr', bookCodes: ['TIT'] };
const B = { id: '_local_/_local_/bet', name: 'Bet', languageTag: 'es', flavor: 'textTranslation', scriptDirection: 'ltr', bookCodes: ['TIT'] };
const FILE_A = { textDirection: 'rtl', textFont: SCRIPT_FONTS[2], languageName: 'العربية' };
const FILE_B = { textDirection: 'ltr', textFont: SCRIPT_FONTS[1], languageName: 'Español' };

type Reads = { settings: Deferred<unknown>; resources: Deferred<unknown>; context: Deferred<unknown> };

/** A harness: the real reducer, a `stateRef` frozen after the open, and one
 * project's reads under the test's control. */
function harness() {
  let state: Record<string, unknown> = { modal: null, st: null, gatewayError: null };
  const stateRef: { current: Record<string, unknown> } = { current: state };
  let renders = 0;
  const dispatch = (action: unknown) => {
    state = reducer(state, action);
    if (renders === 0) { stateRef.current = state; renders = 1; } // one render: the open paints
  };
  const reads = new Map<string, Reads>();
  const open = (project: typeof A, openError?: Error) => {
    const r: Reads = { settings: deferred(), resources: deferred(), context: deferred() };
    reads.set(project.id, r);
    const reader = { readSettings: () => r.settings.promise, readResources: () => r.resources.promise };
    return openSettings({
      project,
      dispatch,
      openReader: async () => { if (openError) throw openError; return reader; },
      resolutionContext: () => r.context.promise,
    });
  };
  const st = () => state.st as Record<string, unknown> & { gw: Record<string, unknown> };
  return { open, reads, st, dispatch, state: () => state };
}

const CONTEXT = { installed: {}, coverage: {}, resolutionError: null };

describe('#641: Project settings finishes loading whichever read lands last', () => {
  it('1. the lookup first, then the settings read, no render between', async () => {
    const h = harness();
    const done = h.open(A);
    await settle();
    expect(h.st().gw.loading).toBe(true);
    const r = h.reads.get(A.id)!;
    r.resources.resolve({ pins: 1 });
    r.context.resolve(CONTEXT);
    await settle();
    expect(h.st().gw.loading).toBe(false);
    r.settings.resolve(FILE_A);
    await done;
    await settle();
    expect(h.st().gw).toMatchObject({ loading: false, error: null, pins: { pins: 1 } });
    expect(h.st()).toMatchObject({ loaded: true, dir: 'rtl', font: SCRIPT_FONTS[2], langName: 'العربية', error: null });
  });

  it('2. the settings read first, then the lookup, no render between', async () => {
    const h = harness();
    const done = h.open(A);
    await settle();
    const r = h.reads.get(A.id)!;
    r.settings.resolve(FILE_A);
    await done;
    expect(h.st().loaded).toBe(true);
    r.resources.resolve({ pins: 1 });
    r.context.resolve(CONTEXT);
    await settle();
    expect(h.st()).toMatchObject({ loaded: true, dir: 'rtl', font: SCRIPT_FONTS[2], langName: 'العربية' });
    expect(h.st().gw).toMatchObject({ loading: false, error: null, pins: { pins: 1 } });
  });

  it('3. the lookup fails: the form loads and the row states the error', async () => {
    const h = harness();
    const done = h.open(A);
    await settle();
    const r = h.reads.get(A.id)!;
    r.resources.reject(new Error('no resources on disk'));
    r.context.resolve(CONTEXT);
    await settle();
    r.settings.resolve(FILE_A);
    await done;
    await settle();
    expect(h.st().gw).toMatchObject({ loading: false, error: 'no resources on disk' });
    expect(h.st()).toMatchObject({ loaded: true, dir: 'rtl', error: null });
  });

  it('4. the settings read fails: the row finishes and Save stays disabled with the error', async () => {
    const h = harness();
    const done = h.open(A);
    await settle();
    const r = h.reads.get(A.id)!;
    r.settings.reject(new Error('settings.json unreadable'));
    await done;
    r.resources.resolve(null);
    r.context.resolve(CONTEXT);
    await settle();
    expect(h.st()).toMatchObject({ loaded: false, error: 'settings.json unreadable' });
    expect(h.st().gw).toMatchObject({ loading: false, error: null });
  });

  it('5. another project opens first: the first project\'s reads write nothing on its form', async () => {
    const h = harness();
    const doneA = h.open(A);
    await settle();
    const doneB = h.open(B);
    await settle();
    expect(h.st().repoPath).toBe(B.id);
    const a = h.reads.get(A.id)!;
    a.settings.resolve(FILE_A);
    a.resources.resolve({ pins: 'A' });
    a.context.resolve(CONTEXT);
    await doneA;
    await settle();
    expect(h.st()).toMatchObject({ repoPath: B.id, loaded: false, langName: '' });
    expect(h.st().gw).toMatchObject({ loading: true, pins: null });
    const b = h.reads.get(B.id)!;
    b.settings.resolve(FILE_B);
    b.resources.resolve({ pins: 'B' });
    b.context.resolve(CONTEXT);
    await doneB;
    await settle();
    expect(h.st()).toMatchObject({ repoPath: B.id, loaded: true, dir: 'ltr', font: SCRIPT_FONTS[1], langName: 'Español' });
    expect(h.st().gw).toMatchObject({ loading: false, pins: { pins: 'B' } });
  });

  it('6. Settings closes before the reads finish: nothing is written', async () => {
    const h = harness();
    const done = h.open(A);
    await settle();
    h.dispatch({ type: 'set', patch: { modal: null, st: null } });
    const r = h.reads.get(A.id)!;
    r.settings.resolve(FILE_A);
    r.resources.resolve({ pins: 1 });
    r.context.resolve(CONTEXT);
    await done;
    await settle();
    expect(h.state().st).toBeNull();
    expect(h.state().modal).toBeNull();
  });

  it('7. the project does not open: the error is stated and the row leaves its loading text', async () => {
    const h = harness();
    await h.open(A, new Error('no such project'));
    await settle();
    expect(h.st()).toMatchObject({ loaded: false, error: 'no such project' });
    expect(h.st().gw).toMatchObject({ loading: false, error: null, options: [] });
  });
});
