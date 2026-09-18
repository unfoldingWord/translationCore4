// #290 (J25): the story Understand load on the fake rig — the OBS notes and
// word links of the OPEN story through the shared derivation (#291), keyed
// story:frame with the title notes on frame 0, and the frame comments read
// back from the journal after a note.add {story, frame}. Inputs are the
// system's own: the vendored template project, the real en_obs-tn v13 and
// en_obs-twl v3 exports, the bundled pin identities.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { localRepoPathFromRepoPath } from '../src/data/installed';
import { EN_HELPS, INSTALLED_SUITE } from '../src/data/installedSuite';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { __performLoadStoryUnderstandForTests as loadStory } from '../src/state.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const FIX = path.resolve(process.cwd(), 'test/fixtures/resources');
const OBS_TN = fs.readFileSync(path.join(FIX, 'en_obs-tn@v13/OBS.tsv'), 'utf8');
const OBS_TWL = fs.readFileSync(path.join(FIX, 'en_obs-twl@v3/OBS.tsv'), 'utf8');
const PARAMS = { content_name: 'Historias', content_abbr: 'historias', content_language_code: 'es' };

type Slot = { state: string; items?: Array<{ contextId: { checkId: string; reference: { story: number; frame: number } } }> };
type Understand = { loading: boolean; book: string; story: number; notes: Slot; words: Slot; comprehension: Record<string, { text: string }> | null; error?: string };

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-09-17T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  const { repoPath } = await store.createObsProject(PARAMS);
  await store.open(repoPath);
  const tnLocal = localRepoPathFromRepoPath(EN_HELPS['obs-tn'].repoPath);
  const twlLocal = localRepoPathFromRepoPath(EN_HELPS['obs-twl'].repoPath);
  rig.createRepo(tnLocal, { 'OBS.tsv': OBS_TN });
  rig.createRepo(twlLocal, { 'OBS.tsv': OBS_TWL });
  const installed = { [tnLocal]: EN_HELPS['obs-tn'], [twlLocal]: EN_HELPS['obs-twl'] };
  const load = async (storyNumber: number, understand: unknown = null): Promise<Understand> => {
    const dispatched: Array<{ type: string; patch?: { understand?: Understand } }> = [];
    await loadStory({
      stateRef: { current: { project: { flavor: 'textStories', repoPath }, storyNumber, projectPins: INSTALLED_SUITE, projectPinsLoaded: true, netEnabled: false, understand } },
      storeRef: { current: store },
      understandSeqRef: { current: 0 },
      dispatch: (a: never) => dispatched.push(a),
      actions: { resolutionContext: async () => ({ installed, coverage: {}, resolutionError: null }) },
      apiClient: api,
    });
    const final = dispatched.filter((a) => a.patch?.understand).pop()?.patch?.understand;
    if (!final) throw new Error('no understand dispatch');
    return final;
  };
  return { store, load };
};

describe('the story Understand load (#290)', () => {
  it('derives the open story’s notes (title note on frame 0) and word links, story-keyed, with no book field', async () => {
    const { load } = await setup();
    const u = await load(1);
    expect(u).toMatchObject({ loading: false, book: 'OBS', story: 1 });
    expect(u.notes.state).toBe('ready');
    expect(u.words.state).toBe('ready');
    const notes = u.notes.items!;
    expect(notes).toHaveLength(91);
    expect(notes.every((it) => it.contextId.reference.story === 1)).toBe(true);
    expect(notes.find((it) => it.contextId.checkId === 'i6lj')?.contextId.reference).toEqual({ story: 1, frame: 0 });
    expect(notes.find((it) => it.contextId.checkId === 'lm48')?.contextId.reference).toEqual({ story: 1, frame: 1 });
    expect(u.words.items!.find((it) => it.contextId.checkId === 'aoaa')?.contextId.reference).toEqual({ story: 1, frame: 1 });
    expect(u.comprehension).toEqual({});
    const two = await load(2);
    expect(two.notes.items!.every((it) => it.contextId.reference.story === 2)).toBe(true);
  });

  it('reads a frame comment back from the journal under its story:frame key', async () => {
    const { store, load } = await setup();
    await store.addNote('OBS', 1, 1, 'Preguntar al equipo.');
    const u = await load(1);
    expect(u.comprehension).toEqual({ '1:1': { text: 'Preguntar al equipo.', ts: expect.any(String) } });
  });
});
