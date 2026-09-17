// #291 (BURRITO-SPEC §10.5, §10.7 R-10.7.3): the story write path of the
// journal store, on the fake rig with the vendored `text_stories` template. A
// story-keyed decision and a frame-targeted note seal as `v: 2` events with NO
// generation stamp; the decision folds and projects to
// `checking/<toolId>/OBS.json`; the project reopens converged and the fold-
// compare verifier holds; the story file is byte-identical throughout.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import { EN_HELPS } from '../src/data/installedSuite';
import type { Decision } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';

const PARAMS = { content_name: 'Historias', content_abbr: 'historias', content_language_code: 'es' };
const TN_RESOLUTION = { repoPath: EN_HELPS['obs-tn'].repoPath, version: EN_HELPS['obs-tn'].version, sha: EN_HELPS['obs-tn'].sha, languageSet: 'primary' as const };
const TWL_RESOLUTION = { repoPath: EN_HELPS['obs-twl'].repoPath, version: EN_HELPS['obs-twl'].version, sha: EN_HELPS['obs-twl'].sha, languageSet: 'primary' as const };

/** A §10.5 story decision: the en_obs-tn v13 row `1:0 i6lj` (the story title note). */
const storyDecision = (patch: Partial<Decision> = {}): Decision => ({
  contextId: {
    checkId: 'i6lj',
    occurrenceNote: 'This title can also be translated as: “About how God made the world”',
    reference: { story: 1, frame: 0 },
    tool: 'translationNotes',
    groupId: '',
    quote: [{ word: 'The', occurrence: 1 }, { word: 'Creation', occurrence: 1 }],
    quoteString: 'The Creation',
    glQuote: '',
    occurrence: 1,
  },
  category: 'other',
  selections: false,
  comments: false,
  reminders: false,
  nothingToSelect: false,
  verseEdits: false,
  invalidated: false,
  modifiedTimestamp: '2026-09-17T10:00:00.000Z',
  ...patch,
});

const publishedEvents = async (rig: JournalingRig, repo: string): Promise<JournalEvent[]> => {
  const project = rig.repos.get(repo);
  if (!project) return [];
  const out: JournalEvent[] = [];
  for (const ipath of [...project.files.keys()].sort()) {
    if (!/^checking\/journal\/[a-z0-9-]+\/segments\//.test(ipath)) continue;
    const verdict = await validateSegment(project.files.get(ipath) ?? '');
    if (!verdict.ok) throw new Error(`invalid segment on disk ${ipath}: ${verdict.reason}`);
    out.push(...verdict.events);
  }
  return out;
};

const expectVerified = async (api: ServerApi, repo: string): Promise<void> => {
  const report = await verifyProjectAgainstJournal(api, repo);
  expect(describeVerifierReport(report), describeVerifierReport(report)).toContain('verified');
};

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-09-17T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const newStore = (): JournalingStore => new JournalingStore({ api, kv, now: () => clock.advance(13) });
  const store = newStore();
  const { repoPath } = await store.createObsProject(PARAMS);
  await store.open(repoPath);
  const storyBytes = () => rig.repos.get(repoPath)?.files.get('content/01.md');
  const sidecar = (tool: string) => {
    const text = rig.repos.get(repoPath)?.files.get(`checking/${tool}/OBS.json`);
    return text === undefined ? null : JSON.parse(text);
  };
  return { rig, api, store, newStore, repoPath, storyBytes, sidecar };
};

describe('the story write path of the store (#291, §10.5 / R-10.7.3)', () => {
  it('writes a story-keyed decision as ONE v: 2 check.decision.set with no generation, projected to checking/translationNotes/OBS.json', async () => {
    const { rig, api, store, repoPath, storyBytes, sidecar } = await setup();
    const before = storyBytes();
    await store.upsertDecision('translationNotes', 'OBS', storyDecision(), TN_RESOLUTION);
    const events = await publishedEvents(rig, repoPath);
    const decisions = events.filter((e) => e.op === 'check.decision.set');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].v).toBe(2);
    expect('generation' in decisions[0]).toBe(false);
    expect(decisions[0].base).toBeNull();
    expect((decisions[0].decision as Decision).contextId.reference).toEqual({ story: 1, frame: 0 });
    const file = sidecar('translationNotes');
    expect(file).toMatchObject({ schemaVersion: 1, tool: 'translationNotes', book: 'OBS', resource: TN_RESOLUTION });
    expect(file.decisions).toHaveLength(1);
    expect(file.decisions[0].contextId.reference).toEqual({ story: 1, frame: 0 });
    expect(storyBytes()).toBe(before);
    expect(await store.readDecisions('translationNotes', 'OBS')).toMatchObject({ book: 'OBS' });
    await expectVerified(api, repoPath);
  });

  it('a second write on the same story key advances the register linearly and the file still holds one record', async () => {
    const { rig, api, store, repoPath, sidecar } = await setup();
    await store.upsertDecision('translationNotes', 'OBS', storyDecision(), TN_RESOLUTION);
    await store.upsertDecision('translationNotes', 'OBS', storyDecision({ comments: 'revisar', reminders: true }), TN_RESOLUTION);
    await store.upsertDecision('translationNotes', 'OBS', storyDecision({ comments: 'revisar', reminders: true }), TN_RESOLUTION); // no change: nothing published
    const decisions = (await publishedEvents(rig, repoPath)).filter((e) => e.op === 'check.decision.set');
    expect(decisions).toHaveLength(2);
    expect(decisions[1].base).toBe(decisions[0].ts);
    expect(decisions.every((e) => e.v === 2 && !('generation' in e))).toBe(true);
    const file = sidecar('translationNotes');
    expect(file.decisions).toHaveLength(1);
    expect(file.decisions[0]).toMatchObject({ comments: 'revisar', reminders: true });
    await expectVerified(api, repoPath);
  });

  it('files the two tools separately, each with its own resolution record', async () => {
    const { store, sidecar, api, repoPath } = await setup();
    await store.upsertDecision('translationNotes', 'OBS', storyDecision(), TN_RESOLUTION);
    const word = storyDecision({
      contextId: { ...storyDecision().contextId, checkId: 'aoaa', reference: { story: 1, frame: 1 }, tool: 'translationWords', groupId: 'god', quote: 'God', quoteString: 'God' },
      category: 'kt',
      selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }],
      status: 'valid',
    });
    await store.upsertDecision('translationWords', 'OBS', word, TWL_RESOLUTION);
    expect(sidecar('translationWords')).toMatchObject({ book: 'OBS', resource: TWL_RESOLUTION });
    expect(sidecar('translationWords').decisions[0].selections).toEqual(word.selections);
    expect(sidecar('translationNotes').decisions).toHaveLength(1);
    await expectVerified(api, repoPath);
  });

  it('refuses a Bible-form reference under the story position, publishing nothing', async () => {
    const { rig, store, repoPath } = await setup();
    const bible = storyDecision({ contextId: { ...storyDecision().contextId, reference: { bookId: 'tit', chapter: 1, verse: 1 } } });
    await expect(store.upsertDecision('translationNotes', 'OBS', bible, TN_RESOLUTION)).rejects.toThrow(/story decision is written under OBS/);
    expect((await publishedEvents(rig, repoPath)).filter((e) => e.op === 'check.decision.set')).toHaveLength(0);
  });

  it('writes a frame-targeted note as v: 2 with no generation; the story file is byte-identical; a repeat is idempotent', async () => {
    const { rig, api, store, repoPath, storyBytes } = await setup();
    const before = storyBytes();
    await store.addNote('OBS', 1, 2, 'Preguntar al equipo por esta frase.');
    await store.addNote('OBS', 1, 2, 'Preguntar al equipo por esta frase.');
    const notes = (await publishedEvents(rig, repoPath)).filter((e) => e.op === 'note.add');
    expect(notes).toHaveLength(1);
    expect(notes[0].v).toBe(2);
    expect('generation' in notes[0]).toBe(false);
    expect(notes[0].target).toEqual({ story: 1, frame: 2 });
    expect(storyBytes()).toBe(before);
    expect(store.readNotes('OBS')).toEqual([
      { ts: notes[0].ts, chapter: '1', verse: '2', text: 'Preguntar al equipo por esta frase.' },
    ]);
    await expectVerified(api, repoPath);
  });

  it('checkpoints and reopens converged with the decision sidecar and the note in place', async () => {
    const { api, store, newStore, repoPath, sidecar, storyBytes } = await setup();
    const before = storyBytes();
    await store.upsertDecision('translationNotes', 'OBS', storyDecision(), TN_RESOLUTION);
    await store.addNote('OBS', 1, 1, 'nota');
    await store.commit('checkpoint');
    const reopened = newStore();
    await reopened.open(repoPath);
    expect(reopened.lastOpenReport?.classification).toBe('converged');
    expect(reopened.lastOpenReport?.regeneratedPaths).toEqual([]);
    expect(sidecar('translationNotes').decisions).toHaveLength(1);
    expect(reopened.readNotes('OBS')).toHaveLength(1);
    expect(storyBytes()).toBe(before);
    await expectVerified(api, repoPath);
  });
});
