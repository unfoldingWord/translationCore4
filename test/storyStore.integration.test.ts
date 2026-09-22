// The story path of the store against the LIVE pankosmia rig (issue #286,
// BURRITO-SPEC §10): the project is created by the platform's own OBS endpoint
// (`POST /git/new-obs-resource`), so every input comes from the system under
// test — the summary flavor, the paths, the story bytes. Without the rig the
// suite is skipped with a clear message (rig-dependent rows are accepted; the
// `rig` CI job runs them). The project is uniquely named and left behind (the
// journey suite reseeds the rig later).
//
// Platform defect the write step depends on [VERIFIED — pankosmia-web 0.18.5
// (99fd9be, 2026-07-30), rig, 2026-09-15]: the metadata.json that
// `new-obs-resource` writes has no `localizedNames`, and the server's own
// `BurritoMetadata` struct (src/structs.rs) requires it — so every
// `update_ingredients` write and every `remake-ingredients` on such a project
// fails with "Could not parse metadata: missing field `localizedNames`".
// Platform-created Bible projects carry the field. Creation (#287) owns the
// repair; until then the write step SKIPS on a fresh platform project and names
// this. `OBS286_REPO=<repoPath>` points the suite at an existing, repaired OBS
// project to run the whole path.
import { beforeAll, describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import { memKv } from './helpers/journalingRig';
import { openFacts } from './helpers/report';

const BASE = 'http://127.0.0.1:19998/api';
const SLOW = 30_000;

const rigUp = await (async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BASE}/version`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
})();

if (!rigUp) {
  console.warn(
    `[storyStore.integration] pankosmia rig not reachable at ${BASE} — the live-rig suite is skipped ` +
      '(rig-dependent integration rows are accepted; start the rig to run them).',
  );
}

const ABBR = `obs286_${Date.now()}`;
const REPO = process.env.OBS286_REPO ?? `_local_/_local_/${ABBR}`;
const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/;

describe.skipIf(!rigUp)('the story path on the live rig (#286, §10)', () => {
  const api = new ServerApi({ baseUrl: BASE });
  const kv = memKv();
  const newStore = (): JournalingStore => new JournalingStore({ api, kv });
  let store: JournalingStore;
  /** Null when the platform can rescan the project; else the platform's reason. */
  let rescanDefect: string | null = null;

  beforeAll(async () => {
    forgetSharedClocks();
    forgetProjectQueues();
    if (!process.env.OBS286_REPO) {
      // The platform's own OBS creation route — not a store operation (#287 puts
      // it behind the port); the raw call keeps the fixture sourced from the rig.
      const response = await fetch(`${BASE}/git/new-obs-resource`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_name: `OBS ${ABBR}`, content_abbr: ABBR, content_language_code: 'es' }),
      });
      expect(response.ok).toBe(true);
    }
    try {
      await api.remakeIngredients(REPO);
    } catch (error) {
      rescanDefect = String((error as Error).message ?? error);
    }
    store = newStore();
    await store.open(REPO);
  }, SLOW);

  it('lists the OBS project with flavor textStories and no book codes', async () => {
    const summary = (await store.listProjects()).find((p) => p.id === REPO);
    expect(summary).toMatchObject({ flavor: 'textStories', bookCodes: [] });
    expect(openFacts(store).classification).toBe('converged');
  }, SLOW);

  it('lists fifty stories and parses story 1 as the platform wrote it', async () => {
    expect(await store.listStories()).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const { bytes, story } = await store.readStory(1);
    expect(story.frames.length).toBe(bytes.split('\n').filter((l) => IMAGE_LINE.test(l)).length);
    expect(story.frames.length).toBeGreaterThan(0);
  }, SLOW);

  it('writes a frame byte-strictly, seals v: 2, verifies, checkpoints and reopens converged', async (ctx) => {
    if (rescanDefect !== null)
      ctx.skip(`the platform cannot rescan its own OBS project (${rescanDefect}) — a creation defect for #287; set OBS286_REPO to a repaired project`);
    const before = await api.readIngredient(REPO, 'content/01.md');
    await store.writeFrame(1, 2, 'Entonces Dios dijo:\n\n"Que haya luz".');
    const after = await api.readIngredient(REPO, 'content/01.md');
    const imageAt = (text: string): number[] => text.split('\n').flatMap((l, i) => (IMAGE_LINE.test(l) ? [i] : []));
    const [b, a] = [imageAt(before), imageAt(after)];
    expect(before.split('\n').slice(0, b[1] + 1)).toEqual(after.split('\n').slice(0, a[1] + 1));
    expect(before.split('\n').slice(b[2])).toEqual(after.split('\n').slice(a[2]));
    expect((await store.readStory(1)).story.frames[1].text).toBe('Entonces Dios dijo:\n"Que haya luz".');
    const segments = (await api.listPaths(REPO)).filter((p) => /^checking\/journal\/[^/]+\/segments\//.test(p));
    expect(segments).toHaveLength(1);
    const body = JSON.parse((JSON.parse(await api.readIngredient(REPO, segments[0])) as { body: string }).body) as { events: Array<Record<string, unknown>> };
    expect(body.events[0]).toMatchObject({ v: 2, op: 'text.frame.set', story: 1, frame: 2 });
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(describeVerifierReport(report), describeVerifierReport(report)).toContain('verified');
    await store.commit('checkpoint (#286 integration)');
    expect(await api.gitStatus(REPO)).toEqual([]);
    const store2 = newStore();
    await store2.open(REPO);
    expect(openFacts(store2).classification).toBe('converged');
    expect((await store2.readStory(1)).story.frames[1].text).toBe('Entonces Dios dijo:\n"Que haya luz".');
  }, SLOW);
});
