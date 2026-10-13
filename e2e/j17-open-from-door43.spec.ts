// J17 (docs/JOURNEYS.md) — open a project from Door43 on another computer (#677; layer 4 of
// epic #24). Door43 `main` is a bare `file://` remote this spec makes (the #673 stand-in, as
// e2e/sync-button.spec.ts uses it): the bare sits at <tmp>/<org>/<repo>.git, so its url names
// <org>/<repo>, and the clone copies the never-committed mirror `_local_/_archive_/<org>--<repo>`,
// then pulls (`standInCloneRepo`, development build only). Door43 `main` holds the seeded
// project after one open, so its journal is the journal of another translator.
// Ground truth is the bare's `main` and the rig's disk, never the app's own claims.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { SEEDED_PROJECT, RIG_LOCAL_REPOS, rigRepo, writePlace } from './helpers/rig';
import { USER, fakeShare, git, shot, signIn, gateOff, type BareRemote } from './helpers/door43Share';
import { lane } from './lane.mjs';
import { ServerApi } from '../src/data/serverApi';
import { describeVerifierReport, verifyProjectAgainstJournal } from '../src/data/journal/verify';

const TAG = { tag: ['@J17'] };
const SEEDED_ID = `_local_/_local_/${SEEDED_PROJECT}`;
const ORG = USER.username;
const RUN = Date.now();
const REPO = `j17open_${RUN}`;
const BAD = `j17bad_${RUN}`;
const ID = `_local_/_local_/${REPO}`;
const REPOS = path.join(RIG_LOCAL_REPOS, '..', '..');
const mirrorDir = (repo: string) => path.join(REPOS, '_local_', '_archive_', `${ORG}--${repo}`);
const fixedDir = (repo: string) => path.join(REPOS, 'file', ORG, repo);
const scratchDir = (name: string) => path.join(REPOS, '_local_', '_archive_', `tc4-open--${name}`);
const JOURNAL = 'ingredients/checking/journal';

/** A bare remote at <tmp>/<org>/<repo>.git whose `main` is `work`, and its mirror on the rig. */
function door43Main(tmp: string, repo: string, work: string): BareRemote {
  const bare = path.join(tmp, ORG, `${repo}.git`);
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  git(work, 'push', '-q', pathToFileURL(bare).href, 'HEAD:main');
  execFileSync('git', ['clone', '-q', pathToFileURL(bare).href, mirrorDir(repo)]);
  return {
    tmp,
    bare,
    main: () => git(bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/main'),
    show: (spec) => execFileSync('git', ['-C', bare, 'show', spec], { encoding: 'utf8', stdio: 'pipe' }),
    dispose: () => fs.rmSync(path.join(tmp, ORG, `${repo}.git`), { recursive: true, force: true }),
  };
}

/** The actor folders of a journal on Door43 `main`. */
const actorsOn = (remote: BareRemote): string[] =>
  git(remote.bare, 'ls-tree', '--name-only', `main:${JOURNAL}`).split('\n').filter(Boolean).sort();

/** Nothing of an open is on the rig: no project, no scratch copy, no clone at the fixed path. */
function expectNothingWritten(repo: string, name: string): void {
  expect(fs.existsSync(path.join(RIG_LOCAL_REPOS, name)), `project ${name}`).toBe(false);
  expect(fs.existsSync(scratchDir(name)), `scratch copy of ${name}`).toBe(false);
  expect(fs.existsSync(fixedDir(repo)), `clone of ${repo}`).toBe(false);
}

async function openDialog(page: Page): Promise<void> {
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-door43').click();
  await expect(page.getByTestId('open-door43-modal')).toBeVisible();
}

test.describe('J17 — open a project from Door43', () => {
  test.describe.configure({ mode: 'serial' });
  let tmp: string;
  let remote: BareRemote;
  let bad: BareRemote;

  test.beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j17-'));
  });
  test.afterAll(async () => {
    for (const repo of [REPO, BAD]) {
      fs.rmSync(mirrorDir(repo), { recursive: true, force: true });
      fs.rmSync(fixedDir(repo), { recursive: true, force: true });
      fs.rmSync(scratchDir(repo), { recursive: true, force: true });
    }
    fs.rmSync(path.join(RIG_LOCAL_REPOS, REPO), { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    await gateOff();
  });

  test('another translator opens the project from Door43, and it syncs', TAG, async ({ page, context }, testInfo) => {
    test.setTimeout(300_000);
    // ---- Door43 main: the seeded project after one open (its journal exists), and a copy
    //      of it with one damaged journal file ----
    writePlace(SEEDED_PROJECT, 'TIT', { mode: 'draft', chapter: 1 });
    await page.goto('/');
    await page.getByTestId(`project-${SEEDED_ID}`).getByRole('button', { name: /Titus/ }).click();
    await expect(page.getByRole('heading', { name: /^Titus \d+$/ })).toBeVisible({ timeout: 120_000 });
    await page.goto('/');
    await expect(page.getByTestId(`share-${SEEDED_ID}`)).toBeVisible();
    // The open's journal and projections are on disk; a checkpoint commits them later. Door43
    // main is a snapshot of the folder as it is on disk, once the writes stop.
    const status = () => git(rigRepo(SEEDED_PROJECT), 'status', '--porcelain');
    let last = '';
    await expect.poll(async () => {
      const now = status();
      const stable = now === last;
      last = now;
      return stable && now.includes('checking/journal');
    }, { intervals: [3_000], timeout: 60_000 }).toBe(true);
    const work = path.join(tmp, 'work');
    fs.cpSync(rigRepo(SEEDED_PROJECT), work, { recursive: true });
    git(work, 'add', '--all');
    git(work, '-c', 'user.name=j17', '-c', 'user.email=j17@rig.test', 'commit', '-q', '-m', 'the shared project');
    remote = door43Main(tmp, REPO, work);
    const segment = git(work, 'ls-files', `${JOURNAL}/*/segments/*`).split('\n')[0];
    fs.writeFileSync(path.join(work, segment), '{"not":"a sealed segment"}\n');
    git(work, '-c', 'user.name=j17', '-c', 'user.email=j17@rig.test', 'commit', '-q', '-am', 'one damaged journal file');
    bad = door43Main(tmp, BAD, work);
    const actorsBefore = actorsOn(remote);
    expect(actorsBefore.length, 'Door43 main holds a journal').toBeGreaterThan(0);

    // ---- (d) the fourth card of "Add a project" ----
    await page.goto('/');
    await page.getByTestId('add-project').click();
    await expect(page.getByTestId('add-project-door43')).toBeVisible();
    await shot(page, testInfo, 'd-add-project-door43');
    await page.getByTestId('add-project-door43').click();

    // ---- (e) the dialog: the name follows the repository name ----
    await page.getByTestId('open-door43-repo').fill(pathToFileURL(remote.bare).href);
    await expect(page.getByTestId('open-door43-name')).toHaveValue(REPO);
    await expect(page.getByTestId('open-door43-submit')).toBeEnabled();
    await shot(page, testInfo, 'e-open-dialog');

    // ---- a name in use: an inline error under the name, and Open project is off ----
    await page.getByTestId('open-door43-name').fill(SEEDED_PROJECT);
    await expect(page.getByTestId('open-door43-name-field')).toContainText(SEEDED_PROJECT);
    await expect(page.getByTestId('open-door43-submit')).toBeDisabled();
    await shot(page, testInfo, 'e2-name-in-use');
    await page.getByTestId('open-door43-name').fill(REPO);

    // ---- (f) the internet is off: the question first; Not now writes nothing ----
    await page.getByTestId('open-door43-submit').click();
    await expect(page.getByTestId('net-ask')).toHaveAttribute('data-kind', 'open');
    await shot(page, testInfo, 'f-internet-ask');
    await page.getByTestId('net-cancel').click();
    await expect(page.getByTestId('net-ask')).toHaveCount(0);
    await expect(page.getByTestId('open-door43-submit')).toBeEnabled();
    expectNothingWritten(REPO, REPO);

    // ---- Turn on internet: the project opens under its name ----
    await page.getByTestId('open-door43-submit').click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('open-door43-modal')).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId('import-toast')).toBeVisible();
    // ---- (h) the new card reads "Sync with Door43" ----
    const card = page.getByTestId(`share-card-${ID}`);
    await expect(card).toHaveAttribute('data-action', 'sync');
    await expect(page.getByTestId(`share-${ID}`)).toHaveText('Sync with Door43');
    await page.getByTestId(`project-${ID}`).scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'h-home-opened');

    // ---- end state on disk: the text of Door43 main, its journal, its origin; nothing else ----
    const opened = rigRepo(REPO);
    expect(fs.readFileSync(path.join(opened, 'ingredients', 'TIT.usfm'), 'utf8')).toBe(remote.show('main:ingredients/TIT.usfm'));
    expect(git(opened, 'rev-parse', 'HEAD')).toBe(remote.main());
    expect(git(opened, 'remote', 'get-url', 'origin')).toBe(pathToFileURL(remote.bare).href);
    expect(fs.readdirSync(path.join(opened, JOURNAL)).sort()).toEqual(actorsBefore);
    expect(fs.existsSync(scratchDir(REPO))).toBe(false);
    expect(fs.existsSync(fixedDir(REPO))).toBe(false);

    // ---- the project opens ----
    await page.getByTestId(`project-${ID}`).getByRole('button', { name: /Titus/ }).click();
    await expect(page.getByRole('heading', { name: /^Titus \d+$/ })).toBeVisible({ timeout: 120_000 });
    await page.goto('/');

    // ---- it syncs with no extra step, as a new actor (identity is per path) ----
    await fakeShare(context, remote);
    await page.getByTestId(`share-${ID}`).click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await signIn(page);
    const result = page.getByTestId('sync-result');
    await expect(result).toBeVisible({ timeout: 120_000 });
    await expect(result).toHaveAttribute('data-ok', '1');
    const actorsAfter = actorsOn(remote);
    const added = actorsAfter.filter((a) => !actorsBefore.includes(a));
    expect(added, 'one new actor on Door43 main: this computer in this project').toHaveLength(1);
    expect(git(opened, 'rev-parse', 'HEAD')).toBe(remote.main());
    // the opened project is the fold of its journal (the #62 verifier)
    const verified = await verifyProjectAgainstJournal(new ServerApi({ baseUrl: lane().rigApi }), ID);
    expect(verified.ok, describeVerifierReport(verified)).toBe(true);
  });

  test('[G2] one invalid journal file on Door43 refuses the open, and nothing is written', TAG, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await openDialog(page);
    await page.getByTestId('open-door43-repo').fill(pathToFileURL(bad.bare).href);
    await expect(page.getByTestId('open-door43-name')).toHaveValue(BAD);
    await page.getByTestId('open-door43-submit').click();
    await page.getByTestId('net-confirm').click();
    // ---- (g) the refusal, its code, "Nothing was written" ----
    const refused = page.getByTestId('open-door43-refused');
    await expect(refused).toBeVisible({ timeout: 120_000 });
    await expect(refused).toHaveAttribute('data-code', 'sync.incoming-invalid');
    await shot(page, testInfo, 'g-refused');
    expectNothingWritten(BAD, BAD);
    await expect(page.getByTestId(`project-_local_/_local_/${BAD}`)).toHaveCount(0);
  });
});
