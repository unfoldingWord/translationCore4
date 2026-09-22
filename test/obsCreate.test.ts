// J20 (#287): the store creates an OBS project — the platform's template repo,
// then the seed form (every title `# N.`, R-10.2.4) committed as the base. Proves
// on the fake rig: the created repository differs from the vendored template
// only in metadata.json and the fifty title lines; the tC4-served template gives
// the created metadata the `localizedNames` the server requires (PLATFORM-NOTES
// #36) while the store never asks the platform to parse it (a registering write
// or rescan would empty the scope table, PLATFORM-NOTES #37); the project opens
// converged and lists on Home with the OBS flavor; a frame drafted through the
// store is the only change afterwards.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, ProjectReader, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { seedStory, storyIpath } from '../src/data/journal/runtime';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import type { ResourcesFile } from '../src/data/burritoStore';
import { openFacts } from './helpers/report';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const TEMPLATE = path.resolve(process.cwd(), 'conformance/fixtures/text_stories/ingredients');
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
  it('negative control (PLATFORM-NOTES #36): on the unfixed template the created metadata lacks localizedNames and the platform cannot parse it back; the store never asks it to', async () => {
    const { rig, api, store } = setup();
    rig.serveUnfixedObsTemplate();
    const { repoPath } = await store.createObsProject(PARAMS);
    expect('localizedNames' in rig.repos.get(REPO)!.meta).toBe(false);
    await expect(api.remakeIngredients(repoPath)).rejects.toThrow(/localizedNames/);
    await store.open(repoPath);
    await store.writeFrame(1, 1, 'Un texto.');
    await store.commit('checkpoint');
    expect(rig.log.filter((e) => e.route.includes('update_ingredients'))).toHaveLength(0);
    expect(rig.log.filter((e) => e.route.includes('remake-ingredients'))).toHaveLength(1); // the test's own call above
    expect(rig.repos.get(REPO)!.commits).toContain('checkpoint');
  });

  it('creates the template in the seed form: only metadata.json and the fifty title lines differ; the base is committed', async () => {
    const { rig, store } = setup();
    const { repoPath } = await store.createObsProject(PARAMS);
    expect(repoPath).toBe(REPO);
    const project = rig.repos.get(REPO)!;
    const template = templateFiles();
    expect([...project.files.keys()].sort()).toEqual(Object.keys(template).sort());
    for (const [ipath, bytes] of Object.entries(template)) {
      const story = /^content\/(\d\d)\.md$/.exec(ipath);
      expect(project.files.get(ipath), ipath).toBe(story ? seedStory(bytes) : bytes);
    }
    expect(project.files.get(storyIpath(1))!.startsWith('# 1.\n')).toBe(true);
    // the platform's stamp carries the project's identity and the key the server requires
    const meta = project.meta as { identification: { name: { en: string } }; localizedNames: unknown; type: { flavorType: { currentScope: object } } };
    expect(meta.identification.name.en).toBe(PARAMS.content_name);
    expect(meta.localizedNames).toEqual({});
    expect(Object.keys(meta.type.flavorType.currentScope)).toHaveLength(33); // the template's table, verbatim
    expect(project.commits).toEqual(['Initial commit', 'Seed the fifty stories (tC4)']);
    expect(project.dirty.size).toBe(0);
  });

  it('opens converged, lists on Home as an OBS project, and a frame drafted through the store is the only change', async () => {
    const { rig, api, store } = setup();
    const { repoPath } = await store.createObsProject(PARAMS);
    await store.open(repoPath);
    expect(openFacts(store).classification).toBe('converged');
    expect((await store.listProjects()).find((p) => p.id === REPO)).toMatchObject({ flavor: 'textStories', bookCodes: [] });
    await store.writeFrame(1, 1, 'Así hizo Dios todo al principio.');
    const reader = new ProjectReader({ api });
    await reader.open(REPO);
    expect(await reader.listStories()).toHaveLength(50);
    const { story } = await reader.readStory(1);
    expect(story.title).toBe('');
    expect(story.frames.filter((f) => f.text !== '')).toHaveLength(1);
    const template = templateFiles();
    for (const ipath of Object.keys(template).filter((p) => p !== storyIpath(1)))
      expect(rig.repos.get(REPO)!.files.get(ipath)).toBe(/^content\/\d\d\.md$/.test(ipath) ? seedStory(template[ipath]) : template[ipath]);
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(describeVerifierReport(report), describeVerifierReport(report)).toContain('verified');
  });

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
