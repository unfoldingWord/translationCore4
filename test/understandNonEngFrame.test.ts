import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __makeNoteWriterForTests as makeNoteWriter,
  __performLoadUnderstandForTests as loadUnderstand,
  noteKeyFor,
} from '../src/state.jsx';
import { forgetProjectFrames, resolveProjectFrame } from '../src/data/projectFrame';
import { forgetCompiledSchemes } from '../src/data/mapReference';
import { t } from '../src/i18n';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SYN_PATH = path.resolve(process.cwd(), 'test/fixtures/vrs-synthetic/syn.json');
const synBytes = fs.readFileSync(SYN_PATH, 'utf8');
const synDoc = JSON.parse(synBytes);

const ENG_PATH = path.resolve(process.cwd(), 'test/fixtures/vrs/eng.json');
const engDoc = JSON.parse(fs.readFileSync(ENG_PATH, 'utf8'));

const REPO = '_local_/_local_/syn-project';
const SYN_TIT = '\\id TIT\n\\c 1\n\\p\n\\v 15 ___\n\\c 2\n\\p\n\\v 1 ___\n\\v 2-3 ___\n\\v 4 ___\n';

interface Note {
  ts: string;
  chapter: string;
  verse: string;
  text: string;
}

interface Target {
  store: {
    readVersification: () => Promise<{ name: string; bytes: string } | null>;
    addNote: (book: string, c: number | string, v: number | string, text: string) => Promise<void>;
    readNotes: (book: string) => Note[];
  };
  repoPath: string;
  book: string;
  chapter: number | string;
  verse: number | string;
  projectFrame: boolean;
}

describe('Understand comment round-trip on non-eng frame (#117)', () => {
  let notes: Note[];
  let noteCounter: number;
  let register: { name: string; bytes: string };
  let store: {
    readVersification: () => Promise<{ name: string; bytes: string } | null>;
    addNote: (book: string, c: number | string, v: number | string, text: string) => Promise<void>;
    readNotes: (book: string) => Note[];
  };
  let addNoteSpy: ReturnType<
    typeof vi.fn<
      (book: string, c: number | string, v: number | string, text: string) => Promise<void>
    >
  >;
  let api: {
    getVersifications: () => Promise<string[]>;
    getVersification: (n: string) => Promise<unknown>;
  };
  let dispatchedWriter: Array<Record<string, unknown>>;
  let targets: Map<string, Target>;
  let writer: ReturnType<typeof makeNoteWriter>;

  const targetFor = (chapter: number | string, verse: number | string): string => {
    const key = noteKeyFor(REPO, 'TIT', chapter, verse);
    targets.set(key, {
      store,
      repoPath: REPO,
      book: 'TIT',
      chapter,
      verse,
      projectFrame: false,
    });
    return key;
  };

  const ctxWith = (deps: { store: typeof store; api: typeof api }) => {
    const dispatched: Array<Record<string, unknown>> = [];
    const state: Record<string, unknown> = {
      book: 'TIT',
      bookRaw: SYN_TIT,
      projectPins: null,
      projectPinsLoaded: true,
      projectScope: {},
      netEnabled: false,
      understand: null,
    };
    return {
      dispatched,
      ctx: {
        stateRef: { current: state },
        storeRef: { current: deps.store },
        understandSeqRef: { current: 0 },
        dispatch: (a: Record<string, unknown>) => dispatched.push(a),
        actions: {
          resolutionContext: async () => ({
            installed: {},
            coverage: {},
          }),
          projectFrame: () => resolveProjectFrame(REPO, deps),
        },
        apiClient: deps.api,
      },
    };
  };

  const finalUnderstand = (dispatched: Array<Record<string, unknown>>) => {
    const patches = dispatched
      .map(
        (d) =>
          (d.patch as Record<string, unknown>)?.understand as Record<string, unknown> | undefined,
      )
      .filter((u) => u && u.loading === false);
    return patches[patches.length - 1];
  };

  beforeEach(() => {
    forgetProjectFrames();
    forgetCompiledSchemes();
    notes = [];
    noteCounter = 0;
    register = { name: 'syn', bytes: synBytes };
    addNoteSpy = vi.fn(
      async (_book: string, c: number | string, v: number | string, text: string) => {
        notes.push({
          ts: String(++noteCounter).padStart(4, '0'),
          chapter: String(c),
          verse: String(v),
          text,
        });
      },
    );
    store = {
      readVersification: async () => register,
      addNote: async (book: string, c: number | string, v: number | string, text: string) => {
        await addNoteSpy(book, c, v, text);
      },
      readNotes: () => notes,
    };
    api = {
      getVersifications: async () => ['eng', 'lxx', 'org', 'rsc', 'rso', 'vul', 'syn'],
      getVersification: async (n: string) => {
        if (n === 'syn') return synDoc;
        if (n === 'eng') return engDoc;
        throw new Error(`unknown scheme: ${n}`);
      },
    };
    dispatchedWriter = [];
    targets = new Map();
    writer = makeNoteWriter({
      noteTargetsRef: { current: targets },
      dispatch: (a: Record<string, unknown>) => dispatchedWriter.push(a),
      apiClient: api,
    });
  });

  it('the syn register resolves to a ready frame', async () => {
    const frame = await resolveProjectFrame(REPO, { store, api });
    expect(frame).toMatchObject({
      name: 'syn',
      source: 'recorded',
      state: 'ready',
    });
    expect(frame.schemes.eng).toBeDefined();
    expect(frame.schemes.syn).toBeDefined();
  });

  it('round trip: eng TIT 1:16 journals under syn TIT 2:1 and reloads into the unit that shows eng 1:16', async () => {
    const text = 'persisted note on 1:16';
    const key = targetFor(1, '16');
    await writer(key, text);

    expect(addNoteSpy).toHaveBeenCalledTimes(1);
    expect(addNoteSpy).toHaveBeenCalledWith('TIT', 2, 1, text);

    expect(dispatchedWriter).toEqual([
      expect.objectContaining({
        type: 'noteSaved',
        repoPath: REPO,
        book: 'TIT',
        key: '1:16',
        text,
      }),
    ]);

    const { ctx, dispatched: loadDispatched } = ctxWith({ store, api });
    await loadUnderstand(ctx);
    const understand = finalUnderstand(loadDispatched);
    expect(understand).toBeDefined();

    const comprehension = understand!.comprehension as Record<string, { text: string }>;
    expect(comprehension['2:1'].text).toBe(text);

    const sourceRefs = understand!.sourceRefs as Record<
      string,
      Array<{ c: number; v: string; pc: number | string; pv: string }>
    >;
    expect(sourceRefs['2']).toBeDefined();
    expect(sourceRefs['2']).toContainEqual(expect.objectContaining({ c: 1, v: '16', pv: '1' }));
    const ref = sourceRefs['2'].find((r) => r.c === 1 && r.v === '16' && r.pv === '1');
    expect(String(ref?.pc)).toBe('2');
  });

  it('span round trip: eng TIT 2:1-2 journals under syn TIT 2:2-3', async () => {
    const text = 'persisted span note';
    const key = targetFor(2, '1-2');
    await writer(key, text);

    expect(addNoteSpy).toHaveBeenCalledWith('TIT', 2, '2-3', text);

    const { ctx, dispatched: loadDispatched } = ctxWith({ store, api });
    await loadUnderstand(ctx);
    const understand = finalUnderstand(loadDispatched);
    expect(understand).toBeDefined();

    const comprehension = understand!.comprehension as Record<string, { text: string }>;
    expect(comprehension['2:2-3'].text).toBe(text);

    const sourceRefs = understand!.sourceRefs as Record<
      string,
      Array<{ c: number; v: string; pc: number | string; pv: string }>
    >;
    expect(sourceRefs['2']).toBeDefined();
    expect(sourceRefs['2']).toContainEqual(expect.objectContaining({ c: 2, v: '1-2', pv: '2-3' }));
  });

  it('refusal: eng TIT 3:15 has no place in syn', async () => {
    const key = targetFor(3, '15');
    await expect(writer(key, 'never saved')).rejects.toThrow(t('understand.saveUnmappable'));
    expect(notes).toEqual([]);
    expect(dispatchedWriter).toEqual([]);
  });

  it('refusal: frame unavailable writes nothing', async () => {
    const failingApi = {
      ...api,
      getVersification: async (n: string) => {
        if (n === 'syn') throw new Error('network down');
        return api.getVersification(n);
      },
    };
    const failingWriter = makeNoteWriter({
      noteTargetsRef: { current: targets },
      dispatch: (a: Record<string, unknown>) => dispatchedWriter.push(a),
      apiClient: failingApi,
    });
    const key = targetFor(1, '16');
    await expect(failingWriter(key, 'never saved')).rejects.toThrow(t('understand.saveUnmappable'));
    expect(notes).toEqual([]);
    expect(dispatchedWriter).toEqual([]);
  });

  it('refusal: frame unavailable loads nothing', async () => {
    // A note IS on disk under the project key; an unavailable frame must not
    // surface it under a guessed identity (antagonist round 1).
    notes.push({ ts: '0001', chapter: '2', verse: '1', text: 'stored under syn 2:1' });
    const failingApi = {
      ...api,
      getVersification: async (n: string) => {
        if (n === 'syn') throw new Error('network down');
        return api.getVersification(n);
      },
    };
    const { ctx, dispatched: loadDispatched } = ctxWith({ store, api: failingApi });
    await loadUnderstand(ctx);
    const understand = finalUnderstand(loadDispatched);
    expect(understand).toBeDefined();
    expect(understand!.comprehension).toBeNull();
    expect(understand!.sourceRefs).toEqual({});
  });

  it('refusal: frame unknown writes nothing', async () => {
    register = { name: 'unrecorded', bytes: '{"maxVerses":{"TIT":["1"]}}' };
    const apiForUnknown = {
      ...api,
      getVersifications: async () => ['eng', 'syn'],
    };
    const frame = await resolveProjectFrame(REPO, { store, api: apiForUnknown });
    expect(frame.state).toBe('unknown');

    const unknownWriter = makeNoteWriter({
      noteTargetsRef: { current: targets },
      dispatch: (a: Record<string, unknown>) => dispatchedWriter.push(a),
      apiClient: apiForUnknown,
    });
    const key = targetFor(1, '16');
    await expect(unknownWriter(key, 'never saved')).rejects.toThrow(t('understand.saveUnmappable'));
    expect(notes).toEqual([]);
    expect(dispatchedWriter).toEqual([]);
  });
});
