// #289 — the story pictures against the LIVE pankosmia rig. The rig's seed
// installs the default picture pack at its identity-qualified path when the
// cache entry exists (dev-env/scripts/seed.zsh; the `rig` CI job fetches it).
// Every input comes from the system under test: the project is the platform's
// own OBS template, the filenames are the template's image lines, and the pack
// listing is the server's. Without the rig, or without the seeded pack, the
// suite skips and names what it needs.
import { beforeAll, describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { DEFAULT_OBS_IMAGES, DEFAULT_OBS_IMAGES_LOCAL, resolveObsImage } from '../src/data/obsImages';
import { readObsStoryPresentation } from '../src/data/obsStory';
import { memKv } from './helpers/journalingRig';

const BASE = 'http://127.0.0.1:19998/api';
const SLOW = 30_000;
const CACHE_HINT = `zsh dev-env/scripts/cache-resource.zsh uW/obs_images_360 "" ${DEFAULT_OBS_IMAGES.sha}, then zsh dev-env/scripts/seed.zsh`;

const rigUp = await (async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BASE}/version`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
})();

/** The pack's real file listing on the rig, or [] when the rig is down or the pack is absent. */
const packFiles = await (async (): Promise<string[]> => {
  if (!rigUp) return [];
  try {
    return (await new ServerApi({ baseUrl: BASE }).listPaths(DEFAULT_OBS_IMAGES_LOCAL)).filter((p) => /\.(?:jpe?g|png|webp)$/i.test(p));
  } catch {
    return [];
  }
})();

if (!rigUp) {
  console.warn(`[obsImages.integration] pankosmia rig not reachable at ${BASE} — the live-rig suite is skipped.`);
} else if (packFiles.length === 0) {
  console.warn(`[obsImages.integration] the rig has no picture pack at ${DEFAULT_OBS_IMAGES_LOCAL} — skipped; seed it with: ${CACHE_HINT}`);
}

const ABBR = `obs289_${Date.now()}`;
const REPO = `_local_/_local_/${ABBR}`;

describe.skipIf(!rigUp || packFiles.length === 0)('story pictures on the live rig (#289)', () => {
  const api = new ServerApi({ baseUrl: BASE });
  let store: JournalingStore;

  beforeAll(async () => {
    forgetSharedClocks();
    forgetProjectQueues();
    store = new JournalingStore({ api, kv: memKv() });
    await store.createObsProject({ content_name: `OBS ${ABBR}`, content_abbr: ABBR, content_language_code: 'es' });
    await store.open(REPO);
  }, SLOW);

  it('negative control: an invented filename resolves to nothing', async () => {
    const presentation = await readObsStoryPresentation({ api, store, projectRepo: REPO, storyNumber: 1, resources: null, installed: {} });
    const bundled = presentation.imagePacks.find((report) => report.pin.sha === DEFAULT_OBS_IMAGES.sha);
    expect(bundled).toMatchObject({ via: 'paths', files: packFiles.length });
    const emptyPins = { schemaVersion: 2, languageSets: { primary: {}, fallback: {} }, resources: {} } as never;
    expect(resolveObsImage('![x](obs-xx-99-99.jpg)', emptyPins, {}, [], { pin: DEFAULT_OBS_IMAGES, images: {} }).source).toBe('missing');
  }, SLOW);

  it('resolves every frame of story 1 to a URL the server answers with image bytes', async () => {
    const presentation = await readObsStoryPresentation({ api, store, projectRepo: REPO, storyNumber: 1, resources: null, installed: {} });
    expect(presentation.imageNote).toBeNull();
    const images = Object.values(presentation.images);
    expect(images.length).toBe(presentation.story.frames.length);
    expect(images.every((image) => image.source === 'default' && image.uri)).toBe(true);
    const response = await fetch(images[0].uri as string);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^image\//);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }, SLOW);
});
