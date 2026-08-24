// Fold-compare verifier — the negative cases (issue #62): the verifier must
// REPORT what tampering produces, with useful hashes, and validate the journal
// itself with the conformance reader. The positive path is exercised after
// every scenario of the store suites (expectVerified); this file proves the
// verifier actually fails when the invariant is broken — a verifier that
// cannot fail proves nothing.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { describeVerifierReport, verifyProjectAgainstJournal } from '../src/data/journal/verify';
import type { ResourcesFile } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';

const REPO = '_local_/_local_/prueba';

const TIT_USFM = ['\\id TIT prueba', '\\c 1', '\\p', '\\v 1 Pablo.', '\\v 2 ___', ''].join('\n');

// D58: a §5.3 pin carries its sha identity.
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

const setup = async (): Promise<{ rig: JournalingRig; api: ServerApi }> => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-08-19T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  await store.createProject({
    content_name: 'Prueba',
    content_abbr: 'prueba',
    content_language_code: 'es',
    add_book: false,
    versification: 'eng',
  });
  await store.writeResources(PINS, null);
  await store.writeSettings({ schemaVersion: 1, textDirection: 'ltr' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM });
  await store.commit('checkpoint (tC4)');
  return { rig, api };
};

describe('#62 fold-compare verifier: reports every broken invariant', () => {
  it('verifies the healthy project (and the description says so)', async () => {
    const { api } = await setup();
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    expect(describeVerifierReport(report)).toContain('verified');
    expect(report.clean).toContain('TIT.usfm');
  });

  it('a MISMATCHED derived file is reported with both hashes', async () => {
    const { rig, api } = await setup();
    rig.repos.get(REPO)?.files.set('TIT.usfm', TIT_USFM.replace('Pablo.', 'Pedro.'));
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok).toBe(false);
    const entry = report.mismatches.find((m) => m.ipath === 'TIT.usfm');
    expect(entry?.kind).toBe('mismatched');
    expect(entry?.diskMd5).toMatch(/^[0-9a-f]{32}$/);
    expect(entry?.projectedMd5).toMatch(/^[0-9a-f]{32}$/);
    expect(entry?.diskMd5).not.toBe(entry?.projectedMd5);
  });

  it('a derived file DELETED from disk is MISSING; an underived extra file is EXTRA', async () => {
    const { rig, api } = await setup();
    rig.repos.get(REPO)?.files.delete('checking/settings.json');
    rig.repos.get(REPO)?.files.set('checking/extra.json', '{}');
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok).toBe(false);
    expect(report.mismatches.find((m) => m.ipath === 'checking/settings.json')?.kind).toBe('missing');
    expect(report.mismatches.find((m) => m.ipath === 'checking/extra.json')?.kind).toBe('extra');
  });

  it('a corrupted segment fails the run via the conformance reader — never silently dropped', async () => {
    const { rig, api } = await setup();
    const project = rig.repos.get(REPO);
    const segment = [...(project?.files.keys() ?? [])].find((p) => p.includes('/segments/'));
    project?.files.set(segment ?? '', `${project.files.get(segment ?? '') ?? ''}tampered`);
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok).toBe(false);
    expect(report.invalidSegments.some((s) => s.path === segment)).toBe(true);
  });

  it('a metadata scope that does not match the fold is a metadata problem (R-8.7.2)', async () => {
    const { rig, api } = await setup();
    const meta = rig.repos.get(REPO)?.meta as { type: { flavorType: { currentScope: unknown } } };
    meta.type.flavorType.currentScope = {};
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok).toBe(false);
    expect(report.metadataProblems.some((p) => p.includes('currentScope'))).toBe(true);
  });
});
