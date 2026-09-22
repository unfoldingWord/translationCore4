// The story path of the store (issue #286, BURRITO-SPEC §10, D74): an OBS
// project on the fake rig, loaded byte for byte from the vendored pankosmia
// `text_stories` template (conformance/fixtures/text_stories). Proves the
// acceptance criteria of #286: the port lists, reads and writes stories under
// the `content/NN.md` rule; a frame write is byte-strict outside its region;
// frame text seals as one paragraph; the store seals `v: 2` story events while
// book events stay `v: 1`; Home's list includes `gloss/textStories`; and the
// fold-compare verifier holds on a story fixture, through a checkpoint, a
// reopen, a journal-ahead recovery and an out-of-band deletion.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { fold, writeFrame as spliceFrame } from '../src/data/journal/runtime';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import type { ResourcesFile } from '../src/data/burritoStore';
import { expectRefusal, openFacts } from './helpers/report';

// vite-plugin-node-polyfills aliases node builtins even under the node
// environment; the real ones come through process.getBuiltinModule.
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const REPO = '_local_/_local_/historias';
const TEMPLATE = path.resolve(process.cwd(), 'conformance/fixtures/text_stories/ingredients');
const OBS_META = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'conformance/sample-burrito-obs/metadata.json'), 'utf8'),
) as Record<string, unknown>;

/** Every ingredient of the template, keyed by ipath: the fifty stories, the
 * front and back matter and the license — the on-disk shape of a new project. */
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

const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/;

/** Every published segment's events, in path order. */
const publishedEvents = async (rig: JournalingRig, repo = REPO): Promise<JournalEvent[]> => {
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

const expectVerified = async (api: ServerApi, repo = REPO): Promise<void> => {
  const report = await verifyProjectAgainstJournal(api, repo);
  expect(describeVerifierReport(report), describeVerifierReport(report)).toContain('verified');
};

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-09-15T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const project = rig.createRepo(REPO, templateFiles(), structuredClone(OBS_META));
  project.commits.push('Initial commit');
  const newStore = (): JournalingStore => new JournalingStore({ api, kv, now: () => clock.advance(13) });
  const store = newStore();
  await store.open(REPO);
  return { rig, api, store, newStore, project };
};

describe('the story path of the store (#286, §10)', () => {
  it('#288 resource publication preserves every target story byte, including image and reference lines', async () => {
    const { store, newStore } = await setup();
    const before = await Promise.all((await store.listStories()).map((n) => store.readStory(n).then((got) => got.bytes)));
    const resourcesMd5 = (await store.readResourcesWithMd5()).md5;
    await store.applyGatewayChange({
      resources: INSTALLED_SUITE as unknown as ResourcesFile,
      resourcesMd5,
      decisions: [],
    });
    const after = await Promise.all((await store.listStories()).map((n) => store.readStory(n).then((got) => got.bytes)));
    expect(after).toEqual(before);
    expect(after[0].split('\n').filter((line) => IMAGE_LINE.test(line)))
      .toEqual(before[0].split('\n').filter((line) => IMAGE_LINE.test(line)));
    expect(after[0].split('\n').find((line) => /^_.*_$/.test(line)))
      .toBe(before[0].split('\n').find((line) => /^_.*_$/.test(line)));
    const reopened = newStore();
    await reopened.open(REPO);
    expect((await reopened.readResources())?.languageSets.primary.obs?.sha)
      .toBe(INSTALLED_SUITE.languageSets.primary.obs.sha);
  });

  it('lists an OBS project beside a Bible project, with no book codes (Home)', async () => {
    const { rig, store } = await setup();
    await store.createProject({
      content_name: 'Prueba',
      content_abbr: 'prueba',
      content_language_code: 'es',
      add_book: true,
      book_code: 'TIT',
      add_cv: true,
      versification: 'eng',
    });
    const projects = await store.listProjects();
    const obs = projects.find((p) => p.id === REPO);
    expect(obs).toMatchObject({ flavor: 'textStories', bookCodes: [] });
    // the platform reports the scope table's Bible books there — not books of the project
    expect((rig.repos.get(REPO)!.meta.type as { flavorType: { currentScope: object } }).flavorType.currentScope).toHaveProperty('GEN');
    expect(projects.find((p) => p.id === '_local_/_local_/prueba')).toMatchObject({ flavor: 'textTranslation', bookCodes: ['TIT'] });
  });

  it('lists the fifty stories under content/NN.md and splits a story on its image lines', async () => {
    const { store } = await setup();
    expect(await store.listStories()).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const { bytes, story } = await store.readStory(1);
    expect(bytes).toBe(templateFiles()['content/01.md']);
    expect(story.number).toBe(1);
    expect(story.title).toBe('The Creation');
    expect(story.frames).toHaveLength(bytes.split('\n').filter((line) => IMAGE_LINE.test(line)).length);
    expect(story.frames).toHaveLength(16);
    for (const frame of story.frames) {
      expect(frame.image).toMatch(IMAGE_LINE);
      expect(frame.text).toBe('');
    }
    expect(story.ref).toBeNull();
  });

  it('opens the template project as converged: no unknown path, nothing regenerated', async () => {
    const { store, api } = await setup();
    expect(openFacts(store).classification).toBe('converged');
    expect(openFacts(store).regeneratedPaths).toEqual([]);
    await expectVerified(api);
  });

  it('writes one frame byte-strictly: every byte outside the frame region is identical, and the event is v: 2', async () => {
    const { store, rig, api } = await setup();
    const before = templateFiles()['content/01.md'];
    await store.writeFrame(1, 2, 'Entonces Dios dijo: "Que haya luz".');
    const after = rig.repos.get(REPO)!.files.get('content/01.md')!;
    // the region of frame 2: after its image line, up to the next image line
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const imageAt = (lines: string[]): number[] => lines.flatMap((line, i) => (IMAGE_LINE.test(line) ? [i] : []));
    const [bImg, aImg] = [imageAt(beforeLines), imageAt(afterLines)];
    expect(aImg).toHaveLength(bImg.length);
    expect(beforeLines.slice(0, bImg[1] + 1)).toEqual(afterLines.slice(0, aImg[1] + 1)); // title + frame 1 + image 2
    expect(beforeLines.slice(bImg[2])).toEqual(afterLines.slice(aImg[2])); // image 3 to the end
    expect(afterLines.slice(aImg[1] + 1, aImg[2])).toEqual(['', 'Entonces Dios dijo: "Que haya luz".', '']);
    const { story } = await store.readStory(1);
    expect(story.frames[1].text).toBe('Entonces Dios dijo: "Que haya luz".');
    expect(story.frames.filter((f) => f.text !== '')).toHaveLength(1);
    const events = await publishedEvents(rig);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ v: 2, op: 'text.frame.set', story: 1, frame: 2, text: 'Entonces Dios dijo: "Que haya luz".' });
    expect(events[0].base).toBeUndefined(); // a rootless first write on a frame is ordinary (R-10.7.2)
    expect(events[0].generation).toBeUndefined();
    // the version 2 fold: one frame register, projected as {frames, ref}
    expect(fold(events).stories).toEqual({ '1': { frames: { '2': 'Entonces Dios dijo: "Que haya luz".' }, ref: null } });
    await expectVerified(api);
  });

  it('seals frame text as ONE paragraph: blank lines and carriage returns go, single newlines survive', async () => {
    const { store, rig } = await setup();
    await store.writeFrame(3, 1, 'Línea uno\r\n\r\n   \nLínea dos\n\n');
    const events = await publishedEvents(rig);
    expect(events[0]).toMatchObject({ v: 2, op: 'text.frame.set', story: 3, frame: 1, text: 'Línea uno\nLínea dos' });
    const { story, bytes } = await store.readStory(3);
    expect(story.frames[0].text).toBe('Línea uno\nLínea dos');
    expect(bytes).toContain('\n\nLínea uno\nLínea dos\n\n');
  });

  it('writes the title (frame 0) and the reference line; a second write on a frame advances linearly', async () => {
    const { store, rig, api } = await setup();
    await store.writeTitle(1, '  La Creación ');
    await store.writeRef(1, 'Una historia de la Biblia de: Génesis 1-2');
    await store.writeFrame(1, 2, 'Primera versión.');
    await store.writeFrame(1, 2, 'Segunda versión.');
    const { story, bytes } = await store.readStory(1);
    expect(story.title).toBe('La Creación');
    expect(story.ref).toBe('Una historia de la Biblia de: Génesis 1-2');
    expect(story.frames[1].text).toBe('Segunda versión.');
    expect(bytes.startsWith('# 1. La Creación\n')).toBe(true);
    expect(bytes.endsWith('\n_Una historia de la Biblia de: Génesis 1-2_\n')).toBe(true);
    const events = await publishedEvents(rig);
    expect(events.map((e) => [e.v, e.op])).toEqual([
      [2, 'text.frame.set'],
      [2, 'text.story.ref.set'],
      [2, 'text.frame.set'],
      [2, 'text.frame.set'],
    ]);
    expect(events[0]).toMatchObject({ story: 1, frame: 0, text: 'La Creación' });
    expect(events[1]).toMatchObject({ story: 1, text: 'Una historia de la Biblia de: Génesis 1-2' });
    expect(events[3].base).toBe(events[2].ts); // same actor: linear history on the frame register
    await expectVerified(api);
  });

  it('refuses at the writer, before anything seals: a frame the story does not have, an image line, an empty reference', async () => {
    const { store, rig } = await setup();
    await expect(store.writeFrame(1, 17, 'x')).rejects.toThrow(/frame 17 does not exist/);
    await expect(store.writeFrame(1, 1, '![OBS Image](x)')).rejects.toThrow(/image line/);
    await expect(store.writeRef(1, '')).rejects.toThrow(/empty/);
    await expect(store.writeFrame(51, 1, 'x')).rejects.toThrow(/no content\/51\.md/);
    expect(await publishedEvents(rig)).toEqual([]);
    expect(rig.repos.get(REPO)!.files.get('content/01.md')).toBe(templateFiles()['content/01.md']);
  });

  it('publishes nothing for a write that changes no byte (an idempotent retry)', async () => {
    const { store, rig } = await setup();
    await store.writeFrame(2, 1, 'Texto.');
    await store.writeFrame(2, 1, 'Texto.');
    await store.writeFrame(2, 3, ''); // an already-empty frame in the template's own form
    expect(await publishedEvents(rig)).toHaveLength(1);
  });

  it('checkpoints, reopens converged, and keeps every base ingredient untouched', async () => {
    const { store, rig, api, newStore, project } = await setup();
    await store.writeFrame(1, 1, 'Así hizo Dios todo al principio.');
    await store.writeRef(1, 'Génesis 1-2');
    await store.commit('checkpoint');
    expect(project.commits).toEqual(['Initial commit', 'checkpoint']);
    const files = templateFiles();
    for (const ipath of ['LICENSE.md', 'content/front/title.md', 'content/front/intro.md', 'content/back/intro.md', 'content/02.md', 'content/50.md'])
      expect(project.files.get(ipath)).toBe(files[ipath]);
    expect(rig.writes.map((w) => w.ipath).filter((p) => p.startsWith('content/'))).toEqual(['content/01.md', 'content/01.md']);
    await expectVerified(api);
    const store2 = newStore();
    await store2.open(REPO);
    expect(openFacts(store2).classification).toBe('converged');
    const { story } = await store2.readStory(1);
    expect(story.frames[0].text).toBe('Así hizo Dios todo al principio.');
    expect(story.ref).toBe('Génesis 1-2');
  });

  it('regenerates a story forward when the journal is ahead of the file (the book rule, for stories)', async () => {
    const { store, api, newStore, project, rig } = await setup();
    // the crash window: the action is published, the derived write fails, the
    // ledger record stays — reopen owes the path and regenerates it forward
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'content/04.md');
    await expect(store.writeFrame(4, 1, 'Un texto.')).rejects.toThrow(/injected failure/);
    expect(await publishedEvents(rig)).toHaveLength(1); // published
    expect(project.files.get('content/04.md')).toBe(templateFiles()['content/04.md']); // stale disk
    const store2 = newStore();
    await store2.open(REPO);
    expect(openFacts(store2).classification).toBe('regenerated-forward');
    expect(openFacts(store2).regeneratedPaths).toEqual(['content/04.md']);
    expect((await store2.readStory(4)).story.frames[0].text).toBe('Un texto.');
    await expectVerified(api);
  });

  it('stops before sealing when the story file was edited out of band since the open (R-10.7.5)', async () => {
    const { store, rig, project } = await setup();
    const external = spliceFrame(project.files.get('content/01.md')!, 2, 'Edición externa.');
    project.files.set('content/01.md', external);
    await expect(store.writeFrame(1, 1, 'Edición de la app.')).rejects.toThrow(/edited out of band/);
    expect(await publishedEvents(rig)).toEqual([]);
    expect(project.files.get('content/01.md')).toBe(external); // frame 2's external text survives
    project.files.delete('content/01.md');
    await expect(store.writeFrame(1, 1, 'Edición de la app.')).rejects.toThrow(/deleted out of band/);
  });

  it('stops on reopen when a drafted, checkpointed frame was edited out of band: never regenerated over (R-10.7.5)', async () => {
    const { store, newStore, project } = await setup();
    await store.writeFrame(1, 1, 'Texto del diario.');
    await store.commit('checkpoint');
    project.files.set('content/01.md', spliceFrame(project.files.get('content/01.md')!, 1, 'Edición externa.'));
    await expectRefusal(newStore().open(REPO), 'open.story-divergence'); // R-10.7.5, not a book rule
    expect(project.files.get('content/01.md')).toContain('Edición externa.'); // nothing overwritten
  });

  it('keeps the projection a fixed point: an emptied last frame, then the reference line, then another frame', async () => {
    const { store, api, project } = await setup();
    await store.writeFrame(1, 16, 'Último.');
    await store.writeFrame(1, 16, '');
    await store.writeRef(1, 'Génesis 1-2');
    await expectVerified(api);
    const tail = project.files.get('content/01.md')!.slice(-40);
    await store.writeFrame(1, 1, 'Primero.');
    expect(project.files.get('content/01.md')!.slice(-40)).toBe(tail); // frame 1's write left the end of the file alone
    await expectVerified(api);
  });

  it('stops on an out-of-band deletion of a drafted story: never silently repaired (R-10.7.4)', async () => {
    const { store, newStore, project } = await setup();
    await store.writeFrame(5, 1, 'Un texto.');
    project.files.delete('content/05.md');
    await expectRefusal(newStore().open(REPO), 'open.story-divergence');
  });

  it('keeps a Bible project on v: 1, and its v: 1 set folds with no story state', async () => {
    const { store, rig } = await setup();
    await store.createProject({
      content_name: 'Prueba',
      content_abbr: 'prueba',
      content_language_code: 'es',
      add_book: true,
      book_code: 'TIT',
      add_cv: true,
      versification: 'eng',
    });
    const bible = new JournalingStore({ api: store.api, kv: memKv(), now: () => Date.now() });
    await bible.open('_local_/_local_/prueba');
    const { usfm } = await bible.readBook('TIT');
    await bible.writeBook('TIT', usfm.replace('\\v 1 ___', '\\v 1 Pablo.'));
    const events = await publishedEvents(rig, '_local_/_local_/prueba');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.v === 1)).toBe(true);
    const out = fold(events);
    expect(out.stories).toEqual({});
    expect(out.books.TIT.usfm).toContain('\\v 1 Pablo.');
  });
});
