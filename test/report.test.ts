// One Report shape and one refusal-code table — issue #156 (legibility L-3).
//
// Three proofs: the schema is closed (every malformed shape is named), the
// refusal-code table is closed and bound (a code outside it cannot be thrown; a
// live code has the text the Home banner looks up), and the store EMITS the
// shape — an open and a checkpoint each leave a validated Report, ok with its
// facts or failed with the code the thrown refusal carried. Codes, never
// message strings, are what these tests assert.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import {
  REFUSAL_CODES,
  Refusal,
  derivedProjections,
  failedReport,
  fold,
  okReport,
  refusalCodeOf,
  reportError,
  type FoldOutput,
  type RefusalCode,
  type Report,
} from '../src/data/journal/runtime';
import { FAKE_VRS, journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { expectRefusal, lastReportOf, openFacts } from './helpers/report';
import { t } from '../src/i18n/index.js';

const REPO = '_local_/_local_/prueba';
const TIT_USFM = ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', ''].join('\n');
const T0 = '2026-09-22T09:00:00.000Z';
const T1 = '2026-09-22T09:00:01.000Z';

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

describe('#156 the Report schema is closed', () => {
  const ok = { op: 'open', ok: true, facts: { classification: 'converged' }, startedAt: T0, endedAt: T1 };

  it('accepts an ok Report and a failed Report with a bound code', () => {
    expect(reportError(ok)).toBeNull();
    expect(reportError({ op: 'checkpoint', ok: false, code: 'checkpoint.divergence', rule: 'R-8.7.5', facts: {}, startedAt: T0, endedAt: T1 })).toBeNull();
    expect(reportError({ op: 'import', ok: false, code: 'import.name-exists', facts: {}, startedAt: T0, endedAt: T1 })).toBeNull();
    expect(reportError({ op: 'share', ok: false, facts: { message: 'ECONNRESET' }, startedAt: T0, endedAt: T1 })).toBeNull();
  });

  it('names the first problem of every malformed shape (negative controls)', () => {
    expect(reportError(null)).toBe('is not an object');
    expect(reportError({ ...ok, extra: 1 })).toMatch(/unknown field "extra"/);
    expect(reportError({ ...ok, op: 'receive' })).toMatch(/op "receive" is not one of/);
    expect(reportError({ ...ok, ok: 'yes' })).toBe('ok is not a boolean');
    expect(reportError({ ...ok, code: 'seed.mismatch' })).toMatch(/an ok Report carries no code/);
    expect(reportError({ ...ok, ok: false, code: 'nope.nope' })).toMatch(/not in the refusal-code table/);
    expect(reportError({ ...ok, ok: false, rule: 'R-8.8.2' })).toBe('a rule without a code');
    expect(reportError({ ...ok, ok: false, code: 'seed.mismatch', rule: 'R-8.1.6' })).toMatch(/bound to R-8.8.2, not "R-8.1.6"/);
    expect(reportError({ ...ok, ok: false, code: 'seed.mismatch' })).toMatch(/bound to R-8.8.2, not undefined/);
    expect(reportError({ ...ok, ok: false, code: 'share.offline', rule: 'R-8.1.6' })).toMatch(/app rule and carries no rule id/);
    expect(reportError({ ...ok, facts: [] })).toBe('facts is not an object');
    expect(reportError({ ...ok, startedAt: '2026-09-22' })).toMatch(/startedAt is not an ISO-8601/);
    expect(reportError({ ...ok, endedAt: 'soon' })).toMatch(/endedAt is not an ISO-8601/);
  });

  it('the constructors emit only validated Reports', () => {
    expect(() => okReport('open', T0, T1, [] as never)).toThrow(/malformed Report: facts is not an object/);
    const refused = failedReport('open', T0, T1, new Refusal('seed.mismatch', 'refuse to seed', { mismatches: ['x'] }));
    expect(refused).toEqual({
      op: 'open', ok: false, code: 'seed.mismatch', rule: 'R-8.8.2',
      facts: { error: 'refuse to seed', refusal: { mismatches: ['x'] } }, startedAt: T0, endedAt: T1,
    });
    const failed = failedReport('checkpoint', T0, T1, new Error('ECONNRESET'), { message: 'checkpoint (tC4)' });
    expect(failed).toEqual({ op: 'checkpoint', ok: false, facts: { message: 'checkpoint (tC4)', error: 'ECONNRESET' }, startedAt: T0, endedAt: T1 });
  });

  it('a failed Report keeps the refusal facts as fields and never lets them overwrite the operation facts', () => {
    const refusal = new Refusal('checkpoint.divergence', 'checkpoint refused', { stale: ['TIT.usfm (edited out of band)'] });
    const report = failedReport('checkpoint', T0, T1, refusal, { message: 'leave checkpoint (tC4)' });
    expect(report.facts).toEqual({ message: 'leave checkpoint (tC4)', error: 'checkpoint refused', refusal: { stale: ['TIT.usfm (edited out of band)'] } });
    expect(() => failedReport('open', T0, T1, refusal, { error: 'mine' })).toThrow(/reserved/);
    expect(() => failedReport('open', T0, T1, refusal, { refusal: {} })).toThrow(/reserved/);
  });
});

describe('#156 the refusal-code table is closed and bound', () => {
  it('a code outside the table cannot be thrown', () => {
    expect(() => new Refusal('open.made-up' as RefusalCode, 'x')).toThrow(/unknown refusal code "open.made-up"/);
    expect(refusalCodeOf(new Error('plain'))).toBeNull();
    expect(refusalCodeOf({ code: 'not.a.code' })).toBeNull();
    expect(refusalCodeOf(new Refusal('share.offline', 'x'))).toBe('share.offline');
  });

  it('every code is bound to one §8/§10 rule id or to no rule (an app rule)', () => {
    for (const [code, rule] of Object.entries(REFUSAL_CODES)) {
      expect(code, code).toMatch(/^[a-z]+(\.[a-z-]+)+$/);
      if (rule !== null) expect(rule, code).toMatch(/^R-(8|10)(\.\d+)+$/);
    }
    expect(Object.keys(REFUSAL_CODES).length).toBe(38);
  });

  it('every live code has the recovery sentence the Home banner looks up; the reserved codes wait for their issues', () => {
    // Live = every code in the table except the kernels still to come (#41, #362, #203) and
    // the export code no producer throws yet (export.unsupported-kind). The import shell
    // (#361) throws import.name-exists and import.write-failed.
    const reserved = /^(import\.damaged\.|share\.|export\.unsupported-kind$)/;
    const live = Object.keys(REFUSAL_CODES).filter((code) => !reserved.test(code));
    expect(live.length).toBe(26);
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
  it('an open leaves an ok open Report whose facts are the classification', async () => {
    const { store, restart } = await setup();
    const reopened = restart();
    await reopened.open(REPO);
    const report = lastReportOf(reopened, 'open');
    expect(report.ok).toBe(true);
    expect(report.endedAt >= report.startedAt).toBe(true);
    expect(openFacts(reopened).classification).toBe('converged');
    expect(store.lastReport?.op).toBe('open'); // createProject's own open
  });

  it('a checkpoint leaves an ok checkpoint Report naming the paths it wrote', async () => {
    const { store } = await setup();
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    await store.commit('checkpoint (tC4)');
    const report = lastReportOf(store, 'checkpoint');
    expect(report.ok).toBe(true);
    expect(report.facts.message).toBe('checkpoint (tC4)');
    // A save installs its own derived file; the checkpoint writes what still lags — here
    // the §8.7 empty documents a fresh project has not materialized yet.
    expect(report.facts.written).toContain('checking/resources.json');
  });

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

  it('an open that fails before recovery (no such project) leaves a failed open Report without a code, not a stale one', async () => {
    const { store, restart } = await setup();
    await store.commit('checkpoint (tC4)');
    expect(store.lastReport?.op).toBe('checkpoint'); // the previous operation's ok Report
    let thrown: unknown = null;
    await store.open('_local_/_local_/no-such-project').catch((e) => (thrown = e));
    expect(thrown).not.toBeNull();
    const report = lastReportOf(store, 'open');
    expect(report.ok).toBe(false);
    expect(report.code).toBeUndefined();
    expect(report.facts.error).toBe(String((thrown as Error).message));
    const fresh = restart();
    await fresh.open('_local_/_local_/no-such-project').catch(() => undefined);
    expect(lastReportOf(fresh, 'open').ok).toBe(false); // null before, failed after
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
