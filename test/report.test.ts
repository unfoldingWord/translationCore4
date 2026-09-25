// One Report shape and one refusal-code table — issue #156 (legibility L-3).
//
// Two proofs: the refusal-code table is closed and bound (a code outside it
// cannot be thrown; a live code has the text the Home banner looks up), and the
// store's refusal and failure paths each throw the right code and leave a
// validated failed Report. Codes, never message strings, are what these tests
// assert.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import {
  REFUSAL_CODES,
  Refusal,
  derivedProjections,
  fold,
  refusalCodeOf,
  reportError,
  type FoldOutput,
  type RefusalCode,
  type Report,
} from '../src/data/journal/runtime';
import { FAKE_VRS, journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { expectRefusal, lastReportOf } from './helpers/report';
import { t } from '../src/i18n/index.js';

const REPO = '_local_/_local_/prueba';
const TIT_USFM = ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', ''].join('\n');
const T0 = '2026-09-22T09:00:00.000Z';

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow(T0);
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await store.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM });
  const restart = (): JournalingStore => {
    forgetSharedClocks();
    forgetProjectQueues();
    return new JournalingStore({ api, kv, now: () => clock.advance(29) });
  };
  return { rig, store, restart };
};

describe('#156 the refusal-code table is closed and bound', () => {
  it('a code outside the table cannot be thrown', () => {
    expect(() => new Refusal('open.made-up' as RefusalCode, 'x')).toThrow(/unknown refusal code "open.made-up"/);
    expect(refusalCodeOf(new Error('plain'))).toBeNull();
    expect(refusalCodeOf({ code: 'not.a.code' })).toBeNull();
    expect(refusalCodeOf(new Refusal('share.offline', 'x'))).toBe('share.offline');
  });

  it('every live code has the recovery sentence the Home banner looks up; the reserved codes wait for their issues', () => {
    // Live = every code in the table except the kernels still to come (#41, #362, #203) and
    // the export code no producer throws yet (export.unsupported-kind). The import shell
    // (#361) throws import.name-exists and import.write-failed.
    const reserved = /^(import\.damaged\.|share\.|export\.unsupported-kind$)/;
    const live = Object.keys(REFUSAL_CODES).filter((code) => !reserved.test(code));
    expect(live.length).toBe(27);
    for (const code of live) expect(t(`refusal.${code}`, undefined, ''), code).not.toBe('');
  });

  it('the reference checkpoint projection throws coded refusals, one code per rule (R-8.7.4, R-8.7.6)', () => {
    const empty = fold([]);
    expect(() => derivedProjections(empty, { baseMetadata: null, resolutions: {} })).toThrow(
      expect.objectContaining({ code: 'checkpoint.incomplete-inputs', rule: 'R-8.7.4' }),
    );
    const escaping = { ...empty, pins: {}, books: { '../EVIL': { usfm: '', verses: {} } }, vrs: { name: 'eng', bytes: '{}' } } as unknown as FoldOutput;
    expect(() => derivedProjections(escaping, { baseMetadata: {}, resolutions: {} })).toThrow(
      expect.objectContaining({ code: 'checkpoint.unsafe-path', rule: 'R-8.7.6' }),
    );
  });
});

describe('#156 the store emits the Report', () => {
  it('a refused checkpoint throws checkpoint.divergence and leaves the failed Report with that code', async () => {
    const { rig, store } = await setup();
    rig.repos.get(REPO)!.files.set('checking/settings.json', '{"schemaVersion":1,"tampered":true}'); // another tool
    const refusal = await expectRefusal(store.commit('checkpoint (tC4)'), 'checkpoint.divergence');
    expect(refusal.facts.stale).toEqual(['checking/settings.json (edited out of band)']);
    const report = lastReportOf(store, 'checkpoint');
    expect(report.ok).toBe(false);
    expect(report.facts.message).toBe('checkpoint (tC4)'); // the operation's own fact survives
    expect((report.facts.refusal as { stale: string[] }).stale).toEqual(['checking/settings.json (edited out of band)']);
    expect(report.code).toBe('checkpoint.divergence');
    expect(report.rule).toBe('R-8.7.5');
  });

  it('a refused open throws open.unexplained-divergence and leaves the failed Report with that code', async () => {
    const { rig, restart } = await setup();
    const repo = '_local_/_local_/extrania';
    rig.createRepo(repo, { 'vrs.json': FAKE_VRS, 'TIT.usfm': TIT_USFM, 'checking/custom/notes.json': '{"mine": true}' });
    const store = restart();
    const refusal = await expectRefusal(store.open(repo), 'open.unexplained-divergence');
    expect(refusal.facts.repoPath).toBe(repo);
    const report = lastReportOf(store, 'open');
    expect(report.ok).toBe(false);
    expect(report.code).toBe('open.unexplained-divergence');
    expect(report.rule).toBe('R-8.7.5');
  });

  it('a checkpoint whose status read fails leaves a failed checkpoint Report, not the previous ok one', async () => {
    const { rig, store } = await setup();
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    expect(await store.commitPending(() => 'checkpoint (tC4)')).toBe('checkpoint (tC4)');
    expect(lastReportOf(store, 'checkpoint').ok).toBe(true);
    rig.failOn((ctx) => ctx.route.includes('/git/status/'));
    let thrown: unknown = null;
    await store.commitPending(() => 'again (tC4)').catch((e) => (thrown = e));
    expect(thrown).not.toBeNull();
    const report = lastReportOf(store, 'checkpoint');
    expect(report.ok).toBe(false);
    expect(report.facts.error).toBe(String((thrown as Error).message));
  });

  it('an open records its seed and reconcile phases as Reports, ok or failed', async () => {
    const { rig, store, restart } = await setup();
    const created = lastReportOf(store, 'open');
    expect((created.facts.phases as Report[]).map((r) => [r.op, r.ok])).toEqual([['seed', true]]);

    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    const edited = rig.repos.get(REPO)!.files.get('TIT.usfm')!.replace('Pablo, siervo de Dios.', 'Pablo, apóstol.');
    rig.repos.get(REPO)!.files.set('TIT.usfm', edited); // another tool
    const reopened = restart();
    await reopened.open(REPO);
    const phases = lastReportOf(reopened, 'open').facts.phases as Report[];
    expect(phases.map((r) => [r.op, r.ok])).toEqual([['reconcile', true]]);
    expect(reportError(phases[0])).toBeNull();
    expect(phases[0].facts.reconciledBooks).toEqual(['TIT']);

    const repo = '_local_/_local_/nonfc';
    rig.createRepo(repo, { 'vrs.json': FAKE_VRS, 'TIT.usfm': TIT_USFM.replace('Pablo', 'Pablo cafe\u0301') }); // NFD
    const refused = restart();
    await expectRefusal(refused.open(repo), 'seed.mismatch');
    const failed = lastReportOf(refused, 'open');
    expect(failed.code).toBe('seed.mismatch');
    const [seed] = failed.facts.phases as Report[];
    expect([seed.op, seed.ok, seed.code, seed.rule]).toEqual(['seed', false, 'seed.mismatch', 'R-8.8.2']);
  });


  it('expectRefusal fails when the operation succeeds or carries another code', async () => {
    await expect(expectRefusal(Promise.resolve('fine'), 'seed.mismatch')).rejects.toThrow(/the operation succeeded/);
    await expect(expectRefusal(Promise.reject(new Refusal('share.offline', 'x')), 'seed.mismatch')).rejects.toThrow(/expected the refusal seed.mismatch/);
  });
});
