// J20 (#287): the refusal and never-rescan paths of createObsProject on the
// fake rig. A name the platform would splice into its JSON template unescaped is
// refused before any repository exists; the store never registers or rescans an
// OBS project, so the platform cannot empty its scope table (PLATFORM-NOTES #37).
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import type { ResourcesFile } from '../src/data/burritoStore';

const PARAMS = { content_name: 'Historias de Prueba', content_abbr: 'historias', content_language_code: 'es' };
const REPO = `_local_/_local_/${PARAMS.content_abbr}`;

const setup = () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-09-16T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  return { rig, api, store };
};

describe('createObsProject (#287, J20)', () => {
  it('refuses a project name the platform would splice into its JSON template unescaped, and leaves no repository', async () => {
    const { rig, store } = setup();
    await expect(store.createObsProject({ ...PARAMS, content_name: 'Historias "de" Prueba' })).rejects.toThrow(/quote/);
    await expect(store.createObsProject({ ...PARAMS, content_name: 'Historias\\Prueba' })).rejects.toThrow(/backslash/);
    expect(rig.repos.has(REPO)).toBe(false);
    expect(rig.log.some((e) => e.route.includes('new-obs-resource'))).toBe(false);
  });

  it('never registers or rescans an OBS project, so the platform cannot empty its scope table (R-10.2.3, PLATFORM-NOTES #37)', async () => {
    const { rig, api, store } = setup();
    const { repoPath } = await store.createObsProject(PARAMS);
    await store.open(repoPath);
    await store.writeResources(INSTALLED_SUITE as unknown as ResourcesFile, null);
    await store.writeFrame(2, 1, 'Un texto.');
    await store.commit('checkpoint');
    // R-10.7.5: no book.add on stories — and the scaffold would rescan
    await expect(store.addBook({ book_code: 'JON', book_title: 'Jonás', book_abbr: 'JON', add_cv: true })).rejects.toThrow(/stories, not books/);
    expect(rig.repos.get(REPO)!.files.has('JON.usfm')).toBe(false);
    const scopeOf = () => Object.keys((rig.repos.get(REPO)!.meta.type as { flavorType: { currentScope: object } }).flavorType.currentScope);
    expect(scopeOf()).toHaveLength(33);
    expect(rig.log.some((e) => e.route.includes('remake-ingredients'))).toBe(false);
    expect(rig.log.some((e) => e.route.includes('update_ingredients'))).toBe(false);
    // negative control: the fake models the platform — one rescan empties the table
    await api.remakeIngredients(REPO);
    expect(scopeOf()).toHaveLength(0);
  });
});
