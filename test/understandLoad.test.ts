// Round 33 (2026-08-28 adversarial review): the Understand load pipeline.
// F1 — comprehension is RE-READ under the sequence guard after the help
// awaits: a note saved while they ran must never be clobbered by dispatching
// the pre-load snapshot. F2 — pins LOADED-BUT-ABSENT is a legal state (D30.3
// "no pins recorded"): the screen proceeds with unpinned help slots instead
// of waiting forever.
import { describe, expect, it } from 'vitest';
import { __performLoadUnderstandForTests as loadUnderstand, __loadProjectPinsForTests as loadPins, __loadSourcePanesForTests as loadSourcePanes, __setInstalledCacheForTests as setInstalledCache, __INSTALLED_SUITE_FOR_TESTS as INSTALLED_SUITE } from '../src/state.jsx';
import { localRepoPathFromRepoPath } from '../src/data/installed';
import { absenceMessageKey } from '../src/data/sourceState';
import en from '../src/i18n/en.json';

const PIN = { repoPath: 'git.door43.org/unfoldingWord/en_ust', sha: 'a'.repeat(40), flavor: 'scripture/textTranslation' };
const notFound = () => Object.assign(new Error('404'), { isNotFound: true });

const ctxWith = ({ pins, pinsLoaded, store }: { pins: unknown; pinsLoaded: boolean; store: Record<string, unknown> }) => {
  const dispatched: Array<Record<string, unknown>> = [];
  const state: Record<string, unknown> = {
    book: 'TIT',
    projectPins: pins,
    projectPinsLoaded: pinsLoaded,
    projectScope: {},
    netEnabled: false,
    understand: null,
  };
  return {
    dispatched,
    ctx: {
      stateRef: { current: state },
      storeRef: { current: store },
      understandSeqRef: { current: 0 },
      dispatch: (a: Record<string, unknown>) => dispatched.push(a),
      actions: {
        resolutionContext: async () => ({
          installed: { '_local_/_sideloaded_/unfoldingword--en_ust': PIN },
          coverage: {},
        }),
        projectFrame: async () => ({ state: 'ready', name: 'eng' }),
      },
      apiClient: {},
    },
  };
};
const finalUnderstand = (dispatched: Array<Record<string, unknown>>) => {
  const patches = dispatched
    .map((d) => (d.patch as Record<string, unknown>)?.understand as Record<string, unknown> | undefined)
    .filter((u) => u && u.loading === false);
  return patches[patches.length - 1];
};

describe('round 33 F1 — a note saved during the help awaits survives the load dispatch', () => {
  it('the final dispatch carries the RE-READ comprehension, not the pre-load snapshot', async () => {
    let release: () => void = () => {};
    let started: () => void = () => {};
    const startedP = new Promise<void>((r) => { started = r; });
    const notes: Array<{ ts: string; chapter: string; verse: string; text: string }> = [];
    const store = {
      readNotes: () => [...notes],
      // The simplified-text read holds the load open — the window in which
      // a comprehension save can land.
      readSourceBook: async () => {
        started();
        await new Promise<void>((r) => { release = r; });
        throw notFound();
      },
    };
    const pins = {
      languageSets: {
        primary: { gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' }, simplifiedText: PIN },
      },
    };
    const { ctx, dispatched } = ctxWith({ pins, pinsLoaded: true, store });
    const load = loadUnderstand(ctx);
    await startedP; // the initial comprehension snapshot has been taken
    notes.push({ ts: '2026-08-28T12:00:00.000Z|0000|a', chapter: '1', verse: '2', text: 'landed mid-load' });
    release();
    await load;
    const understand = finalUnderstand(dispatched);
    expect(understand).toBeTruthy();
    const comprehension = understand!.comprehension as Record<string, { text: string }>;
    expect(comprehension['1:2']?.text).toBe('landed mid-load'); // never clobbered by the stale snapshot
    expect((understand!.simplified as { state: string }).state).toBe('missing');
  });
});

describe('round 33 F2 — pins loaded-but-absent proceeds; pins still loading waits', () => {
  it('with pins ABSENT (loaded), the screen loads: comprehension read, every help slot honestly empty', async () => {
    const store = { readNotes: () => [{ ts: 't1', chapter: '1', verse: '1', text: 'a journal note' }] };
    const { ctx, dispatched } = ctxWith({ pins: null, pinsLoaded: true, store });
    await loadUnderstand(ctx);
    const understand = finalUnderstand(dispatched);
    expect(understand).toBeTruthy();
    expect((understand!.comprehension as Record<string, { text: string }>)['1:1'].text).toBe('a journal note');
    for (const slot of ['notes', 'questions', 'words', 'simplified'] as const) {
      expect((understand![slot] as { state: string; error?: string }), slot).toMatchObject({ state: 'none' });
    }
  });

  it('with pins still LOADING, the screen waits (and clears any previous project data)', async () => {
    const { ctx, dispatched } = ctxWith({ pins: null, pinsLoaded: false, store: {} });
    (ctx.stateRef.current as Record<string, unknown>).understand = { book: 'OLD' };
    await loadUnderstand(ctx);
    expect(dispatched).toEqual([{ type: 'set', patch: { understand: null } }]);
  });
});

describe('round 34 — the three pins-read outcomes are distinct', () => {
  const pinsCtx = (readResources: () => Promise<unknown>) => {
    const dispatched: Array<Record<string, unknown>> = [];
    const store = { readResources };
    return {
      dispatched,
      run: () =>
        new Promise<void>((resolve) => {
          loadPins({
            store,
            repoPath: 'repo/p',
            storeRef: { current: store },
            stateRef: { current: { project: { repoPath: 'repo/p' } } },
            actions: { resolutionContext: async () => ({ installed: {}, coverage: {} }) },
            dispatch: (a: Record<string, unknown>) => {
              dispatched.push(a);
              resolve();
            },
          });
        }),
    };
  };

  it('a RESOLVED-null read is loaded-but-absent (understand proceeds)', async () => {
    const { dispatched, run } = pinsCtx(async () => null);
    await run();
    expect(dispatched[0].patch).toMatchObject({ projectPins: null, projectPinsLoaded: true, projectPinsError: null });
  });

  it('a REJECTED read is a stated error — never loaded-but-absent (no false absence claim, D30)', async () => {
    const { dispatched, run } = pinsCtx(async () => { throw new Error('sidecar corrupt'); });
    await run();
    expect(dispatched[0].patch).toMatchObject({ projectPins: null, projectPinsLoaded: false });
    expect(String((dispatched[0].patch as Record<string, unknown>).projectPinsError)).toMatch(/sidecar corrupt/);
  });
});

describe('round 35 — a summaries outage is a stated, retryable slot error, never a false absence', () => {
  it('every help slot reports the outage; the passage and comprehension stay usable', async () => {
    const store = { readNotes: () => [{ ts: 't1', chapter: '1', verse: '1', text: 'still readable' }] };
    const { ctx, dispatched } = ctxWith({ pins: { languageSets: {} }, pinsLoaded: true, store });
    (ctx.actions as Record<string, unknown>).resolutionContext = async () => ({
      installed: {},
      coverage: {},
      resolutionError: 'summaries endpoint down',
    });
    await loadUnderstand(ctx);
    const understand = finalUnderstand(dispatched);
    expect(understand).toBeTruthy();
    for (const slot of ['notes', 'questions', 'words', 'simplified'] as const) {
      const v = understand![slot] as { state: string; error: string };
      expect(v.state, slot).toBe('error');
      expect(v.error).toContain('summaries endpoint down');
    }
    expect((understand!.comprehension as Record<string, { text: string }>)['1:1'].text).toBe('still readable');
  });
});

describe('round 37 — the source panes come from the PROJECT pins (§5.3), never the machine suite', () => {
  const paneCtx = (state: Record<string, unknown>, readSourceBook: (repo: string) => Promise<{ usfm: string }>) => {
    const dispatched: Array<Record<string, unknown>> = [];
    return {
      dispatched,
      run: () =>
        loadSourcePanes({
          store: { readSourceBook },
          code: 'TIT',
          seq: 1,
          openSeqRef: { current: 1 },
          stateRef: { current: { sourceTab: 'ult', ...state } },
          dispatch: (a: Record<string, unknown>) => dispatched.push(a),
          pins: undefined,
        }),
    };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("the project's own entries drive ids, reads, and the pane version — the tab follows when its id is absent", async () => {
    const entry = { id: 'glt', repoPath: 'git.door43.org/es-419_gl/es-419_glt', sha: 'd'.repeat(40), version: 'v12', flavor: 'scripture/textTranslation' };
    const reads: string[] = [];
    const { dispatched, run } = paneCtx(
      { projectPins: { extraScripture: [entry] }, projectPinsLoaded: true },
      async (repo) => { reads.push(repo); return { usfm: '\\id TIT\n\\c 1\n\\p\n\\v 1 uno\n' }; },
    );
    run();
    await flush();
    expect(dispatched[0].patch).toMatchObject({ sourcePanes: ['glt'], sourceTab: 'glt' });
    expect(reads.some((r) => r.includes('es-419_glt') || r.includes('es-419_gl'))).toBe(true);
    const pane = dispatched.find((d) => d.type === 'setSource') as Record<string, unknown>;
    expect((pane.value as { version: string }).version).toBe('v12');
  });

  it('a project that legally OMITS extraScripture gets the stated no-panes state — never the defaults', async () => {
    const { dispatched, run } = paneCtx({ projectPins: {}, projectPinsLoaded: true }, async () => {
      throw new Error('must not read');
    });
    run();
    await flush();
    expect(dispatched[0].patch).toMatchObject({ sourcePanes: [] });
    expect(dispatched.filter((d) => d.type === 'setSource')).toEqual([]);
  });

  it('pins still LOADING defers — nothing dispatched, nothing read', async () => {
    const { dispatched, run } = paneCtx({ projectPins: null, projectPinsLoaded: false }, async () => {
      throw new Error('must not read');
    });
    run();
    await flush();
    expect(dispatched).toEqual([]);
  });

  it("a pane read failure is a stated pane error; a confirmed not-found is 'missing' (A3/D30)", async () => {
    const entry = { id: 'ult', repoPath: 'git.door43.org/unfoldingWord/en_ult', sha: 'a'.repeat(40), flavor: 'scripture/textTranslation' };
    const down = paneCtx(
      { projectPins: { extraScripture: [entry] }, projectPinsLoaded: true },
      async () => { throw new Error('socket hang up'); },
    );
    down.run();
    await flush();
    const errPane = down.dispatched.find((d) => d.type === 'setSource') as Record<string, unknown>;
    expect((errPane.value as { error: string }).error).toMatch(/socket hang up/);
    const absent = paneCtx(
      { projectPins: { extraScripture: [entry] }, projectPinsLoaded: true },
      async () => { throw notFound(); },
    );
    absent.run();
    await flush();
    const missingPane = absent.dispatched.find((d) => d.type === 'setSource') as Record<string, unknown>;
    expect(missingPane.value).toBe('missing');
  });
});

describe('#164 — a confirmed not-found pane read names WHICH absence (D30)', () => {
  // Inputs come from the system under test, never from memory (AGENTS.md): the pin is
  // the shipped English package's own `ult` entry (repoPath, version, sha as pinned in
  // src/state.jsx), and the install key is the path the installer derives for it.
  const entry = INSTALLED_SUITE.extraScripture.find((e: { id: string }) => e.id === 'ult')!;
  const installKey = localRepoPathFromRepoPath(entry.repoPath);
  const notFoundRead = async () => { throw notFound(); };
  const paneCtx = (state: Record<string, unknown>, readSourceBook: (repo: string) => Promise<{ usfm: string }>) => {
    const dispatched: Array<Record<string, unknown>> = [];
    return {
      dispatched,
      run: () =>
        loadSourcePanes({
          store: { readSourceBook },
          code: 'GEN',
          seq: 1,
          openSeqRef: { current: 1 },
          stateRef: { current: { sourceTab: 'ult', projectPins: { extraScripture: [entry] }, projectPinsLoaded: true, ...state } },
          dispatch: (a: Record<string, unknown>) => dispatched.push(a),
          pins: undefined,
        }),
    };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const paneValue = (dispatched: Array<Record<string, unknown>>) =>
    (dispatched.find((d) => d.type === 'setSource') as Record<string, unknown>).value;

  it('the pin is a real identity, not an invented one', () => {
    expect(entry.repoPath).toMatch(/^git\.door43\.org\//);
    expect(entry.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(installKey).toMatch(/^_local_\/_sideloaded_\//);
  });

  it("the pinned source is not on this computer → 'not-installed', never 'missing'", async () => {
    // The resolver HAS run and found nothing: the pilot's offline install (#163).
    setInstalledCache({});
    const { dispatched, run } = paneCtx({}, notFoundRead);
    run();
    await flush();
    expect(paneValue(dispatched)).toBe('not-installed');
  });

  it("the source is installed at the pinned identity and lacks the book → 'missing'", async () => {
    setInstalledCache({ [installKey]: entry });
    const { dispatched, run } = paneCtx({}, notFoundRead);
    run();
    await flush();
    expect(paneValue(dispatched)).toBe('missing');
  });

  it("negative control: the same repository installed at ANOTHER commit is not this pin → 'not-installed' (D58/D59 exact identity)", async () => {
    const otherSha = entry.sha.endsWith('0') ? `${entry.sha.slice(0, -1)}1` : `${entry.sha.slice(0, -1)}0`;
    setInstalledCache({ [installKey]: { ...entry, sha: otherSha } });
    const { dispatched, run } = paneCtx({}, notFoundRead);
    run();
    await flush();
    expect(paneValue(dispatched)).toBe('not-installed');
  });

  it("before the resolver has run the answer is unknown → the weaker 'missing' stands", async () => {
    setInstalledCache(null);
    const { dispatched, run } = paneCtx({}, notFoundRead);
    run();
    await flush();
    expect(paneValue(dispatched)).toBe('missing');
  });

  it('a transient read failure is still a stated pane error, whatever the install state', async () => {
    setInstalledCache({});
    const { dispatched, run } = paneCtx({}, async () => { throw new Error('socket hang up'); });
    run();
    await flush();
    expect((paneValue(dispatched) as { error: string }).error).toMatch(/socket hang up/);
  });

  it('the two absences map to two different sentences through ONE function', () => {
    expect(absenceMessageKey('not-installed')).toBe('source.notInstalled');
    expect(absenceMessageKey('missing')).toBe('source.unavailable');
    expect(en['source.notInstalled']).toMatch(/not on this computer/);
    expect(en['source.unavailable']).toMatch(/not available for this book/);
  });
});
