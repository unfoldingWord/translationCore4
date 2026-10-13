// #678 — the "Sync with Door43" button and its result (layer 4 of epic #24).
// Journey: sync with no teammate change, then with one. The three-translator journey
// is #681 (J26); this spec proves the button, the question, the result and one refusal.
//
// Door43 `main` is a bare `file://` remote this spec makes and reads (the #673 stand-in,
// as test/sync/syncRig.integration.test.ts uses it): the bare sits at
// <tmp>/<org>/<repo>.git, so its url names <org>/<repo>, and the clone copies the
// never-committed mirror `_local_/_archive_/<org>--<repo>`, then pulls. The fake Door43
// (helpers/door43.ts) answers the sign-in and the first share; its `clone_url` is the bare.
// Ground truth is the bare's `main` and the rig's disk, never the app's own claims.
// Teammates are written with the reference journal writers (journal/files.mjs), as the
// shared fixture does (conformance/fixtures/team-sync/generate.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { SEEDED_PROJECT, RIG_LOCAL_REPOS, rigRepo, writePlace } from './helpers/rig';
import { USER, dropOrigin, fakeShare, git, head, shot, signIn, gateOff, type BareRemote } from './helpers/door43Share';
import { recordExternal } from './helpers/externalRequests';
import { verifyAllJournaledProjects } from './helpers/journal';
import { makeClock } from '../journal/hlc.mjs';
import { fold } from '../journal/fold.mjs';
import { actorDirFor, readUnion, writeActionSegment } from '../journal/files.mjs';

const TAG = { tag: ['@sync-button', '@J26'] };
const ID = `_local_/_local_/${SEEDED_PROJECT}`;
const ORG = USER.username;
const RUN = Date.now();
const REPO = `sync678_${RUN}`;
const MIRROR_DIR = path.join(RIG_LOCAL_REPOS, '..', '_archive_', `${ORG}--${REPO}`);
const FIXED_DIR = path.join(RIG_LOCAL_REPOS, '..', '..', 'file', ORG, REPO);
const TEAMMATES = ['b678teammate0001', 'c678teammate0002'];

/** The bare remote at <tmp>/<org>/<repo>.git (cloneSourceOf reads org and repo from the url). */
function makeOrgRemote(): BareRemote {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-sync678-'));
  const bare = path.join(tmp, ORG, `${REPO}.git`);
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  return {
    tmp,
    bare,
    main() {
      try {
        return git(bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/main');
      } catch {
        return null;
      }
    },
    show: (spec) => execFileSync('git', ['-C', bare, 'show', spec], { encoding: 'utf8', stdio: 'pipe' }),
    dispose: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

/** Two teammates change TIT 1:1 from the same base on Door43 main: one verse-text conflict. */
function teammatesChangeOneVerse(remote: BareRemote): void {
  const work = path.join(remote.tmp, 'teammates');
  execFileSync('git', ['clone', '-q', pathToFileURL(remote.bare).href, work]);
  const journalDir = path.join(work, 'ingredients', 'checking', 'journal');
  const union = readUnion(journalDir);
  const base = (fold(union).headsTs as Record<string, string>)['text|TIT|1:1'];
  expect(base, 'Door43 main holds the head of TIT 1:1').toBeTruthy();
  const last = union.map((e: { ts: string }) => e.ts).sort().pop();
  let now = Date.now();
  TEAMMATES.forEach((actor, i) => {
    const clock = makeClock(actor, () => now);
    clock.ratchet(last);
    now += 1000;
    const event = { v: 1, op: 'text.verse.set', actor, ts: clock.issue(), base, book: 'TIT', chapter: '1', verse: '1', text: `Pablo, versión del compañero ${i + 1}.\n` };
    writeActionSegment(actorDirFor(journalDir, actor), [event]);
  });
  git(work, '-c', 'user.name=teammates', '-c', 'user.email=teammates@rig.test', 'add', 'ingredients/checking/journal');
  git(work, '-c', 'user.name=teammates', '-c', 'user.email=teammates@rig.test', 'commit', '-q', '-m', 'two teammates change TIT 1:1');
  git(work, 'push', '-q', 'origin', 'main');
}

const button = (page: Page) => page.getByTestId(`share-${ID}`);

/** Open the seeded project once, so its journal exists (the open seeds it), then go Home. */
async function openOnce(page: Page): Promise<void> {
  writePlace(SEEDED_PROJECT, 'TIT', { mode: 'draft', chapter: 1 });
  await page.goto('/');
  await page.getByTestId(`project-${ID}`).getByRole('button', { name: /Titus/ }).click();
  await expect(page.getByRole('heading', { name: /^Titus \d+$/ })).toBeVisible({ timeout: 120_000 });
  await page.goto('/');
  await expect(button(page)).toBeVisible();
}

test.describe('#678 — Sync with Door43', () => {
  test.describe.configure({ mode: 'serial' });
  let remote: BareRemote;

  test.beforeAll(() => {
    dropOrigin(SEEDED_PROJECT);
    remote = makeOrgRemote();
  });
  test.afterAll(async () => {
    dropOrigin(SEEDED_PROJECT);
    remote?.dispose();
    for (const dir of [MIRROR_DIR, FIXED_DIR]) fs.rmSync(dir, { recursive: true, force: true });
    await gateOff();
  });

  test('sync with no teammate change, then with one', TAG, async ({ page, context }, testInfo) => {
    test.setTimeout(300_000);
    await fakeShare(context, remote);
    await openOnce(page);

    // ---- the first share: the result names write access; the card becomes Sync ----
    await expect(page.getByTestId(`share-card-${ID}`)).toHaveAttribute('data-action', 'share');
    await button(page).click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
    await page.getByTestId('share-next').click();
    await page.getByTestId('share-submit').click();
    await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('share-team-access')).toBeVisible();
    await page.getByTestId('share-close').click();
    const shared = remote.main();
    expect(shared, 'the first share pushed main').not.toBeNull();
    // the stand-in mirror the sync clone copies (never committed to)
    execFileSync('git', ['clone', '-q', pathToFileURL(remote.bare).href, MIRROR_DIR]);
    await expect(page.getByTestId(`share-card-${ID}`)).toHaveAttribute('data-action', 'sync');
    await expect(button(page)).toHaveText('Sync with Door43');
    await shot(page, testInfo, 'sync-button');

    // ---- a new launch: no request to Door43 at start or while idle (D88 point 5) ----
    const recorder = recordExternal(page);
    const gitCalls: string[] = [];
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (/^\/api\/git\/(clone|push|pull|fetch)/.test(p) || p.startsWith('/api/gitea/')) gitCalls.push(`${r.method()} ${p}`);
    });
    await page.goto('/');
    await expect(button(page)).toHaveText('Sync with Door43');
    await page.waitForTimeout(5_000);
    expect(recorder.external()).toEqual([]);
    expect(gitCalls).toEqual([]);
    expect(remote.main()).toBe(shared);

    // ---- with the internet off, the press asks first; Not now sends nothing ----
    await button(page).click();
    await expect(page.getByTestId('net-ask')).toHaveAttribute('data-kind', 'sync');
    await shot(page, testInfo, 'sync-internet-ask');
    await page.getByTestId('net-cancel').click();
    await expect(page.getByTestId('net-ask')).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(recorder.external()).toEqual([]);
    expect(gitCalls).toEqual([]);
    await expect(page.getByTestId('sync-result')).toHaveCount(0);
    expect(remote.main()).toBe(shared);

    // ---- sync 1: no teammate change. Turn on internet, sign in, one result ----
    await button(page).click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await signIn(page);
    const first = page.getByTestId('sync-result');
    await expect(first).toBeVisible({ timeout: 120_000 });
    await expect(first).toHaveAttribute('data-ok', '1');
    await expect(page.getByTestId('sync-count-received')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('sync-count-newest')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('sync-count-conflicts')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('sync-review')).toHaveCount(0);
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
    const afterFirst = remote.main();
    // G4: main moved forward (the actor's name action), and it is the project's HEAD
    expect(afterFirst).not.toBe(shared);
    expect(git(remote.bare, 'merge-base', '--is-ancestor', shared!, afterFirst!)).toBe('');
    expect(head(SEEDED_PROJECT)).toBe(afterFirst);
    await page.getByTestId('sync-dismiss').click();
    await expect(first).toHaveCount(0);

    // ---- sync 2: two teammates changed TIT 1:1 on Door43 ----
    teammatesChangeOneVerse(remote);
    const teammatesMain = remote.main();
    await button(page).click();
    // the internet is on now, and the sign-in is in memory: no question, no sign-in step
    await expect(page.getByTestId('net-ask')).toHaveCount(0);
    const second = page.getByTestId('sync-result');
    await expect(second).toBeVisible({ timeout: 120_000 });
    await expect(second).toHaveAttribute('data-ok', '1');
    await expect(page.getByTestId('sync-count-received')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('sync-count-conflicts')).toHaveAttribute('data-count', '1');
    await expect(page.getByTestId('sync-count-newest')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('sync-review')).toBeVisible();
    // D88 point 6: the teammates moved no pin, so no Download is offered (the seeded
    // project's own missing hbo_uhb pin was missing before the sync too)
    await expect(page.getByTestId('sync-download')).toHaveCount(0);
    // the card reads the project again: its conflict chip shows the one verse conflict (#679)
    await expect(page.getByTestId(`conflicts-${ID}`)).toHaveAttribute('data-count', '1');
    await shot(page, testInfo, 'sync-result-counts');
    const afterSecond = remote.main();
    expect(git(remote.bare, 'merge-base', '--is-ancestor', teammatesMain!, afterSecond!)).toBe('');
    expect(head(SEEDED_PROJECT)).toBe(afterSecond);
    for (const actor of TEAMMATES)
      expect(fs.existsSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'journal', actor)), actor).toBe(true);
    await verifyAllJournaledProjects();

    // ---- Review opens the conflict review of the project ----
    await page.getByTestId('sync-review').click();
    await expect(page.getByTestId('sync-result')).toHaveCount(0);
    await expect(page.getByTestId('conflict-review')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('conflict-position')).toHaveAttribute('data-m', '1');
  });

  test('no write access: one plain message, and nothing changes', TAG, async ({ page, context }, testInfo) => {
    test.setTimeout(180_000);
    await fakeShare(context, remote);
    // Door43 refuses the push. [PENDING — owner run, #673 steps 3 and 4]: the real HTTPS
    // reply is not recorded yet; the shell maps a 403 to sync.no-write-access.
    await page.route('**/api/git/push/**', (route) => route.fulfill({ status: 403, contentType: 'text/plain', body: 'remote: User permission denied for writing. 403' }));
    await page.goto('/');
    await expect(button(page)).toHaveText('Sync with Door43');
    const before = remote.main();
    const localBefore = head(SEEDED_PROJECT);
    await button(page).click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await signIn(page);
    const result = page.getByTestId('sync-result');
    await expect(result).toBeVisible({ timeout: 120_000 });
    await expect(result).toHaveAttribute('data-ok', '0');
    await expect(result).toHaveAttribute('data-code', 'sync.no-write-access');
    await expect(page.getByTestId('sync-message')).toHaveText('Ask the project owner for write access on Door43.');
    await shot(page, testInfo, 'sync-no-write-access');
    expect(remote.main()).toBe(before);
    expect(head(SEEDED_PROJECT)).toBe(localBefore);
    await verifyAllJournaledProjects();
  });
});
