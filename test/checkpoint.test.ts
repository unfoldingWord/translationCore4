// Issue #183 — the checkpoint commit message is derived from the pending
// changes, and a clean tree yields no message (so no empty commit).
import { describe, expect, it } from 'vitest';
import { checkpointMessage } from '../src/data/checkpoint';

const ch = (path: string, change_type = 'modified') => ({ path, change_type });

describe('#183 checkpointMessage', () => {
  it('a clean tree is nothing to commit', () => {
    expect(checkpointMessage('leaving Translate', [])).toBeNull();
  });

  it('names the books and the kind of work, once each, in the order seen', () => {
    const msg = checkpointMessage('leaving Translate', [
      ch('ingredients/checking/journal/', 'new'),
      ch('ingredients/TIT.usfm'),
      ch('ingredients/checking/translationWords/TIT.json'),
      ch('ingredients/checking/alignments/TIT.json'),
      ch('ingredients/TIT.usfm'),
      ch('ingredients/JON.usfm'),
      ch('metadata.json'),
      ch('ingredients/audio/TIT/01.mp3', 'new'),
    ]);
    expect(msg).toBe('Checkpoint, leaving Translate: TIT text, TIT checks, TIT alignment, JON text, audio (tC4)');
  });

  it('a checkpoint that carries only journal segments and metadata says so', () => {
    expect(checkpointMessage('leaving the project', [ch('ingredients/checking/journal/', 'new'), ch('metadata.json')]))
      .toBe('Checkpoint, leaving the project: journal (tC4)');
  });

  it('settings and source pins are named as what they are', () => {
    expect(checkpointMessage('leaving Check', [ch('ingredients/checking/settings.json'), ch('ingredients/checking/resources.json')]))
      .toBe('Checkpoint, leaving Check: settings, sources (tC4)');
  });
});

// The store half: status and commit are ONE queued step, so overlapping
// checkpoints cannot both see the same pending changes and record an empty
// second commit (the platform would: PLATFORM-NOTES #9).
import { ServerApi } from '../src/data/serverApi';
import { HttpStore } from '../src/data/httpStore';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';

const REPO = '_local_/_local_/puntos';
const TIT = ['\\id TIT puntos', '\\usfm 3.0', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', ''].join('\n');

const seeded = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-09-05T12:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await store.createProject({ content_name: 'Puntos', content_abbr: 'puntos', content_language_code: 'es', add_book: false, versification: 'eng' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT });
  await store.commit('baseline');
  return { rig, store, project: rig.repos.get(REPO)! };
};

describe('#183 commitPending', () => {
  it('a clean tree commits nothing and returns null', async () => {
    const { store, project } = await seeded();
    const n = project.commits.length;
    expect(await store.commitPending((changes) => checkpointMessage('leaving Translate', changes))).toBeNull();
    expect(project.commits.length).toBe(n);
  });

  it('pending changes commit once with the derived message; a second overlapping checkpoint commits nothing', async () => {
    const { rig, store, project } = await seeded();
    await store.writeBook('TIT', TIT.replace('\\v 2 ___', '\\v 2 Nueva vida.'));
    const n = project.commits.length;
    const [a, b] = await Promise.all([
      store.commitPending((changes) => checkpointMessage('leaving Translate', changes)),
      store.commitPending((changes) => checkpointMessage('leaving the project', changes)),
    ]);
    expect(a).toMatch(/^Checkpoint, leaving Translate: .*TIT text/);
    expect(b).toBeNull();
    expect(project.commits.length).toBe(n + 1);
    expect(project.commits.at(-1)).toBe(a);

    // The raw store holds the same contract (it is what the boundary drives).
    const raw = new HttpStore({ fetchFn: rig.fetchFn, baseUrl: 'http://rig.test/api' });
    await raw.open(REPO);
    project.dirty.add('TIT.usfm');
    const [c, d] = await Promise.all([
      raw.commitPending((changes) => checkpointMessage('leaving Check', changes)),
      raw.commitPending((changes) => checkpointMessage('leaving the project', changes)),
    ]);
    expect(c).toBe('Checkpoint, leaving Check: TIT text (tC4)');
    expect(d).toBeNull();
    expect(project.commits.length).toBe(n + 2);
  });
});
