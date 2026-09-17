// #289 — the story presentation's picture path, on the fake rig. The frame
// filenames are sourced from the story the platform template carries (never
// invented), and the pack is read the way the live server serves it: the REAL
// file listing (`GET /burrito/paths`) first, the metadata ingredient table only
// as the fallback. A pack fetched as a commit archive carries whatever
// `metadata.json` is committed — possibly no ingredient table at all — which is
// how a seeded default pack rendered nothing while every request succeeded.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { DEFAULT_OBS_IMAGES, DEFAULT_OBS_IMAGES_LOCAL, obsImageFileName } from '../src/data/obsImages';
import { readObsStoryPresentation } from '../src/data/obsStory';
import type { ResourcesFile } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';

const PARAMS = { content_name: 'Historias con fotos', content_abbr: 'fotos', content_language_code: 'es' };

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-09-16T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  const { repoPath } = await store.createObsProject(PARAMS);
  await store.open(repoPath);
  const { story } = await store.readStory(1);
  const fileNames = story.frames.map((frame) => obsImageFileName(frame.image) ?? '');
  expect(fileNames.length).toBeGreaterThan(0);
  expect(fileNames.every(Boolean)).toBe(true);
  const read = () => readObsStoryPresentation({ api, store, projectRepo: repoPath, storyNumber: 1, resources: null, installed: {} });
  /** Seed the default pack at its identity-qualified path with one file per frame. */
  const seedPack = () => rig.createRepo(DEFAULT_OBS_IMAGES_LOCAL, Object.fromEntries(fileNames.map((name) => [`360px/${name}`, 'jpeg-bytes'])));
  return { rig, api, store, repoPath, story, fileNames, read, seedPack };
};

describe('OBS story source state (#289)', () => {
  it('reports no pin, a pinned source that is not installed, and a read error as structured states, never as sentences', async () => {
    const { api, store, repoPath } = await setup();
    const at = (resources: ResourcesFile | null, installed: Record<string, unknown>) =>
      readObsStoryPresentation({ api, store, projectRepo: repoPath, storyNumber: 1, resources, installed: installed as never });
    expect((await at(null, {})).source).toEqual({ kind: 'no-pin' });
    const pin = { repoPath: 'git.door43.org/unfoldingWord/en_obs', sha: '0123456789abcdef0123456789abcdef01234567', version: 'v1', flavor: 'textStories' };
    const pinned = { schemaVersion: 2, languageSets: { primary: { obs: pin }, fallback: {} }, resources: {} } as unknown as ResourcesFile;
    const missing = await at(pinned, {});
    expect(missing.source).toEqual({ kind: 'not-installed', pin });
    expect(missing.sourceStory).toBeNull();
    const local = '_local_/_sideloaded_/unfoldingword--en_obs--0123456789ab';
    const unreadable = await at(pinned, { [local]: pin });
    expect(unreadable.source?.kind).toBe('error');
    expect(unreadable.sourceStory).toBeNull();
    expect(unreadable.story.frames.length).toBeGreaterThan(0);
  });
});

describe('OBS story pictures (#289)', () => {
  it('negative control: with no pack on the machine every frame is missing and the note names the pack path', async () => {
    const { read, fileNames } = await setup();
    const presentation = await read();
    expect(Object.values(presentation.images).map((image) => image.source)).toEqual(fileNames.map(() => 'missing'));
    expect(presentation.imagePacks).toHaveLength(1);
    expect(presentation.imagePacks[0]).toMatchObject({ pin: DEFAULT_OBS_IMAGES, localPath: DEFAULT_OBS_IMAGES_LOCAL, via: null, files: 0 });
    expect(presentation.imageNote).toEqual({ wanted: fileNames.length, packs: presentation.imagePacks });
  });

  it('resolves every frame from the real file listing even when the pack metadata lists no ingredients', async () => {
    const { rig, read, fileNames, seedPack } = await setup();
    const pack = seedPack();
    pack.meta.ingredients = {}; // a commit archive's committed metadata.json — no table
    const presentation = await read();
    expect(presentation.imageNote).toBeNull();
    expect(presentation.imagePacks[0]).toMatchObject({ via: 'paths', files: fileNames.length, error: null });
    fileNames.forEach((name, index) => {
      const image = presentation.images[String(index + 1)];
      expect(image.source).toBe('default');
      expect(image.uri).toBe(`http://rig.test/api/burrito/ingredient/bytes/${DEFAULT_OBS_IMAGES_LOCAL}?ipath=360px/${encodeURIComponent(name)}`);
    });
    expect(rig.log.some((entry) => entry.route === `/api/burrito/paths/${DEFAULT_OBS_IMAGES_LOCAL}`)).toBe(true);
  });

  it('falls back to the metadata ingredient table when the file listing cannot be read', async () => {
    const { rig, read, fileNames, seedPack } = await setup();
    seedPack(); // createRepo builds the table from the files
    rig.failOn((ctx) => ctx.route === `/api/burrito/paths/${DEFAULT_OBS_IMAGES_LOCAL}`, Infinity);
    const presentation = await read();
    expect(presentation.imagePacks[0]).toMatchObject({ via: 'metadata', files: fileNames.length });
    expect(presentation.imagePacks[0].error).toMatch(/injected failure/);
    expect(presentation.imageNote).toBeNull();
    expect(Object.values(presentation.images).every((image) => image.source === 'default')).toBe(true);
  });

  it('reports a seeded pack that holds no image files instead of failing silently', async () => {
    const { rig, read, seedPack } = await setup();
    const pack = seedPack();
    pack.files.clear();
    rig.createRepo(DEFAULT_OBS_IMAGES_LOCAL, {}, pack.meta);
    const presentation = await read();
    expect(presentation.imagePacks[0]).toMatchObject({ via: 'paths', files: 0 });
    expect(presentation.imageNote?.packs[0]).toMatchObject({ localPath: DEFAULT_OBS_IMAGES_LOCAL, via: 'paths', files: 0 });
  });
});
