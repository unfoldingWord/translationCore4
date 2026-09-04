// JournalStore integration tests — issue #61, run against the LIVE pankosmia rig
// (http://127.0.0.1:19998, /api). The rig is detected up front; without it the
// suite is skipped with a clear message naming the prerequisite (the same
// rig-gated pattern as test/httpStore.integration.test.ts — rig-dependent
// integration rows are accepted by the TEST-PLAN; CI may not have the rig).
//
// The suite creates its own uniquely-named scratch project in beforeAll and
// leaves it behind (the journey suite reseeds the rig later).
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpStore } from '../src/data/httpStore';
import { ServerApi } from '../src/data/serverApi';
import { JournalStore } from '../src/data/journal/journalStore';
import type { KvStore } from '../src/data/journal/identity';
import type { JournalEvent } from '../src/data/journal/seal';

// journal/files.mjs is Node-bound (fs, node:crypto); loaded via a
// NATIVE require outside the vite pipeline (vite-plugin-node-polyfills aliases
// node builtins to browser mocks even under the Vitest node environment — same
// workaround as test/s0a-aligner-headless.test.ts).
const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
const refFiles = nodeRequire('./journal/files.mjs') as {
  validateActorDoc(raw: unknown, actorId: string): { ok: boolean; reason?: string };
  validateSegment(raw: string): { ok: boolean; reason?: string };
};

const BASE = 'http://127.0.0.1:19998/api';

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
    `[journalStore.integration] pankosmia rig not reachable at ${BASE} — the live-rig suite is skipped ` +
      '(rig-dependent integration rows are accepted by the TEST-PLAN; start the rig to run them).',
  );
}

const memKv = (): KvStore => {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    setIfAbsent: async (key, value) => {
      const existing = map.get(key);
      if (existing !== undefined) return existing;
      map.set(key, value);
      return value;
    },
    keys: async (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
    delete: async (key) => {
      map.delete(key);
    },
  };
};

const RUN = Date.now();
const ABBR = `j61js_${RUN}`;
const REPO = `_local_/_local_/${ABBR}`;

describe.skipIf(!rigUp)(
  'JournalStore against the live rig (#61 checkbox coverage, end to end)',
  () => {
    const api = new ServerApi({ baseUrl: BASE });
    const journal = new JournalStore({ api, repoPath: REPO, kv: memKv() });

    beforeAll(async () => {
      const httpStore = new HttpStore({ baseUrl: BASE });
      const { repoPath } = await httpStore.createProject({
        content_name: `J61 JournalStore test ${RUN}`,
        content_abbr: ABBR,
        content_language_code: 'es',
        content_language_name: 'Spanish',
        add_book: true,
        book_code: 'TIT',
        book_title: 'Tito',
        book_abbr: 'Tit',
        add_cv: true,
        versification: 'eng',
      });
      expect(repoPath).toBe(REPO);
    }, 60_000);

    it('open() provisions actor.json in the scratch project, and the reference validator accepts it', async () => {
      const { actorId } = await journal.open();
      const raw = await api.readIngredient(REPO, `checking/journal/${actorId}/actor.json`);
      expect(refFiles.validateActorDoc(raw, actorId).ok).toBe(true);
    }, 30_000);

    let publishedEvents: JournalEvent[];
    let segmentIpath: string;

    it('publish() lands a segment readable via readIngredient whose bytes pass the reference validateSegment', async () => {
      publishedEvents = [
        {
          v: 1,
          op: 'text.verse.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: null,
          book: 'TIT',
          chapter: '1',
          verse: '1',
          text: 'primer borrador en el rig\n',
        },
      ];
      const result = await journal.publish(publishedEvents);
      expect(result.idempotent).toBe(false);
      segmentIpath = result.ipath;
      const raw = await api.readIngredient(REPO, segmentIpath);
      expect(refFiles.validateSegment(raw).ok).toBe(true);
    }, 30_000);

    it('a second identical publish is an idempotent accept (R-8.1.5)', async () => {
      const result = await journal.publish(publishedEvents);
      expect(result.idempotent).toBe(true);
      expect(result.ipath).toBe(segmentIpath);
    }, 30_000);

    it('a DIFFERENT action at the same path refuses, and the accepted bytes stay untouched (R-8.1.5)', async () => {
      const before = await api.readIngredient(REPO, segmentIpath);
      const different: JournalEvent[] = [{ ...publishedEvents[0], text: 'un texto DIFERENTE\n' }];
      await expect(journal.publish(different)).rejects.toThrow(/refuse to overwrite/);
      expect(await api.readIngredient(REPO, segmentIpath)).toBe(before);
    }, 30_000);

    it('readOwnSegments lists the published segment via GET /burrito/paths (the platform listing route)', async () => {
      const listing = await journal.readOwnSegments();
      expect(listing.segments.map((segment) => segment.ts)).toContain(publishedEvents[0].ts);
    }, 30_000);
  },
);
