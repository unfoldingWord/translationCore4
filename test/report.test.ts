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
  failedReport,
  okReport,
  refusalCodeOf,
  reportError,
  type RefusalCode,
} from '../src/data/journal/runtime';
import { t } from '../src/i18n/index.js';
import { FAKE_VRS, journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { expectRefusal, lastReportOf, openFacts } from './helpers/report';

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
    expect(refused).toEqual({ op: 'open', ok: false, code: 'seed.mismatch', rule: 'R-8.8.2', facts: { message: 'refuse to seed' }, startedAt: T0, endedAt: T1 });
    const failed = failedReport('checkpoint', T0, T1, new Error('ECONNRESET'), { message: 'checkpoint (tC4)' });
    expect(failed).toEqual({ op: 'checkpoint', ok: false, facts: { message: 'ECONNRESET' }, startedAt: T0, endedAt: T1 });
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
    expect(Object.keys(REFUSAL_CODES).length).toBe(28);
  });

  it('every code a live operation throws has the recovery text the Home banner looks up', () => {
    const live: RefusalCode[] = [
      'segment.invalid', 'segment.misnamed', 'segment.foreign-actor', 'ledger.unreadable', 'open.scope-unreadable',
      'open.unexplained-divergence', 'seed.mismatch', 'seed.publish-failed', 'checkpoint.divergence',
      'checkpoint.scope-mismatch', 'checkpoint.incomplete-inputs', 'checkpoint.metadata-unwritable',
    ];
    for (const code of live) {
      expect(code in REFUSAL_CODES, code).toBe(true);
      expect(t(`refusal.${code}`, undefined, ''), code).not.toBe('');
    }
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
    expect(report.facts.message).toBe(String((thrown as Error).message));
    const fresh = restart();
    await fresh.open('_local_/_local_/no-such-project').catch(() => undefined);
    expect(lastReportOf(fresh, 'open').ok).toBe(false); // null before, failed after
  });

  it('expectRefusal fails when the operation succeeds or carries another code', async () => {
    await expect(expectRefusal(Promise.resolve('fine'), 'seed.mismatch')).rejects.toThrow(/the operation succeeded/);
    await expect(expectRefusal(Promise.reject(new Refusal('share.offline', 'x')), 'seed.mismatch')).rejects.toThrow(/expected the refusal seed.mismatch/);
  });
});
