// #801 — after a sync, show the plain refusal message, and let the user go Home.
//
// A store that opened before a sync's apply is old: it refuses each later queued action
// with sync.project-replaced, before the action runs (journalingStore.ts `queue`). These
// journeys prove that the screen shows the catalog sentence refusal.sync.project-replaced
// and never the raw diagnosis with the project path, that a checkpoint of that store
// records no error, and that Home leaves the project in one click. Every other save
// failure still holds Home (J6, FR-32).
//
// J1 and J2-J6 make the open store old with the development hook `window.__tc4StaleStore`
// (a development build only, behind localStorage `tc4.e2e.staleStore` = '1'). It moves the
// sync generation as a sync's apply does (opsLog.ts `nextSyncGeneration`). J1b reaches the
// same refusal by the one-window route, with a real sync against a bare `file://` Door43
// main (the #673 stand-in, as e2e/sync-button.spec.ts makes it).
//
// Ground truth is the rig disk and the request log, not the UI alone. Each journey writes
// `record.json` (what it observed) into its output folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { Page, Route, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/test';
import { SEEDED_PROJECT, RIG_LOCAL_REPOS, TC4_ROOT, pinForSideloaded, readDecisionFile, resetSeededChecking, rigRepo, writePlace, writeProjectPins } from './helpers/rig';
import { USER, dropOrigin, fakeShare, gateOff, git, shot, signIn, type BareRemote } from './helpers/door43Share';
import { makeClock } from '../journal/hlc.mjs';
import { fold } from '../journal/fold.mjs';
import { actorDirFor, readUnion, writeActionSegment } from '../journal/files.mjs';

const TAG = { tag: ['@sync-refusal'] };
const ID = `_local_/_local_/${SEEDED_PROJECT}`;
const RUN = Date.now();
const EN: Record<string, string> = JSON.parse(fs.readFileSync(path.join(TC4_ROOT, 'src', 'i18n', 'en.json'), 'utf8'));
const SENTENCE = EN['refusal.sync.project-replaced'];
const LOAD_ERROR = EN['draft.loadError'];
const CHECKPOINT_LABEL = EN['app.commitError'];
/** The start of the store's raw diagnosis (journalingStore.ts `queue`), which holds the path. */
const DIAGNOSIS = 'was synced after this store opened it';
const RAW_INGREDIENT = `/api/burrito/ingredient/raw/${ID}`;
/** A journal segment write (journalStore.ts: `checking/journal/<actor>/segments/...`). */
const SEGMENT = /^checking\/journal\/[^/]+\/segments\//;

// ---------------------------------------------------------------------------
// Ground truth: the rig disk
// ---------------------------------------------------------------------------

/** Verse `c:v` of a USFM text (the line after `\v n `). */
function verseOf(usfm: string, chapter: string, verse: string): string {
  const fromChapter = usfm.slice(usfm.indexOf(`\\c ${chapter}\n`));
  const match = fromChapter.match(new RegExp(`\\\\v ${verse} ([^\\n]*)`));
  return match ? match[1].trim() : '';
}

const diskVerse = (verse: string): string =>
  verseOf(fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'TIT.usfm'), 'utf8'), '1', verse);

function record(testInfo: TestInfo, entry: Record<string, unknown>): void {
  fs.writeFileSync(testInfo.outputPath('record.json'), `${JSON.stringify(entry, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// UI steps
// ---------------------------------------------------------------------------

const card = (page: Page) => page.getByTestId(`project-${ID}`);
const bookTile = (page: Page, code: string) => card(page).getByTestId(`book-tile-${code}`);
const heading = (page: Page, book = 'Titus') => page.getByRole('heading', { name: new RegExp(`^${book} \\d+$`) });
const indicator = (page: Page) => page.getByTestId('save-indicator');
const sentence = (page: Page) => page.getByTestId('save-refusal');
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const verseCard = (page: Page, text: string) => page.getByTitle(EN['draft.editVerse']).filter({ hasText: text });
const verseBox = (page: Page, verse: string) => page.getByRole('textbox', { name: `Verse ${verse}` });

/** The hook's flag is set before the page loads: the app reads it once, at start. */
async function allowStaleHook(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('tc4.e2e.staleStore', '1'));
}

/** Make the open store old, as a sync's apply does. */
async function makeStale(page: Page): Promise<void> {
  const called = await page.evaluate(() => {
    const hook = (window as unknown as { __tc4StaleStore?: () => void }).__tc4StaleStore;
    if (typeof hook !== 'function') return false;
    hook();
    return true;
  });
  expect(called, 'the development hook window.__tc4StaleStore exists').toBe(true);
}

/** Open Titus from Home in Translate, chapter 1. */
async function openTitus(page: Page): Promise<void> {
  writePlace(SEEDED_PROJECT, 'TIT', { mode: 'draft', chapter: 1 });
  await page.goto('/');
  await bookTile(page, 'TIT').click();
  await expect(heading(page)).toBeVisible({ timeout: 120_000 });
}

/** Open Titus in Translate, chapter 1, Verse mode. */
async function openTitusVerses(page: Page): Promise<void> {
  await openTitus(page);
  await tab(page, 'Verse').click();
}

/** Open the card of verse 1:`verse` (it shows `shown`) and type `text`, with no blur. */
async function typeVerse(page: Page, verse: string, shown: string, text: string): Promise<void> {
  await verseCard(page, shown.split(/\s+/).slice(0, 4).join(' ')).first().click();
  await verseBox(page, verse).fill(text);
}

async function expectHome(page: Page): Promise<void> {
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('project-switch')).toHaveCount(0);
}

/** Home shows no checkpoint banner and no open error. The leave checkpoint runs after
 * the screen moved, so the banners are read after it has had time to settle. */
async function expectNoHomeBanners(page: Page): Promise<void> {
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId('home-checkpoint-error')).toHaveCount(0);
  await expect(page.getByTestId('home-open-error')).toHaveCount(0);
}

/** No element shows the raw diagnosis, and no alert shows a project path. */
async function expectNoDiagnosis(page: Page): Promise<void> {
  await expect(page.getByText(DIAGNOSIS)).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '_local_/_local_/' })).toHaveCount(0);
}

async function indicatorState(page: Page): Promise<string | null> {
  return (await indicator(page).count()) ? indicator(page).getAttribute('data-state') : null;
}

/** The project's own add-and-commit requests (checkpoints), as the page sends them. */
function projectCommits(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && decodeURIComponent(new URL(r.url()).pathname) === `/api/git/add-and-commit/${ID}`) seen.push(r.url());
  });
  return seen;
}

const isSegmentWrite = (url: URL): boolean =>
  decodeURIComponent(url.pathname) === RAW_INGREDIENT && SEGMENT.test(url.searchParams.get('ipath') ?? '');

/** Hold the first journal segment POST until `release()`. Every other request goes on. */
async function holdFirstSegment(page: Page): Promise<{ reached: Promise<void>; release: () => void }> {
  let onReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (onReached = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  let caught = false;
  await page.route(isSegmentWrite, async (route: Route) => {
    if (route.request().method() === 'POST' && !caught) {
      caught = true;
      onReached();
      await gate;
    }
    // the settleRig fixture's context route still sees the request
    await route.fallback().catch(() => {});
  });
  return { reached, release };
}

// Each journey starts from the seeded books and checking folder, with no journal: the
// first open seeds it (as e2e/j04-check-book.spec.ts and e2e/j16-understand.spec.ts start).
test.beforeEach(() => {
  resetSeededChecking();
});

// ---------------------------------------------------------------------------
// The journeys with the development hook
// ---------------------------------------------------------------------------

test.describe('#801 — a refusal after a sync shows the sentence, and Home leaves', () => {
  test('J1 a refused book load shows the sentence, a mode switch shows no checkpoint label, and Home leaves', TAG, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await allowStaleHook(page);
    const commits = projectCommits(page);
    await openTitus(page);
    await makeStale(page);

    // Jonah's load runs the store's reconcile through the queue, which refuses it.
    await page.getByRole('button', { name: /^Jonah/ }).click();
    const loadError = page.getByText(LOAD_ERROR);
    await expect(loadError).toBeVisible({ timeout: 30_000 });
    const loadText = (await loadError.innerText()).replace(/\s+/g, ' ').trim();
    await shot(page, testInfo, 'J1-refused-book-load');
    expect(loadText).toBe(`${LOAD_ERROR} ${SENTENCE}`);
    await expectNoDiagnosis(page);

    // A mode switch starts a checkpoint, which the old store refuses: it records no error.
    await tab(page, EN['nav.understand']).click();
    await expect(tab(page, EN['nav.understand'])).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(2_000);
    const afterSwitch = ((await indicator(page).textContent()) ?? '').trim();
    expect(afterSwitch).not.toContain(CHECKPOINT_LABEL);
    await expectNoDiagnosis(page);

    // One Home click leaves; Home shows no banner, and no checkpoint is committed.
    const commitsBefore = commits.length;
    await page.getByTestId('project-switch').click();
    await expectHome(page);
    await expectNoHomeBanners(page);
    expect(commits.length, 'no checkpoint commit after the Home click').toBe(commitsBefore);
    await shot(page, testInfo, 'J1-home-after-leaving');

    // The next open loads the book that was refused.
    await bookTile(page, 'JON').click();
    await expect(heading(page, 'Jonah')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(LOAD_ERROR)).toHaveCount(0);
    record(testInfo, { loadText, indicatorAfterModeSwitch: afterSwitch, homeLeftInOneClick: true, commitsAfterHome: commits.length - commitsBefore, reopenedBook: 'Jonah' });
  });

  test('J2 a refused verse save keeps its text, shows the sentence next to the indicator, holds a mode switch, and Home leaves', TAG, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await allowStaleHook(page);
    await openTitusVerses(page);
    const before = diskVerse('1');
    const saved = `Pablo, siervo de Dios (#801 J2 saved ${RUN}).`;
    await typeVerse(page, '1', before, saved);
    await verseBox(page, '1').blur();
    await expect(indicator(page)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    await expect.poll(() => diskVerse('1'), { timeout: 15_000 }).toBe(saved);

    await makeStale(page);
    const refused = `Pablo, siervo refused (#801 J2 ${RUN}).`;
    await typeVerse(page, '1', saved, refused);
    await verseBox(page, '1').blur();
    await expect(indicator(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await expect(sentence(page)).toHaveText(SENTENCE);
    await expect(verseCard(page, refused)).toHaveCount(1);
    await expectNoDiagnosis(page);

    // The sentence sits next to the indicator, inside the window, at 1280 and 375 wide.
    const layout: Record<string, unknown> = {};
    const size = page.viewportSize()!;
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(sentence(page)).toBeVisible();
      const box = (await sentence(page).boundingBox())!;
      const ind = (await indicator(page).boundingBox())!;
      layout[width] = { sentence: box, indicator: ind };
      await shot(page, testInfo, `J2-sentence-${width}`);
      expect(box.x, `the sentence starts inside the window at ${width}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `the sentence ends inside the window at ${width}`).toBeLessThanOrEqual(width);
      expect(box.y, `the sentence is under the indicator at ${width}`).toBeGreaterThanOrEqual(ind.y + ind.height);
    }
    await page.setViewportSize(size);

    // Retry is refused again: the error, the sentence and the text stay.
    await indicator(page).getByRole('button', { name: EN['app.retry'] }).click();
    await page.waitForTimeout(1_500);
    await expect(indicator(page)).toHaveAttribute('data-state', 'error');
    await expect(sentence(page)).toHaveText(SENTENCE);
    await expect(verseCard(page, refused)).toHaveCount(1);

    // A mode switch stays held (FR-32).
    await tab(page, EN['nav.check']).click();
    await page.waitForTimeout(2_000);
    await expect(tab(page, EN['nav.draft'])).toHaveAttribute('aria-selected', 'true');
    await expect(heading(page)).toBeVisible();
    await expectNoDiagnosis(page);

    // One Home click leaves, and the refused text is not on disk.
    await page.getByTestId('project-switch').click();
    await expectHome(page);
    await expectNoHomeBanners(page);
    const diskAfterHome = diskVerse('1');
    expect(diskAfterHome).toBe(saved);

    // The next open shows the disk text, and the same edit saves.
    await bookTile(page, 'TIT').click();
    await expect(heading(page)).toBeVisible({ timeout: 120_000 });
    await tab(page, 'Verse').click();
    await expect(verseCard(page, saved)).toHaveCount(1);
    await expect(verseCard(page, refused)).toHaveCount(0);
    await typeVerse(page, '1', saved, refused);
    await verseBox(page, '1').blur();
    await expect(indicator(page)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    await expect.poll(() => diskVerse('1'), { timeout: 15_000 }).toBe(refused);
    record(testInfo, { sentence: SENTENCE, diskAfterHome: diskAfterHome === saved ? 'saved text' : diskAfterHome, diskAfterReedit: 'refused text saved', layoutWidths: Object.keys(layout) });
  });

  test('J2b idle queue: the user types and selects Home at once, and Home leaves on that click', TAG, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await allowStaleHook(page);
    await openTitusVerses(page);
    const before = diskVerse('1');
    await makeStale(page);
    const typed = `Pablo, typed then Home (#801 J2b ${RUN}).`;
    await typeVerse(page, '1', before, typed);
    // No separate blur: the click's own mousedown blurs the card, which flushes. On an idle
    // queue the old store refuses in microtasks, before the click runs, so Home finds the
    // refusal standing and drops the buffer (accepted by the owner, 2026-10-18).
    await page.getByTestId('project-switch').click();
    await expectHome(page);
    await expectNoHomeBanners(page);
    expect(diskVerse('1')).toBe(before);
    record(testInfo, { homeLeftOnFirstClick: true, diskUnchanged: true });
  });

  test('J3 the refusal arrives during Home\'s drain: the app stays once with the sentence, and the next Home leaves', TAG, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await allowStaleHook(page);
    await openTitusVerses(page);
    // Verses 1:2 and 1:3: the sample aligns only 1:1, and a saved edit of an aligned verse
    // stages an alignment reflow in a second buffer. Each buffer with unsent work can make
    // Home stay once (the issue's Interruptions); this journey proves the one-buffer case.
    const v2 = diskVerse('2');
    const v3 = diskVerse('3');
    const w1 = `Held write (#801 J3 W1 ${RUN}).`;
    const w2 = `Verse refused in the drain (#801 J3 W2 ${RUN}).`;

    // Without the hold, the refusal comes before the click (J2b). The hold keeps W1's
    // write in flight (it passed its queue check), so W2 waits behind it in Home's drain.
    const hold = await holdFirstSegment(page);
    await typeVerse(page, '2', v2, w1);
    await verseBox(page, '2').blur();
    await hold.reached;
    await makeStale(page);
    await typeVerse(page, '3', v3, w2);
    await page.getByTestId('project-switch').click();
    hold.release();

    await expect(indicator(page)).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await expect(heading(page)).toBeVisible();
    await expect(sentence(page)).toHaveText(SENTENCE);
    await expect(verseCard(page, w2)).toHaveCount(1);
    await expectNoDiagnosis(page);
    await shot(page, testInfo, 'J3-stayed-once');

    await page.getByTestId('project-switch').click();
    await expectHome(page);
    await expectNoHomeBanners(page);
    expect(diskVerse('2')).toBe(w1);
    expect(diskVerse('3')).toBe(v3);

    await bookTile(page, 'TIT').click();
    await expect(heading(page)).toBeVisible({ timeout: 120_000 });
    await tab(page, 'Verse').click();
    await expect(verseCard(page, w1)).toHaveCount(1);
    await expect(verseCard(page, w2)).toHaveCount(0);
    record(testInfo, { stayedOnce: true, disk12: 'W1', disk13: 'unchanged' });
  });

  test('J4 a refused comment save shows the sentence, not the Understand error, and leaves in one Home click', TAG, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await allowStaleHook(page);
    writeProjectPins(SEEDED_PROJECT, PINS());
    await openTitus(page);
    await tab(page, EN['nav.understand']).click();
    await expect(heading(page)).toBeVisible();
    await tab(page, 'Verse').click();
    await expect(page.getByTestId('helps-loading')).toHaveCount(0, { timeout: 30_000 });
    const box = page.getByTestId('understand-unit-v1').getByRole('textbox');
    await box.fill(`A comment that saves (#801 J4 ${RUN}).`);
    await box.blur();
    await expect(indicator(page)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

    await makeStale(page);
    const refused = `A comment the old store refuses (#801 J4 ${RUN}).`;
    await box.fill(refused);
    await box.blur();
    await expect(indicator(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await expect(sentence(page)).toHaveText(SENTENCE);
    await expect(page.getByTestId('understand-save-error')).toHaveCount(0);
    await expect(box).toHaveValue(refused);
    await expectNoDiagnosis(page);
    await shot(page, testInfo, 'J4-refused-comment');

    await page.getByTestId('project-switch').click();
    await expectHome(page);
    await expectNoHomeBanners(page);
    record(testInfo, { sentence: SENTENCE, understandSaveError: 0, homeLeftInOneClick: true });
  });

  test('J5 a refused check decision shows the sentence, not the Check error, and leaves in one Home click', TAG, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await allowStaleHook(page);
    writeProjectPins(SEEDED_PROJECT, PINS());
    restateRecordAsEnglish('translationNotes', 'TIT');
    await openTitus(page);
    await tab(page, EN['nav.check']).click();
    await page.getByTestId('open-translationNotes').click();
    await expect(page.getByTestId('check-progress')).toBeVisible({ timeout: 60_000 });
    const undecided = () => page.getByTestId('check-list').locator('button[data-decided="0"]').first();

    await undecided().click();
    await page.getByTestId('mark-valid').click();
    await expect(indicator(page)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

    await makeStale(page);
    await undecided().click();
    await page.getByTestId('mark-valid').click();
    await expect(indicator(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await expect(sentence(page)).toHaveText(SENTENCE);
    await expect(page.getByTestId('save-error')).toHaveCount(0);
    await expectNoDiagnosis(page);
    await shot(page, testInfo, 'J5-refused-decision');

    await page.getByTestId('project-switch').click();
    await expectHome(page);
    await expectNoHomeBanners(page);
    record(testInfo, { sentence: SENTENCE, checkSaveError: 0, homeLeftInOneClick: true });
  });

  test('J6 control: a save that fails for another reason holds Home over two clicks and shows no sentence (FR-32)', TAG, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    // Every journal segment POST answers 500. A failure on TIT.usfm alone would not hold
    // Home: Home's retry would find the segment accepted and nothing to publish.
    const fail = (route: Route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'J6 control' }) : route.fallback();
    await openTitusVerses(page);
    const before = diskVerse('1');
    const typed = `Pablo, a write that fails (#801 J6 ${RUN}).`;
    await page.route(isSegmentWrite, fail);
    await typeVerse(page, '1', before, typed);
    await verseBox(page, '1').blur();
    await expect(indicator(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await expect(sentence(page)).toHaveCount(0);

    for (const click of [1, 2]) {
      await page.getByTestId('project-switch').click();
      await page.waitForTimeout(2_000);
      await expect(heading(page), `Home click ${click} stays in the project`).toBeVisible();
      await expect(indicator(page)).toHaveAttribute('data-state', 'error');
      await expect(sentence(page)).toHaveCount(0);
    }
    expect(diskVerse('1')).toBe(before);

    await page.unroute(isSegmentWrite, fail);
    await indicator(page).getByRole('button', { name: EN['app.retry'] }).click();
    await expect(indicator(page)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    await expect.poll(() => diskVerse('1'), { timeout: 15_000 }).toBe(typed);
    const indicatorAfterRetry = await indicatorState(page);
    await page.getByTestId('project-switch').click();
    await expectHome(page);
    record(testInfo, { heldOverTwoClicks: true, sentenceShown: false, savedAfterRetry: true, indicatorAfterRetry });
  });
});

// ---------------------------------------------------------------------------
// J1b — the one-window route, with a real sync (last: it shares the project)
// ---------------------------------------------------------------------------

const ORG = USER.username;
const REPO = `sync801_${RUN}`;
const MIRROR_DIR = path.join(RIG_LOCAL_REPOS, '..', '_archive_', `${ORG}--${REPO}`);
const FIXED_DIR = path.join(RIG_LOCAL_REPOS, '..', '..', 'file', ORG, REPO);
const JOURNAL = 'ingredients/checking/journal';

/** The bare remote at <tmp>/<org>/<repo>.git (cloneSourceOf reads org and repo from the url). */
function makeOrgRemote(): BareRemote {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-sync801-'));
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

/** A teammate changes TIT 1:`verse` on Door43 main: one sealed segment, pushed with git. */
function teammateChangesVerse(remote: BareRemote, actor: string, verse: string, text: string): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-sync801-team-'));
  try {
    execFileSync('git', ['clone', '-q', pathToFileURL(remote.bare).href, work]);
    const journalDir = path.join(work, JOURNAL);
    const union = readUnion(journalDir) as Array<{ ts: string }>;
    const base = ((fold(union) as unknown as { headsTs?: Record<string, string> }).headsTs ?? {})[`text|TIT|1:${verse}`];
    expect(base, `Door43 main holds the head of TIT 1:${verse}`).toBeTruthy();
    const last = union.map((e) => e.ts).sort().pop();
    const clock = makeClock(actor, () => Date.now());
    clock.ratchet(last);
    const event = { v: 1, op: 'text.verse.set', actor, ts: clock.issue(), base, book: 'TIT', chapter: '1', verse, text: `${text}\n` };
    writeActionSegment(actorDirFor(journalDir, actor), [event]);
    git(work, '-c', 'user.name=teammate', '-c', 'user.email=teammate@rig.test', 'add', JOURNAL);
    git(work, '-c', 'user.name=teammate', '-c', 'user.email=teammate@rig.test', 'commit', '-q', '-m', `a teammate changes TIT 1:${verse}`);
    git(work, 'push', '-q', 'origin', 'main');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const syncButton = (page: Page) => page.getByTestId(`share-${ID}`);

test.describe('#801 J1b — the one-window route', () => {
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

  test('J1b open, then Sync at once: the open goes on with its old store, its book load shows the sentence, and Home leaves', TAG, async ({ page, context }, testInfo) => {
    test.setTimeout(600_000);
    const log: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.pathname.startsWith('/api/')) log.push(`${r.method()} ${decodeURIComponent(url.pathname)}`);
    });
    const commits = projectCommits(page);
    await fakeShare(context, remote);

    // ---- setup: open once (the journal is seeded), the first share, the mirror ----
    await openTitus(page);
    await page.goto('/');
    await expect(page.getByTestId(`share-card-${ID}`)).toHaveAttribute('data-action', 'share');
    await syncButton(page).click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
    await page.getByTestId('share-next').click();
    await page.getByTestId('share-submit').click();
    await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('share-close').click();
    expect(remote.main(), 'the first share pushed main').not.toBeNull();
    execFileSync('git', ['clone', '-q', pathToFileURL(remote.bare).href, MIRROR_DIR]);
    // The server's own clone writes a local identity; add-and-commit panics without one (#676).
    execFileSync('git', ['-C', MIRROR_DIR, 'config', 'user.name', 'rig']);
    execFileSync('git', ['-C', MIRROR_DIR, 'config', 'user.email', 'rig@localhost']);
    // A new page load reads `origin` again. The internet is off at each start (D95), and
    // the page holds no sign-in, so its first sync asks for both. The route below then
    // runs in a page that has both, and its Sync press starts the sync at once.
    await page.goto('/');
    await expect(syncButton(page)).toHaveText('Sync with Door43', { timeout: 60_000 });
    await syncButton(page).click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('sync-result')).toHaveAttribute('data-ok', '1', { timeout: 180_000 });
    await page.getByTestId('sync-dismiss').click();

    // ---- a teammate changes TIT 1:2 on Door43 main ----
    const teammate = `Versículo del compañero (#801 J1b ${RUN}).`;
    teammateChangesVerse(remote, 'r801teammate0001', '2', teammate);

    // ---- the route: hold the open's presentation read until the sync has ended ----
    // The open reads the project metadata two times. The second read comes after the
    // second current-project bind (projectPresentation), after the store opened; holding it
    // keeps `project` unset, so the sync's afterSync does not open the project again.
    let binds = 0;
    let held = false;
    let onReached!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (onReached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname.startsWith('/api/'), async (route: Route) => {
      const r = route.request();
      const p = decodeURIComponent(new URL(r.url()).pathname);
      if (r.method() === 'POST' && p === `/api/app-state/current-project/${ID}`) binds += 1;
      if (!held && binds >= 2 && r.method() === 'GET' && p === `/api/burrito/metadata/raw/${ID}`) {
        held = true;
        onReached();
        await gate;
      }
      await route.fallback().catch(() => {});
    });
    const from = log.length;
    await bookTile(page, 'TIT').click();
    await syncButton(page).click({ timeout: 2_000 });
    const holdReached = await Promise.race([reached.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), 60_000))]);
    const syncEnded = holdReached
      ? await expect(page.getByTestId('sync-result')).toHaveCount(1, { timeout: 180_000 }).then(() => true, () => false)
      : false;
    release();

    // Validity: the open entered the project queue first, and its book load was refused.
    const turns = log.slice(from);
    const openAt = turns.indexOf(`POST /api/app-state/current-project/${ID}`);
    const syncAt = turns.indexOf(`GET /api/git/remotes/${ID}`);
    const loadError = page.getByText(LOAD_ERROR);
    const refusedLoad = await expect(loadError).toBeVisible({ timeout: 60_000 }).then(() => true, () => false);
    const observed = { holdReached, syncEnded, openAt, syncAt, openFirst: openAt >= 0 && syncAt >= 0 && openAt < syncAt, refusedLoad };
    if (!observed.holdReached || !observed.syncEnded || !observed.openFirst || !observed.refusedLoad) {
      record(testInfo, { route: observed });
      throw new Error(`route missed: ${JSON.stringify(observed)}`);
    }
    await shot(page, testInfo, 'J1b-refused-book-load');
    const loadText = (await loadError.innerText()).replace(/\s+/g, ' ').trim();
    expect(loadText).toBe(`${LOAD_ERROR} ${SENTENCE}`);
    await expectNoDiagnosis(page);

    // One Home click leaves; Home shows no banner.
    const commitsBefore = commits.length;
    await page.getByTestId('project-switch').click();
    await expectHome(page);
    await expectNoHomeBanners(page);
    expect(commits.length, 'no checkpoint commit after the Home click').toBe(commitsBefore);
    await shot(page, testInfo, 'J1b-home-after-leaving');
    const result = page.getByTestId('sync-dismiss');
    if (await result.count()) await result.click();

    // The next open loads the book and shows the teammate's synced verse.
    expect(diskVerse('2')).toBe(teammate);
    await bookTile(page, 'TIT').click();
    await expect(heading(page)).toBeVisible({ timeout: 120_000 });
    await tab(page, 'Verse').click();
    await expect(verseCard(page, teammate)).toHaveCount(1);
    record(testInfo, { route: { holdReached, syncEnded, openFirst: observed.openFirst, refusedLoad }, loadText, homeLeftInOneClick: true, teammateVerseShown: true });
  });
});

// ---------------------------------------------------------------------------
// Fixtures for J4 and J5 (as e2e/j16-understand.spec.ts and e2e/j04-check-book.spec.ts)
// ---------------------------------------------------------------------------

function PINS() {
  return {
    tn: pinForSideloaded('en_tn', 'v91'),
    twl: pinForSideloaded('en_twl', 'v91'),
    tw: pinForSideloaded('en_tw', 'v91'),
    ta: pinForSideloaded('en_ta', 'v91'),
  };
}

/** Restate the seeded sample's checked-against record as the English pin the project now
 * holds (the j04 pattern): under D59 a decision write against a drifted record refuses. */
function restateRecordAsEnglish(tool: string, book: string): void {
  const en = PINS();
  const file = readDecisionFile(SEEDED_PROJECT, tool, book);
  if (!file) return;
  (file as { resource?: unknown }).resource = { repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'primary' };
  const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', tool, `${book}.json`);
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}
