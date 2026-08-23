// Round-6 review regressions (antagonistic review, 2026-08-23) — the two
// intent-ledger blockers found before the official #62 review:
//   B1. A retried mutation after a LOST PUBLISH RESPONSE must not re-emit the
//       same edit as a second action: replayOwnStagedBeforeDiff must refresh
//       the fold on 'already-published' (not only 'republished'), and must
//       refuse to mutate over a 'conflict'.
//   B2. Pruning a newer converged intent while an older live record shares a
//       resolution key must not roll the overlay (and then the disk) back to
//       the superseded resolution: the prune may not destroy the supersession
//       information the overlay query depends on.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import type { Decision, DecisionFile, ResourcesFile } from '../src/data/burritoStore';
import {
  journalingRig,
  memKv,
  tickingNow,
  type JournalingRig,
} from './helpers/journalingRig';

const REPO = '_local_/_local_/prueba';

const TIT_USFM = [
  '\\id TIT prueba',
  '\\h Tito',
  '\\mt Tito',
  '\\c 1',
  '\\p',
  '\\v 1 Pablo, siervo de Dios.',
  '\\v 2 ___',
  '',
].join('\n');

const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};
const PIN = (repo: string, version: string, flavor: string) => ({
  sha: sha40(`${repo}@${version}`),
  repoPath: `git.door43.org/unfoldingWord/${repo}`,
  version,
  flavor,
});
const RUNG = {
  gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
  translationNotes: PIN('en_tn', 'v86', 'parascriptural/x-bcvnotes'),
  translationWordsLinks: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationWords: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationAcademy: PIN('en_ta', 'v86', 'peripheral/x-peripheralArticles'),
};
const PINS: ResourcesFile = {
  schemaVersion: 2,
  languageSets: { primary: { ...RUNG }, fallback: { ...RUNG } },
} as unknown as ResourcesFile;

const RESOLUTION = {
  repoPath: 'git.door43.org/unfoldingWord/en_tw',
  version: 'v87',
  sha: sha40('en_tw@v87'),
  languageSet: 'fallback',
};
// Two SUCCESSIVE resolutions of the same (tool, book) — the B2 rollback pair.
const RES_OLD = {
  repoPath: 'git.door43.org/es-419_gl/es-419_tw',
  version: 'v37',
  sha: sha40('es-419_tw@v37'),
  languageSet: 'primary',
};
const RES_NEW = {
  repoPath: 'git.door43.org/es-419_gl/es-419_tw',
  version: 'v38',
  sha: sha40('es-419_tw@v38'),
  languageSet: 'primary',
};

const decision = (checkId: string, comments: string | false = false): Decision =>
  ({
    contextId: {
      checkId,
      occurrenceNote: '',
      reference: { bookId: 'tit', chapter: 1, verse: 1 },
      tool: 'translationWords',
      groupId: 'god',
      quote: 'Θεοῦ',
      quoteString: 'Θεοῦ',
      glQuote: '',
      occurrence: 1,
    },
    category: 'kt',
    selections: false,
    comments,
    reminders: false,
    nothingToSelect: false,
    verseEdits: false,
    invalidated: false,
    modifiedTimestamp: '2026-08-23T12:00:00.000Z',
  }) as unknown as Decision;

const segmentPaths = (rig: JournalingRig, repo = REPO): string[] =>
  [...(rig.repos.get(repo)?.files.keys() ?? [])]
    .filter((p) => /^checking\/journal\/[a-z0-9-]+\/segments\//.test(p))
    .sort();

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-08-23T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await store.createProject({
    content_name: 'Prueba',
    content_abbr: 'prueba',
    content_language_code: 'es',
    add_book: false,
    versification: 'eng',
  });
  await store.writeResources(PINS, null);
  await store.writeSettings({ schemaVersion: 1, textDirection: 'ltr' });
  await store.addBook({
    book_code: 'TIT',
    book_title: 'Tito',
    book_abbr: 'TIT',
    add_cv: true,
    initialUsfm: TIT_USFM,
  });
  const restart = (): JournalingStore => {
    forgetSharedClocks();
    forgetProjectQueues();
    return new JournalingStore({ api, kv, now: () => clock.advance(29) });
  };
  return { rig, api, kv, clock, store, restart };
};

describe('round 6 B1: a retry after a lost publish response is idempotent', () => {
  it('the retried edit is not re-emitted as a second action on the old base', async () => {
    const { rig, api, kv, store, restart } = await setup();
    const EDITED = TIT_USFM.replace('___', 'Nueva vida.');

    // The segment write is ACCEPTED by the server but the response is lost —
    // emulated at the exact same crash window: the stage-key delete after the
    // confirmed accept fails, so publish() throws AFTER the segment landed and
    // BEFORE the in-memory fold learned about it.
    let lostResponses = 1;
    const rawDelete = kv.delete.bind(kv);
    kv.delete = async (key: string): Promise<void> => {
      if (lostResponses > 0 && key.startsWith('outbox:')) {
        lostResponses -= 1;
        throw new Error('injected failure: lost response after accept');
      }
      return rawDelete(key);
    };
    await expect(store.writeBook('TIT', EDITED)).rejects.toThrow(/lost response/);

    // The segment IS on the server and the staged intent survived.
    const published = segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('Nueva vida.'),
    );
    expect(published).toHaveLength(1);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    // The user retries the same save. Replay finds the byte-identical segment
    // ('already-published'), which PROVES the fold is stale — the retry must
    // refresh and diff to nothing, never re-emit the edit on the old base.
    await store.writeBook('TIT', EDITED);
    const republished = segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('Nueva vida.'),
    );
    expect(republished, 'the same edit must not be published twice').toHaveLength(1);

    // The project verifies and a reopen converges quietly.
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
  });
});

describe('round 6 B3 / D59: the relabel guard compares shas, never version labels', () => {
  it('a same-label resolution over a DIFFERENT sha REFUSES the decision write', async () => {
    const { rig, store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('base1'), RESOLUTION);

    // The tag is unenforced (D58): same repoPath, same 'v87', another commit.
    const retagged = { ...RESOLUTION, sha: 'e'.repeat(40) };
    await expect(
      store.upsertDecision('translationWords', 'TIT', decision('base2'), retagged),
    ).rejects.toThrow(/sha|gateway/i);

    // Nothing relabeled, nothing silently journaled under wrong provenance.
    const doc = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { sha?: string }; decisions?: Decision[] };
    expect(doc.resource?.sha).toBe(RESOLUTION.sha);
    expect(doc.decisions?.some((d) => d.contextId.checkId === 'base2')).toBeFalsy();
  });

  it('the SAME sha under a different display label agrees — the label is cosmetic', async () => {
    const { rig, api, store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('base1'), RESOLUTION);

    const relabeled = { ...RESOLUTION, version: 'v87-rc1' };
    await store.upsertDecision('translationWords', 'TIT', decision('base2'), relabeled);
    const doc = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { sha?: string; version?: string }; decisions?: Decision[] };
    expect(doc.resource?.sha).toBe(RESOLUTION.sha);
    expect(doc.resource?.version).toBe('v87-rc1');
    expect(doc.decisions?.some((d) => d.contextId.checkId === 'base2')).toBe(true);
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });
});

describe('round 6 B2: pruning a newer intent never resurrects a superseded resolution', () => {
  it('a retained older record cannot roll the decision file back after the newer record prunes', async () => {
    const { rig, api, store, restart } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);

    // I1 — a coordinated gateway change to RES_OLD whose resources.json
    // regeneration fails persistently: published, decisions regenerated, the
    // record is retained with resolutions {translationWords/TIT: RES_OLD}.
    const nextPins = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (nextPins.languageSets.primary as unknown as Record<string, unknown>).translationWords = PIN(
      'es-419_tw',
      'v37',
      'parascriptural/x-bcvarticles',
    );
    rig.failOn((c) => c.method === 'POST' && c.ipath === 'checking/resources.json', 2);
    await expect(
      store.applyGatewayChange({
        resources: nextPins,
        resourcesMd5: (await store.readResourcesWithMd5()).md5,
        decisions: [
          {
            tool: 'translationWords',
            book: 'TIT',
            file: {
              schemaVersion: 1,
              tool: 'translationWords',
              book: 'TIT',
              resource: RES_OLD as never,
              decisions: [decision('nuevo1', 'llevada')],
            } as unknown as DecisionFile,
            expectMd5: (await store.readDecisionsWithMd5('translationWords', 'TIT')).md5,
          },
        ],
      }),
    ).rejects.toThrow(/injected failure/);

    // I2 — a later whole-file write moves the SAME (tool, book) key to RES_NEW
    // and adds a decision. It converges; its record becomes prunable. The
    // still-failing resources.json keeps I1 alive (its inline retry burns the
    // second injected failure).
    const stored = (await store.readDecisions('translationWords', 'TIT'))!;
    await store.writeDecisions('translationWords', 'TIT', {
      ...stored,
      resource: RES_NEW as never,
      decisions: [...stored.decisions, decision('extra1')],
    } as unknown as DecisionFile);
    const afterI2 = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { version?: string } };
    expect(afterI2.resource?.version).toBe('v38');

    // The injected failures are exhausted: resources.json can now install.
    // Any later mutation runs the inline retry of I1's outstanding paths —
    // which must complete I1 under the CURRENT overlay, never rewrite the
    // decision file back to I1's superseded RES_OLD.
    await store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' });
    const afterRetry = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { version?: string; sha?: string } };
    expect(
      afterRetry.resource?.version,
      'the superseded resolution must never be resurrected by the retry',
    ).toBe('v38');
    expect(afterRetry.resource?.sha).toBe(RES_NEW.sha);

    // And the same holds across a restart + open.
    const store2 = restart();
    await store2.open(REPO);
    const afterOpen = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { version?: string } };
    expect(afterOpen.resource?.version).toBe('v38');
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });
});
