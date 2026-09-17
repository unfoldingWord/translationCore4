// #291 (J22) — the story check session from the application state to the
// store, on the fake rig: the OBS notes derive for the OPEN story only, keyed
// story:frame; a decision recorded the way the Check screen records it (the
// check writer, the `OBS` book position, the session's resolution) lands in
// checking/translationNotes/OBS.json under {story, frame} with its selections,
// bookmark and comment; a frame edit then flags the decision invalid and keeps
// it. Every input is the system's own: the vendored template project, the real
// en_obs-tn v13 export (test/fixtures/resources), the bundled pin identity.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { localRepoPathFromRepoPath } from '../src/data/installed';
import { EN_HELPS, INSTALLED_SUITE } from '../src/data/installedSuite';
import { isDecided, isStoryReference } from '../src/data/derive';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { __alignSaveForTests, __obsCheckForTests as check, checkKeyFor } from '../src/state.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const OBS_TN = fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/resources/en_obs-tn@v13/OBS.tsv'), 'utf8');
const PARAMS = { content_name: 'Historias', content_abbr: 'historias', content_language_code: 'es' };
const TOOL = 'translationNotes';
const BOOK = 'OBS';
const FRAME_1 = 'Así fue como Dios hizo todo en el principio. Creó el universo y todo lo que hay en él en seis días.';
const FRAME_1_EDITED = 'Así fue como el Señor hizo todo al comienzo.';

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-09-17T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  const { repoPath } = await store.createObsProject(PARAMS);
  await store.open(repoPath);
  // the pinned obs-tn, installed where the app reads it (no install record: the disk path)
  rig.createRepo(localRepoPathFromRepoPath(EN_HELPS['obs-tn'].repoPath), { 'OBS.tsv': OBS_TN });
  const pre = { tool: TOOL, state: 'ready', resolution: { pin: EN_HELPS['obs-tn'], rung: 'primary', usedFallback: false } };
  const stateFor = async (storyNumber: number) => ({
    project: { flavor: 'textStories', repoPath },
    projectPins: INSTALLED_SUITE,
    storyNumber,
    story: (await store.readStory(storyNumber)).story,
    bookRaw: null,
    book: null,
  });
  const session = async (storyNumber: number) => {
    const st = await stateFor(storyNumber);
    const result = await check.deriveCheckItems({ apiClient: api, actions: null, st, tool: TOOL, book: BOOK, pre });
    expect(result.session, 'the derivation yields items, not a designed empty state').toBeUndefined();
    return check.completedCheckSession({ store, st, tool: TOOL, book: BOOK, pre, derived: result.derived, dropped: result.dropped });
  };
  const sidecar = () => {
    const text = rig.repos.get(repoPath)?.files.get(`checking/${TOOL}/${BOOK}.json`);
    return text === undefined ? null : JSON.parse(text);
  };
  return { store, session, sidecar };
};

describe('the story check session (#291, J22): from the derivation to the store and back', () => {
  it('derives the open story only, keyed story:frame, title note on frame 0, no book field anywhere', async () => {
    const { session } = await setup();
    const cs = await session(1);
    expect(cs.items.length).toBe(91); // every en_obs-tn v13 row of story 1
    expect(cs.items.every((it) => isStoryReference(it.contextId.reference))).toBe(true);
    expect(cs.items.every((it) => it.contextId.reference.story === 1)).toBe(true);
    expect(cs.items.some((it) => it.contextId.reference.frame === 0 && it.contextId.checkId === 'i6lj')).toBe(true);
    expect(cs.progress).toEqual({ decided: 0, total: 91 });
    expect(cs.resource).toMatchObject({ repoPath: EN_HELPS['obs-tn'].repoPath, sha: EN_HELPS['obs-tn'].sha, languageSet: 'primary' });
    expect(Object.keys(cs.verses)).toContain('story|1:0'); // the story key grammar (#310)
    expect(Object.keys(cs.verses)).toContain('story|1:16');
    const two = await session(2);
    expect(two.items.every((it) => it.contextId.reference.story === 2)).toBe(true);
  });

  it('a decision recorded through the check writer lands under {story, frame} with selections, bookmark and comment; a frame edit flags it invalid and keeps it', async () => {
    const { store, session, sidecar } = await setup();
    await store.writeFrame(1, 1, FRAME_1);
    const cs = await session(1);
    const item = cs.items.find((it) => it.contextId.checkId === 'lm48'); // "the beginning" on 1:1
    expect(item).toBeDefined();
    // recordDecision's write: the item patched, keyed tool|OBS|checkId, the session's resolution as the target
    const next = {
      ...item,
      selections: [{ text: 'principio', occurrence: 1, occurrences: 1 }],
      nothingToSelect: false,
      status: 'valid',
      reminders: true,
      comments: 'Preguntar al equipo.',
      modifiedTimestamp: '2026-09-17T10:00:00.000Z',
    };
    const key = checkKeyFor(TOOL, BOOK, item!.contextId.checkId);
    const targets = new Map([[key, { tool: TOOL, book: BOOK, resource: cs.resource }]]);
    const write = __alignSaveForTests.makeCheckWriter({ store, checkTargetsRef: { current: targets } });
    await write(key, JSON.stringify(next));

    const file = sidecar();
    expect(file).toMatchObject({ book: BOOK, resource: cs.resource });
    expect(file.decisions).toHaveLength(1);
    expect(file.decisions[0].contextId.reference).toEqual({ story: 1, frame: 1 });
    expect(file.decisions[0]).toMatchObject({ selections: next.selections, status: 'valid', reminders: true, comments: 'Preguntar al equipo.' });

    // reopening the tool merges the stored decision: decided, not stale
    const again = await session(1);
    const merged = again.items.find((it) => it.contextId.checkId === 'lm48')!;
    expect(isDecided(merged)).toBe(true);
    expect(again.invalidated).toBe(0);
    expect(again.progress).toEqual({ decided: 1, total: 91 });

    // the frame edit (J6 for frames): flagged invalid, the record retained
    await store.writeFrame(1, 1, FRAME_1_EDITED);
    const edited = await session(1);
    const flagged = edited.items.find((it) => it.contextId.checkId === 'lm48')!;
    expect(edited.invalidated).toBe(1);
    expect(flagged).toMatchObject({ invalidated: true, status: 'invalid', selections: next.selections, comments: 'Preguntar al equipo.', reminders: true });
    expect(isDecided(flagged)).toBe(false);
    expect(sidecar().decisions).toHaveLength(1);
  });
});
