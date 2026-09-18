// #289 (J21) — the application state around the story screen, against the fake
// rig and the vendored pankosmia `text_stories` template: an OBS project
// routes to its stories and never to a book; the first open lands on story 1;
// the persisted story record resumes; a `currentScope` book code is never read
// as a story; a story switch waits behind a failed write; a save is one
// operation for one unit and byte-strict outside it; and the draft percentage
// moves on a durable frame write only. Every story number, frame number and
// byte comes from the template project the store lists.
import { describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { StoryScheduler } from '../src/data/storyScheduler';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';
import { __obsStoryForTests as obs } from '../src/state.jsx';
import { EN_HELPS, INSTALLED_SUITE } from '../src/data/installedSuite';
import { localRepoPathFromRepoPath } from '../src/data/installed';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const REPO = '_local_/_local_/historias';
const TEMPLATE = path.resolve(process.cwd(), 'conformance/fixtures/text_stories/ingredients');
const OBS_META = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'conformance/sample-burrito-obs/metadata.json'), 'utf8'),
) as Record<string, unknown>;

const templateFiles = (): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const ipath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), ipath);
      else out[ipath] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    }
  };
  walk(TEMPLATE, '');
  return out;
};

const publishedEvents = async (rig: JournalingRig): Promise<JournalEvent[]> => {
  const project = rig.repos.get(REPO);
  const out: JournalEvent[] = [];
  for (const ipath of [...(project?.files.keys() ?? [])].sort()) {
    if (!/^checking\/journal\/[a-z0-9-]+\/segments\//.test(ipath)) continue;
    const verdict = await validateSegment(project!.files.get(ipath) ?? '');
    if (!verdict.ok) throw new Error(`invalid segment on disk ${ipath}: ${verdict.reason}`);
    out.push(...verdict.events);
  }
  return out;
};

type State = Record<string, unknown> & { storyNumber: number | null; story: { number: number } | null };

/** What the open path seeds the scheduler with: the story's current text. */
const seedFrom = async (scheduler: StoryScheduler, store: JournalingStore, n: number) => {
  const { story } = await store.readStory(n);
  scheduler.seed({ kind: 'title', story: n }, story.title);
  story.frames.forEach((frame, index) => scheduler.seed({ kind: 'frame', story: n, frame: index + 1 }, frame.text));
  scheduler.seed({ kind: 'ref', story: n }, story.ref || '');
  return story;
};

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-09-17T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const project = rig.createRepo(REPO, templateFiles(), structuredClone(OBS_META));
  project.commits.push('Initial commit');
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  const summary = await store.open(REPO);
  const state: State = {
    project: { ...summary, repoPath: REPO },
    storyNumbers: [],
    storyNumber: null,
    story: null,
    obsStoryByProject: {},
    projectPins: null,
  };
  const stateRef = { current: state };
  const storeRef = { current: store };
  const dispatch = (action: { type: string; patch?: Record<string, unknown> }) => {
    if (action.type === 'set') Object.assign(stateRef.current, action.patch);
  };
  const remembered: Array<[string, number]> = [];
  const open = (storyNumber: number, saveRefs: Array<{ current: StoryScheduler | null }> = [], scheduler: StoryScheduler | null = null) =>
    obs.openObsStory({
      storyNumber,
      resourcesOverride: undefined,
      context: {},
      stateRef,
      storeRef,
      saveRefs,
      dispatch,
      api,
      resolveContext: async () => ({ installed: {} }),
      scheduler,
      rememberObsStory: (repoPath: string, number: number) => remembered.push([repoPath, number]),
    });
  return { rig, api, store, summary, state, stateRef, storeRef, dispatch, open, remembered };
};

const openContent = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  summary: { flavor: string; bookCodes?: string[] },
  bookCode: string | undefined,
) => {
  const actions = {
    openStory: vi.fn<(number: number, resources?: unknown, context?: unknown) => Promise<void>>(async () => {}),
    openBook: vi.fn<(code: string) => Promise<void>>(async () => {}),
  };
  const listStories = vi.spyOn(ctx.store, 'listStories');
  await obs.openProjectContent({
    summary,
    store: ctx.store,
    repoPath: REPO,
    scriptDirection: 'ltr',
    textFont: null,
    bookCode,
    superseded: () => false,
    dispatch: ctx.dispatch,
    actions,
    stateRef: ctx.stateRef,
  });
  return { actions, listStories };
};

describe('#289 — routing and resume', () => {
  it('an OBS project routes to its story catalogue and never to a book: the first open is story 1', async () => {
    const ctx = await setup();
    const numbers = await ctx.store.listStories();
    expect(numbers[0]).toBe(1);
    const { actions, listStories } = await openContent(ctx, ctx.summary, undefined);
    expect(listStories).toHaveBeenCalledTimes(1);
    expect(actions.openBook).not.toHaveBeenCalled();
    expect(actions.openStory).toHaveBeenCalledTimes(1);
    expect(actions.openStory.mock.calls[0][0]).toBe(1);
    expect(ctx.state.storyNumbers).toEqual(numbers);
  });

  it('a Bible project takes the book path and reads no story catalogue', async () => {
    const ctx = await setup();
    const { actions, listStories } = await openContent(ctx, { flavor: 'textTranslation', bookCodes: ['TIT'] }, undefined);
    expect(actions.openBook).toHaveBeenCalledWith('TIT');
    expect(actions.openStory).not.toHaveBeenCalled();
    expect(listStories).not.toHaveBeenCalled();
  });

  it('resumes on the persisted story of this project (the record a restart reloads from client settings)', async () => {
    const ctx = await setup();
    const numbers = await ctx.store.listStories();
    const last = numbers[numbers.length - 1];
    ctx.state.obsStoryByProject = { [REPO]: last, '_local_/_local_/otro': 3 };
    const { actions } = await openContent(ctx, ctx.summary, undefined);
    expect(actions.openStory.mock.calls[0][0]).toBe(last);
  });

  it('never reads a book code as a story: a currentScope code on open, or a stale record, falls back to story 1', async () => {
    const ctx = await setup();
    const viaScope = await openContent(ctx, ctx.summary, 'GEN');
    expect(viaScope.actions.openStory.mock.calls[0][0]).toBe(1);
    expect(viaScope.actions.openBook).not.toHaveBeenCalled();
    ctx.state.obsStoryByProject = { [REPO]: 'GEN' };
    const viaRecord = await openContent(ctx, ctx.summary, undefined);
    expect(viaRecord.actions.openStory.mock.calls[0][0]).toBe(1);
    ctx.state.storyNumbers = await ctx.store.listStories();
    expect(obs.obsStoryOpenContext({ storyNumber: 'GEN', context: {}, stateRef: ctx.stateRef, storeRef: ctx.storeRef })).toBeNull();
    expect(obs.obsStoryOpenContext({ storyNumber: 51, context: {}, stateRef: ctx.stateRef, storeRef: ctx.storeRef })).toBeNull();
  });

  it('records the story once per open, not per keystroke', async () => {
    const ctx = await setup();
    ctx.state.storyNumbers = await ctx.store.listStories();
    await ctx.open(2);
    expect(ctx.state.storyNumber).toBe(2);
    expect(ctx.state.story?.number).toBe(2);
    expect(ctx.remembered).toEqual([[REPO, 2]]);
  });
});

describe('#289 — a story switch over a failed write', () => {
  it('waits: the switch refuses while a frame write is retained as failed, and proceeds after the retry succeeds', async () => {
    const ctx = await setup();
    ctx.state.storyNumbers = await ctx.store.listStories();
    let offline = true;
    const scheduler = new StoryScheduler({
      debounceMs: 0,
      write: async (unit, text) => {
        if (offline) throw new Error('offline');
        await obs.writeStoryUnit(ctx.store, unit, text);
      },
    });
    const saveRefs = [{ current: scheduler }];
    await ctx.open(1, saveRefs, scheduler);
    expect(ctx.state.storyNumber).toBe(1);
    scheduler.markDirty({ kind: 'frame', story: 1, frame: 1 }, 'Al principio.');
    await scheduler.drain();
    expect(scheduler.getState()).toBe('error');
    await ctx.open(2, saveRefs, scheduler);
    expect(ctx.state.storyNumber).toBe(1);
    expect(ctx.state.story?.number).toBe(1);
    expect(scheduler.value({ kind: 'frame', story: 1, frame: 1 })).toBe('Al principio.');
    offline = false;
    await scheduler.retry();
    expect(scheduler.getState()).toBe('saved');
    await ctx.open(2, saveRefs, scheduler);
    expect(ctx.state.storyNumber).toBe(2);
    const { story } = await ctx.store.readStory(1);
    expect(story.frames[0].text).toBe('Al principio.');
  });
});

describe('#289 — one operation for one unit, byte-strict outside it', () => {
  it('a title, a frame and a reference save publish exactly three operations and change only their own lines of one story file', async () => {
    const ctx = await setup();
    const before = templateFiles();
    const scheduler = new StoryScheduler({ debounceMs: 0, write: (unit, text) => obs.writeStoryUnit(ctx.store, unit, text) });
    const seed = await seedFrom(scheduler, ctx.store, 1);
    const frame = Math.min(2, seed.frames.length);
    scheduler.markDirty({ kind: 'title', story: 1 }, 'La creación');
    scheduler.markDirty({ kind: 'frame', story: 1, frame }, 'Uno\n\n\nDos\r\n');
    scheduler.markDirty({ kind: 'ref', story: 1 }, 'Génesis 1-2');
    await scheduler.drain();
    expect(scheduler.getState()).toBe('saved');

    const events = await publishedEvents(ctx.rig);
    expect(events.map((e) => [e.v, e.op])).toEqual([[2, 'text.frame.set'], [2, 'text.frame.set'], [2, 'text.story.ref.set']]);
    expect(events[0]).toMatchObject({ story: 1, frame: 0, text: 'La creación' });
    expect(events[1]).toMatchObject({ story: 1, frame, text: 'Uno\nDos' });
    expect(events[2]).toMatchObject({ story: 1, text: 'Génesis 1-2' });

    const files = ctx.rig.repos.get(REPO)!.files;
    for (const [ipath, bytes] of Object.entries(before)) {
      if (ipath === 'content/01.md') continue;
      expect(files.get(ipath), ipath).toBe(bytes);
    }
    const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/;
    const b = before['content/01.md'].split('\n');
    const a = files.get('content/01.md')!.split('\n');
    const imagesAt = (lines: string[]) => lines.flatMap((line, i) => (IMAGE_LINE.test(line) ? [i] : []));
    const [bImg, aImg] = [imagesAt(b), imagesAt(a)];
    expect(aImg).toHaveLength(bImg.length);
    expect(a[0]).toBe('# 1. La creación');
    expect(b[0]).toMatch(/^# 1\. /);
    expect(a.slice(1, aImg[frame - 1] + 1)).toEqual(b.slice(1, bImg[frame - 1] + 1));
    expect(a.slice(aImg[frame - 1] + 1, aImg[frame])).toEqual(['', 'Uno', 'Dos', '']);
    // from the next image line through the last frame's (empty) paragraph: identical
    const lastImage = bImg.length - 1;
    expect(a.slice(aImg[frame], aImg[lastImage] + 2)).toEqual(b.slice(bImg[frame], bImg[lastImage] + 2));
    // the reference region is the trailing blank lines of the seed form (R-10.3.4)
    expect(b.slice(bImg[lastImage] + 1).every((line) => line === '')).toBe(true);
    expect(a.slice(-2)).toEqual(['_Génesis 1-2_', '']);
  });
});

describe('#289 — the draft percentage', () => {
  it('is 0 on the seed form, counts frames over the fixed frame total of the fifty stories, and ignores the title and the reference line', async () => {
    const ctx = await setup();
    expect(await obs.obsDraftPercent(ctx.store)).toBe(0);
    let total = 0;
    for (const n of await ctx.store.listStories()) total += (await ctx.store.readStory(n)).story.frames.length;
    expect(total).toBeGreaterThan(0);
    await ctx.store.writeTitle(1, 'La creación');
    await ctx.store.writeRef(1, 'Génesis 1-2');
    expect(await obs.obsDraftPercent(ctx.store)).toBe(0);
    await ctx.store.writeFrame(1, 1, 'Al principio.');
    expect(await obs.obsDraftPercent(ctx.store)).toBe(Math.max(1, Math.round((1 / total) * 100)));
    const half = Math.ceil(total / 2);
    let drafted = 1;
    for (const n of await ctx.store.listStories()) {
      const { story } = await ctx.store.readStory(n);
      for (let f = 1; f <= story.frames.length && drafted < half; f += 1) {
        if (n === 1 && f === 1) continue;
        await ctx.store.writeFrame(n, f, `Marco ${n}:${f}`);
        drafted += 1;
      }
      if (drafted >= half) break;
    }
    expect(await obs.obsDraftPercent(ctx.store)).toBe(Math.max(1, Math.round((half / total) * 100)));
  });

  it('a durable numbered-frame save drops the cached Home percentage at once; a title or reference save does not', async () => {
    const ctx = await setup();
    const onFrameSaved = vi.fn();
    const storySchedulerRef: { current: StoryScheduler | null } = { current: null };
    obs.installStoryScheduler({ storySchedulerRef, store: ctx.store, dispatch: ctx.dispatch, onFrameSaved });
    const scheduler = storySchedulerRef.current!;
    await seedFrom(scheduler, ctx.store, 1);
    scheduler.markDirty({ kind: 'title', story: 1 }, 'La creación');
    scheduler.markDirty({ kind: 'ref', story: 1 }, 'Génesis 1-2');
    await scheduler.drain();
    expect(onFrameSaved).not.toHaveBeenCalled();
    scheduler.markDirty({ kind: 'frame', story: 1, frame: 1 }, 'Al principio.');
    await scheduler.drain();
    expect(onFrameSaved).toHaveBeenCalledTimes(1);
    expect(ctx.state.storySaveState).toBe('saved');
    expect(await obs.obsDraftPercent(ctx.store)).toBeGreaterThanOrEqual(1);
  });

  it('a rejected frame write drops nothing and stays failed', async () => {
    const ctx = await setup();
    const onFrameSaved = vi.fn();
    const storySchedulerRef: { current: StoryScheduler | null } = { current: null };
    obs.installStoryScheduler({ storySchedulerRef, store: ctx.store, dispatch: ctx.dispatch, onFrameSaved });
    const scheduler = storySchedulerRef.current!;
    await seedFrom(scheduler, ctx.store, 1);
    scheduler.seed({ kind: 'frame', story: 1, frame: 999 }, '');
    scheduler.markDirty({ kind: 'frame', story: 1, frame: 999 }, 'No existe.');
    await scheduler.drain();
    expect(scheduler.getState()).toBe('error');
    expect(ctx.state.storySaveState).toBe('error');
    expect(String(ctx.state.storySaveError)).toMatch(/frame 999/);
    expect(onFrameSaved).not.toHaveBeenCalled();
    expect(await publishedEvents(ctx.rig)).toEqual([]);
  });
});

describe('#312 — a project open reads its story once, with the pins known', () => {
  // The pins a new OBS project gets at creation (the bundled suite, #288); the
  // gateway is its `obs` member, installed at the path the app would stage it.
  const GATEWAY_PIN = EN_HELPS.obs;
  const GATEWAY_LOCAL = localRepoPathFromRepoPath(GATEWAY_PIN.repoPath);
  const PINS = INSTALLED_SUITE;

  /** Open the project the way performProjectOpen does: the pins read is handed to
   * openProjectContent, whose story open is the real openObsStory. Every
   * `storySource` value dispatched through the open is recorded. */
  const openWithPins = async (installed: Record<string, unknown>, before: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void> = async () => {}) => {
    const ctx = await setup();
    await ctx.store.writeResources(PINS as never, null);
    await before(ctx);
    const sources: unknown[] = [];
    const dispatch = (action: { type: string; patch?: Record<string, unknown> }) => {
      if (action.type === 'set' && action.patch && 'storySource' in action.patch) sources.push(action.patch.storySource);
      ctx.dispatch(action as never);
    };
    const actions = {
      openBook: vi.fn(async () => {}),
      openStory: (storyNumber: number, resources?: unknown, context: Record<string, unknown> = {}) =>
        obs.openObsStory({
          storyNumber, resourcesOverride: resources, context, stateRef: ctx.stateRef, storeRef: ctx.storeRef, saveRefs: [], dispatch, api: ctx.api,
          resolveContext: async () => ({ installed }), scheduler: null, rememberObsStory: () => {},
        }),
    };
    await obs.openProjectContent({
      summary: ctx.summary, store: ctx.store, repoPath: REPO, scriptDirection: 'ltr', textFont: null, bookCode: undefined,
      superseded: () => false, dispatch, actions, stateRef: ctx.stateRef, pinsReady: ctx.store.readResources() as never,
    });
    return { ctx, sources };
  };

  it('a project whose pinned gateway story is installed never dispatches a no-pin source, at any moment of the open', async () => {
    const { ctx, sources } = await openWithPins({ [GATEWAY_LOCAL]: GATEWAY_PIN }, async (c) => {
      // the gateway story is the project's own story 1 bytes: installed, and no frame mismatch
      c.rig.createRepo(GATEWAY_LOCAL, { 'content/01.md': await c.api.readIngredient(REPO, 'content/01.md') });
    });
    expect(ctx.state.storyNumber).toBe(1);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((source) => (source as { kind?: string } | null)?.kind === 'no-pin')).toBe(false);
    expect(sources[sources.length - 1]).toBeNull(); // read and matching
    expect((ctx.state as { sourceStory?: { number: number } | null }).sourceStory?.number).toBe(1);
  });

  it('a project whose pinned gateway story is absent ends with a not-installed source', async () => {
    const { ctx, sources } = await openWithPins({});
    expect(ctx.state.storyNumber).toBe(1);
    expect(sources[sources.length - 1]).toEqual({ kind: 'not-installed', pin: GATEWAY_PIN });
    expect(sources.some((source) => (source as { kind?: string } | null)?.kind === 'no-pin')).toBe(false);
  });
});
