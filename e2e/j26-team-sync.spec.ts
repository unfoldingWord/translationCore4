// J26 (docs/JOURNEYS.md) — three translators sync one project through Door43 (#681; layer 5
// of epic #24). One rig, three project paths: three actors, because the actor id is
// HMAC(installation secret, project path) (src/data/journal/identity.ts:9-19). So every
// browser step runs in ONE test (one context, one installation secret); a second test with a
// page would mint a new secret and a fourth actor. The [G6] and [G1] tests read only the disk
// and the bare remote.
//
// Door43 `main` is a bare `file://` remote at <tmp>/<org>/<repo>.git (the #673 stand-in, as
// e2e/sync-button.spec.ts and e2e/j17-open-from-door43.spec.ts use it): a clone copies the
// never-committed mirror `_local_/_archive_/<org>--<repo>`, then pulls. Each translator signs
// in to the fake Door43 (helpers/door43.ts) with their own username, so the versions show
// three names (#680).
//
// The verses, their texts, the check and the usernames come from the shared fixture
// (conformance/fixtures/team-sync, D98), so a journey failure can be reproduced in a core
// test: `different-verses` (A TIT 1:1, B 1:2, C 1:3), `verse-two-ways` (TIT 1:4 two ways; the
// issue's steps give it to B and C, the fixture's case to A and B: the key and the two texts
// are the fixture's), `check-two-ways` (the first translationWords check result: B `valid`,
// then C `todo`), and `names`.
// Ground truth is the bare's `main` and the rig's disk, never the app's own claims.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/test';
import { SEEDED_PROJECT, RIG_LOCAL_REPOS, TC4_ROOT, rigRepo, writePlace } from './helpers/rig';
import { QA_SERVER, dropOrigin, fakeShare, gateOff, git, shot, type BareRemote } from './helpers/door43Share';
import { verifyAllJournaledProjects } from './helpers/journal';
import { lane } from './lane.mjs';
import { fold } from '../journal/fold.mjs';
import { readUnion } from '../journal/files.mjs';

const TAG = { tag: ['@J26'] };
const RUN = Date.now();
const JOURNAL = 'ingredients/checking/journal';
const FIXTURE = path.join(TC4_ROOT, 'conformance', 'fixtures', 'team-sync');
const CASES = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'cases.json'), 'utf8'));

type Event = { op: string; actor: string; verse?: string; chapter?: string; text?: string; decision?: { status?: string; contextId: unknown } };
/** The events of one fixture segment file (the §8.1 container: `body` is the JSON text of `{ events }`). */
const fixtureEvents = (rel: string): Event[] =>
  (JSON.parse(JSON.parse(fs.readFileSync(path.join(FIXTURE, rel), 'utf8')).body) as { events: Event[] }).events;
const fixtureEvent = (rel: string): Event => fixtureEvents(rel)[0];

const [A11, B12, C13] = (CASES.cases['different-verses'].segments as string[]).map(fixtureEvent);
const [ONE_14, TWO_14] = (CASES.cases['verse-two-ways'].segments as string[]).map(fixtureEvent);
const [B_CHECK, C_CHECK] = (CASES.cases['check-two-ways'].segments as string[]).map(fixtureEvent);
// The fixture's check result is the sample's first translationWords record (`a9p2`, the word
// "apostle" in TIT 1:1). The rig pins es-419_twl, whose list names that word `sda6`, so the UI
// sets the same word in the same verse: the row is found by its verse and its word group.
const CHECK_CTX = B_CHECK.decision!.contextId as { checkId: string; groupId: string; reference: { chapter: number; verse: number } };
const CHECK_ROW = `button[title="${CHECK_CTX.reference.chapter}:${CHECK_CTX.reference.verse} · ${CHECK_CTX.groupId}"]`;
const username = (actor: string): string => CASES.actors[actor].username;

interface Translator { label: 'A' | 'B' | 'C'; user: { username: string; password: string; email: string }; repo: string }
const person = (label: 'A' | 'B' | 'C', actor: string, repo: string): Translator => ({
  label, repo, user: { username: username(actor), password: `pass-word ${label}`, email: `${username(actor)}@example.org` },
});
const A = person('A', 'translator-a', SEEDED_PROJECT);
const B = person('B', 'translator-b', `j26b_${RUN}`);
const C = person('C', 'translator-c', `j26c_${RUN}`);
const TRANSLATORS = [A, B, C];
const idOf = (t: Translator) => `_local_/_local_/${t.repo}`;

// Door43 main: the bare at <tmp>/<A's username>/<REPO>.git, so its url names A as the owner.
const ORG = A.user.username;
const REPO = `j26team_${RUN}`;
const REPOS = path.join(RIG_LOCAL_REPOS, '..', '..');
const MIRROR_DIR = path.join(REPOS, '_local_', '_archive_', `${ORG}--${REPO}`);
const FIXED_DIR = path.join(REPOS, 'file', ORG, REPO);
const scratchDir = (name: string) => path.join(REPOS, '_local_', '_archive_', `tc4-open--${name}`);

/** The segment files of a journal on Door43 `main`, as `<actor>/segments/<file>`. */
const segmentsOnMain = (remote: BareRemote): string[] =>
  git(remote.bare, 'ls-tree', '-r', '--name-only', `main:${JOURNAL}`).split('\n').filter((p) => p.includes('/segments/')).sort();

/** The segment files of a project's journal on the rig's disk, as `<actor>/segments/<file>`. */
function segmentsOnDisk(repo: string): string[] {
  const journal = path.join(rigRepo(repo), JOURNAL);
  if (!fs.existsSync(journal)) return [];
  return fs.readdirSync(journal).flatMap((actor) => {
    const dir = path.join(journal, actor, 'segments');
    return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => `${actor}/segments/${f}`) : [];
  }).sort();
}

/** The fold of a project's journal on disk. */
const foldOf = (repo: string) => fold(readUnion(path.join(rigRepo(repo), JOURNAL))) as { forks: Array<{ key: string }>; names: Record<string, string> };

/** The actor folder of a translator's project: the one actor whose name is the translator's username. */
const actorOf = (t: Translator): string | undefined =>
  Object.entries(foldOf(t.repo).names).find(([, name]) => name === t.user.username)?.[0];

/** Every project file of a rig repository, path -> bytes; `.git` is not a project file. */
function projectFiles(repo: string): Map<string, Buffer> {
  const root = rigRepo(repo);
  const out = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name === '.git' && dir === root) continue;
      if (entry.isDirectory()) walk(full);
      else out.set(path.relative(root, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  };
  walk(root);
  return out;
}

/** The text of one verse in a project's TIT.usfm on disk (the line after `\v n `). */
function verseOnDisk(repo: string, chapter: string, verse: string): string {
  const usfm = fs.readFileSync(path.join(rigRepo(repo), 'ingredients', 'TIT.usfm'), 'utf8');
  const fromChapter = usfm.slice(usfm.indexOf(`\\c ${chapter}\n`));
  const match = fromChapter.match(new RegExp(`\\\\v ${verse} ([^\\n]*)`));
  return match ? match[1].trim() : '';
}

/** Door43 for this translator: the fake signs in this username only; its `clone_url` is the bare. */
async function door43As(context: BrowserContext, remote: BareRemote, t: Translator): Promise<void> {
  await context.unroute(`${QA_SERVER}/**`);
  await fakeShare(context, remote, { user: t.user });
}

async function signInAs(page: Page, t: Translator): Promise<void> {
  await page.getByLabel('Door43 username or email').fill(t.user.username);
  await page.getByLabel('Password', { exact: true }).fill(t.user.password);
  await page.getByTestId('signin-submit').click();
}

/** Open the translator's Titus at chapter 1 in Translate. */
async function openTitus(page: Page, t: Translator): Promise<void> {
  writePlace(t.repo, 'TIT', { mode: 'draft', chapter: 1 });
  await page.goto('/');
  await page.getByTestId(`project-${idOf(t)}`).getByRole('button', { name: /Titus/ }).click();
  await expect(page.getByRole('heading', { name: /^Titus 1$/ })).toBeVisible({ timeout: 120_000 });
}

/** The translator's own segment files on disk now (every actor folder). */
const segmentCount = (t: Translator) => segmentsOnDisk(t.repo).length;

/** Revise one drafted verse of Titus 1 in Verse mode, and wait for its segment on disk. */
async function draftVerse(page: Page, t: Translator, event: Event): Promise<void> {
  const before = segmentCount(t);
  await page.getByRole('tab', { name: 'Verse', exact: true }).click();
  const current = verseOnDisk(t.repo, event.chapter!, event.verse!);
  const words = current.split(/\s+/).slice(0, 4).join(' ');
  await page.getByTitle('Edit this verse').filter({ hasText: words }).first().click();
  const editor = page.getByRole('textbox', { name: `Verse ${event.verse}` });
  await editor.fill(event.text!.trim());
  await editor.blur();
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  await expect.poll(() => verseOnDisk(t.repo, event.chapter!, event.verse!), { timeout: 15_000 }).toBe(event.text!.trim());
  await expect.poll(() => segmentCount(t), { timeout: 15_000 }).toBeGreaterThan(before);
}

/** Set the fixture's translationWords check result in Check, and wait for its segment on disk. */
async function checkWord(page: Page, t: Translator, status: 'valid' | 'todo'): Promise<void> {
  const before = segmentCount(t);
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await page.getByTestId('open-translationWords').click();
  await expect(page.getByTestId('check-progress')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('check-list').locator(CHECK_ROW).first().click({ timeout: 30_000 });
  await page.getByTestId(`mark-${status}`).click();
  await expect.poll(() => segmentCount(t), { timeout: 15_000 }).toBeGreaterThan(before);
}

/** Press "Sync with Door43" on the translator's card: the internet question and the sign-in
 * come when this page load has not answered them. Returns the result toast. */
async function syncAs(page: Page, t: Translator) {
  await page.getByTestId(`share-${idOf(t)}`).click();
  const ask = page.getByTestId('net-ask');
  const signin = page.getByTestId('share-signin');
  const result = page.getByTestId('sync-result');
  await expect(ask.or(signin).or(result)).toBeVisible({ timeout: 30_000 });
  if (await ask.isVisible()) await page.getByTestId('net-confirm').click();
  await expect(signin.or(result)).toBeVisible({ timeout: 30_000 });
  if (await signin.isVisible()) await signInAs(page, t);
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toHaveAttribute('data-ok', '1');
  return result;
}

/** Go Home as this translator: a new page load (no token, internet off), Door43 signs in this
 * translator only. */
async function homeAs(page: Page, context: BrowserContext, remote: BareRemote, t: Translator): Promise<void> {
  await page.goto('/');
  await door43As(context, remote, t);
  await expect(page.getByTestId(`share-${idOf(t)}`)).toBeVisible({ timeout: 60_000 });
}

/** Open the project from Door43 under the translator's own project name (the #677 flow). */
async function openFromDoor43(page: Page, remote: BareRemote, t: Translator): Promise<void> {
  await page.goto('/');
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-door43').click();
  await expect(page.getByTestId('open-door43-modal')).toBeVisible();
  await page.getByTestId('open-door43-repo').fill(pathToFileURL(remote.bare).href);
  await expect(page.getByTestId('open-door43-name')).toHaveValue(REPO);
  await page.getByTestId('open-door43-name').fill(t.repo);
  await page.getByTestId('open-door43-submit').click();
  await page.getByTestId('net-confirm').click();
  await expect(page.getByTestId('open-door43-modal')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId(`share-${idOf(t)}`)).toHaveText('Sync with Door43');
  expect(git(rigRepo(t.repo), 'rev-parse', 'HEAD')).toBe(remote.main());
}

/** The counts of a sync result. */
async function counts(page: Page): Promise<{ received: number; newest: number; conflicts: number }> {
  const n = async (id: string) => Number(await page.getByTestId(id).getAttribute('data-count'));
  return { received: await n('sync-count-received'), newest: await n('sync-count-newest'), conflicts: await n('sync-count-conflicts') };
}

/** Per actor folder: the segment files on `main` now that were not there before. */
const newOnMain = (before: string[], after: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const p of after) if (!before.includes(p)) out[p.split('/')[0]] = (out[p.split('/')[0]] ?? 0) + 1;
  return out;
};

const record = (testInfo: TestInfo, name: string, text: string) => fs.writeFileSync(testInfo.outputPath(name), text);

test.describe('J26 — three translators sync one project through Door43', () => {
  test.describe.configure({ mode: 'serial' });
  let remote: BareRemote;
  let tmp: string;
  let keptText = '';

  test.beforeAll(async () => {
    // A's start: the seeded project as the seed made it (one commit). An earlier journey of
    // the run can leave teammates and conflicts in it (e2e/sync-button.spec.ts does).
    const seeded = rigRepo(SEEDED_PROJECT);
    git(seeded, 'reset', '-q', '--hard', git(seeded, 'rev-list', '--max-parents=0', 'HEAD'));
    git(seeded, 'clean', '-qfdx');
    dropOrigin(SEEDED_PROJECT);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j26-'));
    const bare = path.join(tmp, ORG, `${REPO}.git`);
    fs.mkdirSync(path.dirname(bare), { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    remote = {
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
  });
  test.afterAll(async () => {
    dropOrigin(SEEDED_PROJECT);
    for (const t of [B, C]) {
      fs.rmSync(rigRepo(t.repo), { recursive: true, force: true });
      fs.rmSync(scratchDir(t.repo), { recursive: true, force: true });
    }
    for (const dir of [MIRROR_DIR, FIXED_DIR]) fs.rmSync(dir, { recursive: true, force: true });
    remote?.dispose();
    await gateOff();
  });

  test('A shares; B and C open it from Door43; each drafts, checks and syncs; A keeps one version of the conflict; all three end with the same text', TAG, async ({ page, context }, testInfo) => {
    test.setTimeout(600_000);
    const version = await (await fetch(`${lane().rigApi}/version`)).text();
    record(testInfo, 'rig-version.txt', `${version}\n`);

    await test.step('1. A drafts TIT 1:1, checks, and shares the project', async () => {
      await openTitus(page, A);
      await draftVerse(page, A, A11);
      // A's check: the first open check result of the book (not the fixture's check, which B and C set)
      const before = segmentCount(A);
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-translationWords').click();
      await expect(page.getByTestId('check-progress')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('check-list').locator(`button[data-decided="0"]:not(${CHECK_ROW.slice('button'.length)})`).first().click();
      await page.getByTestId('mark-valid').click();
      await expect.poll(() => segmentCount(A), { timeout: 15_000 }).toBeGreaterThan(before);

      await homeAs(page, context, remote, A);
      await expect(page.getByTestId(`share-card-${idOf(A)}`)).toHaveAttribute('data-action', 'share');
      await page.getByTestId(`share-${idOf(A)}`).click();
      await page.getByTestId('net-confirm').click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await signInAs(page, A);
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('share-close').click();
      expect(remote.main(), 'the first share pushed main').not.toBeNull();
      // the stand-in mirror that every clone copies (never committed to)
      execFileSync('git', ['clone', '-q', pathToFileURL(remote.bare).href, MIRROR_DIR]);
      await expect(page.getByTestId(`share-${idOf(A)}`)).toHaveText('Sync with Door43');
    });

    await test.step('2a. B and C open the project from Door43 under their own names', async () => {
      await openFromDoor43(page, remote, B);
      await openFromDoor43(page, remote, C);
    });

    await test.step('2b. B drafts TIT 1:2 and 1:4, sets the check result, and syncs', async () => {
      await openTitus(page, B);
      await draftVerse(page, B, B12);
      await draftVerse(page, B, TWO_14);
      await checkWord(page, B, B_CHECK.decision!.status as 'valid');
      await homeAs(page, context, remote, B);
      const before = segmentsOnMain(remote);
      await syncAs(page, B);
      // B got nothing new: B opened Door43 main as it is
      expect(await counts(page)).toEqual({ received: 0, newest: 0, conflicts: 0 });
      const added = newOnMain(before, segmentsOnMain(remote));
      expect(Object.keys(added), 'one new actor on Door43 main: B').toEqual([actorOf(B)]);
      await shot(page, testInfo, '2b-B-sync');
      await page.getByTestId('sync-dismiss').click();
    });

    await test.step('2c. C drafts TIT 1:3 and 1:4 another way, sets the check result another way, and syncs', async () => {
      await openTitus(page, C);
      await draftVerse(page, C, C13);
      await draftVerse(page, C, ONE_14);
      await checkWord(page, C, C_CHECK.decision!.status as 'todo');
      await homeAs(page, context, remote, C);
      const before = segmentsOnMain(remote);
      await syncAs(page, C);
      // C gets B's work: the verse two ways is one conflict, the check two ways keeps the newest (C)
      const got = await counts(page);
      expect(got.conflicts).toBe(1);
      expect(got.newest).toBeGreaterThanOrEqual(1);
      await expect(page.getByTestId('sync-received-from')).toContainText(B.user.username);
      await shot(page, testInfo, '2c-C-sync');
      const added = newOnMain(before, segmentsOnMain(remote));
      expect(Object.keys(added), 'one new actor on Door43 main: C').toEqual([actorOf(C)]);
      await page.getByTestId('sync-dismiss').click();
    });

    await test.step('3. A syncs, sees the work of B and C, keeps one version of the conflict, and syncs again', async () => {
      await homeAs(page, context, remote, A);
      const before = segmentsOnDisk(A.repo).map((p) => p);
      await syncAs(page, A);
      // received: every segment of B and C that A did not have
      const bActor = actorOf(B)!;
      const cActor = actorOf(C)!;
      const expected = newOnMain(before, segmentsOnMain(remote));
      delete expected[actorOf(A)!];
      const got = await counts(page);
      expect(got.received).toBe((expected[bActor] ?? 0) + (expected[cActor] ?? 0));
      expect(expected[bActor], 'segments of B').toBeGreaterThan(0);
      expect(expected[cActor], 'segments of C').toBeGreaterThan(0);
      expect(got.conflicts, 'TIT 1:4 changed two ways').toBe(1);
      expect(got.newest, 'the check result set two ways').toBeGreaterThanOrEqual(1);
      await expect(page.getByTestId('sync-received-from')).toContainText(B.user.username);
      await expect(page.getByTestId('sync-received-from')).toContainText(C.user.username);
      await expect(page.getByTestId(`conflicts-${idOf(A)}`)).toHaveAttribute('data-count', '1');
      await page.getByTestId(`project-${idOf(A)}`).scrollIntoViewIfNeeded();
      await shot(page, testInfo, '3a-A-sync-result');
      record(testInfo, 'A-first-sync-counts.json', JSON.stringify({ got, expectedReceived: expected }, null, 2));

      await page.getByTestId('sync-review').click();
      await expect(page.getByTestId('conflict-review')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('conflict-ref')).toHaveText('Titus 1:4');
      const versions = page.getByTestId('conflict-version');
      await expect(versions).toHaveCount(2);
      // #680: each version shows its teammate's Door43 username; neither is A's
      await expect(page.getByTestId('conflict-owner')).toHaveText([C.user.username, B.user.username]);
      await expect(versions.filter({ hasText: TWO_14.text!.trim() })).toHaveAttribute('data-owner', 'teammate');
      await shot(page, testInfo, '3b-A-review-names');
      // A keeps B's version
      await versions.filter({ hasText: TWO_14.text!.trim() }).click();
      await expect(page.getByTestId('conflict-consequence')).toContainText(B.user.username);
      const beforeKeep = segmentCount(A);
      await page.getByTestId('conflict-keep').click();
      await expect(page.getByTestId('conflict-none')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => segmentCount(A), { timeout: 15_000 }).toBeGreaterThan(beforeKeep);
      keptText = TWO_14.text!.trim();
      await expect.poll(() => verseOnDisk(A.repo, '1', '4'), { timeout: 15_000 }).toBe(keptText);
      await shot(page, testInfo, '3c-A-kept');

      await homeAs(page, context, remote, A);
      await expect(page.getByTestId(`conflicts-${idOf(A)}`)).toHaveCount(0);
      const mainBefore = remote.main();
      await syncAs(page, A);
      expect(await counts(page)).toEqual({ received: 0, newest: 0, conflicts: 0 });
      expect(remote.main()).not.toBe(mainBefore);
      expect(git(rigRepo(A.repo), 'rev-parse', 'HEAD')).toBe(remote.main());
      await page.getByTestId('sync-dismiss').click();
    });

    for (const t of [B, C]) {
      await test.step(`4. ${t.label} syncs and sees A's choice with no conflict`, async () => {
        await homeAs(page, context, remote, t);
        await syncAs(page, t);
        const got = await counts(page);
        expect(got.conflicts).toBe(0);
        expect(got.received).toBeGreaterThan(0);
        await expect(page.getByTestId('sync-received-from')).toContainText(A.user.username);
        await expect(page.getByTestId(`conflicts-${idOf(t)}`)).toHaveCount(0);
        expect(verseOnDisk(t.repo, '1', '4')).toBe(keptText);
        await shot(page, testInfo, `4-${t.label}-sync`);
        await page.getByTestId('sync-dismiss').click();
      });
    }

    await test.step('5. all three projects show the same text', async () => {
      for (const t of TRANSLATORS) {
        await openTitus(page, t);
        for (const event of [A11, B12, C13]) await expect(page.getByText(event.text!.trim(), { exact: true })).toBeVisible();
        await expect(page.getByText(keptText, { exact: true })).toBeVisible();
        await expect(page.getByTestId('conflicts-review')).toHaveCount(0);
        await shot(page, testInfo, `5-${t.label}-titus-1`);
      }
      await page.goto('/');
      for (const t of TRANSLATORS) await expect(page.getByTestId(`conflicts-${idOf(t)}`)).toHaveCount(0);
      await shot(page, testInfo, '5-home');
      await verifyAllJournaledProjects();
    });
  });

  test('[G6] at the end the three projects have the same project files, and no verse has a conflict', TAG, async ({}, testInfo) => {
    expect(keptText, 'the journey ran').not.toBe('');
    const [a, ...others] = TRANSLATORS.map((t) => projectFiles(t.repo));
    const lines: string[] = [];
    for (const [i, files] of others.entries()) {
      const t = [B, C][i];
      expect([...files.keys()].sort(), `the file list of ${t.label}`).toEqual([...a.keys()].sort());
      for (const [p, bytes] of a) expect(files.get(p)!.equals(bytes), `${t.label} ${p}`).toBe(true);
    }
    for (const [p, bytes] of [...a].sort(([x], [y]) => (x < y ? -1 : 1))) lines.push(`${bytes.length}\t${p}`);
    for (const t of TRANSLATORS) {
      expect(git(rigRepo(t.repo), 'rev-parse', 'HEAD'), `${t.label} HEAD`).toBe(remote.main());
      const forks = foldOf(t.repo).forks.filter((f) => f.key.startsWith('text|'));
      expect(forks, `${t.label}: no verse has a conflict`).toEqual([]);
    }
    record(testInfo, 'g6-project-files.txt', `${lines.join('\n')}\n`);
  });

  test('[G1] every journal file that any translator wrote is on the stand-in\'s main', TAG, async ({}, testInfo) => {
    expect(keptText, 'the journey ran').not.toBe('');
    const onMain = segmentsOnMain(remote);
    const actors = TRANSLATORS.map(actorOf);
    expect(new Set(actors).size, 'three actors').toBe(3);
    for (const [i, t] of TRANSLATORS.entries()) {
      const own = segmentsOnDisk(t.repo).filter((p) => p.startsWith(`${actors[i]}/`));
      expect(own.length, `${t.label} wrote segments`).toBeGreaterThan(0);
      for (const p of own) {
        expect(onMain, `${t.label} ${p} on main`).toContain(p);
        const local = fs.readFileSync(path.join(rigRepo(t.repo), JOURNAL, p));
        const shared = execFileSync('git', ['-C', remote.bare, 'show', `main:${JOURNAL}/${p}`]);
        expect(shared.equals(local), `${t.label} ${p} byte for byte`).toBe(true);
      }
    }
    record(testInfo, 'g1-main-journal.txt', `${git(remote.bare, 'ls-tree', '-r', '--name-only', `main:${JOURNAL}`)}\n`);
  });
});
