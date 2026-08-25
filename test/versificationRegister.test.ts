// readVersification() — the store accessor behind the issue #15 scheme ladder.
//
// The point of these tests is the ASYMMETRY between the two stores, which is
// the whole reason the ladder exists:
//
//   * the journaling store reads the sealed §8.5 `project.vrs.set` register, so
//     a project tC4 created reports its real scheme NAME;
//   * the raw store reads the ingredient, which carries no name at all, because
//     the platform discards the name it was handed at creation.
//
// If the raw store ever started reporting a scheme name, the ladder's second
// rung would go untested — so one test here pins that it does not.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { HttpStore } from '../src/data/httpStore';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import {
  SCHEME_NAMES,
  UNRECORDED_SCHEME,
  isSchemeName,
  resolveProjectScheme,
  type SchemeDoc,
  type SchemeName,
} from '../src/data/versification';
import { FAKE_VRS, journalingRig, memKv, tickingNow } from './helpers/journalingRig';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const REPO = '_local_/_local_/prueba';

const VRS_DIR = path.resolve(process.cwd(), 'test/fixtures/vrs');
const schemes = Object.fromEntries(
  SCHEME_NAMES.map((n) => [
    n,
    JSON.parse(fs.readFileSync(path.join(VRS_DIR, `${n}.json`), 'utf8')) as SchemeDoc,
  ]),
) as Record<SchemeName, SchemeDoc>;

const setup = async (versification = 'eng') => {
  forgetProjectQueues();
  forgetSharedClocks();
  const rig = journalingRig();
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const clock = tickingNow('2026-08-24T12:00:00.000Z');
  const kv = memKv();
  const store = new JournalingStore({ api, kv, now: () => clock.advance(7) });
  await store.createProject({
    content_name: 'prueba',
    content_abbr: 'prueba',
    content_language_code: 'es-419',
    content_language_name: 'Español',
    add_book: false,
    book_code: undefined,
    book_title: undefined,
    book_abbr: undefined,
    add_cv: false,
    versification,
  });
  return { rig, api, store };
};

describe('JournalingStore.readVersification — the sealed register', () => {
  it('reports the scheme name tC4 passed at creation, with the exact bytes', async () => {
    const { store } = await setup('eng');
    expect(await store.readVersification()).toEqual({ name: 'eng', bytes: FAKE_VRS });
  });

  it('carries a non-default scheme name through', async () => {
    const { store } = await setup('lxx');
    const register = await store.readVersification();
    expect(register?.name).toBe('lxx');
    // Rung 1 resolves it without ever parsing the bytes.
    expect(resolveProjectScheme(register, schemes)).toEqual({
      name: 'lxx',
      source: 'recorded',
    });
  });
});

describe('HttpStore.readVersification — bytes without a name', () => {
  it('reports the placeholder, never a scheme name', async () => {
    const { api } = await setup('lxx');
    const raw = new HttpStore({ api, repoPath: REPO });
    const register = await raw.readVersification();

    expect(register?.bytes).toBe(FAKE_VRS);
    // The project WAS created as lxx, and the raw store still cannot say so:
    // the name lives only in the journal. This is the asymmetry the ladder
    // exists for, so assert it rather than assume it.
    expect(register?.name).toBe(UNRECORDED_SCHEME);
    expect(isSchemeName(register?.name)).toBe(false);
  });

  it('returns null when the project has no versification ingredient', async () => {
    const { api, rig } = await setup();
    rig.repos.get(REPO)?.files.delete('vrs.json');
    const raw = new HttpStore({ api, repoPath: REPO });
    expect(await raw.readVersification()).toBeNull();
    // Absence must resolve to unknown, NOT to eng — three of five sampled
    // published burritos carry no versification ingredient at all.
    expect(resolveProjectScheme(null, schemes)).toEqual({ name: null, source: 'unknown' });
  });
});
