// @vitest-environment jsdom
// The export kernel (issue #375): a fake producer proves the wrapper — a dirty
// project gets one D9 checkpoint, a clean one none, and a failure delivers
// nothing and returns a Report code. The store is the real JournalingStore on
// the fake rig, so the checkpoint is the production one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFilename, runExport, type ExportProducer } from '../src/data/export/kernel';
import { Refusal, reportError } from '../src/data/journal/runtime';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import type { ProjectSummary } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { assertProjectUnchanged } from './helpers/export';

const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { execFileSync } = process.getBuiltinModule('node:child_process');

const REPO = '_local_/_local_/puntos';
const TIT = ['\\id TIT puntos', '\\usfm 3.0', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', ''].join('\n');
const PROJECT = { id: 'puntos', name: 'Puntos', languageTag: 'es', scriptDirection: 'ltr', flavor: 'textTranslation', bookCodes: ['TIT'] } as ProjectSummary;

const seeded = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-09-22T12:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  await store.createProject({ content_name: 'Puntos', content_abbr: 'puntos', content_language_code: 'es', add_book: false, versification: 'eng' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT });
  await store.commit('baseline');
  return { rig, store, project: rig.repos.get(REPO)! };
};

/** The fake producer: the book's USFM, read through the store, as a text file. */
const fake = (produce?: ExportProducer['produce']): ExportProducer => ({
  id: 'usfm-plain',
  label: 'Fake',
  appliesTo: () => true,
  produce:
    produce ??
    (async ({ store, book }) => ({ bytes: new TextEncoder().encode((await store.readBook(book!)).usfm), filename: exportFilename('puntos-TIT', 'txt'), mime: 'text/plain' })),
});

let downloads: Array<{ name: string; href: string }>;
beforeEach(() => {
  downloads = [];
  // jsdom has no Blob URLs and does not navigate on an anchor click: record the click.
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('#375 runExport', () => {
  it('a dirty project gets exactly one checkpoint, then the file is delivered and the Report is ok', async () => {
    const { store, project } = await seeded();
    await store.writeBook('TIT', TIT.replace('\\v 2 ___', '\\v 2 Nueva vida.'));
    const n = project.commits.length;
    const report = await runExport(fake(), { store, project: PROJECT, book: 'TIT' });
    expect(reportError(report)).toBeNull();
    expect(report).toMatchObject({ op: 'export', ok: true, facts: { producer: 'usfm-plain', filename: exportFilename('puntos-TIT', 'txt') } });
    expect(project.commits.length).toBe(n + 1);
    expect(project.commits.at(-1)).toBe('Checkpoint, before export: TIT text (tC4)');
    expect(downloads).toEqual([{ name: exportFilename('puntos-TIT', 'txt'), href: 'blob:fake' }]);
    expect(report.facts.bytes).toBe(new TextEncoder().encode(TIT.replace('\\v 2 ___', '\\v 2 Nueva vida.')).byteLength);
  });

  it('a producer that throws delivers nothing and returns export.read-failed', async () => {
    const { store } = await seeded();
    const report = await runExport(fake(async () => { throw new Error('no such book'); }), { store, project: PROJECT });
    expect(reportError(report)).toBeNull();
    expect(report).toMatchObject({ op: 'export', ok: false, code: 'export.read-failed', facts: { producer: 'usfm-plain', error: 'no such book' } });
    expect(downloads).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("a producer's own refusal keeps its code and delivers nothing", async () => {
    const { store } = await seeded();
    const report = await runExport(fake(async () => { throw new Refusal('export.nothing-drafted', 'Titus has no drafted verse yet.'); }), { store, project: PROJECT });
    expect(reportError(report)).toBeNull();
    expect(report).toMatchObject({ op: 'export', ok: false, code: 'export.nothing-drafted', facts: { producer: 'usfm-plain', error: 'Titus has no drafted verse yet.' } });
    expect(downloads).toEqual([]);
  });

  it('a failed checkpoint delivers nothing, never calls the producer, and returns export.checkpoint-failed', async () => {
    const { rig, store } = await seeded();
    await store.writeBook('TIT', TIT.replace('\\v 2 ___', '\\v 2 Nueva vida.'));
    rig.failOn(({ route }) => route.includes('add-and-commit'));
    const produce = vi.fn();
    const report = await runExport(fake(produce), { store, project: PROJECT, book: 'TIT' });
    expect(reportError(report)).toBeNull();
    expect(report).toMatchObject({ op: 'export', ok: false, code: 'export.checkpoint-failed' });
    expect(produce).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });
});

describe('#375 export helpers', () => {
  it('exportFilename is <subject>-<YYYY-MM-DD>.<ext> on the local date', () => {
    expect(exportFilename('Puntos-TIT', 'usfm', new Date(2026, 8, 2, 23, 59))).toBe('Puntos-TIT-2026-09-02.usfm');
  });
});

describe('#375 assertProjectUnchanged', () => {
  const repo = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-export-'));
    const g = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
    g('init', '-q');
    fs.writeFileSync(path.join(dir, 'metadata.json'), '{}');
    g('add', '.');
    g('commit', '-qm', 'baseline');
    fs.writeFileSync(path.join(dir, 'TIT.usfm'), 'pending');
    return dir;
  };
  const commit = (dir: string, message: string) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-am', message]);

  it('passes when nothing changes, and when one checkpoint commit changes only the paths it carries', async () => {
    const dir = repo();
    expect(await assertProjectUnchanged(dir, async () => {})).toBe(0);
    execFileSync('git', ['-C', dir, 'add', 'TIT.usfm']);
    expect(await assertProjectUnchanged(dir, async () => {
      fs.writeFileSync(path.join(dir, 'metadata.json'), '{"rescanned":true}');
      commit(dir, 'Checkpoint, before export: TIT text (tC4)');
    })).toBe(1);
  });

  it('fails on a changed file outside a checkpoint, a non-checkpoint commit, and two commits', async () => {
    const dir = repo();
    await expect(assertProjectUnchanged(dir, async () => fs.writeFileSync(path.join(dir, 'TIT.usfm'), 'changed'))).rejects.toThrow(/beyond a checkpoint commit: TIT.usfm/);
    await expect(assertProjectUnchanged(dir, async () => fs.writeFileSync(path.join(dir, 'stray.txt'), 'x'))).rejects.toThrow(/stray.txt/);
    fs.rmSync(path.join(dir, 'stray.txt'));
    await expect(assertProjectUnchanged(dir, async () => commit(dir, 'something else'))).rejects.toThrow(/not a checkpoint/);
    // A path the checkpoint carries must keep the bytes the checkpoint committed (Codex round 1),
    // also under a non-ASCII name, which git quotes by default (Codex round 2).
    execFileSync('git', ['-C', dir, 'reset', '-q', '--hard', 'HEAD^']);
    const accented = path.join(dir, 'Tító.usfm');
    fs.writeFileSync(accented, 'baseline');
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'Tító.usfm']);
    commit(dir, 'baseline 2');
    fs.writeFileSync(accented, 'pending');
    await expect(assertProjectUnchanged(dir, async () => {
      commit(dir, 'Checkpoint, before export: text (tC4)');
      fs.writeFileSync(accented, 'overwritten');
    })).rejects.toThrow(/beyond a checkpoint commit: Tító.usfm/);
    fs.writeFileSync(accented, 'pending');
    await expect(assertProjectUnchanged(dir, async () => {
      fs.writeFileSync(accented, 'checkpointed');
      commit(dir, 'Checkpoint, before export: text (tC4)');
      fs.writeFileSync(accented, 'pending');
    })).rejects.toThrow(/beyond a checkpoint commit: Tító.usfm/);
    await expect(assertProjectUnchanged(dir, async () => {
      commit(dir, 'Checkpoint, a (tC4)');
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'Checkpoint, b (tC4)']);
    })).rejects.toThrow(/at most one checkpoint commit, found 2/);
  });
});
